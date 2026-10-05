/**
 * Builds the optional GitHub / Thingiverse indexes for found bodies (docs/09-found-bodies.md §4).
 * Downloads about 450 MB (GitHub) and 45 MB (Thingiverse) from Hugging Face once and keeps only
 * glb/stl/obj rows whose dataset license is CC0, CC-BY or public domain.
 *
 *   npm run objaverse:index -w server            # both
 *   npm run objaverse:index -w server -- github  # one
 */
import { writeFileSync } from "node:fs";
import { asyncBufferFromUrl, cachedAsyncBuffer, parquetMetadataAsync, parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { XL, indexFile, type IndexRow } from "../src/assets/objaverse.js";

const LICENSE_KEYS: Record<string, string> = {
  "Creative Commons Zero v1.0 Universal": "cc0",
  "Creative Commons - Attribution": "by",
  "Creative Commons - Public Domain Dedication": "cc0",
  "Public Domain": "pd",
};
const FORMATS = new Set(["glb", "stl", "obj"]);
const WINDOW = 250_000;

async function build(name: "github" | "thingiverse"): Promise<void> {
  const started = Date.now();
  const head = await fetch(`${XL}/${name}/${name}.parquet`, { method: "HEAD", redirect: "follow" });
  const file = cachedAsyncBuffer(await asyncBufferFromUrl({ url: head.url, byteLength: Number(head.headers.get("content-length")) }));
  const metadata = await parquetMetadataAsync(file);
  const total = Number(metadata.num_rows);
  const meta = (await parquetReadObjects({ file, metadata, compressors, columns: ["license", "fileType"] })) as { license: string | null; fileType: string }[];
  const wanted: number[] = [];
  meta.forEach((r, i) => {
    if (FORMATS.has(r.fileType) && r.license && LICENSE_KEYS[r.license]) wanted.push(i);
  });
  console.log(`[${name}] ${wanted.length} of ${total} rows have an allowed license and format`);

  const out: IndexRow[] = [];
  let w = 0;
  // Read in windows so the decoded strings of 5M rows never sit in memory at once.
  for (let start = 0; start < total && w < wanted.length; start += WINDOW) {
    if (wanted[w] >= start + WINDOW) continue;
    const columns = name === "thingiverse" ? ["fileIdentifier", "metadata"] : ["fileIdentifier"];
    const rows = (await parquetReadObjects({ file, metadata, compressors, columns, rowStart: start, rowEnd: Math.min(start + WINDOW, total) })) as {
      fileIdentifier: string;
      metadata?: string;
    }[];
    for (; w < wanted.length && wanted[w] < start + WINDOW; w++) {
      const i = wanted[w];
      const row = rows[i - start];
      const entry: IndexRow = { u: row.fileIdentifier, l: LICENSE_KEYS[meta[i].license!] };
      if (row.metadata) entry.f = (JSON.parse(row.metadata) as { filename?: string }).filename;
      out.push(entry);
    }
    process.stdout.write(`\r[${name}] ${Math.round((Math.min(start + WINDOW, total) / total) * 100)}%`);
  }
  writeFileSync(indexFile(name), JSON.stringify(out));
  console.log(`\n[${name}] wrote ${out.length} rows to ${indexFile(name)} in ${Math.round((Date.now() - started) / 1000)}s`);
}

const which = process.argv[2];
for (const name of ["github", "thingiverse"] as const) if (!which || which === name) await build(name);
