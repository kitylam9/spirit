import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AssetManifest, BodyStats, Civilization, ClientMessage, FoundObject, GameEvent, LlmStatus, LooseObject, NPC, Planet, PlayerState, Scene, ServerMessage, SettingsInfo, UILayout } from "@spirit/shared";
import { exitTarget, npcSpawns } from "@spirit/shared";
import { config, defaultModel, llmDefaults } from "./config.js";
import { scoutAsset } from "./agents/assetScout.js";
import { getManifest } from "./assets/catalog.js";
import { drawObjects, objaverseAvailable, warmPool } from "./assets/objaverse.js";
import { sketchfabEnabled } from "./assets/sketchfab.js";
import { applySettings, settings } from "./settings.js";
import { createCivilization } from "./agents/civilization.js";
import { createEpitaph, createEvent, createGoal, type LifeGoal } from "./agents/narrative.js";
import { npcReply, populateScene } from "./agents/npc.js";
import { appraise, proceduralObjects } from "./agents/objectAppraiser.js";
import { designScene, foodItemId } from "./agents/sceneDesigner.js";
import { generateHud } from "./agents/uiGenerator.js";
import { detailPlanet, nameSystem, type SystemNames } from "./agents/worldArchitect.js";
import { KNOCK_OFF_DAMAGE, MAX_PARTS, bodyStats, type Body } from "./rules/body.js";
import * as rules from "./rules/engine.js";
import { Rng, newSeed } from "./util/rng.js";
import { clamp, clip } from "./util/text.js";
import { validate } from "./validate.js";
import { TIERS } from "./world/templates.js";

/** Fewer real objects than this (offline, no cache) are topped up with procedural shapes. */
const MIN_LOOT = 6;
type Vec3 = [number, number, number];
import { generateSystem, systemSummary, toSummary, type ProceduralSystem } from "./world/universe.js";

/** One universe = one life (docs/01-game-design.md §7). */
interface World {
  system: ProceduralSystem;
  names: SystemNames;
  planets: Record<string, Planet>;
  civs: Record<string, Civilization>;
  huds: Record<string, UILayout>;
  scenes: Record<string, Scene>;
  npcs: Record<string, NPC>;
  /** Every found object that appeared in this universe, by id. */
  objects: Record<string, FoundObject>;
  /** Loose objects per scene id. */
  loose: Record<string, LooseObject[]>;
}

interface Life {
  goal: LifeGoal | null;
  deeds: string[];
  dialogue: Record<string, { speaker: "player" | "npc"; text: string }[]>;
  hostile: string[];
  jobs: Record<string, number>;
  activeEvent: GameEvent | null;
  eventCount: number;
  lastEventTick: number;
  recentEventTitles: string[];
}

interface SaveFile {
  player: PlayerState;
  world: World;
  life: Life;
}

const newLife = (tick: number): Life => ({ goal: null, deeds: [], dialogue: {}, hostile: [], jobs: {}, activeEvent: null, eventCount: 0, lastEventTick: tick, recentEventTitles: [] });

export class Session {
  private sockets = new Set<(m: ServerMessage) => void>();
  private world!: World;
  private life!: Life;
  private pending = new Map<string, Promise<unknown>>();
  private nextWorld: Promise<World> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private dying = false;
  private eventInFlight = false;
  private rng = new Rng(newSeed());
  private saveTimer: NodeJS.Timeout | null = null;

  private constructor(public player: PlayerState) {}

  static async load(playerId: string | undefined): Promise<Session> {
    const id = playerId && /^player-[a-z0-9-]+$/.test(playerId) ? playerId : `player-${newSeed().slice(0, 10)}`;
    const file = join(config.dataDir, `${id}.json`);
    if (existsSync(file)) {
      try {
        const save = JSON.parse(readFileSync(file, "utf8")) as SaveFile;
        // 1.1 -> 1.2 only added optional fields.
        save.player.schemaVersion = "1.2";
        const s = new Session(save.player);
        s.world = save.world;
        s.world.objects ??= {};
        s.world.loose ??= {};
        s.life = save.life;
        if (s.player.location.phase === "reflection") {
          // Died before pressing continue: the save already holds the next universe seed.
          if (s.player.spirit.energy <= 0) rules.startNewRun(s.player);
          s.world = await Session.buildWorld(s.player.universeSeed);
          s.life = newLife(s.player.time.tick);
          rules.startNewUniverse(s.player, s.world.system.id, s.player.universeSeed);
        }
        if (s.player.location.phase === "descent") s.player.location.phase = "space";
        if (s.player.location.phase === "planet" && !s.player.incarnation && !s.player.location.sceneId) s.player.location = { phase: "space", systemId: s.world.system.id };
        return s;
      } catch (err) {
        console.warn(`[session] could not load ${file}: ${(err as Error).message}`);
      }
    }
    const s = new Session(rules.newPlayer(id));
    s.world = await Session.buildWorld(s.player.universeSeed);
    s.player.location.systemId = s.world.system.id;
    s.life = newLife(0);
    return s;
  }

