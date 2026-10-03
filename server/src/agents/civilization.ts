import type { Civilization, Planet } from "@spirit/shared";
import { llm } from "../llm/gateway.js";
import { acceptOrFallback } from "../validate.js";
import { Rng, childSeed } from "../util/rng.js";
import { clip, clipList, uniqueId } from "../util/text.js";
import { BALANCE, TIERS } from "../world/templates.js";
import { proceduralName } from "../world/universe.js";

interface CivDraft {
  name: string;
  summary: string;
  ruler: string;
  governmentDescription: string;
  currency: { name: string; symbol: string; subunit: string };
  mainExports: string[];
  beliefs: string[];
  laws: string[];
  taboos: string[];
  factions: { name: string; goal: string }[];
  namingStyle: string;
  personNames: string[];
  placeNames: string[];
  architecture: string;
  clothing: string;
  music: string;
  eraName: string;
  festivals: { name: string; description: string }[];
  vesselRoles: string[];
}

const str = { type: "string" };
const strArr = (min: number, max: number) => ({ type: "array", minItems: min, maxItems: max, items: str });

const civDraftSchema = {
  type: "object",
  required: ["name", "summary", "ruler", "governmentDescription", "currency", "mainExports", "beliefs", "laws", "taboos", "factions", "namingStyle", "personNames", "placeNames", "architecture", "clothing", "music", "eraName", "festivals", "vesselRoles"],
  properties: {
    name: str,
    summary: str,
    ruler: str,
    governmentDescription: str,
    currency: { type: "object", required: ["name", "symbol", "subunit"], properties: { name: str, symbol: str, subunit: str } },
    mainExports: strArr(2, 5),
    beliefs: strArr(2, 4),
    laws: strArr(2, 5),
    taboos: strArr(1, 3),
    factions: { type: "array", minItems: 3, maxItems: 4, items: { type: "object", required: ["name", "goal"], properties: { name: str, goal: str } } },
    namingStyle: str,
    personNames: strArr(8, 12),
    placeNames: strArr(4, 6),
    architecture: str,
    clothing: str,
    music: str,
    eraName: str,
    festivals: { type: "array", minItems: 2, maxItems: 3, items: { type: "object", required: ["name", "description"], properties: { name: str, description: str } } },
    vesselRoles: { type: "array", minItems: 5, maxItems: 7, items: { type: "string", maxLength: 30 } },
  },
};

function fallbackDraft(planet: Planet): CivDraft {
  const t = TIERS[planet.tier];
  return {
    name: `The ${planet.name} ${t.name === "Primordial" ? "Wilds" : "Realm"}`,
    summary: `A ${t.name.toLowerCase()} civilization on ${planet.name}. ${t.architecture}`,
    ruler: `${proceduralName(planet.seed, planet.tier, "ruler")} the Elder`,
    governmentDescription: `Power is held by ${t.factions[0].name.toLowerCase()}.`,
    currency: { name: t.currency.name, symbol: t.currency.symbol, subunit: t.currency.subunit },
    mainExports: t.materials.slice(0, 3),
    beliefs: t.beliefs,
    laws: t.laws,
    taboos: ["Breaking a sworn promise"],
    factions: t.factions,
    namingStyle: `Names are built from syllables like ${t.syllables.slice(0, 5).join(", ")}.`,
    personNames: Array.from({ length: 12 }, (_, i) => `${proceduralName(planet.seed, planet.tier, `p${i}`)} ${proceduralName(planet.seed, planet.tier, `s${i}`)}`),
    placeNames: planet.regions.map((r) => r.name).concat([proceduralName(planet.seed, planet.tier, "place")]),
    architecture: t.architecture,
    clothing: t.clothing,
    music: t.music,
    eraName: `${t.name} Era`,
    festivals: [
      { name: "Founding Day", description: "The founding of the first settlement is celebrated." },
      { name: "Harvest Feast", description: "Food is shared after the harvest." },
    ],
    vesselRoles: t.roles,
  };
}

/** Models often return "1. Smith's Apprentice - Learns the forge" or headings; keep short job titles only. */
function cleanRoles(raw: string[]): string[] {
  const out = new Set<string>();
  for (const r of raw ?? []) {
    const title = String(r).replace(/^\s*\d+[.)]\s*/, "").split(/\s+[-–—:(]\s*|[,.]/)[0].trim().toLowerCase();
    if (title && !title.endsWith(":") && title.length <= 30 && title.split(/\s+/).length <= 4) out.add(title);
  }
  return [...out].slice(0, 8);
}

