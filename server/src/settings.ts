import type { ServerSettings } from "@spirit/shared";
import { config, llmDefaults, resolveLlm, type ProviderKind } from "./config.js";
import { llm } from "./llm/gateway.js";
import { clamp } from "./util/text.js";

const PROVIDERS = Object.keys(llmDefaults) as ProviderKind[];
const JSON_MODES: ServerSettings["llm"]["jsonMode"][] = ["", "schema", "object", "off"];

/** Changed from the in-game settings menu. Not persisted: a server restart goes back to .env. */
export const settings: ServerSettings = {
  llm: {
    provider: config.llm.provider,
    model: config.llm.model,
    jsonMode: config.llm.jsonMode,
    maxConcurrency: config.llm.maxConcurrency,
    timeoutMs: config.llm.timeoutMs,
  },
  gameplay: { descentCost: 5, seDrain: 1, objectsPerScene: 12 },
  assets: { polyhaven: true, sketchfab: true, objaverse: { sketchfab: true, smithsonian: true, github: true, thingiverse: true } },
};

const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? clamp(v, min, max) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

/** Validates untrusted input from the client and applies it; reconnects the LLM if its settings changed. */
export async function applySettings(next: ServerSettings): Promise<void> {
  const l = next?.llm ?? settings.llm;
  const g = next?.gameplay ?? settings.gameplay;
  const a = next?.assets ?? settings.assets;
  const ox = a.objaverse ?? settings.assets.objaverse;
  const llmNext: ServerSettings["llm"] = {
    provider: PROVIDERS.includes(l.provider) ? l.provider : settings.llm.provider,
    model: typeof l.model === "string" ? l.model.trim().slice(0, 200) : settings.llm.model,
    jsonMode: JSON_MODES.includes(l.jsonMode) ? l.jsonMode : settings.llm.jsonMode,
    maxConcurrency: Math.round(num(l.maxConcurrency, 1, 8, settings.llm.maxConcurrency)),
    timeoutMs: Math.round(num(l.timeoutMs, 10_000, 600_000, settings.llm.timeoutMs)),
  };
  settings.gameplay = {
    descentCost: Math.round(num(g.descentCost, 0, 50, settings.gameplay.descentCost)),
    seDrain: num(g.seDrain, 0, 5, settings.gameplay.seDrain),
    objectsPerScene: Math.round(num(g.objectsPerScene, 1, 24, settings.gameplay.objectsPerScene)),
  };
  settings.assets = {
    polyhaven: bool(a.polyhaven, settings.assets.polyhaven),
    sketchfab: bool(a.sketchfab, settings.assets.sketchfab),
    objaverse: {
      sketchfab: bool(ox.sketchfab, settings.assets.objaverse.sketchfab),
      smithsonian: bool(ox.smithsonian, settings.assets.objaverse.smithsonian),
      github: bool(ox.github, settings.assets.objaverse.github),
      thingiverse: bool(ox.thingiverse, settings.assets.objaverse.thingiverse),
    },
  };
  if (JSON.stringify(llmNext) === JSON.stringify(settings.llm)) return;
  config.llm = resolveLlm(llmNext);
  settings.llm = { ...llmNext, model: config.llm.model };
  await llm.reconfigure();
}
