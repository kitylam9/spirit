import type { Planet } from "./generated/planet.js";
import type { Civilization } from "./generated/civilization.js";
import type { Scene } from "./generated/scene.js";
import type { NPC } from "./generated/entity-npc.js";
import type { Event } from "./generated/event.js";
import type { PlayerState } from "./generated/player-state.js";
import type { UILayout } from "./generated/ui-layout.js";

export type Tier = Planet["tier"];
/** Alias that avoids clashing with the DOM `Event` type in client code. */
export type GameEvent = Event;

/**
 * json-schema-to-typescript drops properties for objects constrained with `anyOf: [{required}]`,
 * so these two scene shapes are typed by hand to match schemas/scene.schema.json.
 */
export interface NpcSpawn {
  npcId?: string;
  roleHint?: string;
  position: [number, number, number];
  behavior: "idle" | "wander" | "work" | "patrol" | "sit" | "sell" | "guard" | "follow-schedule";
}
export interface ExitTarget {
  sceneId?: string;
  regionId?: string;
  pending?: boolean;
}
export const npcSpawns = (scene: Scene): NpcSpawn[] => (scene.npcSpawns ?? []) as unknown as NpcSpawn[];
export const exitTarget = (exit: Scene["exits"][number]): ExitTarget => exit.to as ExitTarget;

/** Procedural summary of a planet as seen from space (before detail generation). */
export interface PlanetSummary {
  id: string;
  seed: string;
  tier: Tier;
  name: string;
  omen: string;
  /** Position in the star system, in space units. */
  position: [number, number, number];
  /** Visual radius in space units. */
  radius: number;
  palette: string[];
  hasRings: boolean;
  danger: number;
  detailReady: boolean;
}

export interface StarSystemSummary {
  id: string;
  seed: string;
  name: string;
  starColor: string;
  planets: PlanetSummary[];
}

export interface Action {
  verb: string;
  params?: Record<string, string | number | boolean>;
}

export interface DialogueReply {
  npcId: string;
  say: string;
  emotion: string;
  intents: NpcIntent[];
  opinion: number;
}

export type NpcIntent =
  | { type: "offer_trade"; itemId: string; name: string; price: number }
  | { type: "offer_job"; wage: number; hours: number; description: string }
  | { type: "give_item"; itemId: string; name: string }
  | { type: "share_info"; fact: string }
  | { type: "become_hostile" }
  | { type: "call_guard" }
  | { type: "end_conversation" };

export interface DeathReport {
  vesselName: string;
  causeOfDeath: string;
  epitaph: string;
  yearsLived: number;
  fulfillment: number;
  seDelta: number;
  energyLeft: number;
  runOver: boolean;
}

export interface LlmStatus {
  provider: string;
  model: string;
  online: boolean;
  busy: number;
  calls: number;
  failures: number;
}

export type ClientMessage =
  | { type: "hello"; playerId?: string }
  | { type: "approach"; planetId: string }
  | { type: "incarnate"; planetId: string; mode: "born" | "arrive" }
  | { type: "action"; action: Action }
  | { type: "dialogue.start"; npcId: string }
  | { type: "dialogue.say"; npcId: string; text: string }
  | { type: "event.choose"; eventId: string; choiceId: string }
  | { type: "space.tick"; boosting: boolean }
  | { type: "reflect.continue" };

export type ServerMessage =
  | { type: "welcome"; player: PlayerState; system: StarSystemSummary; llm: LlmStatus }
  | { type: "state"; player: PlayerState }
  | { type: "system"; system: StarSystemSummary }
  | { type: "planet.summary"; planet: PlanetSummary }
  | { type: "planet.detail"; planet: Planet; civilization: Civilization }
  | { type: "scene"; scene: Scene; npcs: NPC[]; ui: UILayout }
  | { type: "npc.say"; reply: DialogueReply }
  | { type: "event"; event: Event }
  | { type: "toast"; text: string; tone: "info" | "good" | "bad" | "mystic" }
  | { type: "loading"; what: string; done: boolean }
  | { type: "death"; report: DeathReport }
  | { type: "llm"; status: LlmStatus }
  | { type: "error"; message: string };
