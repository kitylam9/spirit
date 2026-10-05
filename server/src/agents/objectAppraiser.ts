import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AssetManifest, Civilization, FoundObject, Planet } from "@spirit/shared";
import { config } from "../config.js";
import { llm } from "../llm/gateway.js";
import { traitsFor, type Tag } from "../rules/body.js";
import { Rng } from "../util/rng.js";
import { clamp, clip, slug } from "../util/text.js";
import { validate } from "../validate.js";
import { TIERS } from "../world/templates.js";

/**
 * Appraisal step of the Asset Scout (prompts/object-appraiser.md): one batched LLM call names
 * and tags the objects drawn for a scene. Code adds ids and traits. Results are cached per asset.
 */
const TAGS: Tag[] = ["heavy", "sturdy", "armored", "stone", "metal", "light", "wheeled", "winged", "springy", "fast", "electronic", "mechanical", "bookish", "precise", "pretty", "cute", "shiny", "musical", "tasty", "scary", "sharp", "fragile"];
const cacheFile = join(config.dataDir, "found-objects.json");
const cache: Record<string, FoundObject> = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};

interface Draft {
  name: string;
  description: string;
  tags: string[];
  suggestedSize?: number;
  unsuitable?: boolean;
}

const KEYWORD_TAGS: [RegExp, Tag][] = [
  [/stone|rock|statue|bust|fossil|skull|bone|mandible|talus/, "stone"],
  [/metal|iron|steel|copper|brass|cannon|anvil|gear|bolt|nut/, "metal"],
  [/car|truck|wheel|tire|tyre|cart|bike|train|tank|tractor|wagon/, "wheeled"],
  [/bird|wing|plane|drone|jet|butterfly|dragon|angel/, "winged"],
  [/robot|computer|phone|radio|tv|monitor|laptop|console|camera/, "electronic"],
  [/engine|clock|lever|machine|motor|toggle|pump|valve/, "mechanical"],
  [/book|scroll|map|letter|paper/, "bookish"],
  [/flower|crystal|gem|jewel|ring|crown|vase/, "pretty"],
  [/cat|dog|bear|bunny|rabbit|duck|toy|plush|chibi/, "cute"],
  [/gold|silver|chrome|mirror|trophy/, "shiny"],
  [/guitar|piano|drum|violin|horn|bell|flute/, "musical"],
  [/cake|fruit|bread|apple|food|donut|burger|pizza|cookie/, "tasty"],
  [/monster|demon|zombie|skull|spider|alien|goblin/, "scary"],
  [/sword|knife|axe|spike|blade|spear|claw|crab/, "sharp"],
  [/glass|egg|bottle|cup|mug|teapot|lamp/, "fragile"],
  [/armor|armour|helmet|shield|shell/, "armored"],
  [/chair|table|crate|barrel|box|counter|cabinet|house/, "heavy"],
  [/feather|leaf|balloon|paper/, "light"],
];

/** "gear_v2_final.stl" -> "Gear", "LORD VOLDEMORT_HEAD" -> "Lord Voldemort Head". */
export function cleanName(title: string): string {
  const words = title
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.()[\]\d]+/g, " ")
    .split(/\s+/)
    .filter((w) => /^[a-z]{2,}$/i.test(w) && !/^(v\d*|final|new|copy|obj|stl|glb|fbx|model|low|poly|lowpoly|updated|untitled|scan|mesh)$/i.test(w))
    .slice(0, 4)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  return clip(words.join(" "), 40) || "Strange Object";
}

function keywordDraft(m: AssetManifest): Draft {
  // Smithsonian titles are "Species name: Part"; the part is the recognizable bit.
  const title = m.source.name === "smithsonian" && m.name.includes(":") ? m.name.split(":").pop()! : m.name;
  const words = title.toLowerCase().replace(/[^a-z]+/g, " ");
  const tags = [...new Set(KEYWORD_TAGS.filter(([re]) => new RegExp(`\\b(${re.source})s?\\b`).test(words)).map(([, t]) => t))].slice(0, 4);
  return { name: cleanName(title), description: clip(`Something that fell from far away: ${m.name}.`, 160), tags };
}

function assemble(m: AssetManifest, d: Draft): FoundObject {
  const tags = [...new Set(d.tags.map((t) => t.toLowerCase()).filter((t): t is Tag => (TAGS as string[]).includes(t)))].slice(0, 4);
  const name = clip(d.name, 40) || cleanName(m.name);
  return {
    schemaVersion: "1.1",
    id: `obj-${slug(name).slice(0, 24).replace(/-+$/, "")}-${m.id.slice(-8)}`,
    assetRef: m.id,
    name,
    description: clip(d.description, 160) || "An object of unknown origin.",
    tags,
    traits: traitsFor(tags),
    suggestedSize: Math.round(clamp(typeof d.suggestedSize === "number" ? d.suggestedSize : 0.6, 0.2, 1.8) * 100) / 100,
    unsuitable: d.unsuitable === true,
  };
}

