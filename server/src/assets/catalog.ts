import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AssetManifest } from "@spirit/shared";
import { config } from "../config.js";
import { validate } from "../validate.js";

/** Ingested assets live in `DATA_DIR/assets/<asset-id>/` next to their `manifest.json`. */
export const assetsDir = join(config.dataDir, "assets");
const indexFile = join(assetsDir, "queries.json");

const manifests = new Map<string, AssetManifest>();
let queries: Record<string, string> = {};

mkdirSync(assetsDir, { recursive: true });
for (const dir of readdirSync(assetsDir, { withFileTypes: true })) {
  const file = join(assetsDir, dir.name, "manifest.json");
  if (!dir.isDirectory() || !existsSync(file)) continue;
  try {
    const m = JSON.parse(readFileSync(file, "utf8")) as AssetManifest;
    manifests.set(m.id, m);
  } catch {
    // A half-written ingest; it will be redone on the next request.
  }
}
if (existsSync(indexFile)) {
  try {
    queries = JSON.parse(readFileSync(indexFile, "utf8"));
  } catch {
    queries = {};
  }
}

export function getManifest(id: string): AssetManifest | undefined {
  const m = manifests.get(id);
  return m && !m.disabled ? m : undefined;
}

export function lookupQuery(key: string): AssetManifest | undefined {
  return queries[key] ? getManifest(queries[key]) : undefined;
}

export function rememberQuery(key: string, assetId: string): void {
  queries[key] = assetId;
  writeFileSync(indexFile, JSON.stringify(queries, null, 1));
}

/** Writes `bytes` to `<asset-id>/<relPath>`, refusing paths that escape the asset folder. */
export function writeAssetFile(assetId: string, relPath: string, bytes: Uint8Array): void {
  if (relPath.split(/[\\/]/).some((p) => p === ".." || p === "") || /^[a-zA-Z]:/.test(relPath)) throw new Error(`unsafe path ${relPath}`);
  const file = join(assetsDir, assetId, relPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

export function assetUrl(assetId: string, relPath: string): string {
  return `${config.publicUrl}/assets/${assetId}/${relPath.split("/").map(encodeURIComponent).join("/")}`;
}

export const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export async function download(url: string, maxBytes: number, headers: Record<string, string> = {}): Promise<Uint8Array> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`download ${res.status}: ${url}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error(`too large (${declared} bytes)`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error(`too large (${bytes.byteLength} bytes)`);
  return bytes;
}

/** Validates and stores a manifest; the files must already be written. */
export function register(m: AssetManifest): AssetManifest {
  const r = validate("asset-manifest", m);
  if (!r.ok) throw new Error(`manifest ${m.id} invalid: ${r.errors}`);
  writeFileSync(join(assetsDir, m.id, "manifest.json"), JSON.stringify(m, null, 1));
  manifests.set(m.id, m);
  return m;
}
