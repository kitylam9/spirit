import type { Civilization, Tier } from "@spirit/shared";

type Gov = Civilization["government"]["type"];
type Econ = Civilization["economy"]["type"];
type Theme = NonNullable<Civilization["aesthetic"]["uiTheme"]>;
export type Balance = Required<NonNullable<Civilization["balance"]>>;

export interface TierTemplate {
  name: string;
  government: Gov;
  economy: Econ;
  currency: { name: string; symbol: string; subunit: string; subunitsPerUnit: number };
  socialClasses: { name: string; share: number; description: string }[];
  beliefs: string[];
  laws: string[];
  factions: { name: string; goal: string }[];
  materials: string[];
  architecture: string;
  clothing: string;
  music: string;
  uiTheme: Theme;
  roles: string[];
  lifespan: number;
  baseYear: number;
  food: { name: string; nourish: number };
  /** Syllables for procedural names. */
  syllables: string[];
  vocabulary: { health: string; hunger: string; energy: string; wealth: string };
  hazards: string[];
  workplace: string;
  focal: "well" | "statue" | "kiosk" | "fire";
}

const ancient: Partial<TierTemplate> = {
  syllables: ["ka", "ru", "an", "to", "mi", "ul", "ra", "ek", "so", "na", "ta", "gu"],
};
const medieval: Partial<TierTemplate> = {
  syllables: ["al", "dric", "wen", "mar", "th", "ford", "bran", "el", "wyn", "os", "hil", "ric", "ton", "gar"],
};
const modern: Partial<TierTemplate> = {
  syllables: ["vel", "ston", "ar", "den", "lor", "ex", "mo", "rin", "cal", "ver", "ta", "son"],
};
const future: Partial<TierTemplate> = {
  syllables: ["kess", "ar", "vex", "on", "zy", "ra", "quel", "ion", "dex", "ny", "sol", "kai"],
};

