# AGENTS.md

Context for AI coding and content agents working in this repository.

## What this repo is

The design specification for **Spirit**, a Three.js life-simulation game whose content is
generated at runtime by a multi-agent LLM system. At milestone M0 the repo contains only
documents, JSON Schemas, prompt templates and examples.

## Source of truth

- `schemas/*.schema.json` are the binding contracts. Code, prompts and examples must agree
  with them. If a doc and a schema disagree, the schema wins; fix the doc.
- `docs/04-multi-agent-system.md` defines agent responsibilities. Do not give an agent work
  that belongs to another agent.
- `docs/07-safety-and-consistency.md` defines hard rules (no executable code in generated
  content, license allow-list for assets, canon must not be contradicted).

## Conventions

- Identifiers: `kebab-case` for ids of generated entities, prefixed by type
  (`planet-`, `civ-`, `scene-`, `npc-`, `evt-`, `asset-`, `ui-`, `obj-` for found objects,
  `part-` for body parts).
- Units: meters, seconds, radians. Up axis is +Y. Three.js right-handed coordinates.
- Time in game: `tick` (integer, 1 tick = 1 in-game minute on a planet surface).
- All generated JSON must include `schemaVersion` and `id`.
- Civilization tiers are `T0`–`T7` as defined in `docs/02-world-model.md`.

## When changing a schema

1. Bump `schemaVersion` in the schema's `$id` comment / `version` field.
2. Update every example in `examples/` that uses it.
3. Update the matching prompt in `prompts/` (output section).
4. Note the change in the relevant doc.

## Planned code layout (from M1)

```
client/   Three.js + Vite + TypeScript
server/   Node + TypeScript game server and agent runtime
shared/   types generated from schemas/ (json-schema-to-typescript)
tools/    asset pipeline CLI (gltf-transform based)
```
