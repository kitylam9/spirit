import type { BodyStats, FoundObject, PlayerState } from "@spirit/shared";
import { clamp } from "../util/text.js";

/** Found-body numbers (docs/09-found-bodies.md §3). The LLM only picks tags. */
export type Tag = FoundObject["tags"][number];
export type Traits = FoundObject["traits"];
export type Body = NonNullable<NonNullable<PlayerState["incarnation"]>["body"]>;

export const MAX_PARTS = 8;
export const KNOCK_OFF_DAMAGE = 15;

const TAG_POINTS: Record<Tag, Partial<Traits>> = {
  heavy: { sturdy: 2 },
  sturdy: { sturdy: 2 },
  armored: { sturdy: 2 },
  stone: { sturdy: 2 },
  metal: { sturdy: 2 },
  light: { nimble: 2 },
  wheeled: { nimble: 2 },
  winged: { nimble: 2 },
  springy: { nimble: 2 },
  fast: { nimble: 2 },
  electronic: { clever: 2 },
  mechanical: { clever: 2 },
  bookish: { clever: 2 },
  precise: { clever: 2 },
  pretty: { charming: 2 },
  cute: { charming: 2 },
  shiny: { charming: 2 },
  musical: { charming: 2 },
  tasty: { charming: 2 },
  scary: { charming: -1, sturdy: 1 },
  sharp: { charming: -1, sturdy: 1 },
  fragile: { sturdy: -1 },
};

export function traitsFor(tags: Tag[]): Traits {
  const t: Traits = { sturdy: 2, nimble: 2, clever: 2, charming: 2 };
  for (const tag of tags) for (const [k, v] of Object.entries(TAG_POINTS[tag]) as [keyof Traits, number][]) t[k] += v;
  for (const k of Object.keys(t) as (keyof Traits)[]) t[k] = clamp(t[k], 0, 10);
  return t;
}

export function bodyStats(body: Body, objects: Record<string, FoundObject>): BodyStats {
  const total: Traits = { sturdy: 0, nimble: 0, clever: 0, charming: 0 };
  let scary = 0;
  const parts = [{ ...body.core, weight: 2 }, ...body.parts.map((p) => ({ ...p, weight: 1 }))];
  for (const part of parts) {
    const o = objects[part.objectId];
    if (!o) continue;
    for (const k of Object.keys(total) as (keyof Traits)[]) total[k] += o.traits[k] * part.weight;
    if (o.tags.includes("scary")) scary++;
  }
  return {
    maxHealth: Math.min(100, 40 + 3 * total.sturdy),
    speed: Math.round(Math.min(6.5, 3 + 0.12 * total.nimble) * 100) / 100,
    payMultiplier: Math.round(Math.min(1.6, 0.8 + 0.02 * total.clever) * 100) / 100,
    firstOpinion: clamp(total.charming - 2 * scary, -20, 20),
  };
}
