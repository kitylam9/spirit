import type { AssetManifest } from "@spirit/shared";
import { lookupQuery, rememberQuery } from "../assets/catalog.js";
import type { ScoutRequest } from "../assets/match.js";
import { findPolyHaven } from "../assets/polyhaven.js";
import { findSketchfab, sketchfabEnabled } from "../assets/sketchfab.js";

/**
 * Asset Scout (docs/06-asset-pipeline.md). Deterministic for now: keyword ranking instead of an
 * LLM pick, so it costs no model calls. Order: local catalog, Poly Haven (CC0), Sketchfab (CC0 /
 * CC-BY, only with SKETCHFAB_API_TOKEN). Returns null when nothing fits; the procedural
 * placeholder then stays.
 */
const SOURCES: [string, (r: ScoutRequest) => Promise<AssetManifest | null>][] = [
  ["polyhaven", findPolyHaven],
  ["sketchfab", findSketchfab],
];
const MAX_PARALLEL = 2;

const inflight = new Map<string, Promise<AssetManifest | null>>();
const misses = new Set<string>();
let running = 0;
const waiters: (() => void)[] = [];

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((r) => waiters.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiters.shift()?.();
  }
}

/** "salt-crusted cistern hut" -> ["salt-crusted cistern hut", "cistern hut", "hut"]. */
function broaden(query: string): string[] {
  const words = query.trim().split(/\s+/);
  return [...new Set([words.join(" "), words.slice(-2).join(" "), words.slice(-1).join(" ")])];
}

export function scoutAsset(req: ScoutRequest): Promise<AssetManifest | null> {
  const key = `${req.query.trim().toLowerCase()}|${req.maxTriangles}`;
  const cached = lookupQuery(key);
  if (cached) return Promise.resolve(cached);
  const missKey = `${key}|${sketchfabEnabled()}`;
  if (misses.has(missKey)) return Promise.resolve(null);
  let p = inflight.get(key);
  if (!p) {
    p = slot(() => search(req, key, missKey)).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

async function search(req: ScoutRequest, key: string, missKey: string): Promise<AssetManifest | null> {
  const started = Date.now();
  for (const query of broaden(req.query)) {
    for (const [name, find] of SOURCES) {
      // Poly Haven is contemporary or vintage: "sci-fi crate" must not broaden to a wooden "crate".
      if (name === "polyhaven" && query !== req.query && (req.tier === "T6" || req.tier === "T7")) continue;
      try {
        const m = await find({ ...req, query });
        if (!m) continue;
        rememberQuery(key, m.id);
        console.log(`[assets] "${req.query}" -> ${name}:${m.source.sourceId} (${m.id}) in ${Date.now() - started}ms`);
        return m;
      } catch (err) {
        console.warn(`[assets] ${name} failed for "${query}": ${(err as Error).message}`);
      }
    }
  }
  misses.add(missKey);
  console.log(`[assets] "${req.query}" not found${sketchfabEnabled() ? "" : " (set SKETCHFAB_API_TOKEN for more sources)"}; keeping the placeholder`);
  return null;
}
