/* Generated from schemas/player-state.schema.json by shared/scripts/gen-types.mjs. Do not edit. */

export type Stat = number;

/**
 * Authoritative player state owned by the rules engine. Agents receive read-only summaries of it; they never write it directly.
 */
export interface PlayerState {
  schemaVersion: "1.2";
  id: string;
  /**
   * Seed of the current universe. Replaced with a new seed after every death.
   */
  universeSeed: string;
  difficulty: "wanderer" | "seeker" | "ascetic";
  canonSnapshotId: string;
  /**
   * The only state that survives death. Spirit Energy is the sole cross-life value.
   */
  spirit: {
    energy: number;
    /**
     * Lives in the current run; reset when a new run starts.
     */
    livesLived: number;
  };
  location: {
    phase: "space" | "descent" | "planet" | "reflection";
    systemId: string;
    planetId?: string;
    regionId?: string;
    sceneId?: string;
    /**
     * @minItems 3
     * @maxItems 3
     */
    position?: number[];
  };
  incarnation?: {
    id: string;
    /**
     * New lives are `assembled` (docs/09-found-bodies.md); `born` and `arrive` remain for saves made before 1.2.
     */
    mode: "assembled" | "born" | "arrive" | "possess";
    planetId: string;
    vessel: {
      kind: "assembled" | "humanoid" | "animal" | "android" | "hive-drone" | "uploaded-mind" | "other";
      species: string;
      role: string;
      name: string;
      age: number;
      lifespan: number;
      possessedNpcId?: string;
    };
    stats: {
      health: Stat;
      /**
       * 100 = full, 0 = starving.
       */
      hunger: number;
      energy: Stat;
      /**
       * 0 = comfortable, 100 = lethal exposure.
       */
      exposure: number;
      reputation: Stat;
      /**
       * Money in civilization currency units.
       */
      wealth: number;
      resolve: Stat;
      insight: Stat;
    };
    legalStatus?: "free" | "suspect" | "wanted" | "imprisoned" | "exiled" | "outlaw";
    relationships: {
      npcId: string;
      opinion: number;
      kind?: string;
    }[];
    inventory: {
      itemId: string;
      name: string;
      qty: number;
    }[];
    /**
     * @maxItems 6
     */
    goals: {
      goalId: string;
      title: string;
      status: "active" | "completed" | "failed" | "abandoned";
    }[];
    fulfillment?: number;
    startedAtTick: number;
    /**
     * Found-object body of an `assembled` life: a core plus up to 8 parts placed relative to it.
     */
    body?: {
      core: BodyPart;
      /**
       * @maxItems 8
       */
      parts: BodyPart[];
    };
  } | null;
  time: {
    tick: number;
    realSecondsPlayed?: number;
  };
  /**
   * Display-only log of previous lives in this run (reflection and run summary screens). Never passed to agents and has no gameplay effect.
   */
  pastLives: {
    lifeId: string;
    planetId: string;
    vesselName: string;
    yearsLived: number;
    causeOfDeath?: string;
    epitaph: string;
    seDelta: number;
  }[];
}
export interface BodyPart {
  partId: string;
  /**
   * The found-object this part is made of.
   */
  objectId: string;
  /**
   * Meters, relative to the core's center. Zero for the core.
   *
   * @minItems 3
   * @maxItems 3
   */
  position: number[];
  /**
   * Euler XYZ in radians.
   *
   * @minItems 3
   * @maxItems 3
   */
  rotation: number[];
  /**
   * Player-chosen multiplier on the normalized size.
   */
  scale: number;
}
