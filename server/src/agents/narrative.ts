import type { Civilization, GameEvent, NPC, Planet, PlayerState, Scene } from "@spirit/shared";
import { llm } from "../llm/gateway.js";
import { acceptOrFallback } from "../validate.js";
import { Rng } from "../util/rng.js";
import { clip, slug } from "../util/text.js";
import { TIERS } from "../world/templates.js";

type Pacing = GameEvent["pacing"];
type Effect = NonNullable<GameEvent["effects"]>[number];
export type ChoiceKind = "safe" | "bold" | "kind" | "greedy";

const STAT = "/player/incarnation/stats";

/** Effects are decided by code (the rules engine owns numbers); the LLM only picks a choice kind. */
export function effectsFor(kind: ChoiceKind, rng: Rng, wage: number): Effect[] {
  switch (kind) {
    case "safe":
      return [{ path: `${STAT}/resolve`, op: "add", value: 2 }];
    case "bold":
      return [
        { path: `${STAT}/insight`, op: "add", value: 8 },
        { path: `${STAT}/health`, op: "add", value: -rng.int(0, 25) },
        { path: `${STAT}/wealth`, op: "add", value: rng.chance(0.5) ? Math.round(wage * 1.5) : 0 },
      ];
    case "kind":
      return [
        { path: `${STAT}/reputation`, op: "add", value: 8 },
        { path: `${STAT}/resolve`, op: "add", value: 5 },
        { path: `${STAT}/wealth`, op: "add", value: -Math.round(wage * 0.3) },
      ];
    case "greedy":
      return [
        { path: `${STAT}/wealth`, op: "add", value: Math.round(wage * 1.2) },
        { path: `${STAT}/reputation`, op: "add", value: -10 },
      ];
  }
}

interface EventDraft {
  title: string;
  text: string;
  choices: { label: string; kind: ChoiceKind; outcome: string }[];
}

const s = { type: "string" };
const eventDraftSchema = {
  type: "object",
  required: ["title", "text", "choices"],
  properties: {
    title: s,
    text: s,
    choices: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: { type: "object", required: ["label", "kind", "outcome"], properties: { label: s, kind: { type: "string", enum: ["safe", "bold", "kind", "greedy"] }, outcome: s } },
    },
  },
};

function fallbackEvent(planet: Planet, rng: Rng): EventDraft {
  const t = TIERS[planet.tier];
  const hook = rng.pick(planet.hooks);
  return rng.pick<EventDraft>([
    {
      title: "A Stranger's Plea",
      text: `A ragged traveler grabs your sleeve. "Please — ${hook.charAt(0).toLowerCase() + hook.slice(1)}" Their eyes dart to the crowd.`,
      choices: [
        { label: "Give them what you can", kind: "kind", outcome: "They bless you and vanish into the crowd." },
        { label: "Follow them to learn more", kind: "bold", outcome: "The trail leads somewhere dangerous." },
        { label: "Pull your arm free", kind: "safe", outcome: "You walk on. The feeling lingers." },
      ],
    },
    {
      title: "An Unguarded Purse",
      text: `Someone has dropped a purse near the ${t.food.name.toLowerCase()} stall. No one seems to have noticed.`,
      choices: [
        { label: "Pocket it", kind: "greedy", outcome: "It is heavier than you expected." },
        { label: "Call out to find the owner", kind: "kind", outcome: "An old woman thanks you with tears in her eyes." },
        { label: "Leave it alone", kind: "safe", outcome: "Better not to get involved." },
      ],
    },
    {
      title: "Trouble Brewing",
      text: `Raised voices nearby: ${t.factions[0].name} and ${t.factions[1].name} are close to blows.`,
      choices: [
        { label: "Step in between them", kind: "bold", outcome: "Fists fly; you take a few, but earn some respect." },
        { label: "Slip away", kind: "safe", outcome: "You hear the fight start behind you." },
      ],
    },
  ]);
}

function assembleEvent(id: string, planet: Planet, scene: Scene, pacing: Pacing, draft: EventDraft, rng: Rng, wage: number): GameEvent {
  return {
    schemaVersion: "1.1",
    id,
    planetId: planet.id,
    regionId: scene.regionId,
    kind: "local",
    title: clip(draft.title, 80) || "Something happens",
    text: clip(draft.text, 1200) || "...",
    pacing,
    trigger: { type: "immediate" },
    choices: draft.choices.slice(0, 4).map((c, i) => ({
      id: `choice-${i + 1}-${slug(c.label).slice(0, 20)}`,
      label: clip(c.label, 80) || "Continue",
      hint: { safe: "Safe", bold: "Risky", kind: "Generous", greedy: "Selfish" }[c.kind],
      action: { verb: "use", params: { eventId: id, choice: i } },
      effects: effectsFor(c.kind, rng, wage),
      followUp: clip(c.outcome, 300),
    })),
    expiresInTicks: 240,
    canonFacts: [],
  };
}

