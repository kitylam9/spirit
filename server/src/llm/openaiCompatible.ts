import type { CompletionRequest, LLMProvider } from "./types.js";
import type { JsonMode } from "../config.js";

/**
 * OpenAI-compatible `/v1/chat/completions`. Works with llama.cpp `llama-server`,
 * LM Studio, vLLM, Ollama's `/v1` endpoint and OpenAI itself.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  private apiBase: string;

  constructor(
    readonly id: string,
    baseUrl: string,
    readonly model: string,
    private apiKey: string,
    private jsonMode: JsonMode,
  ) {
    this.apiBase = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) h.authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  async complete(req: CompletionRequest): Promise<string> {
    let response_format: object | undefined;
    if (this.jsonMode === "schema" && req.schema) {
      response_format = { type: "json_schema", json_schema: { name: "output", schema: req.schema } };
    } else if (this.jsonMode !== "off") {
      response_format = { type: "json_object" };
    }
    const res = await fetch(`${this.apiBase}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      signal: req.signal,
      body: JSON.stringify({
        model: this.model,
        messages: req.messages,
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        response_format,
      }),
    });
    if (!res.ok) throw new Error(`${this.id} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return body.choices?.[0]?.message?.content ?? "";
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiBase}/models`, { headers: this.headers(), signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}
