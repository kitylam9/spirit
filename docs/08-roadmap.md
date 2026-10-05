# 08 — Roadmap

## M0 — Design and contracts (done)

- Design documents (`docs/`), JSON Schemas (`schemas/`), prompt templates (`prompts/`),
  examples (`examples/`).
- **Exit criteria:** every example validates against its schema (`npm run validate:examples`).

## v0.1 vertical slice (playable, current)

A thin, end-to-end slice through M1–M4 so the loop can be played and tuned early:
fly as a spirit, approach a planet (omen), be born or arrive, live (eat, work, rest, talk,
travel between regions, face events), die, read the epitaph, return to space in a new
universe with only Spirit Energy carried over.

What it covers, and the deliberate simplifications versus the milestones below:

| Area | In the slice | Simplified / deferred |
| --- | --- | --- |
| Server | Node `http` + `ws`, one session per player, JSON save files in `DATA_DIR` | Fastify, BullMQ, Postgres/pgvector, Redis (M2) |
| LLM gateway | Ollama native, OpenAI-compatible (llama.cpp `llama-server`, LM Studio, OpenAI), `none`; JSON-schema / JSON-object / prompt-only modes; cache; timeouts | Anthropic provider, budgets, cost dashboard |
| Agents | World Architect, Civilization, Scene Designer, NPC (create + dialogue), Narrative (events, goal, epitaph), UI Generator (HUD vocabulary) | Director, Rules/Balance agent, Asset Scout, Canon Keeper, Validator LLM checks |
| Generation pattern | LLM returns small *draft* JSON (creative fields); code assembles full schema objects with procedural ids/numbers; Ajv validates; procedural fallback on any failure | Full-schema generation by the LLM |
| Scenes | Procedural layout + procedural meshes (`procedural` instances), heightmap terrain, Sky shader | Asset ingest, CC0 catalogs, HDRIs (M3, M5) |
| UI | Server-generated HUD per planet (`ui-layout`); other screens use client-built `ui-layout` trees rendered by the same whitelisted renderer | LLM-generated layouts for omen/dialogue/event/reflection (M5) |
| Rules | Needs, hazards, disease, time skips, economy, SE accounting, death/restart | Combat, crafting, possession |

## v0.2 — Found bodies (designed, next)

Replace *Born*/*Arrive* with a SWAPMEAT-style found body (`09-found-bodies.md`): land as a
wisp, collect random CC0/CC-BY objects from Objaverse-XL, stick them together free-form,
lose parts on heavy hits. Contracts are in place (`player-state` 1.2, `found-object` 1.0,
`asset-manifest` 1.1, `prompts/object-appraiser.md`); the server pool, appraisal, wisp and
placement controls are still to be built.

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
