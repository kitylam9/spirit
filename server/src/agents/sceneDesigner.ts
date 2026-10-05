import type { Civilization, NpcSpawn, Planet, Scene } from "@spirit/shared";
import { llm } from "../llm/gateway.js";
import { acceptOrFallback } from "../validate.js";
import { Rng, childSeed } from "../util/rng.js";
import { clip, clipList, slug } from "../util/text.js";
import { TIERS, tierIndex } from "../world/templates.js";

type Region = Planet["regions"][number];
type Instance = Scene["instances"][number];
type Biome = Region["biome"];
type Vec3 = [number, number, number];

const TERRAIN_MATERIAL: Record<Biome, string> = {
  forest: "grass", plains: "grass", desert: "sand", tundra: "snow", mountains: "rock", swamp: "mud", jungle: "grass",
  ocean: "sand", coast: "sand", "river-valley": "grass", volcanic: "basalt", ice: "snow", urban: "asphalt",
  megacity: "metal-grate", orbital: "metal", underground: "stone", wasteland: "ash", crystal: "crystal",
};

const TREE_COUNT: Partial<Record<Biome, number>> = { forest: 40, jungle: 45, plains: 14, "river-valley": 16, coast: 8, swamp: 18, tundra: 6, mountains: 10, urban: 4 };
const ROCK_COUNT: Partial<Record<Biome, number>> = { desert: 18, mountains: 20, tundra: 10, volcanic: 16, wasteland: 14, crystal: 18, ice: 12, coast: 6 };

export function foodItemId(civ: Civilization): string {
  return `item-${slug(TIERS[civ.tier].food.name)}`;
}

/** 3D model search queries for the props whose look depends most on the culture. */
interface ModelQueries {
  house?: string;
  workplace?: string;
  stall?: string;
  landmark?: string;
}

interface SceneDraft {
  name: string;
  description: string;
  ambientSounds: string[];
  models?: ModelQueries;
}

const s = { type: "string" };
const sceneDraftSchema = {
  type: "object",
  required: ["name", "description", "ambientSounds", "models"],
  properties: {
    name: s,
    description: s,
    ambientSounds: { type: "array", maxItems: 3, items: s },
    models: { type: "object", required: ["house", "workplace", "stall", "landmark"], properties: { house: s, workplace: s, stall: s, landmark: s } },
  },
};

const ERA = ["prehistoric", "tribal", "medieval", "colonial", "victorian", "modern", "cyberpunk", "futuristic"];

/** Template queries per tier, used when the LLM gives none (or an unusable one). */
function fallbackQueries(tier: number, focal: string): Required<ModelQueries> {
  return {
    house: ["large boulder", "tribal hut", "medieval house", "colonial house", "victorian brick house", "modern apartment building", "cyberpunk building", "futuristic building"][tier],
    workplace: ["berry bush", "hide tent", "medieval barn", "harbor warehouse", "brick factory", "office building", "sci-fi factory", "futuristic tower"][tier],
    stall: tier === 0 ? "berry bush" : `${ERA[tier]} market stall`,
    landmark: focal === "well" ? "stone well" : focal === "fire" ? "campfire" : `${ERA[tier]} ${focal}`,
  };
}

/** Keeps a short plain-words query ("medieval timber house"), else the fallback. */
function cleanQuery(q: unknown, fallback: string): string {
  if (typeof q !== "string") return fallback;
  const words = q.replace(/[^a-zA-Z -]/g, " ").trim().split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 5 ? words.join(" ").toLowerCase() : fallback;
}

const request = (query: string, expectedSize: Vec3, maxTriangles: number): NonNullable<Instance["assetRequest"]> => ({
  query: clip(query, 120),
  expectedSize,
  style: "realistic",
  maxTriangles,
});

function buildingSize(tier: number, rng: Rng): Vec3 {
  if (tier <= 1) return [rng.range(4, 6), rng.range(3, 4), rng.range(4, 6)];
  if (tier <= 3) return [rng.range(6, 9), rng.range(5, 8), rng.range(5, 8)];
  if (tier === 4) return [rng.range(8, 12), rng.range(9, 15), rng.range(8, 12)];
  if (tier === 5) return [rng.range(10, 14), rng.range(14, 30), rng.range(10, 14)];
  return [rng.range(10, 16), rng.range(25, 60), rng.range(10, 16)];
}