export const TIERS: Record<Tier, TierTemplate> = {
  T0: {
    ...ancient,
    name: "Primordial",
    government: "none",
    economy: "subsistence",
    currency: { name: "shell", symbol: "sh", subunit: "bead", subunitsPerUnit: 10 },
    socialClasses: [{ name: "Herd", share: 1, description: "Every creature fends for itself." }],
    beliefs: ["The storm and the sun are the only powers."],
    laws: ["The strong eat first."],
    factions: [{ name: "Ridge Pack", goal: "Hold the high hunting grounds." }, { name: "River Herd", goal: "Reach the water before the dry season." }],
    materials: ["stone", "wood", "bone"],
    architecture: "No buildings: caves, fallen trees and nests.",
    clothing: "None; fur and hide.",
    music: "Wind, birdsong and distant howls.",
    uiTheme: "organic",
    roles: ["young wolf", "lone deer", "old bear"],
    lifespan: 15,
    baseYear: 0,
    food: { name: "Wild berries", nourish: 25 },
    vocabulary: { health: "Life", hunger: "Hunger", energy: "Breath", wealth: "Stash" },
    hazards: ["A predator lunges from the brush", "A rockslide clips you"],
    workplace: "foraging ground",
    focal: "fire",
  } as TierTemplate,
  T1: {
    ...ancient,
    name: "Tribal",
    government: "chiefdom",
    economy: "barter",
    currency: { name: "shell", symbol: "sh", subunit: "bead", subunitsPerUnit: 10 },
    socialClasses: [
      { name: "Elders", share: 0.1, description: "Keepers of lore and law." },
      { name: "Hunters", share: 0.4, description: "Bring meat and defend the camp." },
      { name: "Gatherers", share: 0.5, description: "Bring roots, herbs and water." },
    ],
    beliefs: ["Ancestors walk beside the living.", "The great beast in the sky watches the hunt."],
    laws: ["Share the kill with the whole camp.", "Never break a fire-oath."],
    factions: [{ name: "Elder Circle", goal: "Keep the old ways." }, { name: "Young Spears", goal: "Raid the rival tribe for its valley." }],
    materials: ["hide", "bone", "wood", "stone", "ochre"],
    architecture: "Hide tents and longhouses of bent saplings around a central fire.",
    clothing: "Tanned hides, bone beads and ochre paint.",
    music: "Drums, chanting and bone flutes.",
    uiTheme: "bone-and-ochre",
    roles: ["hunter", "gatherer", "shaman's apprentice", "potter", "orphan"],
    lifespan: 40,
    baseYear: 300,
    food: { name: "Roast tuber", nourish: 30 },
    vocabulary: { health: "Blood", hunger: "Belly", energy: "Breath", wealth: "Shells" },
    hazards: ["A boar charges out of the brush", "You step on a sharp stone"],
    workplace: "hunting grounds",
    focal: "fire",
  } as TierTemplate,
  T2: {
    ...medieval,
    name: "Feudal",
    government: "feudal-monarchy",
    economy: "agrarian",
    currency: { name: "silver mark", symbol: "m", subunit: "copper", subunitsPerUnit: 20 },
    socialClasses: [
      { name: "Nobility", share: 0.02, description: "Lords and knights who own the land." },
      { name: "Clergy", share: 0.03, description: "Priests of the realm's faith." },
      { name: "Guildfolk", share: 0.15, description: "Craftsmen and merchants." },
      { name: "Serfs", share: 0.8, description: "Peasants bound to the land." },
    ],
    beliefs: ["The gods judge every oath.", "Sickness is punishment for hidden sin."],
    laws: ["Poaching the lord's game is punished by the loss of a hand.", "Serfs may not leave without leave of the reeve."],
    factions: [{ name: "The Lord's House", goal: "Keep the peasants obedient and the taxes flowing." }, { name: "Merchants' Guild", goal: "Win trade freedoms from the lord." }, { name: "Forest Outlaws", goal: "Rob the tax wagons." }],
    materials: ["oak", "thatch", "fieldstone", "wool", "iron"],
    architecture: "Half-timbered cottages with thatched roofs, a stone chapel and wooden market stalls.",
    clothing: "Wool tunics, linen shirts, leather belts and hoods.",
    music: "Lutes, recorders and chapel bells.",
    uiTheme: "parchment",
    roles: ["serf farmer", "baker's apprentice", "stable hand", "acolyte", "squire", "beggar"],
    lifespan: 55,
    baseYear: 900,
    food: { name: "Rye loaf", nourish: 30 },
    vocabulary: { health: "Vigor", hunger: "Belly", energy: "Weariness", wealth: "Purse" },
    hazards: ["A cutpurse knocks you down", "A cart wheel crushes your foot", "A drunk soldier swings at you"],
    workplace: "fields",
    focal: "well",
  } as TierTemplate,
  T3: {
    ...medieval,
    name: "Age of Sail",
    government: "empire",
    economy: "mercantile",
    currency: { name: "crown", symbol: "cr", subunit: "penny", subunitsPerUnit: 100 },
    socialClasses: [
      { name: "Aristocracy", share: 0.03, description: "Old families and colonial governors." },
      { name: "Merchants", share: 0.17, description: "Traders, bankers and ship owners." },
      { name: "Commoners", share: 0.8, description: "Sailors, dockers, servants and farmers." },
    ],
    beliefs: ["Providence rewards the industrious.", "The sea takes its due."],
    laws: ["Debtors go to prison.", "Heresy is tried by the tribunal."],
    factions: [{ name: "Royal Trading Company", goal: "Monopolize the spice routes." }, { name: "The Tribunal", goal: "Root out heretics and dangerous books." }, { name: "Free Captains", goal: "Plunder company ships." }],
    materials: ["brick", "oak", "brass", "canvas", "glass"],
    architecture: "Brick townhouses, timber docks, warehouses and a domed customs house.",
    clothing: "Tricorn hats, waistcoats, long coats and linen dresses.",
    music: "Harpsichords, fiddles and sea shanties.",
    uiTheme: "ink-and-brass",
    roles: ["dock worker", "printer's apprentice", "cabin boy", "maid", "clerk"],
    lifespan: 60,
    baseYear: 1640,
    food: { name: "Salt pork and biscuit", nourish: 30 },
    vocabulary: { health: "Constitution", hunger: "Appetite", energy: "Stamina", wealth: "Purse" },
    hazards: ["A press gang roughs you up", "A cargo net snaps above you"],
    workplace: "docks",
    focal: "statue",
  } as TierTemplate,
  T4: {
    ...modern,
    name: "Industrial",
    government: "republic",
    economy: "industrial",
    currency: { name: "pound", symbol: "£", subunit: "shilling", subunitsPerUnit: 20 },
    socialClasses: [
      { name: "Industrialists", share: 0.02, description: "Factory and rail owners." },
      { name: "Middle class", share: 0.18, description: "Clerks, engineers and shopkeepers." },
      { name: "Workers", share: 0.8, description: "Factory hands and miners." },
    ],
    beliefs: ["Progress is inevitable.", "Hard work redeems the soul."],
    laws: ["Unions are illegal.", "Children may work from age ten."],
    factions: [{ name: "Ironworks Consortium", goal: "Keep wages low and the furnaces burning." }, { name: "Workers' Brotherhood", goal: "Win the eight-hour day." }, { name: "Temperance League", goal: "Close every tavern." }],
    materials: ["brick", "iron", "steel", "coal", "glass"],
    architecture: "Soot-stained brick tenements, iron bridges, smokestacks and gas lamps.",
    clothing: "Flat caps, waistcoats, aprons and heavy boots.",
    music: "Brass bands, music halls and factory whistles.",
    uiTheme: "steam-and-iron",
    roles: ["factory hand", "coal miner", "newspaper boy", "seamstress", "chimney sweep"],
    lifespan: 60,
    baseYear: 1880,
    food: { name: "Meat pie", nourish: 30 },
    vocabulary: { health: "Health", hunger: "Hunger", energy: "Steam", wealth: "Wages" },
    hazards: ["A machine belt snaps", "A pickpocket shoves you into the gutter"],
    workplace: "factory",
    focal: "statue",
  } as TierTemplate,
  T5: {
    ...modern,
    name: "Information",
    government: "democracy",
    economy: "market",
    currency: { name: "dollar", symbol: "$", subunit: "cent", subunitsPerUnit: 100 },
    socialClasses: [
      { name: "Executives", share: 0.05, description: "Own and run the platforms." },
      { name: "Professionals", share: 0.35, description: "Office and tech workers." },
      { name: "Gig workers", share: 0.6, description: "Couriers, drivers and contractors." },
    ],
    beliefs: ["Data is truth.", "Everyone can be famous."],
    laws: ["All transactions are recorded.", "Unlicensed protest is a misdemeanor."],
    factions: [{ name: "Omnia Platforms", goal: "Own every screen in the city." }, { name: "Open Net Collective", goal: "Leak the platform's secrets." }, { name: "City Council", goal: "Win the next election." }],
    materials: ["concrete", "glass", "steel", "plastic", "asphalt"],
    architecture: "Glass office towers, concrete apartment blocks, billboards and parking lots.",
    clothing: "Hoodies, suits, sneakers and company lanyards.",
    music: "Pop, hip-hop and notification chimes.",
    uiTheme: "flat-digital",
    roles: ["delivery courier", "junior coder", "barista", "student", "street artist"],
    lifespan: 80,
    baseYear: 2020,
    food: { name: "Burger meal", nourish: 35 },
    vocabulary: { health: "Health", hunger: "Hunger", energy: "Battery", wealth: "Balance" },
    hazards: ["A scooter clips you", "You get mugged in an alley"],
    workplace: "office",
    focal: "kiosk",
  } as TierTemplate,
  T6: {
    ...future,
    name: "Cyber",
    government: "corporate-oligarchy",
    economy: "market",
    currency: { name: "credit", symbol: "cr", subunit: "bit", subunitsPerUnit: 100 },
    socialClasses: [
      { name: "Shareholders", share: 0.02, description: "Live on the top decks with clean air." },
      { name: "Contract citizens", share: 0.6, description: "Work for a corporation for air, housing and implants." },
      { name: "Unregistered", share: 0.38, description: "No contract, no rights." },
    ],
    beliefs: ["Contract is identity.", "Uploading the mind is salvation."],
    laws: ["Unlicensed AI is a capital crime.", "Implants remain corporate property until paid."],
    factions: [{ name: "Halcyon Corp", goal: "Control the air supply." }, { name: "Runner Underground", goal: "Hack the corporate grid." }, { name: "Church of the Upload", goal: "Convert citizens to the cloud." }],
    materials: ["chrome", "neon", "glass", "concrete", "carbon fiber"],
    architecture: "Monolithic towers of dark glass, neon signage, maglev rails and rain-slick walkways.",
    clothing: "Rebreathers, LED-trimmed jackets and chrome implants.",
    music: "Dark synthwave and industrial beats.",
    uiTheme: "neon-holo",
    roles: ["street runner", "noodle cook", "maintenance tech", "data courier", "unregistered kid"],
    lifespan: 85,
    baseYear: 2260,
    food: { name: "Synth noodles", nourish: 35 },
    vocabulary: { health: "Integrity", hunger: "Fuel", energy: "Charge", wealth: "Credits" },
    hazards: ["A security drone tases you", "A gang runner slashes at you"],
    workplace: "fabrication plant",
    focal: "kiosk",
  } as TierTemplate,
  T7: {
    ...future,
    name: "Post-singularity",
    government: "ai-governance",
    economy: "post-scarcity",
    currency: { name: "attention", symbol: "◈", subunit: "glint", subunitsPerUnit: 1000 },
    socialClasses: [
      { name: "Minds", share: 0.1, description: "Vast uploaded intelligences." },
      { name: "Embodied", share: 0.9, description: "Those who still choose flesh." },
    ],
    beliefs: ["Meaning is the last scarce resource.", "The Minds dream the world."],
    laws: ["No being may be copied without consent.", "Matter compilers may not make weapons."],
    factions: [{ name: "The Concord of Minds", goal: "Optimize the happiness of all beings." }, { name: "The Embodied Movement", goal: "Keep a place for flesh and chance." }],
    materials: ["light", "crystal", "smart matter", "glass"],
    architecture: "Floating crystalline spires, gardens of light and shifting smart-matter halls.",
    clothing: "Garments of light that change with mood.",
    music: "Generative harmonies that respond to listeners.",
    uiTheme: "luminous-minimal",
    roles: ["embodied artist", "memory gardener", "dream architect", "wanderer"],
    lifespan: 300,
    baseYear: 3400,
    food: { name: "Compiled meal", nourish: 40 },
    vocabulary: { health: "Coherence", hunger: "Sustenance", energy: "Focus", wealth: "Attention" },
    hazards: ["A reality glitch tears at you", "A rogue sub-mind lashes out"],
    workplace: "dream foundry",
    focal: "statue",
  } as TierTemplate,
};

