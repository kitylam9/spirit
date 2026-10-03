import type { Civilization, GameEvent, PlayerState, Tier } from "@spirit/shared";
import { Rng, newSeed } from "../util/rng.js";
import { clamp } from "../util/text.js";
import { BALANCE, TIERS, type Balance } from "../world/templates.js";

/**
 * Deterministic rules engine (docs/01-game-design.md §4). LLMs never decide numbers;
 * everything here is a pure function of state, action and RNG.
 */

type Stats = NonNullable<PlayerState["incarnation"]>["stats"];
type Difficulty = PlayerState["difficulty"];

export const DIFFICULTY: Record<Difficulty, { seDecay: number; deathCost: number }> = {
  wanderer: { seDecay: 0.5, deathCost: 0.5 },
  seeker: { seDecay: 1, deathCost: 1 },
  ascetic: { seDecay: 1.5, deathCost: 1.5 },
};

export const INCARNATION_COST = { born: 5, arrive: 10 } as const;
const SE_DECAY_PER_SECOND = 0.5 / 60;
const BAR_STATS = ["health", "hunger", "energy", "exposure", "reputation", "resolve", "insight"] as const;

/** Tier defaults overridden by whatever the Rules/Balance agent provided. */
export function balanceOf(civ: Civilization): Balance {
  return { ...BALANCE[civ.tier], ...civ.balance };
}

export function newPlayer(id: string, difficulty: Difficulty = "seeker"): PlayerState {
  return {
    schemaVersion: "1.1",
    id,
    universeSeed: newSeed(),
    difficulty,
    canonSnapshotId: "canon-0",
    spirit: { energy: 100, livesLived: 0 },
    location: { phase: "space", systemId: "system-pending" },
    incarnation: null,
    time: { tick: 0, realSecondsPlayed: 0 },
    pastLives: [],
  };
}

/** After a death: new universe, only Spirit Energy carries over (docs/01-game-design.md §7). */
export function startNewUniverse(p: PlayerState, systemId: string, universeSeed: string): void {
  p.universeSeed = universeSeed;
  p.location = { phase: "space", systemId };
  p.incarnation = null;
  p.canonSnapshotId = `canon-${p.spirit.livesLived}`;
}

export function startNewRun(p: PlayerState): void {
  p.spirit = { energy: 100, livesLived: 0 };
  p.pastLives = [];
}

export function clampStats(s: Stats): void {
  for (const k of BAR_STATS) s[k] = clamp(s[k], 0, 100);
  s.wealth = Math.max(0, Math.round(s.wealth * 100) / 100);
}

export function incarnate(
  p: PlayerState,
  args: { planetId: string; tier: Tier; civ: Civilization; mode: "born" | "arrive"; name: string; role: string; regionId: string; sceneId: string; position: [number, number, number]; foodItemId: string },
): void {
  const rng = new Rng(newSeed());
  const t = TIERS[args.tier];
  const wage = balanceOf(args.civ).dailyWageBase;
  const vessel = args.civ.vessels[0];
  p.spirit.energy = clamp(p.spirit.energy - INCARNATION_COST[args.mode], 0, 100);
  p.location = { phase: "planet", systemId: p.location.systemId, planetId: args.planetId, regionId: args.regionId, sceneId: args.sceneId, position: args.position };
  p.incarnation = {
    id: `life-${args.planetId.replace(/^planet-/, "")}-${p.spirit.livesLived + 1}`,
    mode: args.mode,
    planetId: args.planetId,
    vessel: {
      kind: vessel?.kind ?? "humanoid",
      species: vessel?.species ?? "human",
      role: args.role,
      name: args.name,
      age: args.mode === "born" ? 16 : rng.int(22, 40),
      lifespan: vessel?.lifespanYears ?? t.lifespan,
    },
    stats: {
      health: 100,
      hunger: args.mode === "born" ? 80 : 60,
      energy: 85,
      exposure: 0,
      reputation: args.mode === "born" ? 40 : 25,
      wealth: Math.round(wage * (args.mode === "born" ? 0.8 : 1.5)),
      resolve: 70,
      insight: 10,
    },
    legalStatus: "free",
    relationships: [],
    inventory: [{ itemId: args.foodItemId, name: t.food.name, qty: 1 }],
    goals: [],
    fulfillment: 0,
    startedAtTick: p.time.tick,
  };
}

export interface TickOutcome {
  messages: { text: string; tone: "info" | "good" | "bad" | "mystic" }[];
  /** Set when health reached 0. */
  deathCause?: string;
}

/**
 * Advance `ticks` in-game minutes. `hazards` enables random dangers (disabled for time skips
 * like sleeping, which roll a single hazard check instead).
 */
