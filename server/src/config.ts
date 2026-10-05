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

const defaults: Record<ProviderKind, { baseUrl: string; model: string; jsonMode: JsonMode }> = {
  ollama: { baseUrl: "http://localhost:11434", model: "llama3.1:8b", jsonMode: "schema" },
  llamacpp: { baseUrl: "http://localhost:8080", model: "local", jsonMode: "schema" },
  openai: { baseUrl: "https://api.openai.com", model: "gpt-4.1-mini", jsonMode: "object" },
  // Free models rarely support strict json_schema; JSON mode plus the schema in the prompt works across them.
  openrouter: { baseUrl: "https://openrouter.ai/api", model: "google/gemma-4-31b-it:free", jsonMode: "object" },
  none: { baseUrl: "", model: "procedural", jsonMode: "off" },
};

if (!(provider in defaults)) {
  throw new Error(`LLM_PROVIDER must be one of ${Object.keys(defaults).join(", ")}; got "${provider}"`);
}

const d = defaults[provider];

const port = Number(env("PORT") ?? 8787);

export const config = {
  port,
  dataDir: resolve(env("DATA_DIR") ?? resolve(process.cwd(), "data")),
  /** Base URL clients use to fetch ingested assets (`/assets/...`). */
  publicUrl: (env("PUBLIC_URL") ?? `http://localhost:${port}`).replace(/\/+$/, ""),
  assets: {
    /** Optional. Enables Sketchfab as a fallback source (https://sketchfab.com/settings/password). */
    sketchfabToken: env("SKETCHFAB_API_TOKEN") ?? "",
  },
  llm: {
    provider,
    baseUrl: (env("LLM_BASE_URL") ?? d.baseUrl).replace(/\/+$/, ""),
    model: env("LLM_MODEL") ?? d.model,
    apiKey: (provider === "openrouter" ? env("OPENROUTER_API_KEY") : undefined) ?? env("LLM_API_KEY") ?? "",
    jsonMode: (env("LLM_JSON_MODE") as JsonMode | undefined) ?? d.jsonMode,
    timeoutMs: Number(env("LLM_TIMEOUT_MS") ?? 120000),
    maxConcurrency: Number(env("LLM_MAX_CONCURRENCY") ?? 2),
    /** Ollama only. Large default contexts can spill a model onto the CPU and make it very slow. */
    numCtx: Number(env("LLM_NUM_CTX") ?? 8192),
  },
};
