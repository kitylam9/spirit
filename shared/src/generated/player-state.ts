/* Generated from schemas/player-state.schema.json by shared/scripts/gen-types.mjs. Do not edit. */

export type Stat = number;

/**
 * Authoritative player state owned by the rules engine. Agents receive read-only summaries of it; they never write it directly.
 */
export interface PlayerState {
  schemaVersion: "1.1";
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
    mode: "born" | "arrive" | "possess";
    planetId: string;
    vessel: {
      kind: "humanoid" | "animal" | "android" | "hive-drone" | "uploaded-mind" | "other";
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
