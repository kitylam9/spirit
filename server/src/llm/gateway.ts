import { createHash } from "node:crypto";
import Ajv, { type ValidateFunction } from "ajv";
import { config } from "../config.js";
import type { LlmStatus } from "@spirit/shared";
import type { ChatMessage, LLMProvider } from "./types.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAICompatibleProvider } from "./openaiCompatible.js";
import { OpenRouterProvider } from "./openrouter.js";

export interface JsonRequest {
  /** Agent name, used for logging and cache keys. */
  agent: string;
  system: string;
  user: string;
  /** Draft schema the LLM output must satisfy (simple JSON Schema, draft-07 subset). */
  schema: object;
  temperature?: number;
  maxTokens?: number;
  /** Cache identical requests (default true). Disable for dialogue. */
  cache?: boolean;
}

function createProvider(): LLMProvider | null {
  const { provider, baseUrl, model, apiKey, jsonMode, numCtx } = config.llm;
  switch (provider) {
    case "ollama":
      return new OllamaProvider(baseUrl, model, jsonMode, numCtx);
    case "llamacpp":
      return new OpenAICompatibleProvider("llamacpp", baseUrl, model, apiKey, jsonMode);
    case "openai":
      return new OpenAICompatibleProvider("openai", baseUrl, model, apiKey, jsonMode);
    case "openrouter":
      return new OpenRouterProvider(baseUrl, model, apiKey, jsonMode);
    case "none":
      return null;
  }
}

/** Pulls the first JSON object out of model text (handles code fences and <think> blocks). */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("no JSON object in model output");
  }
}

class Semaphore {
  private queue: (() => void)[] = [];
  active = 0;
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

export class LLMGateway {
  private provider = createProvider();
  private ajv = new Ajv({ allErrors: false, strict: false });
  private validators = new WeakMap<object, ValidateFunction>();
  private cache = new Map<string, unknown>();
  private semaphore = new Semaphore(config.llm.maxConcurrency);
  private online = false;
  private calls = 0;
  private failures = 0;
  private listeners = new Set<(s: LlmStatus) => void>();

  async init(): Promise<void> {
    if (!this.provider) {
      console.log("[llm] provider=none: all content comes from procedural fallbacks");
      return;
    }
    this.online = await this.provider.ping();
    console.log(
      `[llm] provider=${this.provider.id} model=${this.provider.model} url=${config.llm.baseUrl} ` +
        (this.online ? "online" : "OFFLINE (procedural fallbacks will be used until it responds)"),
    );
  }

  status(): LlmStatus {
    return {
      provider: this.provider?.id ?? "none",
      model: this.provider?.model ?? "procedural",
      online: this.online,
      busy: this.semaphore.active,
      calls: this.calls,
      failures: this.failures,
    };
  }

  onStatus(fn: (s: LlmStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const s = this.status();
    for (const fn of this.listeners) fn(s);
  }

  private validator(schema: object): ValidateFunction {
    let v = this.validators.get(schema);
    if (!v) {
      v = this.ajv.compile(schema);
      this.validators.set(schema, v);
    }
    return v;
  }

  /**
   * Ask the model for JSON matching `schema`. Returns null when no provider is configured,
   * the provider is offline, or output is still invalid after one repair round; callers
   * then use their procedural fallback.
   */
  async json<T>(req: JsonRequest): Promise<T | null> {
    if (!this.provider) return null;
    if (!this.online) {
      this.online = await this.provider.ping();
      if (!this.online) return null;
    }

    const key = createHash("sha256")
      .update(JSON.stringify([this.provider.model, req.agent, req.system, req.user, req.schema]))
      .digest("hex");
    if (req.cache !== false && this.cache.has(key)) return this.cache.get(key) as T;

    const validate = this.validator(req.schema);
    const shape =
      config.llm.jsonMode === "schema" ? "" : `\nThe object must validate against this JSON Schema:\n${JSON.stringify(req.schema)}`;
    const messages: ChatMessage[] = [
      { role: "system", content: `${req.system}\n\nRespond with a single JSON object only. No prose, no markdown.${shape}` },
      { role: "user", content: req.user },
    ];

    for (let attempt = 0; attempt < 2; attempt++) {
      const started = Date.now();
      this.calls++;
      this.emit();
      try {
        const text = await this.semaphore.run(() =>
          this.provider!.complete({
            messages,
            schema: req.schema,
            temperature: req.temperature ?? 0.8,
            maxTokens: req.maxTokens ?? 1500,
            signal: AbortSignal.timeout(config.llm.timeoutMs),
          }),
        );
        const data = extractJson(text);
        if (validate(data)) {
          console.log(`[llm] ${req.agent} ok in ${Date.now() - started}ms`);
          if (req.cache !== false) this.cache.set(key, data);
          this.emit();
          return data as T;
        }
        const issues = this.ajv.errorsText(validate.errors);
        console.warn(`[llm] ${req.agent} invalid output (attempt ${attempt + 1}): ${issues}`);
        messages.push({ role: "assistant", content: text }, { role: "user", content: `Your JSON was invalid: ${issues}. Return the corrected JSON object only.` });
      } catch (err) {
        console.warn(`[llm] ${req.agent} failed (attempt ${attempt + 1}): ${(err as Error).message}`);
        // Rate limited (free tiers): retrying right away only burns quota; use the fallback.
        if (/^\S+ 429:/.test((err as Error).message)) break;
        if ((err as Error).name === "TimeoutError" || /fetch failed|ECONNREFUSED/.test(String(err))) {
          this.online = await this.provider.ping();
          break;
        }
      }
    }
    this.failures++;
    this.emit();
    return null;
  }
}

export const llm = new LLMGateway();
