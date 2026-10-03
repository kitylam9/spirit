import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export type SchemaName =
  | "planet"
  | "civilization"
  | "scene"
  | "entity-npc"
  | "event"
  | "ui-layout"
  | "asset-manifest"
  | "player-state";

const schemasDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "schemas");
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const validators = new Map<string, ValidateFunction>();
for (const file of readdirSync(schemasDir).filter((f) => f.endsWith(".schema.json"))) {
  validators.set(file.replace(".schema.json", ""), ajv.compile(JSON.parse(readFileSync(join(schemasDir, file), "utf8"))));
}

/** Validates generated content against the binding schemas in /schemas. */
export function validate(name: SchemaName, data: unknown): { ok: true } | { ok: false; errors: string } {
  const v = validators.get(name);
  if (!v) throw new Error(`unknown schema ${name}`);
  if (v(data)) return { ok: true };
  return { ok: false, errors: ajv.errorsText(v.errors, { separator: "; " }) };
}

/**
 * Validates `primary`; if it fails, logs and validates `fallback()` instead. The fallback
 * is procedural and must always validate — failing that is a bug.
 */
export function acceptOrFallback<T>(name: SchemaName, primary: T, fallback: () => T, label: string): T {
  const r = validate(name, primary);
  if (r.ok) return primary;
  console.warn(`[validator] ${label} rejected: ${r.errors}`);
  const fb = fallback();
  const r2 = validate(name, fb);
  if (!r2.ok) throw new Error(`[validator] fallback ${label} invalid: ${r2.errors}`);
  return fb;
}
