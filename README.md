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

**v0.1 vertical slice — playable.** Design docs and schemas (M0) plus a thin, end-to-end
build of the core loop. See [docs/08-roadmap.md](docs/08-roadmap.md) for what is in the
slice and what is simplified.

## Run it

Requirements: Node.js 22+. Optional: a local LLM (Ollama or llama.cpp).

```bash
npm install
cp .env.example .env      # then pick a provider (see below)
npm run dev               # server on :8787, client on http://localhost:5173
```

Open http://localhost:5173. Without any LLM (`LLM_PROVIDER=none`) the game is fully
playable with procedural content; with an LLM, names, histories, people, dialogue, events
and epitaphs are written by the agents.

### Local LLM: Ollama

```bash
ollama pull llama3.1:8b          # or qwen2.5:7b-instruct, qwen3-coder, ...
```

```ini
LLM_PROVIDER=ollama
LLM_MODEL=llama3.1:8b
LLM_JSON_MODE=schema             # Ollama constrains output to each agent's JSON Schema
LLM_NUM_CTX=8192                 # keeps the model on the GPU; Ollama defaults can be huge
```

### Local LLM: llama.cpp

```bash
llama-server -m ./models/your-model.gguf --port 8080 -c 8192 -ngl 99
```

```ini
LLM_PROVIDER=llamacpp
LLM_BASE_URL=http://localhost:8080
LLM_JSON_MODE=schema             # sent as response_format json_schema (grammar-constrained)
```

The same `llamacpp` provider works for any OpenAI-compatible server: LM Studio
(`LLM_BASE_URL=http://localhost:1234`), vLLM, KoboldCpp, or a hosted API
(`LLM_PROVIDER=openai`, `LLM_API_KEY=...`). If a server rejects `json_schema`, use
`LLM_JSON_MODE=object` or `off`; the schema is then included in the prompt.

### Checks

```bash
npm run llm:check            # one round-trip to the configured LLM
npm run smoke                # headless life: universe → planet → actions → dialogue → death → rebirth
npm run validate:examples    # examples/ against schemas/
npm run typecheck
```

Speed tip: world generation makes a few large calls (planet, civilization, people). Small
instruct models (7–8B) on a GPU keep landing under a minute; a model that barely fits in
VRAM can slow to ~10–30 tokens/s on long outputs. The server logs slow Ollama calls with
token counts so you can tell.

### Controls

| Where | Keys |
| --- | --- |
| Space | Drag to look · W/S fly · A/D strafe · Space/C up/down · Shift boost · click a world to drift there · 1 = be born, 2 = arrive |
| Planet | W/A/S/D walk · Shift run · drag or Q/R to turn the camera · E interact (talk, buy, work, rest, travel) · click food to eat · Esc leave a conversation |
