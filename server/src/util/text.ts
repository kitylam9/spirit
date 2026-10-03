/** Truncate to fit a schema maxLength. */
export function clip(value: unknown, max: number, fallback = ""): string {
  const s = typeof value === "string" ? value.trim() : fallback;
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}

export function clipList(values: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .slice(0, maxItems)
    .map((v) => clip(v, maxLen));
}

export function slug(name: string): string {
  const s = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s || "x";
}

/** Returns `${prefix}-${slug(name)}`, suffixed with a number if already in `taken`. */
export function uniqueId(prefix: string, name: string, taken: Set<string>): string {
  const base = `${prefix}-${slug(name)}`;
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  taken.add(id);
  return id;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
