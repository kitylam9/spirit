import type { Tier } from "@spirit/shared";

export interface ScoutRequest {
  query: string;
  /** Approximate real-world size in meters; the client fits the model to it. */
  expectedSize: number[];
  maxTriangles: number;
  tier: Tier;
  requestedBy: string;
}

const STOP = new Set(["a", "an", "the", "of", "and", "with", "for", "old", "small", "large", "big", "3d", "model"]);

/** Lowercase word tokens, naive singular ("crates" -> "crate"). Splits snake_case and camelCase. */
export function tokens(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/**
 * Fraction of query tokens found in the candidate's words, or 0 when the head noun (last query
 * token) is missing: "medieval wooden cart" must at least be a cart.
 */
export function matchScore(query: string[], words: Set<string>): number {
  if (!query.length || !words.has(query[query.length - 1])) return 0;
  return query.filter((t) => words.has(t)).length / query.length;
}
