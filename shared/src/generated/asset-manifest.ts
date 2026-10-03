/* Generated from schemas/asset-manifest.schema.json by shared/scripts/gen-types.mjs. Do not edit. */

/**
 * Record of an ingested asset, written by the deterministic ingest pipeline after the Asset Scout selects a candidate. Clients load only the URLs listed here.
 */
export interface AssetManifest {
  schemaVersion: "1.0";
  id: string;
  name: string;
  kind: "model" | "character" | "hdri" | "material" | "texture" | "audio" | "image";
  source: {
    name:
      | "polyhaven"
      | "kenney"
      | "quaternius"
      | "ambientcg"
      | "smithsonian"
      | "sketchfab"
      | "objaverse"
      | "texverse"
      | "generated"
      | "internal";
    sourceId: string;
    url: string;
    /**
     * Dataset record id when discovered via Objaverse/TexVerse metadata.
     */
    datasetRef?: string;
  };
  license: {
    /**
     * Allow-list only. Anything else must be rejected before ingest.
     */
    id: "CC0-1.0" | "CC-BY-3.0" | "CC-BY-4.0" | "PUBLIC-DOMAIN" | "INTERNAL";
    url: string;
    author: string;
    authorUrl?: string;
    /**
     * Ready-to-display credit line.
     */
    attribution: string;
    retrievedAt: string;
    /**
     * When the license was re-checked at the original source.
     */
    verifiedAt: string;
  };
  /**
   * @maxItems 20
   */
  tags: string[];
  /**
   * @minItems 1
   */
  tiers: ("T0" | "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7" | "any")[];
  /**
   * @maxItems 10
   */
  biomes?: string[];
  style: "realistic" | "stylized" | "low-poly";
  bounds?: {
    /**
     * AABB size in meters after normalization.
     *
     * @minItems 3
     * @maxItems 3
     */
    size: number[];
    pivot?: "bottom-center" | "center";
  };
  scaleApplied?: number;
  rigged?: boolean;
  /**
   * @maxItems 30
   */
  animations?: string[];
  files: {
    primary: File;
    /**
     * @maxItems 4
     */
    lods?: Lod[];
    thumbnail?: File;
  };
  quality?: {
    triangles?: number;
    maxTextureSize?: number;
    pbrChannels?: ("baseColor" | "normal" | "metallicRoughness" | "occlusion" | "emissive")[];
    score?: number;
  };
  ingest: {
    pipelineVersion: string;
    ingestedAt: string;
    steps?: string[];
    /**
     * Scene or task id that triggered ingestion.
     */
    requestedBy?: string;
  };
  /**
   * Set on takedown; clients fall back to placeholders.
   */
  disabled?: boolean;
}
export interface File {
  url: string;
  bytes: number;
  sha256: string;
  mime?: string;
}
export interface Lod {
  level: number;
  url: string;
  triangles: number;
  bytes: number;
  maxDistance?: number;
}
