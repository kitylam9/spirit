import type { CompletionRequest, LLMProvider } from "./types.js";
import type { JsonMode } from "../config.js";

/** Ollama native API (`/api/chat`). Structured output via the `format` field. */
export class OllamaProvider implements LLMProvider {
  readonly id = "ollama";

  constructor(
    private baseUrl: string,
    readonly model: string,
    private jsonMode: JsonMode,
    private numCtx: number,
  ) {}

  async complete(req: CompletionRequest): Promise<string> {
    const format = this.jsonMode === "schema" && req.schema ? req.schema : this.jsonMode === "off" ? undefined : "json";
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: req.signal,
      body: JSON.stringify({
        model: this.model,
        messages: req.messages,
        stream: false,
        format,
        options: { temperature: req.temperature, num_predict: req.maxTokens, num_ctx: this.numCtx },
      }),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as {
      message?: { content?: string };
      total_duration?: number;
      load_duration?: number;
      prompt_eval_count?: number;
      prompt_eval_duration?: number;
      eval_count?: number;
      eval_duration?: number;
    };
    const s = (ns?: number) => ((ns ?? 0) / 1e9).toFixed(1);
    if ((body.total_duration ?? 0) > 15e9) {
      console.log(
        `[llm] ollama slow call: total ${s(body.total_duration)}s, load ${s(body.load_duration)}s, ` +
          `prompt ${body.prompt_eval_count} tok in ${s(body.prompt_eval_duration)}s, output ${body.eval_count} tok in ${s(body.eval_duration)}s`,
      );
    }
    return body.message?.content ?? "";
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return false;
      const body = (await res.json()) as { models?: { name: string }[] };
      const names = (body.models ?? []).map((m) => m.name);
      if (!names.some((n) => n === this.model || n === `${this.model}:latest`)) {
        console.warn(`[llm] ollama is running but model "${this.model}" is not pulled. Available: ${names.join(", ") || "none"}`);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }
}
