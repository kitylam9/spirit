import type { Planet } from "./generated/planet.js";
import type { Civilization } from "./generated/civilization.js";
import type { Scene } from "./generated/scene.js";
import type { NPC } from "./generated/entity-npc.js";
import type { Event } from "./generated/event.js";
import type { PlayerState } from "./generated/player-state.js";
import type { UILayout } from "./generated/ui-layout.js";
import type { AssetManifest } from "./generated/asset-manifest.js";
import type { FoundObject } from "./generated/found-object.js";

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

/** A found object lying in a scene (session state, docs/09-found-bodies.md §6). */
export interface LooseObject {
  objectId: string;
  position: [number, number, number];
  rotationY: number;
}

/** Effects of the current body's traits, computed by the rules engine (docs/09-found-bodies.md §3). */
export interface BodyStats {
  maxHealth: number;
  /** Meters per second. */
  speed: number;
  payMultiplier: number;
  firstOpinion: number;
}

/** Server settings changeable from the in-game menu; they last until the server restarts (.env is the default). */
export interface ServerSettings {
  llm: {
    provider: "ollama" | "llamacpp" | "openai" | "openrouter" | "none";
    /** Empty = the provider's default model. */
    model: string;
    /** Empty = the provider's default mode. */
    jsonMode: "" | "schema" | "object" | "off";
    maxConcurrency: number;
    timeoutMs: number;
  };
  gameplay: {
    /** Spirit Energy spent to descend to a planet. */
    descentCost: number;
    /** Multiplier on Spirit Energy drain in space and as a wisp. */
    seDrain: number;
    objectsPerScene: number;
  };
  assets: {
    polyhaven: boolean;
    sketchfab: boolean;
    objaverse: { sketchfab: boolean; smithsonian: boolean; github: boolean; thingiverse: boolean };
  };
}

export interface SettingsInfo {
  settings: ServerSettings;
  /** Default model per provider, shown as a placeholder. */
  defaultModels: Record<ServerSettings["llm"]["provider"], string>;
  /** Sources that can work at all (token set, index built). */
  available: { sketchfab: boolean; github: boolean; thingiverse: boolean };
}

type Vec3 = [number, number, number];

export type ClientMessage =
  | { type: "hello"; playerId?: string }
  | { type: "approach"; planetId: string }
  /** Descend to the planet as a wisp. */
  | { type: "incarnate"; planetId: string }
  /** Attach a loose object; `position`/`rotation` are relative to the core, `at` is the player's world position. */
  | { type: "pickup"; objectId: string; position: Vec3; rotation: Vec3; scale: number; at: Vec3 }
  /** Drop a part (the newest one when `partId` is omitted) at the player's position. */
  | { type: "drop"; partId?: string; at: Vec3 }
  | { type: "action"; action: Action }
  | { type: "dialogue.start"; npcId: string }
  | { type: "dialogue.say"; npcId: string; text: string }
  | { type: "event.choose"; eventId: string; choiceId: string }
  | { type: "space.tick"; boosting: boolean }
  | { type: "reflect.continue" }
  | { type: "settings.get" }
  | { type: "settings.set"; settings: ServerSettings; difficulty: PlayerState["difficulty"] }
  /** End the current life without a death and start in a new universe; Spirit Energy and lives lived are kept. */
  | { type: "restart" };

export type ServerMessage =
  | { type: "welcome"; player: PlayerState; system: StarSystemSummary; llm: LlmStatus }
  | { type: "state"; player: PlayerState }
  | { type: "system"; system: StarSystemSummary }
  | { type: "planet.summary"; planet: PlanetSummary }
  | { type: "planet.detail"; planet: Planet; civilization: Civilization }
  | { type: "scene"; scene: Scene; npcs: NPC[]; ui: UILayout; assets: AssetManifest[] }
  /** A model for `instanceIds` finished ingesting; the client swaps out their placeholders. */
  | { type: "asset"; sceneId: string; manifest: AssetManifest; instanceIds: string[] }
  /** Loose objects of the current scene plus every object the body is made of; `body` is null for a wisp. */
  | { type: "found"; sceneId: string; loose: LooseObject[]; objects: FoundObject[]; assets: AssetManifest[]; body: BodyStats | null }
  | { type: "npc.say"; reply: DialogueReply }
  | { type: "event"; event: Event }
  | { type: "toast"; text: string; tone: "info" | "good" | "bad" | "mystic" }
  | { type: "loading"; what: string; done: boolean }
  | { type: "death"; report: DeathReport }
  | { type: "llm"; status: LlmStatus }
  | { type: "settings"; info: SettingsInfo }
  | { type: "error"; message: string };
