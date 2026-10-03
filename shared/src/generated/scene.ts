/* Generated from schemas/scene.schema.json by shared/scripts/gen-types.mjs. Do not edit. */

export type AssetId = string;
export type HexColor = string;
/**
 * @minItems 3
 * @maxItems 3
 */
export type Vec3 = number[];
export type Instance = Instance1 & {
  id: string;
  label?: string;
  assetRef?: AssetId;
  assetRequest?: AssetRequest;
  procedural?: Procedural;
  transform: Transform;
  /**
   * If > 1, scatter copies within scatterRadius (instanced).
   */
  count?: number;
  scatterRadius?: number;
  placement?: {
    snapToGround?: boolean;
    collider?: "none" | "box" | "convex" | "mesh";
    avoidOverlap?: boolean;
  };
};
export type Instance1 = {
  [k: string]: unknown;
};
/**
 * Approximate real-world size in meters (x, y, z).
 *
 * @minItems 3
 * @maxItems 3
 */
export type Vec31 = number[];
/**
 * Euler XYZ, overrides rotationY when present.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Vec32 = number[];

/**
 * A loadable 3D scene produced by the Scene Designer agent and rendered by the Three.js client. Units: meters, radians, +Y up.
 */
export interface Scene {
  schemaVersion: "1.0";
  id: string;
  planetId: string;
  regionId: string;
  name: string;
  description: string;
  tier: "T0" | "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7";
  stylePreference: "realistic" | "stylized" | "low-poly";
  indoor?: boolean;
  bounds: {
    sizeX: number;
    sizeZ: number;
    maxHeight?: number;
  };
  environment: {
    terrain: {
      kind: "flat" | "heightmap" | "floor";
      seed?: string;
      amplitude?: number;
      roughness?: number;
      /**
       * Material keyword resolved to a PBR material asset (e.g. 'grass', 'cobblestone', 'metal-grate').
       */
      material: string;
      materialAssetRef?: AssetId;
    };
    sky: {
      kind: "hdri" | "procedural" | "interior";
      hdriAssetRef?: AssetId;
      timeOfDay: number;
      cloudCover?: number;
    };
    fog?: {
      color: HexColor;
      density: number;
    };
    lighting: {
      sun: {
        color: HexColor;
        intensity: number;
        elevation: number;
        azimuth: number;
        castShadows?: boolean;
      };
      ambient: {
        color: HexColor;
        intensity: number;
      };
      /**
       * @maxItems 16
       */
      pointLights?: {
        position: Vec3;
        color: HexColor;
        intensity: number;
        range: number;
        flicker?: boolean;
      }[];
    };
    weather?: "clear" | "cloudy" | "rain" | "storm" | "snow" | "fog" | "dust" | "acid-rain" | "none";
    /**
     * Audio keywords resolved to audio assets (e.g. 'market-crowd', 'rain-on-roof').
     *
     * @maxItems 4
     */
    ambientAudio?: string[];
  };
  budget: {
    maxTriangles: number;
    maxInstances: number;
    maxNewAssets?: number;
  };
  /**
   * @maxItems 400
   */
  instances: Instance[];
  /**
   * @minItems 1
   */
  spawnPoints: {
    id: string;
    position: Vec3;
    rotationY?: number;
    purpose?: "player" | "birth" | "arrival" | "return";
  }[];
  /**
   * @maxItems 40
   */
  npcSpawns?: {
    [k: string]: unknown;
  }[];
  /**
   * @maxItems 60
   */
  interactables?: {
    id: string;
    instanceId: string;
    label: string;
    /**
     * @minItems 1
     */
    verbs: ("look" | "take" | "use" | "eat" | "rest" | "work" | "craft" | "learn" | "hide" | "buy" | "sell")[];
    itemId?: string;
  }[];
  /**
   * @minItems 1
   */
  exits: {
    id: string;
    label: string;
    position: Vec3;
    radius?: number;
    to: {
      [k: string]: unknown;
    };
  }[];
}
export interface AssetRequest {
  query: string;
  expectedSize: Vec31;
  style?: "realistic" | "stylized" | "low-poly";
  maxTriangles?: number;
  animated?: boolean;
  /**
   * @maxItems 8
   */
  tags?: string[];
}
export interface Procedural {
  kind:
    | "box"
    | "cylinder"
    | "sphere"
    | "cone"
    | "plane"
    | "capsule"
    | "building-block"
    | "tree"
    | "rock"
    | "fence"
    | "stall"
    | "crate"
    | "lamp";
  size?: Vec3;
  material?: string;
  color?: HexColor;
}
export interface Transform {
  position: Vec3;
  rotationY?: number;
  rotation?: Vec32;
  scale?: number;
}
