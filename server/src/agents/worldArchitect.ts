import type { Planet } from "@spirit/shared";
import { llm } from "../llm/gateway.js";
import { acceptOrFallback } from "../validate.js";
import { Rng, childSeed } from "../util/rng.js";
import { clip, clipList, uniqueId } from "../util/text.js";
import { TIERS } from "../world/templates.js";
import { proceduralName, type ProceduralPlanet, type ProceduralSystem } from "../world/universe.js";

const TIER_LINES = Object.entries(TIERS)
  .map(([t, v]) => `${t} ${v.name}`)
  .join(", ");

const SYSTEM = `You are the World Architect of "Spirit", a life-simulation game where a spirit of light travels between planets and is born into their civilizations. Write vivid, grounded, original content. Civilization tiers: ${TIER_LINES}. Content rating: Teen.`;

// ---------- system names and omens (one batched call when a system is entered) ----------

interface SystemDraft {
  systemName: string;
  planets: { name: string; omen: string }[];
}

const systemDraftSchema = (n: number) => ({
  type: "object",
  required: ["systemName", "planets"],
  properties: {
    systemName: { type: "string" },
    planets: {
      type: "array",
      minItems: n,
      maxItems: n,
      items: { type: "object", required: ["name", "omen"], properties: { name: { type: "string" }, omen: { type: "string" } } },
    },
  },
});

export interface SystemNames {
  systemName: string;
  planets: { name: string; omen: string }[];
}

function fallbackOmen(p: ProceduralPlanet): string {
  const t = TIERS[p.tier];
  const moodWord = { serene: "quiet", hopeful: "bright", tense: "uneasy", grim: "dark", chaotic: "restless", mysterious: "strange" }[p.mood];
  return `A ${moodWord} ${p.physical.climate} world of the ${t.name.toLowerCase()} age, where ${t.hazards[0].toLowerCase()}.`;
}

export async function nameSystem(sys: ProceduralSystem): Promise<SystemNames> {
  const fallback: SystemNames = {
    systemName: proceduralName(sys.seed, "T7", "system"),
    planets: sys.planets.map((p) => ({ name: proceduralName(p.seed, p.tier), omen: fallbackOmen(p) })),
  };
  const lines = sys.planets
    .map((p, i) => `${i + 1}. tier ${p.tier} (${TIERS[p.tier].name}), climate ${p.physical.climate}, atmosphere ${p.physical.atmosphere}, mood ${p.mood}, danger ${p.danger}/10, biomes ${p.biomes.join("/")}`)
    .join("\n");
  // Models repeat favorite names across universes; a seeded initial forces variety.
  const initial = "BCDFGHKLMNPRSTVZ"[parseInt(sys.seed.slice(0, 4), 16) % 16];
  const draft = await llm.json<SystemDraft>({
    agent: "world-architect.system",
    system: SYSTEM,
    user: `A new star system has formed. Name the system (the name must start with the letter "${initial}"), and for each planet below give a short evocative planet name (1-2 words, fitting its civilization tier) and a one-sentence omen (max 150 characters) the spirit reads from space, hinting at the tier, mood and one story hook. Keep the planets in the same order.\n\n${lines}`,
    schema: systemDraftSchema(sys.planets.length),
    temperature: 1.0,
    maxTokens: 900,
  });
  if (!draft) return fallback;
  return {
    systemName: clip(draft.systemName, 60) || fallback.systemName,
    planets: sys.planets.map((_, i) => ({
      name: clip(draft.planets[i]?.name, 40) || fallback.planets[i].name,
      omen: clip(draft.planets[i]?.omen, 160) || fallback.planets[i].omen,
    })),
  };
}

// ---------- planet detail (when the player approaches a planet) ----------

interface PlanetDraft {
  regions: { name: string; description: string; features: string[] }[];
  history: { year: number; title: string; summary: string }[];
  hooks: string[];
}

const planetDraftSchema = {
  type: "object",
  required: ["regions", "history", "hooks"],
  properties: {
    regions: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: {
        type: "object",
        required: ["name", "description", "features"],
        properties: { name: { type: "string" }, description: { type: "string" }, features: { type: "array", items: { type: "string" } } },
      },
    },
    history: {
      type: "array",
      minItems: 5,
      maxItems: 7,
      items: {
        type: "object",
        required: ["year", "title", "summary"],
        properties: { year: { type: "integer" }, title: { type: "string" }, summary: { type: "string" } },
      },
    },
    hooks: { type: "array", minItems: 3, maxItems: 4, items: { type: "string" } },
  },
};

const DENSITY: Planet["regions"][number]["populationDensity"][] = ["empty", "sparse", "village", "town", "city", "metropolis"];

