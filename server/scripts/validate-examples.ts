/** Validates every file in /examples against its schema. Usage: `npm run validate:examples`. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { validate, type SchemaName } from "../src/validate.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCHEMA_FOR: Record<string, SchemaName> = {
  planet: "planet",
  civilization: "civilization",
  scene: "scene",
  npc: "entity-npc",
  event: "event",
  "ui-hud": "ui-layout",
  "player-state": "player-state",
  "asset-manifest": "asset-manifest",
};

const files: string[] = [];
const walk = (dir: string) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith(".json")) files.push(p);
  }
};
walk(join(root, "examples"));

let failed = 0;
for (const file of files) {
  const schema = SCHEMA_FOR[basename(file, ".json")];
  const name = relative(root, file);
  if (!schema) {
    console.log(`skip  ${name} (no schema mapping)`);
    continue;
  }
  const r = validate(schema, JSON.parse(readFileSync(file, "utf8")));
  if (r.ok) console.log(`ok    ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}: ${r.errors}`);
  }
}
process.exit(failed ? 1 : 0);
