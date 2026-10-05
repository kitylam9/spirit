import { existsSync } from "node:fs";
import { resolve } from "node:path";

for (const candidate of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "..", ".env")]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

export type ProviderKind = "ollama" | "llamacpp" | "openai" | "openrouter" | "none";
export type JsonMode = "schema" | "object" | "off";

/** Empty values (`LLM_MODEL=` in .env) count as unset. */
const env = (key: string): string | undefined => process.env[key]?.trim() || undefined;

const provider = (env("LLM_PROVIDER") ?? "ollama").toLowerCase() as ProviderKind;

export const llmDefaults: Record<ProviderKind, { baseUrl: string; model: string; jsonMode: JsonMode }> = {
  ollama: { baseUrl: "http://localhost:11434", model: "llama3.1:8b", jsonMode: "schema" },
  llamacpp: { baseUrl: "http://localhost:8080", model: "local", jsonMode: "schema" },
  openai: { baseUrl: "https://api.openai.com", model: "gpt-4.1-mini", jsonMode: "object" },
  // Free models rarely support strict json_schema; JSON mode plus the schema in the prompt works across them.
  openrouter: { baseUrl: "https://openrouter.ai/api", model: "google/gemma-4-31b-it:free", jsonMode: "object" },
  none: { baseUrl: "", model: "procedural", jsonMode: "off" },
};

if (!(provider in llmDefaults)) {
  throw new Error(`LLM_PROVIDER must be one of ${Object.keys(llmDefaults).join(", ")}; got "${provider}"`);
}

/** LLM_MODEL from .env for the .env provider, else the built-in default. */
export const defaultModel = (p: ProviderKind): string => (p === provider ? env("LLM_MODEL") : undefined) ?? llmDefaults[p].model;

/**
 * Full LLM config for a provider choice. Base URL and API keys only ever come from .env, so
 * settings changed in the game cannot send a key to another host.
 */
export function resolveLlm(s: { provider: ProviderKind; model?: string; jsonMode?: JsonMode | ""; maxConcurrency: number; timeoutMs: number }) {
  const d = llmDefaults[s.provider];
  return {
    provider: s.provider,
    baseUrl: ((s.provider === provider ? env("LLM_BASE_URL") : undefined) ?? d.baseUrl).replace(/\/+$/, ""),
    model: s.model || defaultModel(s.provider),
    apiKey: (s.provider === "openrouter" ? env("OPENROUTER_API_KEY") : undefined) ?? env("LLM_API_KEY") ?? "",
    jsonMode: s.jsonMode || d.jsonMode,
    timeoutMs: s.timeoutMs,
    maxConcurrency: s.maxConcurrency,
    /** Ollama only. Large default contexts can spill a model onto the CPU and make it very slow. */
    numCtx: Number(env("LLM_NUM_CTX") ?? 8192),
  };
}

const port = Number(env("PORT") ?? 8787);

export const config = {
  port,
  dataDir: resolve(env("DATA_DIR") ?? resolve(process.cwd(), "data")),
  /** Base URL clients use to fetch ingested assets (`/assets/...`). */
  publicUrl: (env("PUBLIC_URL") ?? `http://localhost:${port}`).replace(/\/+$/, ""),
  assets: {
    /** Optional. Enables Sketchfab as a fallback source (https://sketchfab.com/settings/password). */
    sketchfabToken: env("SKETCHFAB_API_TOKEN") ?? "",
    /** Optional. Raises the GitHub API limit for license checks of Objaverse-XL GitHub objects. */
    githubToken: env("GITHUB_TOKEN") ?? "",
    /** Optional. Enables Objaverse-XL Thingiverse objects (https://www.thingiverse.com/apps/create). */
    thingiverseToken: env("THINGIVERSE_TOKEN") ?? "",
  },
  /** Replaced at runtime by the settings menu (server/src/settings.ts). */
  llm: resolveLlm({
    provider,
    jsonMode: env("LLM_JSON_MODE") as JsonMode | undefined,
    timeoutMs: Number(env("LLM_TIMEOUT_MS") ?? 120000),
    maxConcurrency: Number(env("LLM_MAX_CONCURRENCY") ?? 2),
  }),
};