function fallbackDraft(p: ProceduralPlanet, name: string): PlanetDraft {
  const t = TIERS[p.tier];
  const rng = new Rng(childSeed(p.seed, "regions"));
  const kinds = ["Hollow", "Reach", "Crossing", "Heights", "Market", "Gate", "Fields", "Deep"];
  return {
    regions: [0, 1, 2, 3].map((i) => {
      const n = `${proceduralName(p.seed, p.tier, `region${i}`)} ${rng.pick(kinds)}`;
      return {
        name: n,
        description: `A ${p.biomes[i % p.biomes.length]} district of ${name}. ${t.architecture}`,
        features: [t.workplace, t.food.name.toLowerCase() + " sellers", t.materials[0] + " buildings"],
      };
    }),
    history: [0, 1, 2, 3, 4].map((i) => ({
      year: t.baseYear - 400 + i * 100,
      title: ["The Founding", "The Long Hunger", "The Great Rivalry", "The Turning", "The Present Trouble"][i],
      summary: [
        `The first settlers of ${name} raised their homes from ${t.materials[0]}.`,
        "Years of scarcity taught the people to distrust strangers.",
        `${t.factions[0].name} and ${t.factions[1].name} began their long struggle.`,
        "A new way of life spread across the land.",
        `Today ${t.factions[0].name.toLowerCase()} seeks to ${t.factions[0].goal.charAt(0).toLowerCase() + t.factions[0].goal.slice(1)}`,
      ][i],
    })),
    hooks: [t.factions[0].goal, t.factions[1].goal, `${t.hazards[0]} more often than before.`],
  };
}

function assemble(p: ProceduralPlanet, name: string, omen: string, draft: PlanetDraft): Planet {
  const taken = new Set<string>();
  const rng = new Rng(childSeed(p.seed, "layout"));
  const tierIdx = Number(p.tier.slice(1));
  const regions = draft.regions.slice(0, 4).map((r, i) => ({
    id: uniqueId("region", clip(r.name, 40) || `region ${i}`, taken),
    name: clip(r.name, 60) || `Region ${i + 1}`,
    biome: p.biomes[i % p.biomes.length],
    description: clip(r.description, 600) || "An unremarkable place.",
    populationDensity: DENSITY[Math.min(5, Math.max(1, Math.round(tierIdx / 1.6) + (i === 0 ? 1 : 0) - (i === 3 ? 1 : 0)))],
    danger: Math.min(10, Math.max(0, p.danger + rng.int(-2, 2) + (i === 3 ? 2 : 0))),
    features: clipList(r.features, 10, 80),
    connections: [] as Planet["regions"][number]["connections"],
  }));
  const mode = tierIdx >= 6 ? "tube" : tierIdx >= 4 ? "rail" : "road";
  for (let i = 0; i < regions.length; i++) {
    const next = regions[(i + 1) % regions.length];
    const travelTicks = rng.int(30, 180);
    regions[i].connections.push({ to: next.id, mode, travelTicks });
    next.connections.push({ to: regions[i].id, mode, travelTicks });
  }
  const history = draft.history
    .slice(0, 15)
    .map((h) => ({ year: Math.round(Number(h.year) || 0), title: clip(h.title, 80) || "Untitled", summary: clip(h.summary, 400) || "..." }))
    .sort((a, b) => a.year - b.year);
  return {
    schemaVersion: "1.0",
    id: p.id,
    name,
    systemId: `system-${p.id.split("-")[1]}`,
    seed: p.seed,
    tier: p.tier,
    civilizationId: p.civilizationId,
    omen,
    mood: p.mood,
    danger: p.danger,
    physical: p.physical,
    biomes: p.biomes,
    regions,
    history,
    hooks: clipList(draft.hooks, 6, 200),
  };
}

export async function detailPlanet(p: ProceduralPlanet, systemId: string, name: string, omen: string): Promise<Planet> {
  const t = TIERS[p.tier];
  const draft = await llm.json<PlanetDraft>({
    agent: "world-architect.planet",
    system: SYSTEM,
    user:
      `Detail the planet "${name}". Omen: "${omen}". Civilization tier ${p.tier} (${t.name}). Climate ${p.physical.climate}, atmosphere ${p.physical.atmosphere}, biomes ${p.biomes.join(", ")}, mood ${p.mood}, danger ${p.danger}/10.\n` +
      `Give exactly 4 regions where ordinary people live and work (name, 1-2 sentence description, 2-4 notable features), ` +
      `5-7 history events in chronological order (year as integer in the local calendar, current year about ${t.baseYear}), ` +
      `and 3-4 story hooks: concrete troubles an ordinary person could get caught up in. Only technology possible at tier ${p.tier}.`,
    schema: planetDraftSchema,
    temperature: 0.9,
    maxTokens: 1800,
  });
  const fb = () => assemble(p, name, omen, fallbackDraft(p, name));
  const planet = draft ? assemble(p, name, omen, draft) : fb();
  planet.systemId = systemId;
  return acceptOrFallback("planet", planet, () => ({ ...fb(), systemId }), `planet ${p.id}`);
}
