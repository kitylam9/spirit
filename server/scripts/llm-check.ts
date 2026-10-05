import { config } from "../src/config.js";
import { llm } from "../src/llm/gateway.js";

await llm.init();
console.log("config:", { ...config.llm, apiKey: config.llm.apiKey ? `${config.llm.apiKey.slice(0, 8)}…` : "(none)" });

const started = Date.now();
const result = await llm.json<{ name: string; omen: string }>({
  agent: "llm-check",
  system: "You name planets for a life-simulation game.",
  user: "Invent a medieval planet. Give its name and a one-sentence omen.",
  schema: {
    type: "object",
    required: ["name", "omen"],
    properties: { name: { type: "string" }, omen: { type: "string" } },
  },
  cache: false,
});

console.log(result ? `OK in ${Date.now() - started}ms:` : "FAILED (fallbacks would be used)", result ?? "");
process.exit(result ? 0 : 1);
