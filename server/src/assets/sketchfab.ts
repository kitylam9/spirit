import type { AssetManifest } from "@spirit/shared";
import { config } from "../config.js";
import { clip, clipList, slug } from "../util/text.js";
import { assetUrl, download, getManifest, register, sha256, writeAssetFile } from "./catalog.js";
import { matchScore, tokens, type ScoutRequest } from "./match.js";

/**
 * Sketchfab Data API v3 (https://docs.sketchfab.com/data-api/v3/). Search is public; downloads
 * need SKETCHFAB_API_TOKEN. Only CC0 and CC-BY models are used (docs/06-asset-pipeline.md §3).
 */
const API = "https://api.sketchfab.com/v3";
const MAX_BYTES = 30 * 1024 * 1024;
const LICENSES: Record<string, { id: "CC0-1.0" | "CC-BY-4.0"; url: string }> = {
  cc0: { id: "CC0-1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
  by: { id: "CC-BY-4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
};

interface SfModel {
  uid: string;
  name: string;
  faceCount: number;
  isDownloadable?: boolean;
  tags?: { name: string }[];
  user: { displayName?: string; username: string; profileUrl?: string };
  license?: { slug?: string; label?: string };
  archives?: { glb?: { size?: number } };
  viewerUrl?: string;
}

export const sketchfabEnabled = (): boolean => !!config.assets.sketchfabToken;

async function api<T>(path: string, auth = false): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: auth ? { authorization: `Token ${config.assets.sketchfabToken}` } : {},
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 401 || res.status === 403) throw new Error(`sketchfab rejected the API token (${res.status})`);
  if (!res.ok) throw new Error(`sketchfab ${res.status}: ${path.split("?")[0]}`);
  return res.json() as Promise<T>;
}

export async function findSketchfab(req: ScoutRequest): Promise<AssetManifest | null> {
  if (!sketchfabEnabled()) return null;
  const q = tokens(req.query);
  const params = (license: string) =>
    new URLSearchParams({ type: "models", q: req.query, downloadable: "true", license, max_face_count: String(req.maxTriangles), count: "24" });
  const lists = await Promise.all(Object.keys(LICENSES).map((l) => api<{ results: SfModel[] }>(`/search?${params(l)}`)));

  // Keyword match first, then Sketchfab's own relevance order (rank within its result list).
  const ranked = lists
    .flatMap((r) => r.results.map((m, rank) => ({ m, rank })))
    .filter(({ m }) => m.faceCount > 0 && m.faceCount <= req.maxTriangles && (m.archives?.glb?.size ?? Infinity) <= MAX_BYTES)
    .map(({ m, rank }) => ({ m, rank, match: matchScore(q, new Set(tokens([m.name, ...(m.tags ?? []).map((t) => t.name)].join(" ")))) }))
    .filter((c) => c.match > 0)
    .sort((a, b) => b.match - a.match || a.rank - b.rank);
  for (const { m } of ranked.slice(0, 3)) {
    try {
      return await ingest(m.uid, req);
    } catch (err) {
      console.warn(`[assets] sketchfab ${m.uid} skipped: ${(err as Error).message}`);
    }
  }
  return null;
}

async function ingest(uid: string, req: ScoutRequest): Promise<AssetManifest> {
  // Re-read the license from the model page; search metadata is only a hint.
  const m = await api<SfModel>(`/models/${uid}`);
  const license = LICENSES[m.license?.slug ?? ""];
  if (!license) throw new Error(`license "${m.license?.label ?? "unknown"}" not allowed`);
  if (!m.isDownloadable) throw new Error("not downloadable");
  const id = `asset-sf-${slug(m.name).slice(0, 30).replace(/-+$/, "")}-${uid.slice(0, 8)}`;
  const existing = getManifest(id);
  if (existing) return existing;

  const dl = await api<{ glb?: { url: string; size: number } }>(`/models/${uid}/download`, true);
  if (!dl.glb) throw new Error("no GLB archive");
  if (dl.glb.size > MAX_BYTES) throw new Error(`too large (${dl.glb.size} bytes)`);
  const glb = await download(dl.glb.url, MAX_BYTES);
  writeAssetFile(id, "model.glb", glb);

  const now = new Date().toISOString();
  const author = m.user.displayName || m.user.username;
  const sourceUrl = m.viewerUrl ?? `https://sketchfab.com/3d-models/${uid}`;
  return register({
    schemaVersion: "1.1",
    id,
    name: clip(m.name, 120),
    kind: "model",
    source: { name: "sketchfab", sourceId: uid, url: sourceUrl },
    license: {
      id: license.id,
      url: license.url,
      author: clip(author, 120),
      ...(m.user.profileUrl ? { authorUrl: m.user.profileUrl } : {}),
      attribution: clip(`"${m.name}" by ${author} (${license.id}) via Sketchfab`, 300),
      retrievedAt: now,
      verifiedAt: now,
    },
    tags: clipList((m.tags ?? []).map((t) => t.name), 20, 30),
    tiers: [req.tier],
    style: "realistic",
    files: { primary: { url: assetUrl(id, "model.glb"), bytes: glb.byteLength, sha256: sha256(glb), mime: "model/gltf-binary" } },
    quality: { triangles: m.faceCount },
    ingest: { pipelineVersion: "0.1.0", ingestedAt: now, steps: ["download"], requestedBy: clip(req.requestedBy, 80) },
  });
}