export async function createEvent(args: {
  planet: Planet;
  civ: Civilization;
  scene: Scene;
  npcs: NPC[];
  player: PlayerState;
  pacing: Pacing;
  recentTitles: string[];
  index: number;
}): Promise<GameEvent> {
  const { planet, civ, scene, npcs, player, pacing } = args;
  const rng = new Rng(`${planet.seed.slice(0, 8)}${(args.index * 2654435761 >>> 0).toString(16).padStart(8, "0")}`);
  const inc = player.incarnation!;
  const wage = civ.balance?.dailyWageBase ?? 6;
  const id = `evt-${scene.id.replace(/^scene-/, "")}-${args.index}`;

  const draft = await llm.json<EventDraft>({
    agent: "narrative.event",
    system: `You are the Narrative agent of "Spirit", a life-simulation game. You write short events that shape an ordinary life, grounded in the local troubles. Pacing "${pacing}": calm = everyday moments; rising = a problem grows; climax = real risk; resolution = consequences. Content rating: Teen. Never kill the player directly.`,
    user:
      `Planet "${planet.name}" (tier ${planet.tier}, ${TIERS[planet.tier].name}), ${civ.name}. Place: ${scene.name}: ${scene.description}\n` +
      `Local troubles: ${planet.hooks.join(" | ")}\nFactions: ${civ.factions.map((f) => `${f.name} (${f.goal})`).join("; ")}\n` +
      `People here: ${npcs.map((n) => `${n.name} the ${n.role}`).join(", ")}.\n` +
      `The player is ${inc.vessel.name}, a ${inc.vessel.age}-year-old ${inc.vessel.role}; health ${Math.round(inc.stats.health)}, wealth ${Math.round(inc.stats.wealth)} ${civ.economy.currency.name}, reputation ${Math.round(inc.stats.reputation)}.\n` +
      `Do not reuse these titles: ${args.recentTitles.join(", ") || "none"}.\n` +
      `Write one event: a title (max 6 words), 2-4 sentences of second-person text, and 2-3 choices. Each choice has a short label, a kind (safe, bold, kind or greedy; include at least one safe and one bold or greedy), and a one-sentence outcome.`,
    schema: eventDraftSchema,
    temperature: 1.0,
    maxTokens: 700,
    cache: false,
  });
  const fb = () => assembleEvent(id, planet, scene, pacing, fallbackEvent(planet, rng), rng, wage);
  return acceptOrFallback("event", draft ? assembleEvent(id, planet, scene, pacing, draft, rng, wage) : fb(), fb, `event ${id}`);
}

// ---------- goal (at incarnation) ----------

export interface LifeGoal {
  goalId: string;
  title: string;
  kind: "wealth" | "reputation";
  target: number;
}

export async function createGoal(planet: Planet, civ: Civilization, player: PlayerState): Promise<LifeGoal> {
  const inc = player.incarnation!;
  const wealthy = new Rng(planet.seed).chance(0.5);
  const target = wealthy ? Math.round(inc.stats.wealth + (civ.balance?.dailyWageBase ?? 6) * 4) : 70;
  const kindText = wealthy ? `save up ${target} ${civ.economy.currency.name}` : "become well respected (reputation 70)";
  const draft = await llm.json<{ title: string }>({
    agent: "narrative.goal",
    system: `You are the Narrative agent of "Spirit". You write life goals that feel personal and grounded.`,
    user: `${inc.vessel.name} is a ${inc.vessel.age}-year-old ${inc.vessel.role} on ${planet.name} (${TIERS[planet.tier].name} tier). Their measurable goal is to ${kindText}. Write a personal goal title (max 8 words) that explains WHY, in the world's flavor.`,
    schema: { type: "object", required: ["title"], properties: { title: s } },
    temperature: 0.9,
    maxTokens: 100,
  });
  return {
    goalId: `goal-${wealthy ? "wealth" : "respect"}-${planet.id.slice(-4)}`,
    title: clip(draft?.title, 80) || (wealthy ? `Save ${target} ${civ.economy.currency.name} for a better life` : "Earn the respect of your neighbors"),
    kind: wealthy ? "wealth" : "reputation",
    target,
  };
}

// ---------- epitaph (at death) ----------

export async function createEpitaph(planet: Planet, civ: Civilization, player: PlayerState, cause: string, deeds: string[]): Promise<string> {
  const inc = player.incarnation!;
  const fallback = `Here lies ${inc.vessel.name}, ${inc.vessel.role} of ${planet.name}. ${cause}. ${deeds.length ? `They ${deeds[deeds.length - 1]}.` : "They tried to live."}`;
  const draft = await llm.json<{ epitaph: string }>({
    agent: "narrative.epitaph",
    system: `You are the Narrative agent of "Spirit". You write epitaphs in the voice of the civilization (a gravestone, a song verse, a data-obituary).`,
    user:
      `${inc.vessel.name}, a ${inc.vessel.role} of ${planet.name} (${civ.name}, ${TIERS[planet.tier].name} tier), has died. Cause: ${cause}.\n` +
      `What they did in this life: ${deeds.slice(-8).join("; ") || "little of note"}.\nWrite a 2-4 sentence epitaph.`,
    schema: { type: "object", required: ["epitaph"], properties: { epitaph: s } },
    temperature: 0.9,
    maxTokens: 250,
    cache: false,
  });
  return clip(draft?.epitaph, 400) || clip(fallback, 400);
}
