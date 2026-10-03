# 00 — Vision

## Pitch

> You are a spark of consciousness adrift between worlds. Each planet is a different life
> waiting to be lived — a peasant in a feudal kingdom, a courier in a neon arcology, a
> herder on a tidal moon. Survive. Remember. Become more than a single life.

**Spirit** is a multi-dimension life simulation in which the entire world is written,
designed and staged by AI while you play. No two universes are the same, and no planet is
built until you approach it.

## Design pillars

1. **Every world is new.** All planets, civilizations, characters, events, scenes and UI are
   generated at runtime by LLM agents. Hand-authored content is limited to the rules engine,
   the schemas and the prompt templates.
2. **Lives, not levels.** The unit of play is a *life*: being born into a world, surviving
   in it, forming relationships, and eventually dying. Each life is a short story.
3. **Survival gives weight.** The spirit can be extinguished. Every incarnation risks the
   spirit's energy, so choices matter.
4. **Civilization shapes experience.** The technology tier of a planet changes the
   mechanics, threats, tools, social rules and even the look of the UI.
5. **Grounded in a coherent canon.** Generated content must agree with what has already
   been established. The world remembers.
6. **Real assets, legally.** Scenes use high-quality free 3D models from the internet when
   available, with license checks and attribution, and fall back to procedural geometry.

## Target experience

- Session length: 20–60 minutes; one session ≈ one or two lives.
- Platform: desktop web browser (WebGL2 / WebGPU via Three.js). Mobile later.
- Tone: contemplative wonder in space; grounded, sometimes harsh, life on planets.
- Rating target: Teen. Violence and hardship exist; graphic content is filtered.

## Glossary

| Term | Meaning |
| --- | --- |
| **Spirit** | The player's persistent self: a point of light that travels through space. Holds *Spirit Energy*, *Memories* and *Traits*. |
| **Spirit Energy (SE)** | The master survival resource (0–100). Slowly decays in space; lost on death; regained by living meaningfully. SE = 0 ends the game. |
| **Incarnation** | One life lived in a body on a planet. Begins at landing, ends at death or ascension. |
| **Vessel** | The body occupied during an incarnation (human, animal, android, hive drone, ...). |
| **Planet** | A world with one dominant civilization, biomes, regions and a history. |
| **Civilization Tier (T0–T7)** | Technology/social development level of a civilization. See `02-world-model.md`. |
| **Region** | A named area of a planet (a city, forest, district, station deck). |
| **Scene** | A loadable, playable 3D space inside a region (a market square, a lab, a cave). |
| **Dimension** | One of four layers of a life the game tracks: Physical, Social, Spiritual, Temporal. |
| **Memory** | A fragment kept from a past life, carried by the spirit; can unlock dialogue, skills or insight. |
| **Trait** | A persistent spirit modifier earned across lives (e.g. *Iron Will*, *Silver Tongue*). |
| **Canon** | The set of established world facts. Generated content must not contradict it. |
| **Agent** | An LLM-driven worker on the server with one responsibility and a JSON output contract. |
| **Director** | The orchestrating agent that decides what to generate and when. |
| **Asset** | A 3D model, texture, or audio file used in a scene, with a manifest and license. |