function assemble(planet: Planet, draft: CivDraft): Civilization {
  const t = TIERS[planet.tier];
  const rng = new Rng(childSeed(planet.seed, "civ"));
  const taken = new Set<string>();
  const factions: Civilization["factions"] = draft.factions.slice(0, 8).map((f) => ({
    id: uniqueId("faction", clip(f.name, 40) || "faction", taken),
    name: clip(f.name, 60) || "Unnamed faction",
    goal: clip(f.goal, 200) || "Gain power.",
    power: rng.int(2, 9),
  }));
  factions[0].relations = factions.slice(1).map((f) => ({ factionId: f.id, stance: rng.pick(["rival", "hostile", "neutral"] as const) }));
  const roles = cleanRoles(draft.vesselRoles);
  const isAnimal = planet.tier === "T0";
  const daysPerYear = rng.int(280, 400);
  return {
    schemaVersion: "1.0",
    id: planet.civilizationId,
    planetId: planet.id,
    name: clip(draft.name, 60) || "Unnamed civilization",
    tier: planet.tier,
    techProfile: {
      agriculture: planet.tier,
      energy: planet.tier,
      medicine: planet.tier,
      weapons: planet.tier,
      communication: planet.tier,
      transport: planet.tier,
      computing: planet.tier,
    },
    summary: clip(draft.summary, 800) || "A civilization.",
    government: { type: t.government, ruler: clip(draft.ruler, 100) || "Unknown", description: clip(draft.governmentDescription, 400) || "..." },
    economy: {
      type: t.economy,
      currency: {
        name: clip(draft.currency?.name, 30) || t.currency.name,
        symbol: clip(draft.currency?.symbol, 4) || t.currency.symbol,
        subunit: clip(draft.currency?.subunit, 30) || t.currency.subunit,
        subunitsPerUnit: t.currency.subunitsPerUnit,
      },
      mainExports: clipList(draft.mainExports, 8, 40),
    },
    beliefs: clipList(draft.beliefs, 6, 200),
    socialClasses: t.socialClasses,
    laws: clipList(draft.laws, 10, 160),
    taboos: clipList(draft.taboos, 8, 160),
    factions,
    naming: {
      style: clip(draft.namingStyle, 400) || "Simple names.",
      personExamples: clipList(draft.personNames, 30, 60),
      placeExamples: clipList(draft.placeNames, 20, 60),
    },
    aesthetic: {
      architecture: clip(draft.architecture, 300) || t.architecture,
      clothing: clip(draft.clothing, 300) || t.clothing,
      materials: t.materials,
      palette: planet.physical.palette,
      music: clip(draft.music, 200) || t.music,
      stylePreference: "stylized",
      uiTheme: t.uiTheme,
    },
    calendar: {
      currentYear: t.baseYear + rng.int(0, 60),
      eraName: clip(draft.eraName, 40) || `${t.name} Era`,
      daysPerYear,
      festivals: draft.festivals.slice(0, 8).map((f, i) => ({
        name: clip(f.name, 40) || "Festival",
        dayOfYear: Math.round(((i + 1) * daysPerYear) / (draft.festivals.length + 1)),
        description: clip(f.description, 200) || "...",
      })),
    },
    vessels: [
      {
        kind: isAnimal ? "animal" : "humanoid",
        species: isAnimal ? "beast" : "human",
        roles: roles.length >= 3 ? roles : t.roles,
        lifespanYears: t.lifespan,
      },
    ],
    balance: BALANCE[planet.tier],
  };
}

export async function createCivilization(planet: Planet): Promise<Civilization> {
  const t = TIERS[planet.tier];
  const draft = await llm.json<CivDraft>({
    agent: "civilization",
    system: `You are the Civilization agent of "Spirit", a life-simulation game. You design the society that dominates a planet: who rules, what people believe and fear, how they name things, and what their world looks like. Only technology possible at the given tier. Content rating: Teen.`,
    user:
      `Planet "${planet.name}" (tier ${planet.tier}, ${t.name}). Omen: "${planet.omen}". Climate ${planet.physical.climate}. Mood ${planet.mood}.\n` +
      `Regions: ${planet.regions.map((r) => `${r.name} (${r.description})`).join("; ")}.\n` +
      `History: ${planet.history.map((h) => `${h.year}: ${h.title}`).join("; ")}.\nHooks: ${planet.hooks.join(" | ")}.\n` +
      `Design its dominant civilization. Government type is ${t.government}, economy ${t.economy}. ` +
      `Give 3-4 factions with conflicting goals an ordinary person would feel, a concrete naming style, 8-12 example person names (given name + family name) and 4-6 place names that follow it, ` +
      `specific architecture and clothing (materials, silhouettes), and 5-7 vesselRoles: short job titles of 1-3 words a newborn or newcomer could have, low and high status (e.g. "stable hand", "acolyte"). ` +
      `Keep every text field to one or two sentences.` +
      (planet.tier === "T0" ? " This world has no sapient civilization: describe animal packs instead, and roles are animals." : ""),
    schema: civDraftSchema,
    temperature: 0.9,
    maxTokens: 2200,
  });
  const fb = () => assemble(planet, fallbackDraft(planet));
  return acceptOrFallback("civilization", draft ? assemble(planet, draft) : fb(), fb, `civilization ${planet.civilizationId}`);
}
