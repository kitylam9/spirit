import type { AssetManifest, Civilization, LlmStatus, NPC, Planet, PlayerState, Scene, StarSystemSummary } from "@spirit/shared";

export const TIER_NAMES: Record<string, string> = {
  T0: "Primordial",
  T1: "Tribal",
  T2: "Feudal",
  T3: "Age of Sail",
  T4: "Industrial",
  T5: "Information",
  T6: "Cyber",
  T7: "Post-singularity",
};

/** Client-side mirror of what the server has sent. The server stays authoritative. */
export const state = {
  player: null as PlayerState | null,
  system: null as StarSystemSummary | null,
  planet: null as Planet | null,
  civ: null as Civilization | null,
  scene: null as Scene | null,
  npcs: [] as NPC[],
  /** Models already ingested for the current scene. */
  assets: [] as AssetManifest[],
  llm: null as LlmStatus | null,
};

function clock(tick: number): string {
  const day = Math.floor(tick / 1440) + 1;
  const m = Math.floor(tick % 1440);
  return `Day ${day}, ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Resolves a UI binding path such as `/player/incarnation/stats/health` or `/world/clock`. */
export function get(path: string): unknown {
  const p = state.player;
  switch (path) {
    case "/world/clock":
      return p ? clock(p.time.tick) : "";
    case "/world/goal": {
      const g = p?.incarnation?.goals[0];
      return g ? `${g.title}${g.status === "completed" ? " ✓" : ""}` : "Survive.";
    }
    case "/world/currency":
      return state.civ?.economy.currency.symbol ?? "";
  }
  const parts = path.split("/").filter(Boolean);
  let cur: unknown = parts[0] === "player" ? p : parts[0] === "planet" ? state.planet : parts[0] === "civ" ? state.civ : undefined;
  for (const key of parts.slice(1)) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}