/** docs/02-world-model.md §3 and prompts/rules-balance.md tier defaults. */
export const BALANCE: Record<Tier, Balance> = {
  T0: { hungerDecayPerHour: 3.0, energyDecayPerHour: 2.5, exposureSeverity: 1, dangerMultiplier: 1.6, diseaseRate: 0.1, dailyWageBase: 2, foodPriceBase: 1, deathSECost: 12 },
  T1: { hungerDecayPerHour: 2.8, energyDecayPerHour: 2.4, exposureSeverity: 0.8, dangerMultiplier: 1.5, diseaseRate: 0.12, dailyWageBase: 4, foodPriceBase: 1, deathSECost: 14 },
  T2: { hungerDecayPerHour: 2.5, energyDecayPerHour: 2.2, exposureSeverity: 0.6, dangerMultiplier: 1.3, diseaseRate: 0.15, dailyWageBase: 6, foodPriceBase: 2, deathSECost: 15 },
  T3: { hungerDecayPerHour: 2.3, energyDecayPerHour: 2.1, exposureSeverity: 0.5, dangerMultiplier: 1.2, diseaseRate: 0.1, dailyWageBase: 10, foodPriceBase: 3, deathSECost: 16 },
  T4: { hungerDecayPerHour: 2.2, energyDecayPerHour: 2.3, exposureSeverity: 0.5, dangerMultiplier: 1.1, diseaseRate: 0.08, dailyWageBase: 12, foodPriceBase: 3, deathSECost: 17 },
  T5: { hungerDecayPerHour: 2.0, energyDecayPerHour: 2.0, exposureSeverity: 0.2, dangerMultiplier: 0.9, diseaseRate: 0.03, dailyWageBase: 80, foodPriceBase: 12, deathSECost: 18 },
  T6: { hungerDecayPerHour: 1.9, energyDecayPerHour: 2.0, exposureSeverity: 1.5, dangerMultiplier: 1.1, diseaseRate: 0.02, dailyWageBase: 40, foodPriceBase: 10, deathSECost: 20 },
  T7: { hungerDecayPerHour: 1.5, energyDecayPerHour: 1.5, exposureSeverity: 0, dangerMultiplier: 1.0, diseaseRate: 0.01, dailyWageBase: 100, foodPriceBase: 10, deathSECost: 25 },
};

export const TIER_ORDER: Tier[] = ["T0", "T1", "T2", "T3", "T4", "T5", "T6", "T7"];

export function tierIndex(t: Tier): number {
  return TIER_ORDER.indexOf(t);
}
