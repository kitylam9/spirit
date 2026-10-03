import { existsSync } from "node:fs";
import { resolve } from "node:path";

for (const candidate of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "..", ".env")]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

export type ProviderKind = "ollama" | "llamacpp" | "openai" | "none";
export type JsonMode = "schema" | "object" | "off";

const provider = (process.env.LLM_PROVIDER ?? "ollama").toLowerCase() as ProviderKind;

const defaults: Record<ProviderKind, { baseUrl: string; model: string; jsonMode: JsonMode }> = {
  ollama: { baseUrl: "http://localhost:11434", model: "llama3.1:8b", jsonMode: "schema" },
  llamacpp: { baseUrl: "http://localhost:8080", model: "local", jsonMode: "schema" },
  openai: { baseUrl: "https://api.openai.com", model: "gpt-4.1-mini", jsonMode: "object" },
  none: { baseUrl: "", model: "procedural", jsonMode: "off" },
};

if (!(provider in defaults)) {
  throw new Error(`LLM_PROVIDER must be one of ${Object.keys(defaults).join(", ")}; got "${provider}"`);
}

const d = defaults[provider];

export const config = {
  port: Number(process.env.PORT ?? 8787),
  dataDir: resolve(process.env.DATA_DIR ?? resolve(process.cwd(), "data")),
  llm: {
    provider,
    baseUrl: (process.env.LLM_BASE_URL ?? d.baseUrl).replace(/\/+$/, ""),
    model: process.env.LLM_MODEL ?? d.model,
    apiKey: process.env.LLM_API_KEY ?? "",
    jsonMode: (process.env.LLM_JSON_MODE as JsonMode | undefined) ?? d.jsonMode,
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 120000),
    maxConcurrency: Number(process.env.LLM_MAX_CONCURRENCY ?? 2),
    /** Ollama only. Large default contexts can spill a model onto the CPU and make it very slow. */
    numCtx: Number(process.env.LLM_NUM_CTX ?? 8192),
  },
};
