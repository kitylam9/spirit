import type { Planet, PlanetSummary, StarSystemSummary, Tier } from "@spirit/shared";
import { Rng, childSeed } from "../util/rng.js";
import { TIERS, TIER_ORDER, tierIndex } from "./templates.js";

type Climate = Planet["physical"]["climate"];
type Atmosphere = Planet["physical"]["atmosphere"];
type Biome = Planet["biomes"][number];
type Mood = NonNullable<Planet["mood"]>;

/** Procedural (seed-only) planet data. The World Architect may not change these values. */
export interface ProceduralPlanet {
  id: string;
  seed: string;
  tier: Tier;
  civilizationId: string;
  position: [number, number, number];
  radius: number;
  hasRings: boolean;
  danger: number;
  mood: Mood;
  physical: Planet["physical"];
  biomes: Biome[];
}

export interface ProceduralSystem {
  id: string;
  seed: string;
  starColor: string;
  planets: ProceduralPlanet[];
}

const CLIMATE_BIOMES: Record<Climate, Biome[]> = {
  frozen: ["ice", "tundra", "mountains"],
  cold: ["tundra", "forest", "mountains", "coast"],
  temperate: ["forest", "plains", "river-valley", "coast", "mountains"],
  warm: ["plains", "coast", "river-valley", "forest"],
  arid: ["desert", "mountains", "plains"],
  tropical: ["jungle", "coast", "swamp", "river-valley"],
  toxic: ["wasteland", "volcanic", "crystal"],
  varied: ["forest", "desert", "coast", "mountains", "plains"],
};

const PALETTES: Record<Climate, string[][]> = {
  frozen: [["#dfe9f3", "#9fb8d0", "#5a7ba0", "#ffffff"]],
  cold: [["#6f8fa8", "#cfd8dc", "#3b5b4a", "#8aa0b0"]],
  temperate: [["#5b7f3a", "#c9b27c", "#3d5a80", "#8a6f4d"], ["#4f7942", "#2e5e8c", "#d9c89e", "#6b8e23"]],
  warm: [["#a7883d", "#6a994e", "#386fa4", "#e2c290"]],
  arid: [["#d9a05b", "#a0522d", "#f4d19b", "#7a4b2a"]],
  tropical: [["#1f7a4d", "#2a9d8f", "#e9c46a", "#264653"]],
  toxic: [["#1b1036", "#ff2e88", "#19d3ff", "#5c5c70"], ["#3b2f2f", "#9acd32", "#556b2f", "#c0ff00"]],
  varied: [["#4a7c59", "#c2b280", "#3e6990", "#8b5a2b"]],
};

const STAR_COLORS = ["#ffd27d", "#fff4e0", "#ffb36b", "#cfe0ff", "#ff9a6b"];

function climateFor(rng: Rng, tier: Tier): Climate {
  if (tierIndex(tier) >= 6 && rng.chance(0.6)) return "toxic";
  return rng.pick<Climate>(["frozen", "cold", "temperate", "temperate", "warm", "arid", "tropical", "varied"]);
}

function atmosphereFor(climate: Climate): Atmosphere {
  if (climate === "toxic") return "toxic";
  if (climate === "frozen") return "thin";
  return "breathable";
}

export function generateSystem(universeSeed: string, index = 0): ProceduralSystem {
  const seed = childSeed(universeSeed, "system", index);
  const rng = new Rng(seed);
  const count = rng.int(5, 7);

  // Guarantee contrast: always one feudal-ish and one high-tech world, plus random others.
  const tiers: Tier[] = [rng.pick<Tier>(["T1", "T2", "T3"]), rng.pick<Tier>(["T5", "T6", "T7"])];
  while (tiers.length < count) tiers.push(rng.pick(TIER_ORDER));
  rng.shuffle(tiers);

  const planets: ProceduralPlanet[] = tiers.map((tier, i) => {
    const pseed = childSeed(seed, "planet", i);
    const prng = new Rng(pseed);
    const climate = climateFor(prng, tier);
    const orbit = 180 + i * 140 + prng.range(-30, 30);
    const angle = prng.range(0, Math.PI * 2);
    const palette = prng.pick(PALETTES[climate]);
    const pool = [...CLIMATE_BIOMES[climate]];
    const biomes = prng.shuffle(pool).slice(0, Math.min(pool.length, prng.int(2, 3)));
    if (tierIndex(tier) >= 5) biomes.unshift(tierIndex(tier) >= 6 ? "megacity" : "urban");
    const danger = Math.min(10, prng.int(2, 6) + (climate === "toxic" ? 2 : 0));
    return {
      id: `planet-${seed.slice(0, 6)}-${i}`,
      seed: pseed,
      tier,
      civilizationId: `civ-${seed.slice(0, 6)}-${i}`,
      position: [Math.cos(angle) * orbit, prng.range(-25, 25), Math.sin(angle) * orbit],
      radius: prng.range(16, 34),
      hasRings: prng.chance(0.25),
      danger,
      mood: prng.pick<Mood>(["serene", "hopeful", "tense", "grim", "chaotic", "mysterious"]),
      physical: {
        radiusKm: Math.round(prng.range(2500, 9000)),
        gravityG: Math.round(prng.range(0.6, 1.4) * 100) / 100,
        dayLengthHours: Math.round(prng.range(18, 40)),
        climate,
        atmosphere: atmosphereFor(climate),
        moons: prng.int(0, 3),
        palette,
      },
      biomes: [...new Set(biomes)],
    };
  });

  return { id: `system-${seed.slice(0, 8)}`, seed, starColor: rng.pick(STAR_COLORS), planets };
}

export function proceduralName(seed: string, tier: Tier, salt = "name"): string {
  const rng = new Rng(childSeed(seed, salt));
  const syl = TIERS[tier].syllables;
  const n = rng.int(2, 3);
  let s = "";
  for (let i = 0; i < n; i++) s += rng.pick(syl);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function toSummary(p: ProceduralPlanet, name: string, omen: string, detailReady: boolean): PlanetSummary {
  return {
    id: p.id,
    seed: p.seed,
    tier: p.tier,
    name,
    omen,
    position: p.position,
    radius: p.radius,
    palette: p.physical.palette,
    hasRings: p.hasRings,
    danger: p.danger,
    detailReady,
  };
}

export function systemSummary(sys: ProceduralSystem, name: string, planets: PlanetSummary[]): StarSystemSummary {
  return { id: sys.id, seed: sys.seed, name, starColor: sys.starColor, planets };
}
