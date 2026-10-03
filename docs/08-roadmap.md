# 08 — Roadmap

## M0 — Design and contracts (current)

- Design documents (`docs/`), JSON Schemas (`schemas/`), prompt templates (`prompts/`),
  examples (`examples/`).
- **Exit criteria:** every example validates against its schema
  (`npx -p ajv-cli@5 -p ajv-formats@3 ajv validate --spec=draft2020 --strict=false -c ajv-formats -s schemas/X.schema.json -d examples/...`).

## M1 — Spirit in space

- Client scaffold: Vite + TypeScript + Three.js.
- Spirit particle with trail, 6-DoF flight, bloom.
- Seeded star system: 4–9 procedural planets with shader atmospheres and palettes.
- Spirit Energy decay and space HUD (default layout, no LLM yet).
- **Exit:** fly around a reproducible system from a seed at 60 FPS.

## M2 — AI-generated worlds

- Server scaffold: Fastify + ws + BullMQ + Postgres/pgvector + Redis (docker compose).
- LLM Gateway with OpenAI, Anthropic and Ollama providers, structured output, caching,
  budgets.
- Agent runtime + Validator (Ajv + referential checks).
- Director (rule-based v1), World Architect, Civilization agents.
- Omen screen when approaching planets.
- **Exit:** each planet in a new system gets a valid `planet` + `civilization`; schema
  validity ≥ 99% on golden set; works with Ollama only.

## M3 — Landing and scenes

- Atmospheric descent transition.
- Scene Designer agent + procedural fallback scene generator.
- Scene loader with placeholders, terrain, sky (Poly Haven HDRI), lighting.
- Pre-ingested CC0 catalog (Kenney, Quaternius, Poly Haven) + ingest pipeline v1.
- Asset Scout v1 using the local catalog only.
- **Exit:** landing produces a walkable, themed scene in < 3 s with assets streaming in.

## M4 — Living a life

- Rules engine: needs, verbs, time, economy, combat (simple), SE accounting.
- Incarnation modes (Born, Arrive), vessels, goals.
- NPC agent (creation + streamed dialogue with intents).
- Narrative agent events and pacing; death, epitaph, reflection, then restart as a spirit
  in a newly generated universe (only Spirit Energy carries over).
- **Exit:** a full life can be played from birth to death on T2 and T6 planets.

## M5 — Fully dynamic

- UI Generator with tier themes for all screens.
- Asset Scout v2: Sketchfab API, Objaverse and TexVerse metadata indexes, CLIP ranking,
  optional VLM pick, license verification, credits screen.
- Speculative generation, LLM-judged canon contradiction checks, cost dashboards.
- **Exit:** blind playtest — players rate planets as distinct and coherent (≥ 4/5),
  fallback rate < 10%, cost within budget.

## Later

- Possession incarnation mode.
- Cross-planet politics on T6+ systems.
- Text-to-3D generation for missing hero assets.
- Voice for NPCs (TTS), music generation per civilization.
- Multiplayer: spirits meeting in space.
- WebGPU renderer path, mobile support.
