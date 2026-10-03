import type { DeathReport, GameEvent, NPC, NpcIntent, PlanetSummary, StarSystemSummary, UILayout } from "@spirit/shared";
import { TIER_NAMES } from "../state.js";

type Node = UILayout["root"];
type Theme = UILayout["theme"];

const layout = (id: string, screen: UILayout["screen"], theme: Theme, root: Node): UILayout => ({ schemaVersion: "1.1", id, screen, theme, root });
const text = (t: string, style: "body" | "title" | "whisper" | "mono" = "body"): Node => ({ type: "Text", props: { text: t, style } });

export function spaceHud(system: StarSystemSummary, lives: number, autopilotTo: string | null): UILayout {
  return layout("ui-space-hud", "space-hud", "spirit", {
    type: "Stack",
    children: [
      {
        type: "Panel",
        props: { anchor: "top-left", width: "sm", variant: "subtle" },
        children: [
          text(system.name, "title"),
          { type: "Bar", props: { label: "Spirit Energy", bind: "/player/spirit/energy", max: 100, color: "spirit", warnBelow: 20 } },
          text(lives ? `Lives lived this run: ${lives}` : "Your first light. Choose a world to live on.", "whisper"),
        ],
      },
      {
        type: "Panel",
        props: { anchor: "top-right", width: "sm", variant: "subtle", title: "Worlds" },
        children: system.planets.map((p) => ({
          type: "Button",
          props: {
            label: `${autopilotTo === p.id ? "» " : ""}${p.name} · ${TIER_NAMES[p.tier]}`,
            color: "muted",
            action: { verb: "travel.request", params: { planetId: p.id } },
          },
        })),
      },
      {
        type: "Panel",
        props: { anchor: "bottom-left", width: "md", variant: "subtle" },
        children: [text("Drag to look · W/S fly · A/D strafe · Space/C up/down · Shift boost (drains energy faster) · click a world to drift there", "whisper")],
      },
    ],
  });
}

export function omen(p: PlanetSummary, energy: number, detailReady: boolean): UILayout {
  const dangerWord = p.danger >= 7 ? "perilous" : p.danger >= 4 ? "uncertain" : "gentle";
  return layout(`ui-omen-${p.id.replace(/^planet-/, "")}`, "omen", "spirit", {
    type: "Panel",
    props: { anchor: "bottom", width: "md", variant: "ornate", title: p.name },
    children: [
      text(`${TIER_NAMES[p.tier]} civilization · ${dangerWord} world`, "whisper"),
      text(`“${p.omen}”`),
      text(detailReady ? "The world is ready to receive you." : "The world is still taking shape… (you can descend now; it finishes as you fall)", "whisper"),
      {
        type: "Stack",
        props: { direction: "row", gap: 8 },
        children: [
          { type: "Button", props: { label: "Be born here (5 SE)", hotkey: "1", action: { verb: "incarnate.request", params: { planetId: p.id, mode: "born" } } } },
          { type: "Button", props: { label: "Arrive as a stranger (10 SE)", hotkey: "2", color: energy > 10 ? "accent" : "muted", action: { verb: "incarnate.request", params: { planetId: p.id, mode: "arrive" } } } },
        ],
      },
    ],
  });
}

export interface DialogueLine {
  speaker: "player" | "npc";
  text: string;
}

export function dialogue(theme: Theme, npc: NPC, lines: DialogueLine[], intents: NpcIntent[], waiting: boolean): UILayout {
  const offers: Node[] = [];
  for (const i of intents) {
    if (i.type === "offer_trade") offers.push({ type: "Button", props: { label: `Buy ${i.name} (${i.price})`, action: { verb: "buy", params: { npcId: npc.id, itemId: i.itemId } } } });
    if (i.type === "offer_job") offers.push({ type: "Button", props: { label: `Take the job (${i.wage}/shift)`, action: { verb: "work", params: { npcId: npc.id } } } });
  }
  return layout(`ui-dialogue-${npc.id.replace(/^npc-/, "")}`, "dialogue", theme, {
    type: "Panel",
    props: { anchor: "right", width: "md", variant: "ornate", title: `${npc.name} · ${npc.role}` },
    children: [
      ...lines.slice(-8).map((l): Node => (l.speaker === "npc" ? { type: "Dialog", props: { title: npc.name, text: l.text } } : { type: "Dialog", props: { title: "You", text: l.text } })),
      ...(waiting ? [text(`${npc.name} is thinking…`, "whisper")] : []),
      ...(offers.length ? [{ type: "Stack", props: { direction: "row", gap: 6 }, children: offers } as Node] : []),
      { type: "TextInput", props: { placeholder: "Say something…", label: "Say", action: { verb: "dialogue.say", params: { npcId: npc.id } } } },
      { type: "Button", props: { label: "Leave", hotkey: "Esc", color: "muted", action: { verb: "ui.close", params: { screen: "dialogue" } } } },
    ],
  });
}

export function event(theme: Theme, ev: GameEvent): UILayout {
  return layout(`ui-event-${ev.id.replace(/^evt-/, "")}`, "event", theme, {
    type: "Panel",
    props: { anchor: "center", width: "md", variant: ev.pacing === "climax" ? "alert" : "ornate", title: ev.title },
    children: [
      text(ev.text),
      {
        type: "Choice",
        props: {
          options: (ev.choices ?? []).slice(0, 6).map((c) => ({ label: c.label, hint: c.hint, action: { verb: "use", params: { eventId: ev.id, choiceId: c.id } } })),
        },
      },
    ],
  });
}

export function reflection(r: DeathReport): UILayout {
  const delta = `${r.seDelta >= 0 ? "+" : ""}${Math.round(r.seDelta * 10) / 10}`;
  return layout("ui-reflection", "reflection", "spirit", {
    type: "Panel",
    props: { anchor: "center", width: "md", variant: "ornate", title: r.vesselName },
    children: [
      text(r.causeOfDeath, "whisper"),
      text(r.epitaph),
      { type: "Divider" },
      text(`Years lived: ${Math.round(r.yearsLived * 100) / 100} · Fulfillment: ${r.fulfillment}`, "mono"),
      text(`Spirit Energy ${delta} → ${Math.round(r.energyLeft * 10) / 10}`, "mono"),
      text(
        r.runOver
          ? "Your light has gone out. A new spark will be kindled with full energy, in a universe no one remembers."
          : "This universe dissolves behind you. Nothing you were comes with you — only your light.",
        "whisper",
      ),
      { type: "Button", props: { label: r.runOver ? "Kindle a new spark" : "Return to the stars", hotkey: "Enter", action: { verb: "reflect.continue" } } },
    ],
  });
}