function layout(planet: Planet, civ: Civilization, region: Region, sceneId: string, existingScenes: Set<string>, draft: SceneDraft): Scene {
  const t = TIERS[planet.tier];
  const tier = tierIndex(planet.tier);
  const rng = new Rng(childSeed(planet.seed, sceneId));
  const night = tier >= 6 ? rng.chance(0.7) : rng.chance(0.15);
  const timeOfDay = night ? rng.range(20, 23.5) : rng.range(8, 17);
  const palette = planet.physical.palette;
  const flat = ["urban", "megacity", "orbital", "underground"].includes(region.biome);
  const instances: Instance[] = [];
  const pointLights: NonNullable<Scene["environment"]["lighting"]["pointLights"]> = [];
  const interactables: NonNullable<Scene["interactables"]> = [];
  const food = foodItemId(civ);
  const fq = fallbackQueries(tier, t.focal);
  const q: Required<ModelQueries> = {
    house: cleanQuery(draft.models?.house, fq.house),
    workplace: cleanQuery(draft.models?.workplace, fq.workplace),
    stall: cleanQuery(draft.models?.stall, fq.stall),
    landmark: cleanQuery(draft.models?.landmark, fq.landmark),
  };

  // Focal point at the center.
  const focal: Record<typeof t.focal, Instance["procedural"]> = {
    well: { kind: "cylinder", size: [2.2, 1.1, 2.2], material: "fieldstone" },
    fire: { kind: "cone", size: [1.4, 1.2, 1.4], material: "fire", color: "#ff7a1a" },
    statue: { kind: "box", size: [1.6, 4.5, 1.6], material: "stone" },
    kiosk: { kind: "box", size: [2.4, 3, 1.6], material: "neon", color: palette[2] ?? "#19d3ff" },
  };
  instances.push({ id: "inst-focal", label: { well: "Well", fire: "Campfire", statue: "Monument", kiosk: "Public kiosk" }[t.focal], assetRequest: request(q.landmark, focal[t.focal]!.size as Vec3, 50000), procedural: focal[t.focal], transform: { position: [0, 0, 0] }, placement: { snapToGround: true, collider: "box" } });
  interactables.push({ id: "int-focal", instanceId: "inst-focal", label: { well: "Drink from the well", fire: "Warm yourself", statue: "Rest at the monument", kiosk: "Use the kiosk" }[t.focal], verbs: ["use", "look"] });
  if (t.focal === "fire") pointLights.push({ position: [0, 1.5, 0], color: "#ff8a3a", intensity: 8, range: 14, flicker: true });

  // Food stall with a vendor.
  instances.push({ id: "inst-food-stall", label: `${t.food.name} stall`, assetRequest: request(q.stall, [3, 2.6, 2], 30000), procedural: { kind: "stall", size: [3, 2.6, 2], material: tier >= 5 ? "metal" : "wood", color: palette[1] }, transform: { position: [7, 0, -3], rotationY: -Math.PI / 2 }, placement: { snapToGround: true, collider: "box" } });
  interactables.push({ id: "int-food-stall", instanceId: "inst-food-stall", label: `Buy ${t.food.name.toLowerCase()}`, verbs: ["buy", "look"], itemId: food });
  instances.push({ id: "inst-crates", label: "Crates", assetRequest: request(tier <= 4 ? "wooden crate" : tier === 5 ? "plastic crate" : "sci-fi crate", [0.9, 0.9, 0.9], 5000), procedural: { kind: "crate", size: [0.9, 0.9, 0.9], material: tier >= 5 ? "polymer" : "wood" }, transform: { position: [9.5, 0, -5] }, count: 5, scatterRadius: 2, placement: { snapToGround: true, collider: "box" } });

  // Exits on the edge, one per connection.
  const exits: Scene["exits"] = region.connections.map((c, i) => {
    const angle = (i / Math.max(1, region.connections.length)) * Math.PI * 2 + Math.PI / 4;
    const target = planet.regions.find((r) => r.id === c.to);
    return {
      id: `exit-${slug(target?.name ?? c.to).slice(0, 30)}`,
      label: `To ${target?.name ?? "elsewhere"}`,
      position: [Math.cos(angle) * 44, 0, Math.sin(angle) * 44] as Vec3,
      radius: 3,
      to: { regionId: c.to, pending: !existingScenes.has(c.to) },
    };
  });
  const exitAngles = exits.map((e) => Math.atan2(e.position[2], e.position[0]));

  // Buildings on a ring, leaving gaps toward exits. Building 0 is home, 1 is the workplace.
  const ringCount = tier === 0 ? 0 : { empty: 3, sparse: 4, village: 7, town: 10, city: 12, metropolis: 14 }[region.populationDensity];
  let placed = 0;
  for (let k = 0; placed < ringCount && k < ringCount * 4; k++) {
    const angle = rng.range(0, Math.PI * 2);
    if (exitAngles.some((a) => Math.abs(Math.atan2(Math.sin(angle - a), Math.cos(angle - a))) < 0.35)) continue;
    const r = rng.range(17, 33);
    const size = buildingSize(tier, rng);
    const id = `inst-building-${placed}`;
    instances.push({
      id,
      label: placed === 0 ? "Your shelter" : placed === 1 ? `The ${t.workplace}` : "House",
      assetRequest: placed === 1 ? request(q.workplace, size, 60000) : request(q.house, size, 30000),
      procedural: { kind: "building-block", size, material: t.materials[placed % t.materials.length], color: placed === 0 ? palette[3] ?? palette[0] : undefined },
      transform: { position: [Math.cos(angle) * r, 0, Math.sin(angle) * r], rotationY: -angle + Math.PI / 2 },
      placement: { snapToGround: true, collider: "box" },
    });
    placed++;
  }
  // T0 (no buildings) uses a den rock and a foraging tree as home/work.
  if (tier === 0) {
    instances.push({ id: "inst-building-0", label: "Den", assetRequest: request(q.house, [5, 3, 5], 30000), procedural: { kind: "rock", size: [5, 3, 5], material: "rock" }, transform: { position: [-18, 0, 12] }, placement: { snapToGround: true, collider: "convex" } });
    instances.push({ id: "inst-building-1", label: "Berry thicket", assetRequest: request(q.workplace, [4, 4, 4], 30000), procedural: { kind: "tree", size: [4, 4, 4], material: "leaves" }, transform: { position: [16, 0, 16] }, placement: { snapToGround: true, collider: "convex" } });
  }
  interactables.push({ id: "int-home", instanceId: "inst-building-0", label: tier === 0 ? "Sleep in the den" : "Rest at your shelter", verbs: ["rest", "look"] });
  interactables.push({ id: "int-work", instanceId: "inst-building-1", label: tier === 0 ? "Forage" : `Work at the ${t.workplace}`, verbs: ["work", "look"] });

  // Nature.
  const trees = TREE_COUNT[region.biome] ?? 0;
  const rocks = ROCK_COUNT[region.biome] ?? 0;
  for (let c = 0; c < 3; c++) {
    const a = rng.range(0, Math.PI * 2);
    const pos: Vec3 = [Math.cos(a) * 38, 0, Math.sin(a) * 38];
    if (trees > 0) instances.push({ id: `inst-trees-${c}`, label: "Trees", assetRequest: request(region.biome === "tundra" || region.biome === "mountains" ? "pine tree" : region.biome === "jungle" ? "palm tree" : "tree", [4, 7, 4], 20000), procedural: { kind: "tree", size: [4, 7, 4], material: region.biome === "tundra" ? "pine" : "leaves" }, transform: { position: pos }, count: Math.ceil(trees / 3), scatterRadius: 10, placement: { snapToGround: true, collider: "convex" } });
    if (rocks > 0) instances.push({ id: `inst-rocks-${c}`, label: "Rocks", assetRequest: request(region.biome === "crystal" ? "crystal" : "rock", [2, 1.5, 2], 10000), procedural: { kind: "rock", size: [2, 1.5, 2], material: region.biome === "crystal" ? "crystal" : "rock" }, transform: { position: [-pos[0], 0, -pos[2]] }, count: Math.ceil(rocks / 3), scatterRadius: 9, placement: { snapToGround: true, collider: "convex" } });
  }

  // Lamps for tier 3+ or night.
  if (tier >= 3 || night) {
    for (let i = 0; i < 6 && pointLights.length < 14; i++) {
      const a = (i / 6) * Math.PI * 2;
      const pos: Vec3 = [Math.cos(a) * 12, 0, Math.sin(a) * 12];
      const color = tier >= 6 ? palette[(i % 2) + 1] ?? "#ff2e88" : tier >= 4 ? "#ffd27a" : "#ff9a3a";
      instances.push({ id: `inst-lamp-${i}`, label: "Lamp", assetRequest: request(tier <= 2 ? "torch" : tier === 3 ? "oil street lamp" : tier === 4 ? "victorian street lamp" : tier === 5 ? "street light" : "sci-fi lamp", [0.3, 3.5, 0.3], 8000), procedural: { kind: "lamp", size: [0.3, 3.5, 0.3], material: tier >= 4 ? "iron" : "wood", color }, transform: { position: pos }, placement: { snapToGround: true, collider: "box" } });
      pointLights.push({ position: [pos[0], 3.4, pos[2]], color, intensity: tier >= 6 ? 14 : 8, range: 14, flicker: tier < 4 });
    }
  }

  // People: a vendor, a guard (tier 2+), and residents from the civilization's roles.
  const roles = civ.vessels[0]?.roles ?? t.roles;
  const npcSpawns: NpcSpawn[] = [{ roleHint: tier === 0 ? "old pack leader" : `${t.food.name.toLowerCase()} seller`, position: [9, 0, -1], behavior: "sell" }];
  if (tier >= 2) npcSpawns.push({ roleHint: "guard", position: [-6, 0, 8], behavior: "guard" });
  for (let i = 0; i < 3; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(5, 14);
    npcSpawns.push({ roleHint: roles[(i + 1) % roles.length], position: [Math.cos(a) * r, 0, Math.sin(a) * r], behavior: rng.pick(["idle", "wander", "work"] as const) });
  }

  const sunElevation = night ? -0.3 : Math.sin(((timeOfDay - 6) / 12) * Math.PI) * 1.2;
  const fogColor = night ? "#0b0d1a" : region.biome === "desert" ? "#e8d3a8" : region.biome === "wasteland" || planet.physical.atmosphere === "toxic" ? "#6b5f7a" : "#b9c8d6";

  return {
    schemaVersion: "1.0",
    id: sceneId,
    planetId: planet.id,
    regionId: region.id,
    name: clip(draft.name, 60) || region.name,
    description: clip(draft.description, 600) || region.description,
    tier: planet.tier,
    stylePreference: "stylized",
    indoor: false,
    bounds: { sizeX: 100, sizeZ: 100, maxHeight: 80 },
    environment: {
      terrain: flat
        ? { kind: "flat", material: TERRAIN_MATERIAL[region.biome] }
        : { kind: "heightmap", seed: childSeed(planet.seed, `${sceneId}:terrain`), amplitude: region.biome === "mountains" ? 6 : rng.range(1, 3), roughness: rng.range(0.2, 0.6), material: TERRAIN_MATERIAL[region.biome] },
      sky: { kind: "procedural", timeOfDay: Math.round(timeOfDay * 10) / 10, cloudCover: Math.round(rng.range(0, 0.8) * 100) / 100 },
      fog: { color: fogColor, density: planet.physical.atmosphere === "toxic" ? 0.025 : region.biome === "swamp" ? 0.02 : 0.008 },
      lighting: {
        sun: { color: night ? "#7d8cff" : "#fff1d6", intensity: night ? 0.25 : 2.2, elevation: Math.max(-1.5, Math.min(1.5, sunElevation)), azimuth: rng.range(0, 6.28), castShadows: !night },
        ambient: { color: night ? "#20264a" : "#9fb0c0", intensity: night ? 0.35 : 0.6 },
        pointLights,
      },
      weather: planet.physical.atmosphere === "toxic" ? "acid-rain" : rng.pick(["clear", "clear", "cloudy", "fog"] as const),
      ambientAudio: clipList(draft.ambientSounds, 4, 40),
    },
    budget: { maxTriangles: 250000, maxInstances: 400, maxNewAssets: 8 },
    instances,
    spawnPoints: [
      { id: "spawn-center", position: [0, 0, 6], rotationY: Math.PI, purpose: "arrival" },
      { id: "spawn-home", position: [0, 0, 10], rotationY: 0, purpose: "birth" },
    ],
    npcSpawns: npcSpawns as unknown as Scene["npcSpawns"],
    interactables,
    exits,
  };
}