  private static async buildWorld(universeSeed: string): Promise<World> {
    const system = generateSystem(universeSeed);
    const names = await nameSystem(system);
    return { system, names, planets: {}, civs: {}, huds: {}, scenes: {}, npcs: {}, objects: {}, loose: {} };
  }

  attach(send: (m: ServerMessage) => void): () => void {
    this.sockets.add(send);
    this.ensureTimer();
    return () => {
      this.sockets.delete(send);
      if (!this.sockets.size && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
        this.saveNow();
      }
    };
  }

  private send(m: ServerMessage): void {
    for (const s of this.sockets) s(m);
  }

  private toast(text: string, tone: "info" | "good" | "bad" | "mystic" = "info"): void {
    this.send({ type: "toast", text, tone });
  }

  private pushState(): void {
    this.capHealth();
    this.send({ type: "state", player: this.player });
    this.scheduleSave();
  }

  // ---------- persistence ----------

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 3000);
  }

  private saveNow(): void {
    const check = validate("player-state", this.player);
    if (!check.ok) console.warn(`[session] player-state invalid: ${check.errors}`);
    mkdirSync(config.dataDir, { recursive: true });
    const save: SaveFile = { player: this.player, world: this.world, life: this.life };
    writeFileSync(join(config.dataDir, `${this.player.id}.json`), JSON.stringify(save));
  }

  // ---------- views ----------

  systemView() {
    const w = this.world;
    return systemSummary(
      w.system,
      w.names.systemName,
      w.system.planets.map((p, i) => toSummary(p, w.names.planets[i].name, w.names.planets[i].omen, !!w.planets[p.id])),
    );
  }

  welcome(llmStatus: LlmStatus): void {
    this.send({ type: "welcome", player: this.player, system: this.systemView(), llm: llmStatus });
    this.sendSettings();
    const loc = this.player.location;
    if (loc.phase === "planet" && loc.planetId && loc.sceneId) {
      this.send({ type: "planet.detail", planet: this.world.planets[loc.planetId], civilization: this.world.civs[this.world.planets[loc.planetId].civilizationId] });
      this.sendScene(loc.sceneId);
      if (this.life.activeEvent) this.send({ type: "event", event: this.life.activeEvent });
    }
  }

  private sendScene(sceneId: string): void {
    const scene = this.world.scenes[sceneId];
    const npcs = npcSpawns(scene).map((s) => this.world.npcs[s.npcId!]).filter(Boolean);
    const assets = [...new Set(scene.instances.map((i) => i.assetRef).filter((id): id is string => !!id))].map(getManifest).filter((m): m is AssetManifest => !!m);
    this.send({ type: "scene", scene, npcs, ui: this.world.huds[scene.planetId], assets });
    this.resolveAssets(scene);
    this.ensureLoot(scene);
  }

  // ---------- found bodies (docs/09-found-bodies.md) ----------

  private bodyStats(): BodyStats | null {
    const body = this.player.incarnation?.body;
    return body ? bodyStats(body, this.world.objects) : null;
  }

  private capHealth(): void {
    const stats = this.bodyStats();
    const inc = this.player.incarnation;
    if (stats && inc && inc.stats.health > stats.maxHealth) inc.stats.health = stats.maxHealth;
  }

  private sendFound(): void {
    const sceneId = this.player.location.sceneId;
    if (this.player.location.phase !== "planet" || !sceneId) return;
    const loose = this.world.loose[sceneId] ?? [];
    const body = this.player.incarnation?.body;
    const ids = new Set([...loose.map((l) => l.objectId), ...(body ? [body.core, ...body.parts].map((p) => p.objectId) : [])]);
    const objects = [...ids].map((id) => this.world.objects[id]).filter(Boolean);
    const assets = objects.map((o) => (o.assetRef ? getManifest(o.assetRef) : undefined)).filter((m): m is AssetManifest => !!m);
    this.send({ type: "found", sceneId, loose, objects, assets, body: this.bodyStats() });
  }

  /** Random spot inside the scene, clear of the center and of placed instances. */
  private lootSpot(scene: Scene): Vec3 {
    const rx = Math.min(scene.bounds.sizeX / 2 - 3, 24);
    const rz = Math.min(scene.bounds.sizeZ / 2 - 3, 24);
    let spot: Vec3 = [0, 0, 4];
    for (let i = 0; i < 20; i++) {
      spot = [this.rng.range(-rx, rx), 0, this.rng.range(-rz, rz)];
      if (Math.hypot(spot[0], spot[2]) < 3) continue;
      if (!scene.instances.some((inst) => Math.hypot(inst.transform.position[0] - spot[0], inst.transform.position[2] - spot[2]) < 2.5)) break;
    }
    return spot;
  }

  /** Scatters objects over a scene the first time it is shown; the scene is playable meanwhile. */
  private ensureLoot(scene: Scene): void {
    const w = this.world;
    if (w.loose[scene.id]) return this.sendFound();
    this.once(`loot:${scene.id}`, async () => {
      const planet = w.planets[scene.planetId];
      const civ = w.civs[planet.civilizationId];
      if (!this.player.incarnation) this.toast("Strange objects are falling from the sky…", "mystic");
      const count = settings.gameplay.objectsPerScene;
      const minLoot = Math.min(MIN_LOOT, count);
      const manifests = await drawObjects(count);
      const objects = manifests.length ? await appraise(manifests, planet, civ) : [];
      if (objects.length < minLoot) objects.push(...proceduralObjects(minLoot - objects.length, planet.physical.palette, this.rng));
      if (this.world !== w) return;
      for (const o of objects) w.objects[o.id] = o;
      w.loose[scene.id] = objects.map((o) => ({ objectId: o.id, position: this.lootSpot(scene), rotationY: this.rng.range(0, Math.PI * 2) }));
      this.scheduleSave();
      if (this.player.location.sceneId === scene.id) this.sendFound();
    }).catch((err) => console.warn(`[found] ${scene.id}: ${(err as Error).message}`));
  }

  private async pickup(msg: Extract<ClientMessage, { type: "pickup" }>): Promise<void> {
    const loc = this.player.location;
    if (loc.phase !== "planet" || !loc.planetId || !loc.sceneId || this.busy) return;
    const loose = this.world.loose[loc.sceneId] ?? [];
    const idx = loose.findIndex((l) => l.objectId === msg.objectId);
    const obj = this.world.objects[msg.objectId];
    if (idx < 0 || !obj) return;
    const inc = this.player.incarnation;
    // The client already shows a placement preview; the `found` message resets it.
    const reject = (text: string) => (this.toast(text, "bad"), this.sendFound());
    if (inc && !inc.body) return reject("This old body cannot hold found objects.");
    if (inc?.body && inc.body.parts.length >= MAX_PARTS) return reject(`A body holds at most ${MAX_PARTS} parts. Drop one first (X).`);
    const finite = (v: unknown, lim: number): Vec3 =>
      (Array.isArray(v) && v.length === 3 ? v : [0, 0, 0]).map((n) => clamp(Number.isFinite(n) ? Number(n) : 0, -lim, lim)) as Vec3;
    const part: Body["core"] = {
      partId: `part-${Date.now().toString(36)}-${this.rng.int(0, 1295).toString(36)}`,
      objectId: obj.id,
      position: inc ? finite(msg.position, 3) : [0, 0, 0],
      rotation: finite(msg.rotation, Math.PI),
      scale: clamp(Number(msg.scale) || 1, 0.5, 2),
    };
    loose.splice(idx, 1);
    loc.position = finite(msg.at, 2000);
    if (inc?.body) {
      inc.body.parts.push(part);
      this.toast(`Attached the ${obj.name}.`, "good");
    } else await this.beginLife(part, obj);
    // State first: the client builds the body from player state when `found` arrives.
    this.pushState();
    this.sendFound();
  }

  /** The wisp placed its core: the rules engine creates the life (docs/09-found-bodies.md §1). */
  private async beginLife(core: Body["core"], obj: FoundObject): Promise<void> {
    const loc = this.player.location;
    const planet = this.world.planets[loc.planetId!];
    const civ = this.world.civs[planet.civilizationId];
    const person = this.rng.pick(civ.naming.personExamples.filter((n) => !Object.values(this.world.npcs).some((x) => x.name === n))) ?? "Nameless";
    rules.assemble(this.player, { planetId: planet.id, tier: planet.tier, civ, name: clip(`${person.split(" ")[0]} the ${obj.name}`, 60), core, foodItemId: foodItemId(civ) });
    this.player.incarnation!.stats.health = this.bodyStats()!.maxHealth;
    this.life = newLife(this.player.time.tick);
    this.busy = true;
    try {
      const goal = await createGoal(planet, civ, this.player);
      this.life.goal = goal;
      this.player.incarnation!.goals = [{ goalId: goal.goalId, title: goal.title, status: "active" }];
    } finally {
      this.busy = false;
    }
    this.toast(`You settle into the ${obj.name}. You are ${this.player.incarnation!.vessel.name}.`, "mystic");
  }

  private drop(msg: Extract<ClientMessage, { type: "drop" }>): void {
    const inc = this.player.incarnation;
    const sceneId = this.player.location.sceneId;
    if (!inc?.body || !sceneId || this.busy) return;
    const parts = inc.body.parts;
    const idx = msg.partId ? parts.findIndex((p) => p.partId === msg.partId) : parts.length - 1;
    if (idx < 0) return this.toast("Only the core is left; it holds you together.", "bad");
    const at = (Array.isArray(msg.at) ? msg.at : this.player.location.position ?? [0, 0, 0]).map((n) => clamp(Number(n) || 0, -2000, 2000)) as Vec3;
    this.player.location.position = at;
    this.looseNear(parts.splice(idx, 1)[0].objectId, sceneId);
    this.pushState();
    this.sendFound();
  }

  private looseNear(objectId: string, sceneId: string): void {
    const at = this.player.location.position ?? [0, 0, 0];
    const a = this.rng.range(0, Math.PI * 2);
    (this.world.loose[sceneId] ??= []).push({ objectId, position: [at[0] + Math.cos(a) * 1.5, 0, at[2] + Math.sin(a) * 1.5], rotationY: a });
  }

  /** A single hit of KNOCK_OFF_DAMAGE or more knocks a random non-core part off. */
  private checkKnockOff(healthBefore: number): void {
    const inc = this.player.incarnation;
    const sceneId = this.player.location.sceneId;
    if (!inc?.body?.parts.length || !sceneId || healthBefore - inc.stats.health < KNOCK_OFF_DAMAGE) return;
    const part = inc.body.parts.splice(this.rng.int(0, inc.body.parts.length - 1), 1)[0];
    this.looseNear(part.objectId, sceneId);
    this.toast(`Your ${this.world.objects[part.objectId]?.name ?? "part"} is knocked off!`, "bad");
    this.sendFound();
  }

  private vesselText(): string {
    const inc = this.player.incarnation!;
    if (!inc.body) return `${inc.vessel.role} named ${inc.vessel.name}`;
    const name = (id: string) => this.world.objects[id]?.name ?? "something";
    const parts = inc.body.parts.map((p) => name(p.objectId));
    return `strange being named ${inc.vessel.name}, a spirit wearing a body of found objects: a ${name(inc.body.core.objectId)}${parts.length ? ` with ${parts.join(", ")} stuck on` : ""}`;
  }

  /** Asks the Asset Scout for every request without a usable model; the scene is already playable meanwhile. */
  private resolveAssets(scene: Scene): void {
    const byQuery = new Map<string, Scene["instances"]>();
    for (const inst of scene.instances) {
      if (!inst.assetRequest || (inst.assetRef && getManifest(inst.assetRef))) continue;
      const key = `${inst.assetRequest.query}|${inst.assetRequest.maxTriangles}`;
      byQuery.set(key, [...(byQuery.get(key) ?? []), inst]);
    }
    for (const [key, insts] of byQuery) {
      const r = insts[0].assetRequest!;
      this.once(`asset:${scene.id}:${key}`, () =>
        scoutAsset({ query: r.query, expectedSize: r.expectedSize, maxTriangles: r.maxTriangles ?? 20000, tier: scene.tier, requestedBy: scene.id }),
      )
        .then((m) => {
          if (!m) return;
          for (const i of insts) i.assetRef = m.id;
          this.send({ type: "asset", sceneId: scene.id, manifest: m, instanceIds: insts.map((i) => i.id) });
          this.scheduleSave();
        })
        .catch((err) => console.warn(`[assets] ${scene.id} "${r.query}": ${(err as Error).message}`));
    }
  }

  // ---------- generation (deduplicated) ----------

  private once<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let p = this.pending.get(key) as Promise<T> | undefined;
    if (!p) {
      p = fn().finally(() => this.pending.delete(key));
      this.pending.set(key, p);
    }
    return p;
  }

  private async ensurePlanet(planetId: string): Promise<{ planet: Planet; civ: Civilization }> {
    const w = this.world;
    if (w.planets[planetId]) return { planet: w.planets[planetId], civ: w.civs[w.planets[planetId].civilizationId] };
    return this.once(`planet:${planetId}`, async () => {
      const idx = w.system.planets.findIndex((p) => p.id === planetId);
      if (idx < 0) throw new Error(`unknown planet ${planetId}`);
      this.send({ type: "loading", what: `Dreaming up ${w.names.planets[idx].name}…`, done: false });
      const planet = await detailPlanet(w.system.planets[idx], w.system.id, w.names.planets[idx].name, w.names.planets[idx].omen);
      const civ = await createCivilization(planet);
      const hud = await generateHud(planet, civ);
      if (this.world !== w) throw new Error("universe changed");
      w.planets[planet.id] = planet;
      w.civs[civ.id] = civ;
      w.huds[planet.id] = hud;
      this.send({ type: "loading", what: "", done: true });
      this.send({ type: "planet.summary", planet: toSummary(w.system.planets[idx], planet.name, planet.omen, true) });
      this.scheduleSave();
      return { planet, civ };
    });
  }

  private async ensureScene(planet: Planet, civ: Civilization, regionId: string): Promise<Scene> {
    const w = this.world;
    const existing = Object.values(w.scenes).find((s) => s.planetId === planet.id && s.regionId === regionId);
    if (existing) return existing;
    return this.once(`scene:${planet.id}:${regionId}`, async () => {
      const region = planet.regions.find((r) => r.id === regionId)!;
      this.send({ type: "loading", what: `Shaping ${region.name}…`, done: false });
      const existingRegions = new Set(Object.values(w.scenes).filter((s) => s.planetId === planet.id).map((s) => s.regionId));
      const scene = await designScene(planet, civ, region, existingRegions);
      this.send({ type: "loading", what: `Populating ${scene.name}…`, done: false });
      const npcs = await populateScene(planet, civ, scene, new Set(Object.keys(w.npcs)));
      for (const n of npcs) w.npcs[n.id] = n;
      w.scenes[scene.id] = scene;
      this.send({ type: "loading", what: "", done: true });
      return scene;
    });
  }

  // ---------- message handling ----------

  async handle(msg: ClientMessage): Promise<void> {
    try {
      switch (msg.type) {
        case "approach":
          warmPool();
          await this.ensurePlanet(msg.planetId).then(({ planet, civ }) => this.send({ type: "planet.detail", planet, civilization: civ }));
          break;
        case "incarnate":
          await this.descend(msg.planetId);
          break;
        case "pickup":
          await this.pickup(msg);
          break;
        case "drop":
          this.drop(msg);
          break;
        case "space.tick":
          if (this.player.location.phase === "space" && rules.spaceDecay(this.player, 1, msg.boosting ? 3 : 1)) await this.spiritExtinguished();
          else this.send({ type: "state", player: this.player });
          break;
        case "action":
          await this.action(msg.action.verb, msg.action.params ?? {});
          break;
        case "dialogue.start":
          this.dialogueStart(msg.npcId);
          break;
        case "dialogue.say":
          await this.dialogueSay(msg.npcId, msg.text);
          break;
        case "event.choose":
          this.chooseEvent(msg.eventId, msg.choiceId);
          break;
        case "reflect.continue":
          await this.reflectContinue();
          break;
        case "settings.get":
          this.sendSettings();
          break;
        case "settings.set":
          await applySettings(msg.settings);
          if (Object.hasOwn(rules.DIFFICULTY, msg.difficulty)) this.player.difficulty = msg.difficulty;
          this.sendSettings();
          this.pushState();
          this.toast("Settings saved.", "good");
          break;
        case "restart":
          await this.restart();
          break;
        case "hello":
          break;
      }
    } catch (err) {
      console.error(`[session] ${msg.type} failed:`, err);
      this.send({ type: "error", message: (err as Error).message });
      this.send({ type: "loading", what: "", done: true });
    }
  }

  private async descend(planetId: string): Promise<void> {
    if (this.player.location.phase !== "space" || this.busy) return;
    const cost = settings.gameplay.descentCost;
    if (cost > 0 && this.player.spirit.energy <= cost) {
      this.toast(`Not enough Spirit Energy to descend (${cost} needed).`, "bad");
      return;
    }
    this.busy = true;
    try {
      this.player.location.phase = "descent";
      this.pushState();
      const { planet, civ } = await this.ensurePlanet(planetId);
      const region = planet.regions[0];
      const scene = await this.ensureScene(planet, civ, region.id);
      const spawn = scene.spawnPoints.find((s) => s.purpose === "arrival") ?? scene.spawnPoints[0];
      rules.descend(this.player, { planetId: planet.id, regionId: region.id, sceneId: scene.id, position: spawn.position as Vec3 });
      this.life = newLife(this.player.time.tick);
      this.send({ type: "planet.detail", planet, civilization: civ });
      this.sendScene(scene.id);
      this.pushState();
      this.toast("You drift down as a wisp of light. Find something to wear (E).", "mystic");
      this.ensureTimer();
    } catch (err) {
      this.player.location.phase = "space";
      this.pushState();
      throw err;
    } finally {
      this.busy = false;
    }
  }

  /** Null unless on a planet; also null for a wisp unless `wispOk`. */
  private currentContext(wispOk = false) {
    const loc = this.player.location;
    if (loc.phase !== "planet" || !loc.planetId || !loc.sceneId || (!this.player.incarnation && !wispOk)) return null;
    const planet = this.world.planets[loc.planetId];
    const civ = this.world.civs[planet.civilizationId];
    const scene = this.world.scenes[loc.sceneId];
    const region = planet.regions.find((r) => r.id === scene.regionId)!;
    return { planet, civ, scene, region };
  }

  private deed(text: string): void {
    this.life.deeds.push(text);
    if (this.life.deeds.length > 30) this.life.deeds.shift();
  }

  /** Time skip with a single hazard roll; returns false if the player died. */
  private async skip(ticks: number): Promise<boolean> {
    const ctx = this.currentContext(true)!;
    const before = this.player.incarnation?.stats.health ?? 0;
    const out = rules.advance(this.player, ctx.civ, ctx.region.danger, ticks, this.rng, false);
    for (const m of out.messages) this.toast(m.text, m.tone);
    this.checkKnockOff(before);
    if (out.deathCause) {
      await this.die(out.deathCause);
      return false;
    }
    return true;
  }

  private async action(verb: string, params: Record<string, string | number | boolean>): Promise<void> {
    const ctx = this.currentContext(verb === "travel");
    if (!ctx || this.busy) return;
    const { planet, civ, scene } = ctx;
    const inc = this.player.incarnation!;
    const t = TIERS[planet.tier];
    const cur = civ.economy.currency.name;
    const wage = civ.balance?.dailyWageBase ?? 6;

    switch (verb) {
      case "buy": {
        const npc = params.npcId ? this.world.npcs[String(params.npcId)] : undefined;
        const itemId = String(params.itemId ?? foodItemId(civ));
        const stock = npc?.inventory?.find((i) => i.itemId === itemId && i.forSale && i.qty > 0);
        const price = stock?.value ?? civ.balance?.foodPriceBase ?? 2;
        const name = stock?.name ?? t.food.name;
        if (npc && this.life.hostile.includes(npc.id)) return this.toast(`${npc.name} refuses to deal with you.`, "bad");
        if (inc.stats.wealth < price) return this.toast(`You can't afford ${name} (${price} ${cur}).`, "bad");
        inc.stats.wealth -= price;
        if (stock) stock.qty--;
        rules.addItem(this.player, itemId, name);
        this.toast(`Bought ${name} for ${price} ${cur}.`, "good");
        break;
      }
      case "eat": {
        const itemId = String(params.itemId ?? foodItemId(civ));
        if (!rules.removeItem(this.player, itemId)) return this.toast("You have nothing to eat.", "bad");
        inc.stats.hunger += t.food.nourish;
        inc.stats.resolve += 2;
        rules.clampStats(inc.stats);
        this.toast(`You eat. Hunger +${t.food.nourish}.`, "good");
        if (!(await this.skip(10))) return;
        break;
      }
      case "rest": {
        const atHome = params.interactableId === "int-home";
        this.toast(atHome ? "You sleep through the night…" : "You rest for an hour.", "info");
        if (!(await this.skip(atHome ? 480 : 60))) return;
        inc.stats.energy = atHome ? 100 : inc.stats.energy + 20;
        inc.stats.health += atHome ? 15 : 3;
        rules.clampStats(inc.stats);
        break;
      }
      case "work": {
        const employer = params.npcId ? String(params.npcId) : undefined;
        const pay = Math.round((employer && this.life.jobs[employer] ? this.life.jobs[employer] : wage * 0.5) * (this.bodyStats()?.payMultiplier ?? 1) * 100) / 100;
        if (inc.stats.energy < 15) return this.toast("You are too exhausted to work.", "bad");
        this.toast(`You work for four hours at the ${t.workplace}…`, "info");
        if (!(await this.skip(240))) return;
        inc.stats.wealth += pay;
        inc.stats.energy -= 18;
        inc.stats.reputation += 1;
        rules.clampStats(inc.stats);
        this.deed(`worked at the ${t.workplace}`);
        this.toast(`Earned ${pay} ${cur}.`, "good");
        break;
      }
      case "use": {
        if (!(await this.skip(15))) return;
        inc.stats.energy += 6;
        inc.stats.resolve += 3;
        rules.clampStats(inc.stats);
        this.toast("You take a moment. You feel a little better.", "good");
        break;
      }
      case "look": {
        const target = scene.interactables?.find((i) => i.id === params.interactableId);
        this.toast(target ? `${target.label}. ${scene.description}` : scene.description, "info");
        return;
      }
      case "travel": {
        const regionId = String(params.regionId);
        const conn = ctx.region.connections.find((c) => c.to === regionId);
        if (!conn) return;
        this.busy = true;
        try {
          if (this.player.incarnation && !(await this.skip(conn.travelTicks))) return;
          const next = await this.ensureScene(planet, civ, regionId);
          const back = next.exits.find((e) => exitTarget(e).regionId === ctx.region.id);
          const pos = back ? ([back.position[0] * 0.8, 0, back.position[2] * 0.8] as [number, number, number]) : ([0, 0, 6] as [number, number, number]);
          this.player.location = { ...this.player.location, regionId, sceneId: next.id, position: pos };
          this.deed(`traveled to ${planet.regions.find((r) => r.id === regionId)?.name}`);
          this.sendScene(next.id);
        } finally {
          this.busy = false;
        }
        break;
      }
      default:
        return this.toast(`You can't ${verb} here.`, "bad");
    }
    this.checkGoal();
    this.pushState();
  }

  private dialogueStart(npcId: string): void {
    const npc = this.world.npcs[npcId];
    if (!npc) return;
    if (!this.player.incarnation) return this.toast(`${npc.name} squints at a strange floating light and looks away.`, "mystic");
    const hostile = this.life.hostile.includes(npcId);
    const say = hostile ? "Get away from me." : npc.greeting || "Yes?";
    this.send({ type: "npc.say", reply: { npcId, say, emotion: hostile ? "angry" : "neutral", intents: [], opinion: this.opinionOf(npcId) } });
  }

  private opinionOf(npcId: string): number {
    return rules.opinionOf(this.player, npcId, this.bodyStats()?.firstOpinion ?? 0);
  }

  private async dialogueSay(npcId: string, text: string): Promise<void> {
    const ctx = this.currentContext();
    const npc = this.world.npcs[npcId];
    if (!ctx || !npc || !text.trim()) return;
    const history = (this.life.dialogue[npcId] ??= []);
    const inc = this.player.incarnation!;
    const reply = await npcReply({
      npc,
      planet: ctx.planet,
      civ: ctx.civ,
      scene: ctx.scene,
      opinion: this.opinionOf(npcId),
      history,
      playerVessel: this.vesselText(),
      playerText: text,
    });
    history.push({ speaker: "player", text: text.slice(0, 400) }, { speaker: "npc", text: reply.say });
    if (history.length > 20) history.splice(0, history.length - 20);
    if (this.player.incarnation !== inc) return;
    rules.setOpinion(this.player, npcId, reply.opinion);
    for (const intent of reply.intents) {
      if (intent.type === "offer_job") this.life.jobs[npcId] = intent.wage;
      if (intent.type === "share_info") {
        inc.stats.insight += 1;
        this.deed(`learned from ${npc.name} that ${intent.fact}`);
      }
      if (intent.type === "become_hostile" && !this.life.hostile.includes(npcId)) this.life.hostile.push(npcId);
      if (intent.type === "call_guard") {
        inc.legalStatus = "suspect";
        inc.stats.reputation -= 5;
        this.toast(`${npc.name} shouts for the guards!`, "bad");
      }
    }
    if (reply.opinion >= 50 && !this.life.deeds.some((d) => d === `befriended ${npc.name}`)) {
      this.deed(`befriended ${npc.name}`);
      this.toast(`${npc.name} now counts you as a friend.`, "good");
    }
    rules.clampStats(inc.stats);
    this.send({ type: "npc.say", reply });
    this.checkGoal();
    this.pushState();
  }

  private chooseEvent(eventId: string, choiceId: string): void {
    const ev = this.life.activeEvent;
    if (!ev || ev.id !== eventId || !this.player.incarnation) return;
    const choice = ev.choices?.find((c) => c.id === choiceId);
    if (!choice) return;
    const before = this.player.incarnation.stats.health;
    const lines = rules.applyEffects(this.player, choice.effects ?? []);
    if (choice.hint === "Risky" || choice.hint === "Generous") this.player.incarnation.fulfillment = Math.min(100, (this.player.incarnation.fulfillment ?? 0) + 4);
    this.deed(`faced "${ev.title}" and chose to ${choice.label.charAt(0).toLowerCase()}${choice.label.slice(1)}`);
    this.life.activeEvent = null;
    this.toast(`${choice.followUp ?? ""} ${lines.length ? `(${lines.join(", ")})` : ""}`.trim(), "mystic");
    if (this.player.incarnation.stats.health <= 0) {
      void this.die(`Fell during "${ev.title}"`);
      return;
    }
    this.checkKnockOff(before);
    this.checkGoal();
    this.pushState();
  }

  private checkGoal(): void {
    const inc = this.player.incarnation;
    const goal = this.life.goal;
    if (!inc || !goal || inc.goals[0]?.status !== "active") return;
    const value = goal.kind === "wealth" ? inc.stats.wealth : inc.stats.reputation;
    if (value >= goal.target) {
      inc.goals[0].status = "completed";
      inc.fulfillment = Math.min(100, (inc.fulfillment ?? 0) + 30);
      inc.stats.resolve += 15;
      rules.clampStats(inc.stats);
      this.deed(`achieved a life goal: ${goal.title}`);
      this.toast(`Goal achieved: ${goal.title}`, "mystic");
    }
  }

  // ---------- real-time loop ----------

  private ensureTimer(): void {
    if (this.timer || !this.sockets.size) return;
    this.timer = setInterval(() => void this.tick(), 1000);
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    if (this.player.location.phase === "planet" && !this.player.incarnation) {
      // A wisp drains SE at twice the space rate (docs/09-found-bodies.md §1).
      if (rules.spaceDecay(this.player, 1, 2)) return this.spiritExtinguished();
      this.send({ type: "state", player: this.player });
      return this.scheduleSave();
    }
    const ctx = this.currentContext();
    if (!ctx) return;
    const before = this.player.incarnation!.stats.health;
    const out = rules.advance(this.player, ctx.civ, ctx.region.danger, 1, this.rng);
    for (const m of out.messages) this.toast(m.text, m.tone);
    if (out.deathCause) return this.die(out.deathCause);
    this.checkKnockOff(before);
    this.checkGoal();
    this.capHealth();
    this.send({ type: "state", player: this.player });
    this.scheduleSave();

    if (!this.life.activeEvent && !this.eventInFlight && this.player.time.tick - this.life.lastEventTick > 150) {
      this.eventInFlight = true;
      const inc = this.player.incarnation;
      const pacing = (["calm", "rising", "climax", "resolution"] as const)[this.life.eventCount % 4];
      createEvent({
        planet: ctx.planet,
        civ: ctx.civ,
        scene: ctx.scene,
        npcs: npcSpawns(ctx.scene).map((s) => this.world.npcs[s.npcId!]).filter(Boolean),
        player: this.player,
        pacing,
        recentTitles: this.life.recentEventTitles,
        index: this.life.eventCount,
      })
        .then((ev) => {
          if (this.player.incarnation !== inc) return;
          this.life.activeEvent = ev;
          this.life.eventCount++;
          this.life.lastEventTick = this.player.time.tick;
          this.life.recentEventTitles = [...this.life.recentEventTitles, ev.title].slice(-6);
          this.send({ type: "event", event: ev });
        })
        .catch((err) => console.error("[session] event failed", err))
        .finally(() => (this.eventInFlight = false));
    }
  }

  // ---------- death and rebirth ----------

  private async die(cause: string): Promise<void> {
    const ctx = this.currentContext();
    if (!ctx || this.dying) return;
    this.dying = true;
    const wasBusy = this.busy;
    this.busy = true;
    try {
      const inc = this.player.incarnation!;
      const { seDelta, yearsLived, fulfillment } = rules.endOfLife(this.player, ctx.civ);
      this.player.location.phase = "reflection";
      this.send({ type: "loading", what: "Your light leaves the body…", done: false });
      // Pre-generate the next universe while the epitaph is written (docs/01-game-design.md §7).
      const nextSeed = newSeed();
      this.nextWorld = Session.buildWorld(nextSeed);
      const epitaph = await createEpitaph(ctx.planet, ctx.civ, this.player, cause, this.life.deeds);
      this.player.spirit.energy = Math.max(0, Math.min(100, this.player.spirit.energy + seDelta));
      this.player.spirit.livesLived++;
      this.player.pastLives.push({ lifeId: inc.id, planetId: ctx.planet.id, vesselName: inc.vessel.name, yearsLived, causeOfDeath: cause.slice(0, 100), epitaph, seDelta });
      this.player.universeSeed = nextSeed;
      const runOver = this.player.spirit.energy <= 0;
      this.send({ type: "loading", what: "", done: true });
      this.send({ type: "death", report: { vesselName: inc.vessel.name, causeOfDeath: cause, epitaph, yearsLived, fulfillment, seDelta, energyLeft: this.player.spirit.energy, runOver } });
      this.pushState();
    } finally {
      this.busy = wasBusy;
      this.dying = false;
    }
  }

  private async spiritExtinguished(): Promise<void> {
    this.player.location.phase = "reflection";
    const nextSeed = newSeed();
    this.player.universeSeed = nextSeed;
    this.nextWorld = Session.buildWorld(nextSeed);
    this.send({
      type: "death",
      report: { vesselName: "the spirit", causeOfDeath: "Faded in the void", epitaph: "Your light thinned among the stars until nothing was left.", yearsLived: 0, fulfillment: 0, seDelta: 0, energyLeft: 0, runOver: true },
    });
    this.pushState();
  }

  private async reflectContinue(): Promise<void> {
    if (this.player.location.phase !== "reflection") return;
    if (this.player.spirit.energy <= 0) {
      rules.startNewRun(this.player);
      this.toast("A new spark is kindled. A new run begins.", "mystic");
    }
    this.send({ type: "loading", what: "A new universe unfolds…", done: false });
    this.world = await (this.nextWorld ?? Session.buildWorld(this.player.universeSeed));
    this.nextWorld = null;
    this.life = newLife(this.player.time.tick);
    rules.startNewUniverse(this.player, this.world.system.id, this.player.universeSeed);
    this.send({ type: "loading", what: "", done: true });
    this.send({ type: "system", system: this.systemView() });
    this.pushState();
  }

  /** From the settings menu: leave the current life (no death, no SE change) for a new universe. */
  private async restart(): Promise<void> {
    if (this.busy || this.dying) return;
    this.busy = true;
    try {
      this.send({ type: "loading", what: "A new universe unfolds…", done: false });
      const seed = newSeed();
      this.world = await Session.buildWorld(seed);
      this.nextWorld = null;
      this.life = newLife(this.player.time.tick);
      rules.startNewUniverse(this.player, this.world.system.id, seed);
      this.send({ type: "loading", what: "", done: true });
      this.send({ type: "system", system: this.systemView() });
      this.pushState();
      this.saveNow();
      this.toast("You let go and drift into a new universe.", "mystic");
    } finally {
      this.busy = false;
    }
  }

  private sendSettings(): void {
    this.send({
      type: "settings",
      info: {
        settings,
        defaultModels: Object.fromEntries(Object.keys(llmDefaults).map((k) => [k, defaultModel(k as keyof typeof llmDefaults)])) as SettingsInfo["defaultModels"],
        available: { sketchfab: sketchfabEnabled(), ...objaverseAvailable() },
      },
    });
  }
}
