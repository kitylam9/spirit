export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  /** JSON Schema for structured output; providers use it when their JSON mode allows. */
  schema?: object;
  temperature: number;
  maxTokens: number;
  signal: AbortSignal;
}

export interface LLMProvider {
  readonly id: string;
  readonly model: string;
  complete(req: CompletionRequest): Promise<string>;
  ping(): Promise<boolean>;
}
