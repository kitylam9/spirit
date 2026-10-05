import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { AssetManifest } from "@spirit/shared";
import { parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { config } from "../config.js";
import { settings } from "../settings.js";
import { clip, slug } from "../util/text.js";
import { assetUrl, download, getManifest, listManifests, register, sha256, writeAssetFile } from "./catalog.js";
import { triangleCount, type MeshFormat } from "./meshInfo.js";

/**
 * Random Objaverse-XL objects for found bodies (docs/09-found-bodies.md §4). Every candidate's
 * license is re-checked at its original source before download; only CC0 / CC-BY / public domain.
 * Sketchfab and Smithsonian work out of the box. GitHub and Thingiverse need the local index
 * built by `npm run objaverse:index -w server` (Thingiverse also needs THINGIVERSE_TOKEN).
 */
const HF = "https://huggingface.co/datasets/allenai";
export const XL = `${HF}/objaverse-xl/resolve/main`;
const MIRROR = `${HF}/objaverse/resolve/main`;
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_TRIANGLES = 150_000;
const POOL_TARGET = 24;
const WORKERS = 3;
export const objaverseDir = join(config.dataDir, "objaverse");
mkdirSync(objaverseDir, { recursive: true });

type SourceName = "sketchfab" | "smithsonian" | "github" | "thingiverse";
type LicenseId = AssetManifest["license"]["id"];
const LICENSES: Record<string, { id: LicenseId; url: string }> = {
  cc0: { id: "CC0-1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
  by: { id: "CC-BY-4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  by3: { id: "CC-BY-3.0", url: "https://creativecommons.org/licenses/by/3.0/" },
  pd: { id: "PUBLIC-DOMAIN", url: "https://creativecommons.org/publicdomain/mark/1.0/" },
};
const MIME: Record<MeshFormat, string> = { glb: "model/gltf-binary", stl: "model/stl", obj: "model/obj" };

interface Candidate {
  source: SourceName;
  sourceId: string;
  title: string;
  format: MeshFormat;
  url: string;
  pageUrl: string;
  license: { id: LicenseId; url: string };
  author: string;
  authorUrl?: string;
  headers?: Record<string, string>;
}

/** Rows of the optional GitHub / Thingiverse indexes: dataset fileIdentifier plus license key. */
export interface IndexRow {
  u: string;
  l: string;
  f?: string;
}

async function json<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${url.split("?")[0]}`);
  return res.json() as Promise<T>;
}

/** Downloads `url` into the objaverse folder once and returns its bytes. */
async function cachedFile(name: string, url: string, maxBytes: number): Promise<Buffer> {
  const file = join(objaverseDir, name);
  if (!existsSync(file)) writeFileSync(file, await download(url, maxBytes));
  return readFileSync(file);
}

const once = <T>(fn: () => Promise<T>): (() => Promise<T>) => {
  let p: Promise<T> | undefined;
  return () => (p ??= fn().catch((err) => ((p = undefined), Promise.reject(err))));
};

// --- Sketchfab (Objaverse 1.0 mirror on Hugging Face) ---

const objectPaths = once(async () => gunzipSync(await cachedFile("object-paths.json.gz", `${MIRROR}/object-paths.json.gz`, 40e6)));

interface SfModel {
  name: string;
  faceCount?: number;
  isAgeRestricted?: boolean;
  user: { displayName?: string; username: string; profileUrl?: string };
  license?: { slug?: string; label?: string };
  viewerUrl?: string;
}

async function sketchfab(): Promise<Candidate> {
  const buf = await objectPaths();
  let start = buf.indexOf('"glbs/', Math.floor(Math.random() * buf.length));
  if (start < 0) start = buf.indexOf('"glbs/');
  const path = buf.toString("utf8", start + 1, buf.indexOf('"', start + 1));
  const uid = path.slice(path.lastIndexOf("/") + 1).replace(/\.glb$/, "");
  const m = await json<SfModel>(`https://api.sketchfab.com/v3/models/${uid}`);
  const license = LICENSES[m.license?.slug === "cc0" ? "cc0" : m.license?.slug === "by" ? "by" : ""];
  if (!license) throw new Error(`license "${m.license?.label ?? "unknown"}" not allowed`);
  if (m.isAgeRestricted) throw new Error("age-restricted");
  if ((m.faceCount ?? 0) > MAX_TRIANGLES) throw new Error(`${m.faceCount} faces`);
  return {
    source: "sketchfab",
    sourceId: uid,
    title: m.name,
    format: "glb",
    url: `${MIRROR}/${path}`,
    pageUrl: m.viewerUrl ?? `https://sketchfab.com/3d-models/${uid}`,
    license,
    author: m.user.displayName || m.user.username,
    ...(m.user.profileUrl ? { authorUrl: m.user.profileUrl } : {}),
  };
}

// --- Smithsonian Open Access (CC0 collection-wide) ---

const smithsonianRows = once(async () => {
  const buf = await cachedFile("smithsonian.parquet", `${XL}/smithsonian/smithsonian.parquet`, 5e6);
  const file = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const rows = (await parquetReadObjects({ file, compressors, columns: ["fileIdentifier", "license", "metadata"] })) as {
    fileIdentifier: string;
    license: string;
    metadata: string;
  }[];
  return rows.filter((r) => r.license === "Creative Commons Zero v1.0 Universal" && r.fileIdentifier.endsWith(".glb"));
});

async function smithsonian(): Promise<Candidate> {
  const rows = await smithsonianRows();
  const r = rows[Math.floor(Math.random() * rows.length)];
  const title = (JSON.parse(r.metadata || "{}") as { title?: string }).title || r.fileIdentifier.split("/").pop()!;
  return {
    source: "smithsonian",
    sourceId: r.fileIdentifier.split("/").slice(-2).join("/"),
    title,
    format: "glb",
    url: r.fileIdentifier,
    pageUrl: r.fileIdentifier,
    license: LICENSES.cc0,
    author: "Smithsonian Institution",
    authorUrl: "https://www.si.edu/openaccess",
  };
}

// --- GitHub and Thingiverse (optional local indexes) ---

const indexes = new Map<string, IndexRow[]>();
export const indexFile = (name: "github" | "thingiverse"): string => join(objaverseDir, `${name}.json`);

function indexRows(name: "github" | "thingiverse"): IndexRow[] {
  if (!indexes.has(name)) indexes.set(name, existsSync(indexFile(name)) ? JSON.parse(readFileSync(indexFile(name), "utf8")) : []);
  return indexes.get(name)!;
}

const pickRow = (rows: IndexRow[]): IndexRow => rows[Math.floor(Math.random() * rows.length)];
const extOf = (path: string): MeshFormat => path.split(".").pop()!.toLowerCase() as MeshFormat;
const titleOf = (file: string): string => file.split("/").pop()!.replace(/\.[^.]+$/, "");

async function github(): Promise<Candidate> {
  const row = pickRow(indexRows("github"));
  const m = row.u.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([0-9a-f]+)\/(.+)$/);
  if (!m) throw new Error(`unexpected id ${row.u}`);
  const [, owner, repo, commit, path] = m;
  const headers: Record<string, string> = { "user-agent": "spirit-game" };
  if (config.assets.githubToken) headers.authorization = `Bearer ${config.assets.githubToken}`;
  const info = await json<{ license?: { spdx_id?: string } | null }>(`https://api.github.com/repos/${owner}/${repo}`, headers);
  const spdx = info.license?.spdx_id;
  const license = spdx === "CC0-1.0" ? LICENSES.cc0 : spdx === "CC-BY-4.0" ? LICENSES.by : spdx === "CC-BY-3.0" ? LICENSES.by3 : undefined;
  if (!license) throw new Error(`repo license "${spdx ?? "none"}" not allowed`);
  return {
    source: "github",
    sourceId: `${owner}/${repo}/${path}`.slice(0, 200),
    title: titleOf(path),
    format: extOf(path),
    url: `https://raw.githubusercontent.com/${owner}/${repo}/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`,
    pageUrl: row.u.replace(/ /g, "%20"),
    license,
    author: owner,
    authorUrl: `https://github.com/${owner}`,
  };
}

async function thingiverse(): Promise<Candidate> {
  const row = pickRow(indexRows("thingiverse"));
  const m = row.u.match(/thing:(\d+)\/files\?fileId=(\d+)/);
  if (!m) throw new Error(`unexpected id ${row.u}`);
  const headers = { authorization: `Bearer ${config.assets.thingiverseToken}` };
  const thing = await json<{ name: string; license: string; is_nsfw?: boolean; public_url: string; creator?: { name: string; public_url?: string } }>(
    `https://api.thingiverse.com/things/${m[1]}`,
    headers,
  );
  const license = { "Creative Commons - Attribution": LICENSES.by3, "Creative Commons - Public Domain Dedication": LICENSES.cc0, "Public Domain": LICENSES.pd }[thing.license];
  if (!license) throw new Error(`license "${thing.license}" not allowed`);
  if (thing.is_nsfw) throw new Error("nsfw");
  const file = await json<{ name: string; download_url: string }>(`https://api.thingiverse.com/files/${m[2]}`, headers);
  return {
    source: "thingiverse",
    sourceId: `${m[1]}/${m[2]}`,
    title: thing.name,
    format: extOf(file.name),
    url: file.download_url,
    pageUrl: thing.public_url,
    license,
    author: thing.creator?.name ?? "unknown",
    ...(thing.creator?.public_url ? { authorUrl: thing.creator.public_url } : {}),
    headers,
  };
}

// --- Ingest and pool ---

const SOURCES: [SourceName, number, () => Promise<Candidate>, () => boolean][] = [
  ["sketchfab", 0.6, sketchfab, () => true],
  ["smithsonian", 0.15, smithsonian, () => true],
  ["github", 0.15, github, () => indexRows("github").length > 0],
  ["thingiverse", 0.1, thingiverse, () => !!config.assets.thingiverseToken && indexRows("thingiverse").length > 0],
];

export const objaverseAvailable = () => ({
  github: indexRows("github").length > 0,
  thingiverse: !!config.assets.thingiverseToken && indexRows("thingiverse").length > 0,
});

const sourceOn = (name: string): boolean => settings.assets.objaverse[name as SourceName] ?? false;

function pickSource(): [SourceName, () => Promise<Candidate>] | null {
  const live = SOURCES.filter((s) => sourceOn(s[0]) && s[3]());
  if (!live.length) return null;
  let r = Math.random() * live.reduce((a, s) => a + s[1], 0);
  for (const s of live) if ((r -= s[1]) <= 0) return [s[0], s[2]];
  return [live[0][0], live[0][2]];
}

async function ingest(c: Candidate): Promise<AssetManifest> {
  if (!["glb", "stl", "obj"].includes(c.format)) throw new Error(`format ${c.format}`);
  const id = `asset-ox-${slug(c.title).slice(0, 24).replace(/-+$/, "")}-${sha256(new TextEncoder().encode(c.sourceId)).slice(0, 8)}`;
  const existing = getManifest(id);
  if (existing) return existing;
  const bytes = await download(c.url, MAX_BYTES, c.headers);
  const triangles = triangleCount(bytes, c.format);
  if (triangles === 0 || triangles > MAX_TRIANGLES) throw new Error(`${triangles} triangles`);
  const file = `model.${c.format}`;
  writeAssetFile(id, file, bytes);
  const now = new Date().toISOString();
  const site = { sketchfab: "Sketchfab", smithsonian: "Smithsonian Open Access", github: "GitHub", thingiverse: "Thingiverse" }[c.source];
  return register({
    schemaVersion: "1.1",
    id,
    name: clip(c.title, 120),
    kind: "model",
    source: { name: c.source, sourceId: c.sourceId, url: c.pageUrl },
    license: {
      id: c.license.id,
      url: c.license.url,
      author: clip(c.author, 120),
      ...(c.authorUrl ? { authorUrl: c.authorUrl } : {}),
      attribution: clip(`"${c.title}" by ${c.author} (${c.license.id}) via ${site}, from Objaverse-XL`, 300),
      retrievedAt: now,
      verifiedAt: now,
    },
    tags: ["objaverse-xl"],
    tiers: ["any"],
    style: "realistic",
    files: { primary: { url: assetUrl(id, file), bytes: bytes.byteLength, sha256: sha256(bytes), mime: MIME[c.format] } },
    quality: { triangles },
    ingest: { pipelineVersion: "0.1.0", ingestedAt: now, steps: ["license-check", "download", "count-triangles"], requestedBy: "found-bodies" },
  });
}

const ready: AssetManifest[] = [];
let workers = 0;

async function worker(): Promise<void> {
  workers++;
  let failures = 0;
  let skipped = 0;
  let added = 0;
  try {
    while (ready.length < POOL_TARGET && failures < 20) {
      const picked = pickSource();
      if (!picked) break;
      const [name, find] = picked;
      try {
        const m = await ingest(await find());
        if (!ready.some((r) => r.id === m.id)) ready.push(m);
        added++;
        failures = 0;
      } catch (err) {
        failures++;
        skipped++;
        // Most rejections (license, size) are routine; only network-level trouble is worth a line.
        if (!/not allowed|faces|triangles|too large|age-restricted|404|needs /.test((err as Error).message)) console.warn(`[objaverse] ${name}: ${(err as Error).message}`);
      }
    }
  } finally {
    workers--;
    if (!workers) console.log(`[objaverse] pool has ${ready.length} objects ready (this worker: ${added} added, ${skipped} candidates rejected)`);
  }
}

/** Starts filling the pool in the background (no-op while already filling). */
export function warmPool(): void {
  while (workers < WORKERS) void worker();
}

/**
 * Up to `n` objects: fresh ones from the pool first, waiting at most `waitMs`, then objects
 * ingested in earlier sessions. Can return fewer than `n` (or none) when offline.
 */
export async function drawObjects(n: number, waitMs = 20000): Promise<AssetManifest[]> {
  for (let i = ready.length - 1; i >= 0; i--) if (!sourceOn(ready[i].source.name)) ready.splice(i, 1);
  warmPool();
  const deadline = Date.now() + waitMs;
  while (ready.length < n && Date.now() < deadline && workers > 0) await new Promise((r) => setTimeout(r, 500));
  const out = ready.splice(0, n);
  const old = listManifests("asset-ox-").filter((m) => sourceOn(m.source.name) && !out.some((o) => o.id === m.id));
  while (out.length < n && old.length) out.push(old.splice(Math.floor(Math.random() * old.length), 1)[0]);
  warmPool();
  return out;
}
