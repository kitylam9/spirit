/* Generated from schemas/found-object.schema.json by shared/scripts/gen-types.mjs. Do not edit. */

export type Trait = number;

/**
 * A random Objaverse-XL object lying on a planet, appraised by the Asset Scout so the spirit can use it as a body part (docs/09-found-bodies.md). The LLM writes name, description, tags and unsuitable; code derives traits from tags.
 */
export interface FoundObject {
  schemaVersion: "1.0";
  id: string;
  /**
   * The ingested model (asset-manifest).
   */
  assetRef: string;
  name: string;
  description: string;
  /**
   * @maxItems 4
   */
  tags: (
    | "heavy"
    | "sturdy"
    | "armored"
    | "stone"
    | "metal"
    | "light"
    | "wheeled"
    | "winged"
    | "springy"
    | "fast"
    | "electronic"
    | "mechanical"
    | "bookish"
    | "precise"
    | "pretty"
    | "cute"
    | "shiny"
    | "musical"
    | "tasty"
    | "scary"
    | "sharp"
    | "fragile"
  )[];
  traits: {
    sturdy: Trait;
    nimble: Trait;
    clever: Trait;
    charming: Trait;
  };
  /**
   * Largest side in meters when attached.
   */
  suggestedSize?: number;
  /**
   * Set by the appraiser for content outside the Teen rating; such objects are never spawned.
   */
  unsuitable?: boolean;
}
