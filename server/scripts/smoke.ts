/**
 * Headless end-to-end run of one life: new universe → approach → incarnate → actions →
 * dialogue → death → reflection → new universe. Usage: `npx tsx server/scripts/smoke.ts`
 * (honors LLM_PROVIDER etc.; use LLM_PROVIDER=none for a fast procedural-only run).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerMessage } from "@spirit/shared";

process.env.DATA_DIR ??= mkdtempSync(join(tmpdir(), "spirit-smoke-"));
const { llm } = await import("../src/llm/gateway.js");
const { Session } = await import("../src/session.js");

await llm.init();
const inbox: ServerMessage[] = [];
const waitFor = async <T extends ServerMessage["type"]>(type: T, timeoutMs = 300000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const i = inbox.findIndex((m) => m.type === type);
    if (i >= 0) return inbox.splice(i, 1)[0] as Extract<ServerMessage, { type: T }>;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timeout waiting for ${type}`);
};

const t0 = Date.now();
const lap = (label: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${label}`);

const session = await Session.load(undefined);
const detach = session.attach((m) => {
  inbox.push(m);
  if (m.type === "toast") console.log(`         toast: ${m.text}`);
  if (m.type === "error") console.log(`         ERROR: ${m.message}`);
});
session.welcome(llm.status());
const welcome = await waitFor("welcome");
lap(`system "${welcome.system.name}": ${welcome.system.planets.map((p) => `${p.name} (${p.tier})`).join(", ")}`);

const target = welcome.system.planets.find((p) => p.tier === "T2" || p.tier === "T3") ?? welcome.system.planets[0];
await session.handle({ type: "approach", planetId: target.id });
const detail = await waitFor("planet.detail");
lap(`planet ${detail.planet.name}: ${detail.planet.regions.map((r) => r.name).join(", ")} | civ ${detail.civilization.name}`);

await session.handle({ type: "incarnate", planetId: target.id, mode: "arrive" });
const scene = await waitFor("scene");
const state = await waitFor("state");
lap(`scene "${scene.scene.name}" with ${scene.npcs.length} NPCs (${scene.npcs.map((n) => `${n.name}/${n.role}`).join(", ")}); I am ${state.player.incarnation?.vessel.name}`);

await session.handle({ type: "action", action: { verb: "work", params: { interactableId: "int-work" } } });
await session.handle({ type: "action", action: { verb: "buy", params: { interactableId: "int-food-stall" } } });
await session.handle({ type: "action", action: { verb: "eat", params: {} } });
lap(`after work/buy/eat: ${JSON.stringify(session.player.incarnation?.stats)}`);

const npc = scene.npcs[0];
await session.handle({ type: "dialogue.say", npcId: npc.id, text: "Good day. What news is there, and what do you sell?" });
const reply = await waitFor("npc.say");
lap(`${npc.name}: "${reply.reply.say}" intents=${JSON.stringify(reply.reply.intents)}`);

const exit = scene.scene.exits[0];
await session.handle({ type: "action", action: { verb: "travel", params: { regionId: (exit.to as { regionId: string }).regionId } } });
const scene2 = await waitFor("scene");
lap(`traveled to "${scene2.scene.name}" with ${scene2.npcs.length} NPCs`);

// Force a death to test reflection and rebirth.
session.player.incarnation!.stats.hunger = 0;
session.player.incarnation!.stats.health = 1;
await session.handle({ type: "action", action: { verb: "rest", params: {} } });
const death = await waitFor("death");
lap(`death: ${death.report.causeOfDeath}; SE ${death.report.seDelta} → ${death.report.energyLeft}; epitaph: ${death.report.epitaph}`);

await session.handle({ type: "reflect.continue" });
const next = await waitFor("system");
lap(`new universe "${next.system.name}" (${next.system.id}); planets: ${next.system.planets.map((p) => p.name).join(", ")}`);

console.log("LLM:", llm.status());
detach();
process.exit(0);
