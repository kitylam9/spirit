import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Civilization, ClientMessage, GameEvent, LlmStatus, NPC, Planet, PlayerState, Scene, ServerMessage, UILayout } from "@spirit/shared";
import { exitTarget, npcSpawns } from "@spirit/shared";
import { config } from "./config.js";
import { createCivilization } from "./agents/civilization.js";
import { createEpitaph, createEvent, createGoal, type LifeGoal } from "./agents/narrative.js";
import { npcReply, populateScene } from "./agents/npc.js";
import { designScene, foodItemId } from "./agents/sceneDesigner.js";
import { generateHud } from "./agents/uiGenerator.js";
import { detailPlanet, nameSystem, type SystemNames } from "./agents/worldArchitect.js";
import * as rules from "./rules/engine.js";
import { Rng, newSeed } from "./util/rng.js";
import { validate } from "./validate.js";
import { TIERS } from "./world/templates.js";
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
        const s = new Session(save.player);
        s.world = save.world;
        s.life = save.life;
        if (s.player.location.phase === "reflection") {
          // Died before pressing continue: the save already holds the next universe seed.
          if (s.player.spirit.energy <= 0) rules.startNewRun(s.player);
          s.world = await Session.buildWorld(s.player.universeSeed);
          s.life = newLife(s.player.time.tick);
          rules.startNewUniverse(s.player, s.world.system.id, s.player.universeSeed);
        }
        if (s.player.location.phase === "descent") s.player.location.phase = "space";
        if (s.player.location.phase === "planet" && !s.player.incarnation) s.player.location = { phase: "space", systemId: s.world.system.id };
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
    return { system, names, planets: {}, civs: {}, huds: {}, scenes: {}, npcs: {} };
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
    this.send({ type: "scene", scene, npcs, ui: this.world.huds[scene.planetId] });
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
          await this.ensurePlanet(msg.planetId).then(({ planet, civ }) => this.send({ type: "planet.detail", planet, civilization: civ }));
          break;
        case "incarnate":
          await this.incarnate(msg.planetId, msg.mode);
          break;
        case "space.tick":
          if (this.player.location.phase === "space" && rules.spaceDecay(this.player, 1, msg.boosting)) await this.spiritExtinguished();
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
        case "hello":
          break;
      }
    } catch (err) {
      console.error(`[session] ${msg.type} failed:`, err);
      this.send({ type: "error", message: (err as Error).message });
      this.send({ type: "loading", what: "", done: true });
    }
  }

  private async incarnate(planetId: string, mode: "born" | "arrive"): Promise<void> {
    if (this.player.location.phase !== "space" || this.busy) return;
    const cost = rules.INCARNATION_COST[mode];
    if (this.player.spirit.energy <= cost) {
      this.toast(`Not enough Spirit Energy to ${mode === "born" ? "be born" : "arrive"} (${cost} needed).`, "bad");
      return;
    }
    this.busy = true;
    try {
      this.player.location.phase = "descent";
      this.pushState();
      const { planet, civ } = await this.ensurePlanet(planetId);
      const region = planet.regions[0];
      const scene = await this.ensureScene(planet, civ, region.id);
      const rng = this.rng;
      const roles = civ.vessels[0]?.roles ?? TIERS[planet.tier].roles;
      const name = rng.pick(civ.naming.personExamples.filter((n) => !Object.values(this.world.npcs).some((x) => x.name === n))) ?? "Nameless";
      const spawn = scene.spawnPoints.find((s) => s.purpose === (mode === "born" ? "birth" : "arrival")) ?? scene.spawnPoints[0];
      rules.incarnate(this.player, {
        planetId: planet.id,
        tier: planet.tier,
        civ,
        mode,
        name,
        role: rng.pick(roles),
        regionId: region.id,
        sceneId: scene.id,
        position: spawn.position as [number, number, number],
        foodItemId: foodItemId(civ),
      });
      this.life = newLife(this.player.time.tick);
      const goal = await createGoal(planet, civ, this.player);
      this.life.goal = goal;
      this.player.incarnation!.goals = [{ goalId: goal.goalId, title: goal.title, status: "active" }];
      this.send({ type: "planet.detail", planet, civilization: civ });
      this.sendScene(scene.id);
      this.pushState();
      const inc = this.player.incarnation!;
      this.toast(`You ${mode === "born" ? "are born as" : "wake as"} ${inc.vessel.name}, a ${inc.vessel.role}.`, "mystic");
      this.ensureTimer();
    } catch (err) {
      this.player.location.phase = "space";
      this.pushState();
      throw err;
    } finally {
      this.busy = false;
    }
  }

  private currentContext() {
    const loc = this.player.location;
    if (loc.phase !== "planet" || !loc.planetId || !loc.sceneId || !this.player.incarnation) return null;
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
    const ctx = this.currentContext()!;
    const out = rules.advance(this.player, ctx.civ, ctx.region.danger, ticks, this.rng, false);
    for (const m of out.messages) this.toast(m.text, m.tone);
    if (out.deathCause) {
      await this.die(out.deathCause);
      return false;
    }
    return true;
  }

  private async action(verb: string, params: Record<string, string | number | boolean>): Promise<void> {
    const ctx = this.currentContext();
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
        const pay = Math.round((employer && this.life.jobs[employer] ? this.life.jobs[employer] : wage * 0.5) * 100) / 100;
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
          if (!(await this.skip(conn.travelTicks))) return;
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
    const hostile = this.life.hostile.includes(npcId);
    const say = hostile ? "Get away from me." : npc.greeting || "Yes?";
    this.send({ type: "npc.say", reply: { npcId, say, emotion: hostile ? "angry" : "neutral", intents: [], opinion: rules.opinionOf(this.player, npcId) } });
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
      opinion: rules.opinionOf(this.player, npcId),
      history,
      playerVessel: `${inc.vessel.role} named ${inc.vessel.name}`,
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
    const lines = rules.applyEffects(this.player, choice.effects ?? []);
    if (choice.hint === "Risky" || choice.hint === "Generous") this.player.incarnation.fulfillment = Math.min(100, (this.player.incarnation.fulfillment ?? 0) + 4);
    this.deed(`faced "${ev.title}" and chose to ${choice.label.charAt(0).toLowerCase()}${choice.label.slice(1)}`);
    this.life.activeEvent = null;
    this.toast(`${choice.followUp ?? ""} ${lines.length ? `(${lines.join(", ")})` : ""}`.trim(), "mystic");
    if (this.player.incarnation.stats.health <= 0) {
      void this.die(`Fell during "${ev.title}"`);
      return;
    }
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
    const ctx = this.currentContext();
    if (!ctx || this.busy) return;
    const out = rules.advance(this.player, ctx.civ, ctx.region.danger, 1, this.rng);
    for (const m of out.messages) this.toast(m.text, m.tone);
    if (out.deathCause) return this.die(out.deathCause);
    this.checkGoal();
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
}