const draftSchema = {
  type: "object",
  required: ["objects"],
  properties: {
    objects: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "description", "tags"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          tags: { type: "array", items: { type: "string", enum: TAGS } },
          suggestedSize: { type: "number" },
          unsuitable: { type: "boolean" },
        },
      },
    },
  },
};

/** Appraises `manifests` (cached ones skip the LLM); unsuitable objects are dropped. */
export async function appraise(manifests: AssetManifest[], planet: Planet, civ: Civilization): Promise<FoundObject[]> {
  const fresh = manifests.filter((m) => !cache[m.id]);
  if (fresh.length) {
    const out = await llm.json<{ objects: Draft[] }>({
      agent: "scout.appraise",
      system:
        `You are the Asset Scout of "Spirit". You appraise random real 3D objects lying on a planet; the player's spirit builds a body out of them. ` +
        `For each object write: name (1-4 plain words a player recognizes; turn file names into words; no brand or real people's names), ` +
        `description (one sentence, max 160 characters, playful but about the object, not second person), ` +
        `tags (up to 4 from: ${TAGS.join(", ")}), suggestedSize (largest side in meters as a body part, 0.2-1.8), ` +
        `unsuitable (true for anything outside a Teen rating: sexual content, gore, hate or extremist imagery, or a meaningless title; weapons, monsters and skulls are fine). ` +
        `Keep the input order and return exactly one entry per object as {"objects": [...]}.`,
      user:
        `Planet: ${planet.name}, ${TIERS[planet.tier].name} tier, ${civ.name}.\nObjects (source, title, format, triangles):\n` +
        fresh.map((m, i) => `${i + 1}. ${m.source.name}, "${m.name}", ${m.files.primary.mime?.split("/")[1] ?? "?"}, ${m.quality?.triangles ?? "?"}`).join("\n"),
      schema: draftSchema,
      temperature: 0.6,
      maxTokens: 80 * fresh.length + 200,
    });
    const fallback: Record<string, FoundObject> = {};
    fresh.forEach((m, i) => {
      const d = out?.objects?.[i];
      const o = d && typeof d.name === "string" ? assemble(m, { ...d, tags: Array.isArray(d.tags) ? d.tags : [] }) : undefined;
      // Only LLM appraisals are cached, so objects first seen offline get a proper name later.
      if (o && validate("found-object", o).ok) cache[m.id] = o;
      else fallback[m.id] = assemble(m, keywordDraft(m));
    });
    writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
    return manifests.map((m) => cache[m.id] ?? fallback[m.id]).filter((o) => !o.unsuitable);
  }
  return manifests.map((m) => cache[m.id]).filter((o) => !o.unsuitable);
}

export function cachedObject(assetRef: string): FoundObject | undefined {
  return cache[assetRef];
}

const PROCEDURAL: [string, NonNullable<FoundObject["procedural"]>["shape"], Tag[], string][] = [
  ["Weathered Crate", "box", ["heavy", "sturdy"], "A crate with nothing inside but the smell of old journeys."],
  ["Round Stone", "sphere", ["stone", "heavy"], "A smooth stone, warm from the sun."],
  ["Rusty Pipe", "cylinder", ["metal"], "A length of pipe that hums when the wind blows through it."],
  ["Bent Horn", "cone", ["musical"], "A brass horn that still remembers one note."],
  ["Lost Wheel", "torus", ["wheeled", "light"], "A small wheel that wants to roll somewhere."],
  ["Glass Float", "sphere", ["fragile", "shiny"], "A glass ball that catches every color of the sky."],
  ["Spring Coil", "cylinder", ["springy", "metal"], "A coil that bounces back no matter what."],
  ["Clockwork Box", "box", ["mechanical", "precise"], "Something inside it is still ticking."],
];

/** Offline fallback: simple shapes tinted from the planet palette (found-object 1.1 `procedural`). */
export function proceduralObjects(n: number, palette: string[], rng: Rng): FoundObject[] {
  return rng.shuffle([...PROCEDURAL]).slice(0, n).map(([name, shape, tags, description]) => ({
    schemaVersion: "1.1",
    id: `obj-proc-${slug(name)}`,
    procedural: { shape, color: rng.pick(palette) ?? "#b08d57" },
    name,
    description,
    tags,
    traits: traitsFor(tags),
    suggestedSize: 0.6,
  }));
}
