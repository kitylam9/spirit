/* Generated from schemas/event.schema.json by shared/scripts/gen-types.mjs. Do not edit. */

/**
 * Paths mirror player-state.schema.json with /player as the root, plus world faction power.
 */
export type StatPath = string;

/**
 * A story event produced by the Narrative agent. Choices map to verbs; effects are applied (and clamped) by the rules engine.
 */
export interface Event {
  schemaVersion: "1.1";
  id: string;
  planetId: string;
  regionId?: string;
  kind: "world" | "local" | "personal" | "goal" | "omen" | "epitaph";
  title: string;
  text: string;
  pacing: "calm" | "rising" | "climax" | "resolution";
  /**
   * @maxItems 6
   */
  involvedNpcIds?: string[];
  trigger: {
    type: "immediate" | "at-tick" | "on-enter-scene" | "condition";
    atTick?: number;
    sceneId?: string;
    /**
     * @maxItems 4
     */
    conditions?: Condition[];
  };
  /**
   * @maxItems 4
   */
  choices?: {
    id: string;
    label: string;
    hint?: string;
    action: Action;
    /**
     * @maxItems 3
     */
    requires?: Condition[];
    /**
     * @maxItems 6
     */
    effects?: Effect[];
    /**
     * Short outcome text shown after choosing.
     */
    followUp?: string;
  }[];
  /**
   * Effects applied when the event triggers, regardless of choice.
   *
   * @maxItems 6
   */
  effects?: Effect[];
  expiresInTicks?: number;
  /**
   * Only for kind=goal.
   */
  goal?: {
    id: string;
    title: string;
    /**
     * @minItems 1
     * @maxItems 4
     */
    successConditions: Condition[];
    fulfillment?: number;
  };
  /**
   * Atomic facts this event establishes if it happens.
   *
   * @maxItems 6
   */
  canonFacts?: string[];
}
export interface Condition {
  path: StatPath;
  op: "<" | "<=" | "==" | ">=" | ">" | "!=";
  value: number | string | boolean;
}
export interface Action {
  verb:
    | "move"
    | "look"
    | "talk"
    | "give"
    | "take"
    | "use"
    | "buy"
    | "sell"
    | "work"
    | "rest"
    | "eat"
    | "attack"
    | "flee"
    | "hide"
    | "craft"
    | "learn"
    | "travel"
    | "incarnate.request"
    | "reflect.continue"
    | "travel.request"
    | "ui.close"
    | "ui.open"
    | "ui.tab";
  params?: {
    [k: string]: string | number | boolean;
  };
}
export interface Effect {
  path: StatPath;
  op: "add" | "set";
  value: number | string | boolean;
}
