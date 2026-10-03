import { compileFromFile } from "json-schema-to-typescript";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(here, "..", "..", "schemas");
const outDir = join(here, "..", "src", "generated");

await mkdir(outDir, { recursive: true });
const files = (await readdir(schemasDir)).filter((f) => f.endsWith(".schema.json"));
const exports = [];

for (const file of files) {
  const name = file.replace(".schema.json", "");
  const ts = await compileFromFile(join(schemasDir, file), {
    cwd: schemasDir,
    additionalProperties: false,
    ignoreMinAndMaxItems: true,
    bannerComment: `/* Generated from schemas/${file} by shared/scripts/gen-types.mjs. Do not edit. */`,
    style: { singleQuote: false },
  });
  await writeFile(join(outDir, `${name}.ts`), ts);
  // Helper types ($defs) collide across files, so only the root type is re-exported.
  const { title } = JSON.parse(await readFile(join(schemasDir, file), "utf8"));
  const rootType = title.replace(/(^|\s)(\w)/g, (_, __, c) => c.toUpperCase()).replace(/\s/g, "");
  exports.push(`export type { ${rootType} } from "./${name}.js";`);
  console.log(`generated ${name}.ts`);
}

await writeFile(join(outDir, "index.ts"), exports.join("\n") + "\n");
