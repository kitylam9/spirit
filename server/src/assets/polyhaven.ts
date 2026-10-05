import type { AssetManifest } from "@spirit/shared";
import { clip, clipList, slug } from "../util/text.js";
import { assetUrl, download, getManifest, register, sha256, writeAssetFile } from "./catalog.js";
import { matchScore, tokens, type ScoutRequest } from "./match.js";

/** Poly Haven (https://polyhaven.com): CC0 models, public API, no key. */
const API = "https://api.polyhaven.com";
const HEADERS = { "user-agent": "Spirit-game (https://github.com/kitylam9/spirit)" };
const MAX_BYTES = 60 * 1024 * 1024;

interface PhAsset {
  name: string;
  categories: string[];
  tags: string[];
  authors: Record<string, string>;
  polycount?: number;
  download_count?: number;
  /** Real-world size in millimeters. */
  dimensions?: number[];
}
interface PhFile {
  url: string;
  size: number;
  include?: Record<string, { url: string; size: number }>;
}

let index: Promise<Record<string, PhAsset>> | null = null;

function models(): Promise<Record<string, PhAsset>> {
  index ??= fetch(`${API}/assets?t=models`, { headers: HEADERS, signal: AbortSignal.timeout(20000) })
    .then((r) => {
      if (!r.ok) throw new Error(`polyhaven ${r.status}`);
      return r.json() as Promise<Record<string, PhAsset>>;
    })
    .catch((err) => {
      index = null;
      throw err;
    });
  return index;
}

export async function findPolyHaven(req: ScoutRequest): Promise<AssetManifest | null> {
  const q = tokens(req.query);
  // Cyber and post-singularity scenes need every word to match ("sci-fi crate", not just "crate").
  const minScore = req.tier === "T6" || req.tier === "T7" ? 1 : Number.MIN_VALUE;
  const expected = Math.max(...req.expectedSize);
  let best: { id: string; a: PhAsset; score: number } | null = null;
  for (const [id, a] of Object.entries(await models())) {
    if (!a.polycount || a.polycount > req.maxTriangles) continue;
    // A 0.8 m oil lamp is not a 3.5 m street lamp: reject real sizes more than 3x off.
    const real = Math.max(...(a.dimensions ?? [0])) / 1000;
    if (!(real > 0) || Math.max(real / expected, expected / real) > 3) continue;
    const match = matchScore(q, new Set(tokens([id, a.name, ...a.tags, ...a.categories].join(" "))));
    if (match < minScore) continue;
    const score = match + Math.log10(1 + (a.download_count ?? 0)) / 100;
    if (!best || score > best.score) best = { id, a, score };
  }
  return best ? ingest(best.id, best.a, req) : null;
}

async function ingest(phId: string, a: PhAsset, req: ScoutRequest): Promise<AssetManifest> {
  const id = `asset-ph-${slug(phId)}`;
  const existing = getManifest(id);
  if (existing) return existing;

  const filesRes = await fetch(`${API}/files/${encodeURIComponent(phId)}`, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!filesRes.ok) throw new Error(`polyhaven files ${filesRes.status}`);
  const files = (await filesRes.json()) as { gltf?: Record<string, { gltf?: PhFile }> };
  const gltf = files.gltf?.["1k"]?.gltf;
  if (!gltf) throw new Error(`no 1k glTF for ${phId}`);

  const total = gltf.size + Object.values(gltf.include ?? {}).reduce((s, f) => s + f.size, 0);
  if (total > MAX_BYTES) throw new Error(`${phId} too large (${total} bytes)`);
  const primaryName = gltf.url.split("/").pop()!;
  const primary = await download(gltf.url, MAX_BYTES, HEADERS);
  writeAssetFile(id, primaryName, primary);
  for (const [rel, f] of Object.entries(gltf.include ?? {})) writeAssetFile(id, rel, await download(f.url, MAX_BYTES, HEADERS));

  const now = new Date().toISOString();
  const author = Object.keys(a.authors).join(", ") || "Poly Haven";
  return register({
    schemaVersion: "1.0",
    id,
    name: clip(a.name, 120),
    kind: "model",
    source: { name: "polyhaven", sourceId: phId, url: `https://polyhaven.com/a/${phId}` },
    license: {
      id: "CC0-1.0",
      url: "https://creativecommons.org/publicdomain/zero/1.0/",
      author: clip(author, 120),
      authorUrl: "https://polyhaven.com",
      attribution: clip(`${a.name} by ${author}, Poly Haven (CC0)`, 300),
      retrievedAt: now,
      verifiedAt: now,
    },
    tags: clipList(a.tags, 20, 30),
    tiers: [req.tier],
    style: "realistic",
    files: { primary: { url: assetUrl(id, primaryName), bytes: total, sha256: sha256(primary), mime: "model/gltf+json" } },
    quality: { triangles: a.polycount, maxTextureSize: 1024 },
    ingest: { pipelineVersion: "0.1.0", ingestedAt: now, steps: ["download"], requestedBy: clip(req.requestedBy, 80) },
  });
}
