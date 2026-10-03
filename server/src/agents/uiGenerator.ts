import type { Civilization, Planet, UILayout } from "@spirit/shared";
import { llm } from "../llm/gateway.js";
import { acceptOrFallback } from "../validate.js";
import { clip } from "../util/text.js";
import { TIERS } from "../world/templates.js";

interface Vocabulary {
  health: string;
  hunger: string;
  energy: string;
  wealth: string;
  resolve: string;
}

function hud(planet: Planet, civ: Civilization, v: Vocabulary): UILayout {
  const label = (s: string, fb: string) => clip(s, 20) || fb;
  return {
    schemaVersion: "1.1",
    id: `ui-hud-${planet.id.replace(/^planet-/, "")}`,
    screen: "hud",
    theme: civ.aesthetic.uiTheme ?? TIERS[planet.tier].uiTheme,
    accentOverride: civ.aesthetic.palette[1],
    root: {
      type: "Stack",
      props: { direction: "column", gap: 8 },
      children: [
        {
          type: "Panel",
          props: { anchor: "top-left", width: "sm", variant: "ornate" },
          children: [
            { type: "Text", props: { bind: "/player/incarnation/vessel/name", style: "title" } },
            { type: "Bar", props: { label: label(v.health, "Health"), bind: "/player/incarnation/stats/health", max: 100, color: "health", warnBelow: 25 } },
            { type: "Bar", props: { label: label(v.hunger, "Hunger"), bind: "/player/incarnation/stats/hunger", max: 100, color: "hunger", warnBelow: 20 } },
            { type: "Bar", props: { label: label(v.energy, "Energy"), bind: "/player/incarnation/stats/energy", max: 100, color: "energy", warnBelow: 15 } },
            { type: "Bar", props: { label: label(v.resolve, "Resolve"), bind: "/player/incarnation/stats/resolve", max: 100, color: "accent", warnBelow: 15 } },
          ],
        },
        {
          type: "Panel",
          props: { anchor: "top-right", width: "xs", variant: "subtle" },
          children: [
            { type: "Stat", props: { label: label(v.wealth, "Wealth"), bind: "/player/incarnation/stats/wealth", format: "currency", icon: "coin" } },
            { type: "Stat", props: { label: "Reputation", bind: "/player/incarnation/stats/reputation", format: "int" } },
            { type: "Stat", props: { label: "Time", bind: "/world/clock", format: "clock" } },
            { type: "Bar", props: { label: "Spirit", bind: "/player/spirit/energy", max: 100, color: "spirit", warnBelow: 20 } },
          ],
        },
        {
          type: "Panel",
          props: { anchor: "bottom-left", width: "sm", variant: "subtle" },
          children: [
            { type: "Text", props: { text: "Goal", style: "whisper" } },
            { type: "Text", props: { bind: "/world/goal" } },
            { type: "Inventory", props: { bind: "/player/incarnation/inventory", columns: 4 } },
          ],
        },
      ],
    },
  };
}

export async function generateHud(planet: Planet, civ: Civilization): Promise<UILayout> {
  const fallbackVocab: Vocabulary = { ...TIERS[planet.tier].vocabulary, resolve: "Resolve" };
  const draft = await llm.json<Vocabulary>({
    agent: "ui-generator.hud",
    system: `You are the UI Generator of "Spirit". You choose in-world words for interface labels so the HUD feels native to a civilization while staying understandable.`,
    user: `Civilization "${civ.name}" on ${planet.name}, tier ${planet.tier} (${TIERS[planet.tier].name}). Currency: ${civ.economy.currency.name}. Give one or two-word labels for these stats: health, hunger (fullness), energy (stamina), wealth (money), resolve (morale).`,
    schema: {
      type: "object",
      required: ["health", "hunger", "energy", "wealth", "resolve"],
      properties: { health: { type: "string" }, hunger: { type: "string" }, energy: { type: "string" }, wealth: { type: "string" }, resolve: { type: "string" } },
    },
    temperature: 0.7,
    maxTokens: 120,
  });
  const fb = () => hud(planet, civ, fallbackVocab);
  return acceptOrFallback("ui-layout", draft ? hud(planet, civ, draft) : fb(), fb, `hud ${planet.id}`);
}
