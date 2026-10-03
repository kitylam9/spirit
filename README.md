# Spirit

**Spirit** is an AI-native, multi-dimension life-simulation game built with Three.js.
The player begins as a point of light — a *spirit* — drifting through space. Every planet
holds a different civilization at a different stage of development, from stone-age tribes
to post-singularity megacities. Landing on a planet means being born into it, living a life
there, and trying to survive.

Nothing in the world is hand-authored. Planets, civilizations, characters, quests, 3D scenes
and even the user interface are generated at runtime by a team of cooperating LLM agents
running on a game server. Where a suitable high-quality, freely licensed 3D model exists on
the internet, the scene-design agents find it, download it, optimize it and place it in the
scene.

## Document map

| Doc | Read it when you want to know... |
| --- | --- |
| [docs/00-vision.md](docs/00-vision.md) | What the game is, its pillars, and the shared vocabulary |
| [docs/01-game-design.md](docs/01-game-design.md) | How the game plays: core loop, survival, incarnation, progression |
| [docs/02-world-model.md](docs/02-world-model.md) | How the universe is structured and what civilization tiers mean |
| [docs/03-technical-architecture.md](docs/03-technical-architecture.md) | Client, server, LLM gateway, streaming, persistence |
| [docs/04-multi-agent-system.md](docs/04-multi-agent-system.md) | Every AI agent, its contract, and how the agents are orchestrated |
| [docs/05-dynamic-ui.md](docs/05-dynamic-ui.md) | How the UI is generated safely at runtime |
| [docs/06-asset-pipeline.md](docs/06-asset-pipeline.md) | How free 3D models are discovered, licensed, optimized and placed |
| [docs/07-safety-and-consistency.md](docs/07-safety-and-consistency.md) | Guardrails, canon memory, determinism, cost control |
| [docs/08-roadmap.md](docs/08-roadmap.md) | Milestones from docs to playable game |

Machine-readable contracts:

- [schemas/](schemas/) — JSON Schema (draft 2020-12) for every piece of generated content.
  Agent output that does not validate is rejected.
- [prompts/](prompts/) — the system prompt template for each agent.
- [examples/](examples/) — sample agent outputs for a medieval planet and a high-tech planet.

## Suggested reading order

1. Designers: `00` → `01` → `02` → `examples/`.
2. Engineers: `00` → `03` → `04` → `schemas/` → `05` → `06` → `07`.
3. Prompt / content engineers: `00` → `04` → `prompts/` → `schemas/` → `examples/`.

## Status

Milestone **M0** (design documents and schemas). No game code yet. See
[docs/08-roadmap.md](docs/08-roadmap.md).
