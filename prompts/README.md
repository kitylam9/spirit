# Prompt templates

One system prompt template per agent. The Agent Runtime fills `{{placeholders}}` and
appends the shared context layers described in `docs/04-multi-agent-system.md` §3.

## Front matter fields

| Field | Meaning |
| --- | --- |
| `id` | Template id, used in cache keys and canon provenance |
| `version` | Semver; bump on any change that alters output |
| `agent` | Agent name from the roster |
| `modelTier` | `fast` / `strong` / `local` (LLM Gateway maps to concrete models) |
| `temperature` | Sampling temperature |
| `outputSchema` | Schema file the output must validate against (`none` for free text / internal) |
| `maxOutputTokens` | Hard cap |

## Shared rules (inserted into every template as `{{shared_rules}}`)

```
- You are one agent in the Spirit multi-agent system. Do only your job.
- Output ONLY valid JSON matching the provided schema. No prose, no markdown fences.
- Never output HTML, JavaScript, code, file paths or external URLs (except asset source URLs
  for the Asset Scout).
- Never contradict CANON. If the task conflicts with canon, follow canon and note it in the
  most appropriate free-text field.
- Respect the civilization tier and techProfile. No technology beyond the allowed tier per domain.
- Content rating: Teen. No sexual content, graphic gore, real-world hate symbols, or real people.
- Use the civilization's naming conventions for every new name.
- Use ids in the form <type>-<kebab-case>, and reuse ids given in the input.
```

## Placeholders available to all templates

- `{{shared_rules}}` — the block above.
- `{{tier_bible}}` — tier table from `docs/02-world-model.md` §3.
- `{{canon_pinned}}` — pinned canon facts (JSON).
- `{{canon_retrieved}}` — top-K retrieved canon facts (JSON lines).
- `{{task}}` — the Director's task input (JSON).
- `{{repair_issues}}` — present only on repair rounds: Validator issues to fix.
