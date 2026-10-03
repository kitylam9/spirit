/* Generated from schemas/civilization.schema.json by shared/scripts/gen-types.mjs. Do not edit. */

export type Tier = "T0" | "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7";

/**
 * The dominant civilization of a planet, produced by the Civilization agent. The balance block is produced by the Rules/Balance agent and is clamped by the rules engine.
 */
export interface Civilization {
  schemaVersion: "1.0";
  id: string;
  planetId: string;
  name: string;
  tier: Tier;
  /**
   * Per-domain tier. Lets a civilization be uneven, e.g. T2 society with T6 relic medicine.
   */
  techProfile: {
    agriculture: Tier;
    energy: Tier;
    medicine: Tier;
    weapons: Tier;
    communication: Tier;
    transport: Tier;
    computing: Tier;
  };
  summary: string;
  population?: string;
  government: {
    type:
      | "none"
      | "kinship"
      | "chiefdom"
      | "feudal-monarchy"
      | "theocracy"
      | "republic"
      | "empire"
      | "democracy"
      | "corporate-oligarchy"
      | "technocracy"
      | "ai-governance"
      | "anarchy"
      | "hive";
    ruler: string;
    description: string;
  };
  economy: {
    type: "subsistence" | "barter" | "agrarian" | "mercantile" | "industrial" | "market" | "post-scarcity" | "planned";
    currency: {
      name: string;
      symbol: string;
      subunit?: string;
      subunitsPerUnit?: number;
    };
    /**
     * @maxItems 8
     */
    mainExports: string[];
  };
  /**
   * @minItems 1
   * @maxItems 6
   */
  beliefs: string[];
  /**
   * @minItems 1
   * @maxItems 8
   */
  socialClasses: {
    name: string;
    /**
     * Fraction of population.
     */
    share: number;
    description: string;
  }[];
  /**
   * @maxItems 10
   */
  laws: string[];
  /**
   * @maxItems 8
   */
  taboos?: string[];
  /**
   * @minItems 2
   * @maxItems 8
   */
  factions: {
    id: string;
    name: string;
    goal: string;
    power: number;
    relations?: {
      factionId: string;
      stance: "allied" | "friendly" | "neutral" | "rival" | "hostile" | "at-war";
    }[];
  }[];
  naming: {
    /**
     * Phonetic and structural rules all agents must follow.
     */
    style: string;
    /**
     * @minItems 10
     */
    personExamples: string[];
    /**
     * @minItems 5
     */
    placeExamples: string[];
  };
  aesthetic: {
    architecture: string;
    clothing: string;
    /**
     * @minItems 1
     * @maxItems 10
     */
    materials: string[];
    /**
     * @minItems 3
     * @maxItems 6
     */
    palette: string[];
    music?: string;
    stylePreference: "realistic" | "stylized" | "low-poly";
    uiTheme?:
      | "organic"
      | "bone-and-ochre"
      | "parchment"
      | "ink-and-brass"
      | "steam-and-iron"
      | "flat-digital"
      | "neon-holo"
      | "luminous-minimal";
  };
  calendar: {
    currentYear: number;
    eraName: string;
    daysPerYear: number;
    /**
     * @maxItems 8
     */
    festivals: {
      name: string;
      dayOfYear: number;
      description: string;
    }[];
  };
  /**
   * Body kinds the player may incarnate into on this planet.
   *
   * @minItems 1
   */
  vessels: {
    kind: "humanoid" | "animal" | "android" | "hive-drone" | "uploaded-mind" | "other";
    species: string;
    /**
     * @minItems 1
     */
    roles: string[];
    lifespanYears: number;
  }[];
  /**
   * Rules/Balance agent output. All values are re-clamped by the rules engine.
   */
  balance?: {
    hungerDecayPerHour?: number;
    energyDecayPerHour?: number;
    exposureSeverity?: number;
    dangerMultiplier?: number;
    diseaseRate?: number;
    dailyWageBase?: number;
    foodPriceBase?: number;
    deathSECost?: number;
  };
}
