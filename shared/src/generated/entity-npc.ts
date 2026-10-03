/* Generated from schemas/entity-npc.schema.json by shared/scripts/gen-types.mjs. Do not edit. */

/**
 * A non-player character created by the NPC agent. The same agent role-plays the NPC in dialogue using this record as its character sheet.
 */
export interface NPC {
  schemaVersion: "1.0";
  id: string;
  name: string;
  planetId: string;
  regionId: string;
  homeSceneId?: string;
  species: string;
  vesselKind?: "humanoid" | "animal" | "android" | "hive-drone" | "uploaded-mind" | "other";
  role: string;
  socialClass?: string;
  factionId?: string;
  age: number;
  appearance: {
    description: string;
    bodyAssetRef?: string;
    bodyAssetRequest?: string;
    /**
     * @maxItems 3
     */
    tint?: string[];
    /**
     * Optional prompt for a future 2D portrait generator.
     */
    portraitPrompt?: string;
  };
  personality: {
    /**
     * @minItems 2
     * @maxItems 6
     */
    traits: string[];
    speechStyle: string;
    /**
     * @minItems 1
     * @maxItems 4
     */
    values: string[];
    /**
     * @maxItems 4
     */
    fears?: string[];
    secret?: string;
  };
  /**
   * @minItems 1
   * @maxItems 4
   */
  goals: string[];
  /**
   * Facts this NPC knows and may reveal. NPCs must not reveal facts outside this list and public canon.
   *
   * @maxItems 12
   */
  knowledge: {
    fact: string;
    willingness: "freely" | "if-trusted" | "if-paid" | "under-duress" | "never";
  }[];
  /**
   * @maxItems 12
   */
  relationships: {
    targetId: string;
    kind:
      | "family"
      | "friend"
      | "lover"
      | "rival"
      | "enemy"
      | "employer"
      | "employee"
      | "mentor"
      | "student"
      | "neighbor"
      | "acquaintance";
    opinion: number;
  }[];
  /**
   * @maxItems 8
   */
  schedule?: {
    fromHour: number;
    toHour: number;
    sceneId?: string;
    activity: "sleep" | "work" | "eat" | "socialize" | "pray" | "patrol" | "trade" | "travel" | "rest" | "study";
  }[];
  /**
   * @maxItems 20
   */
  inventory?: {
    itemId: string;
    name: string;
    qty: number;
    /**
     * Price in civilization currency units.
     */
    value?: number;
    forSale?: boolean;
  }[];
  stats?: {
    health?: number;
    combat?: number;
    wealth?: number;
  };
  /**
   * First line when the player approaches, in character.
   */
  greeting?: string;
}
