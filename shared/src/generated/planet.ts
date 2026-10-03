/* Generated from schemas/planet.schema.json by shared/scripts/gen-types.mjs. Do not edit. */

export type Tier = "T0" | "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7";
export type HexColor = string;
export type Biome =
  | "forest"
  | "plains"
  | "desert"
  | "tundra"
  | "mountains"
  | "swamp"
  | "jungle"
  | "ocean"
  | "coast"
  | "river-valley"
  | "volcanic"
  | "ice"
  | "urban"
  | "megacity"
  | "orbital"
  | "underground"
  | "wasteland"
  | "crystal";

/**
 * A planet produced by the World Architect agent. Physical values come from the procedural seed and must not be changed by the agent.
 */
export interface Planet {
  schemaVersion: "1.0";
  id: string;
  name: string;
  systemId: string;
  /**
   * 64-bit hex seed derived from the universe seed.
   */
  seed: string;
  tier: Tier;
  civilizationId: string;
  /**
   * One-line hook shown from space.
   */
  omen: string;
  mood?: "serene" | "hopeful" | "tense" | "grim" | "chaotic" | "mysterious";
  danger?: number;
  physical: {
    radiusKm: number;
    gravityG: number;
    dayLengthHours: number;
    climate: "frozen" | "cold" | "temperate" | "warm" | "arid" | "tropical" | "toxic" | "varied";
    atmosphere: "none" | "thin" | "breathable" | "dense" | "toxic";
    moons?: number;
    /**
     * @minItems 3
     * @maxItems 6
     */
    palette: HexColor[];
  };
  /**
   * @minItems 1
   */
  biomes: Biome[];
  /**
   * @minItems 3
   * @maxItems 12
   */
  regions: {
    id: string;
    name: string;
    biome: Biome;
    description: string;
    populationDensity: "empty" | "sparse" | "village" | "town" | "city" | "metropolis";
    danger: number;
    /**
     * @maxItems 10
     */
    features: string[];
    connections: {
      to: string;
      mode: "walk" | "road" | "river" | "sea" | "rail" | "air" | "tube" | "teleport";
      travelTicks: number;
    }[];
  }[];
  /**
   * @minItems 5
   * @maxItems 15
   */
  history: {
    /**
     * Year in the civilization calendar; negative allowed.
     */
    year: number;
    title: string;
    summary: string;
  }[];
  /**
   * @minItems 3
   * @maxItems 6
   */
  hooks: string[];
  /**
   * Relations with other planets in the same system (mostly T5+).
   */
  relations?: {
    planetId: string;
    kind: "unaware" | "myth" | "trade" | "alliance" | "rivalry" | "war" | "colony" | "ruler";
    note?: string;
  }[];
}