export function advance(p: PlayerState, civ: Civilization, danger: number, ticks: number, rng: Rng, hazards = true): TickOutcome {
  const inc = p.incarnation;
  const out: TickOutcome = { messages: [] };
  if (!inc) return out;
  const b = balanceOf(civ);
  const s = inc.stats;
  const hours = ticks / 60;

  s.hunger -= b.hungerDecayPerHour * hours;
  s.energy -= b.energyDecayPerHour * hours;
  if (s.hunger <= 0) {
    s.health -= 0.25 * ticks;
    if (s.health <= 0) out.deathCause = "Starved to death";
  }
  if (s.energy <= 0) {
    s.health -= 0.08 * ticks;
    s.resolve -= 0.05 * ticks;
    if (s.health <= 0) out.deathCause ??= "Collapsed from exhaustion";
  }
  if (s.hunger > 40 && s.energy > 25) s.health += 0.03 * ticks;
  if (s.resolve <= 0) s.health -= 0.02 * ticks;

  const rolls = hazards ? ticks : 1;
  const pHazard = (danger / 10) * b.dangerMultiplier * 0.004;
  for (let i = 0; i < rolls; i++) {
    if (!rng.chance(pHazard)) continue;
    const hazard = rng.pick(TIERS[civ.tier].hazards);
    const dmg = rng.int(8, 22);
    s.health -= dmg;
    out.messages.push({ text: `${hazard}! (-${dmg})`, tone: "bad" });
    if (s.health <= 0) out.deathCause = hazard;
    break;
  }
  if (rng.chance(b.diseaseRate * 0.0005 * ticks)) {
    s.health -= 15;
    s.resolve -= 5;
    out.messages.push({ text: "You fall ill. (-15)", tone: "bad" });
    if (s.health <= 0) out.deathCause ??= "Taken by sickness";
  }

  p.time.tick += ticks;
  inc.vessel.age += ticks / ((civ.calendar.daysPerYear || 365) * 1440);
  if (inc.vessel.age >= inc.vessel.lifespan) out.deathCause ??= "Died of old age";
  clampStats(s);
  return out;
}

export function spaceDecay(p: PlayerState, seconds: number, boosting: boolean): boolean {
  p.spirit.energy = clamp(p.spirit.energy - SE_DECAY_PER_SECOND * seconds * (boosting ? 3 : 1) * DIFFICULTY[p.difficulty].seDecay, 0, 100);
  p.time.realSecondsPlayed = (p.time.realSecondsPlayed ?? 0) + seconds;
  return p.spirit.energy <= 0;
}

export function applyEffects(p: PlayerState, effects: NonNullable<GameEvent["effects"]>): string[] {
  const inc = p.incarnation;
  const lines: string[] = [];
  if (!inc) return lines;
  for (const e of effects) {
    const m = e.path.match(/^\/player\/incarnation\/stats\/(\w+)$/);
    if (!m || typeof e.value !== "number") continue;
    const key = m[1] as keyof Stats;
    const before = inc.stats[key];
    inc.stats[key] = e.op === "set" ? e.value : before + e.value;
    clampStats(inc.stats);
    const delta = Math.round(inc.stats[key] - before);
    if (delta) lines.push(`${key} ${delta > 0 ? "+" : ""}${delta}`);
  }
  return lines;
}

export function addItem(p: PlayerState, itemId: string, name: string, qty = 1): void {
  const inv = p.incarnation!.inventory;
  const slot = inv.find((i) => i.itemId === itemId);
  if (slot) slot.qty += qty;
  else inv.push({ itemId, name, qty });
}

export function removeItem(p: PlayerState, itemId: string): boolean {
  const inv = p.incarnation!.inventory;
  const slot = inv.find((i) => i.itemId === itemId && i.qty > 0);
  if (!slot) return false;
  slot.qty--;
  if (slot.qty === 0) inv.splice(inv.indexOf(slot), 1);
  return true;
}

export function setOpinion(p: PlayerState, npcId: string, opinion: number): void {
  const rels = p.incarnation!.relationships;
  const r = rels.find((x) => x.npcId === npcId);
  if (r) r.opinion = clamp(Math.round(opinion), -100, 100);
  else rels.push({ npcId, opinion: clamp(Math.round(opinion), -100, 100) });
}

export function opinionOf(p: PlayerState, npcId: string): number {
  return p.incarnation?.relationships.find((r) => r.npcId === npcId)?.opinion ?? 0;
}

/** SE accounting at the end of a life (docs/01-game-design.md §4). */
export function endOfLife(p: PlayerState, civ: Civilization): { seDelta: number; yearsLived: number; fulfillment: number } {
  const inc = p.incarnation!;
  const b = balanceOf(civ);
  const ticksLived = p.time.tick - inc.startedAtTick;
  const yearsLived = ticksLived / ((civ.calendar.daysPerYear || 365) * 1440);
  const friends = inc.relationships.filter((r) => r.opinion >= 50).length;
  const fulfillment = clamp((inc.fulfillment ?? 0) + friends * 5 + inc.stats.insight * 0.2, 0, 100);
  const longevity = Math.min(10, (yearsLived / inc.vessel.lifespan) * 10 + ticksLived / 1440);
  const seDelta = Math.round((-b.deathSECost * DIFFICULTY[p.difficulty].deathCost + fulfillment * 0.3 + longevity) * 10) / 10;
  return { seDelta, yearsLived: Math.round(yearsLived * 1000) / 1000, fulfillment: Math.round(fulfillment) };
}
