import { OpenAICompatibleProvider } from "./openaiCompatible.js";
import type { JsonMode } from "../config.js";

/**
 * OpenRouter (https://openrouter.ai), OpenAI-compatible. Free models have ids ending in
 * `:free` and are rate limited (roughly 20 requests/minute and a small daily quota).
 */
export class OpenRouterProvider extends OpenAICompatibleProvider {
  private warned = new Set<string>();

  constructor(baseUrl: string, model: string, apiKey: string, jsonMode: JsonMode) {
    super("openrouter", baseUrl, model, apiKey, jsonMode);
  }

  protected headers(): Record<string, string> {
    return { ...super.headers(), "x-title": "Spirit" };
  }

  // Reasoning models (e.g. nemotron) otherwise spend the small per-agent token budget
  // thinking and get cut off before emitting any JSON.
  protected extraBody(): Record<string, unknown> {
    return { reasoning: { enabled: false } };
  }

  private warnOnce(message: string): void {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    console.warn(`[llm] ${message}`);
  }

  async ping(): Promise<boolean> {
    if (!this.apiKey) {
      this.warnOnce("OPENROUTER_API_KEY is not set in .env (get one at https://openrouter.ai/keys)");
      return false;
    }
    try {
      const key = await fetch(`${this.apiBase}/key`, { headers: this.headers(), signal: AbortSignal.timeout(5000) });
      if (!key.ok) {
        this.warnOnce(`OpenRouter rejected the API key (${key.status})`);
        return false;
      }
      const models = await fetch(`${this.apiBase}/models`, { signal: AbortSignal.timeout(5000) });
      if (models.ok) {
        const ids = ((await models.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? [];
        if (!ids.includes(this.model)) {
          const free = ids.filter((id) => id.endsWith(":free"));
          this.warnOnce(`OpenRouter has no model "${this.model}". Free models now: ${free.join(", ") || "none"}`);
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }
}