export async function designScene(planet: Planet, civ: Civilization, region: Region, existingScenes: Set<string>): Promise<Scene> {
  const sceneId = `scene-${region.id.replace(/^region-/, "")}`;
  const fbDraft: SceneDraft = { name: region.name, description: region.description, ambientSounds: [] };
  const t = TIERS[planet.tier];
  const draft = await llm.json<SceneDraft>({
    agent: "scene-designer",
    system: `You are the Scene Designer of "Spirit", a life-simulation game. You name places and write the atmosphere a player feels on arrival. Content rating: Teen.`,
    user:
      `Region "${region.name}" on planet "${planet.name}" (tier ${planet.tier}, ${TIERS[planet.tier].name}): ${region.description}\nFeatures: ${region.features.join(", ")}.\n` +
      `Architecture: ${civ.aesthetic.architecture}\nGive the central gathering place a name (max 5 words), a 2-3 sentence arrival description (sights, sounds, smells, the mood of the people today), and up to 3 short ambient sound keywords.\n` +
      `Also give "models": search queries for a 3D model library, 2-4 plain English words each, a common object noun last (e.g. "medieval timber house", "stone market stall"). Keys: house (a typical home), workplace (the ${t.workplace}), stall (a ${t.food.name.toLowerCase()} stall), landmark (the central ${t.focal}).`,
    schema: sceneDraftSchema,
    temperature: 0.9,
    maxTokens: 500,
  });
  const fb = () => layout(planet, civ, region, sceneId, existingScenes, fbDraft);
  return acceptOrFallback("scene", draft ? layout(planet, civ, region, sceneId, existingScenes, draft) : fb(), fb, `scene ${sceneId}`);
}
