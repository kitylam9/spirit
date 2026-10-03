import "./ui/style.css";
import * as THREE from "three";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { NPC, NpcIntent, PlanetSummary, ServerMessage, UILayout } from "@spirit/shared";
import { exitTarget, npcSpawns } from "@spirit/shared";
import { Net } from "./net.js";
import { state } from "./state.js";
import { renderLayout, type Rendered, type UiAction } from "./ui/dsl.js";
import * as layouts from "./ui/layouts.js";
import type { View } from "./views/common.js";
import { SpaceView } from "./views/SpaceView.js";
import { SurfaceView, type Target } from "./views/SurfaceView.js";

// ---------- renderer ----------
const viewport = document.getElementById("viewport")!;
const ui = document.getElementById("ui")!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
viewport.append(renderer.domElement);
const labels = new CSS2DRenderer();
labels.domElement.className = "labels";
viewport.append(labels.domElement);

// ---------- UI layers ----------
const div = (cls: string) => Object.assign(document.createElement("div"), { className: cls });

class Layer {
  private host = div("layer");
  private r: Rendered | null = null;
  constructor() {
    ui.append(this.host);
  }
  set(layout: UILayout | null, focusInput = false): void {
    this.r = layout ? renderLayout(layout, dispatch) : null;
    this.host.replaceChildren(...(this.r ? [this.r.el] : []));
    if (focusInput) this.host.querySelector("input")?.focus();
  }
  update(): void {
    this.r?.update();
  }
  get open(): boolean {
    return !!this.r;
  }
}

const hudLayer = new Layer();
const omenLayer = new Layer();
const dialogueLayer = new Layer();
const eventLayer = new Layer();
const reflectionLayer = new Layer();
const toasts = div("toasts");
const loading = div("loading");
const prompt = div("prompt");
const llmStatus = div("llm-status");
const offline = div("offline");
offline.textContent = "Connecting to the Spirit server…";
loading.hidden = prompt.hidden = true;
ui.append(toasts, loading, prompt, llmStatus, offline);

function toast(text: string, tone = "info"): void {
  const el = div(`toast ${tone}`);
  el.textContent = text;
  toasts.prepend(el);
  while (toasts.children.length > 5) toasts.lastElementChild!.remove();
  setTimeout(() => (el.style.opacity = "0"), 4500);
  setTimeout(() => el.remove(), 5200);
}

// ---------- game state ----------
let view: View | null = null;
let viewKey = "";
let planetHud: UILayout | null = null;
let nearPlanet: PlanetSummary | null = null;
let autopilot: string | null = null;
const approached = new Set<string>();
let dialogue: { npc: NPC; lines: layouts.DialogueLine[]; intents: NpcIntent[]; waiting: boolean } | null = null;

const theme = (): UILayout["theme"] => state.civ?.aesthetic.uiTheme ?? "spirit";

function setView(key: string, make: () => View): void {
  if (key === viewKey) return;
  view?.dispose();
  view = null;
  viewKey = key;
  try {
    view = make();
    view.resize(innerWidth, innerHeight);
  } catch (err) {
    console.error(err);
    toast(`Could not build the scene: ${(err as Error).message}`, "bad");
  }
}

function renderSpaceHud(): void {
  if (state.system && state.player) hudLayer.set(layouts.spaceHud(state.system, state.player.spirit.livesLived, autopilot));
}

function syncView(): void {
  const p = state.player;
  if (!p || !state.system) return;
  const phase = p.location.phase;
  if (phase !== "reflection" && reflectionLayer.open) reflectionLayer.set(null);
  if (phase === "space" || phase === "descent") {
    const key = `space:${state.system.id}`;
    if (key !== viewKey) {
      nearPlanet = null;
      autopilot = null;
      approached.clear();
      omenLayer.set(null);
      setView(key, () => new SpaceView(renderer, state.system!, { onNear, onAutopilot }));
      renderSpaceHud();
    }
    if (phase === "descent") omenLayer.set(null);
  } else if (phase === "planet" && state.scene && p.location.sceneId === state.scene.id) {
    const key = `surface:${state.scene.id}`;
    if (key !== viewKey) {
      omenLayer.set(null);
      const scene = state.scene;
      setView(key, () => new SurfaceView(renderer, scene, state.npcs, p.location.position as [number, number, number] | undefined, { onPrompt, onInteract }));
      hudLayer.set(planetHud);
    }
  }
}

function onNear(p: PlanetSummary | null): void {
  nearPlanet = p;
  if (!p || state.player?.location.phase !== "space") return omenLayer.set(null);
  if (!approached.has(p.id)) {
    approached.add(p.id);
    net.send({ type: "approach", planetId: p.id });
  }
  omenLayer.set(layouts.omen(p, state.player.spirit.energy, p.detailReady));
}

function onAutopilot(id: string | null): void {
  autopilot = id;
  renderSpaceHud();
}

function onPrompt(text: string | null): void {
  prompt.hidden = !text;
  if (text) prompt.replaceChildren(Object.assign(document.createElement("kbd"), { textContent: "E" }), text);
}

function vendorId(): string | undefined {
  return state.scene ? npcSpawns(state.scene).find((s) => s.behavior === "sell")?.npcId : undefined;
}

function onInteract(t: Target): void {
  if (dialogue) return;
  if (t.kind === "npc") return openDialogue(t.npc);
  if (t.kind === "exit") {
    const regionId = exitTarget(t.exit).regionId;
    if (regionId) net.send({ type: "action", action: { verb: "travel", params: { regionId } } });
    return;
  }
  const verb = t.it.verbs.find((v) => v !== "look") ?? "look";
  const params: Record<string, string> = { interactableId: t.it.id };
  if (verb === "buy") {
    if (t.it.itemId) params.itemId = t.it.itemId;
    const v = vendorId();
    if (v) params.npcId = v;
  }
  net.send({ type: "action", action: { verb, params } });
}

function renderDialogue(): void {
  dialogueLayer.set(dialogue ? layouts.dialogue(theme(), dialogue.npc, dialogue.lines, dialogue.intents, dialogue.waiting) : null, !!dialogue);
}

function openDialogue(npc: NPC): void {
  dialogue = { npc, lines: [], intents: [], waiting: true };
  if (view instanceof SurfaceView) view.talkingTo = npc.id;
  net.send({ type: "dialogue.start", npcId: npc.id });
  renderDialogue();
}

function closeDialogue(): void {
  dialogue = null;
  if (view instanceof SurfaceView) view.talkingTo = null;
  (document.activeElement as HTMLElement | null)?.blur?.();
  renderDialogue();
}

function dispatch(a: UiAction, input?: string): void {
  const params = a.params ?? {};
  switch (a.verb) {
    case "incarnate.request":
      omenLayer.set(null);
      net.send({ type: "incarnate", planetId: String(params.planetId), mode: params.mode === "born" ? "born" : "arrive" });
      return;
    case "reflect.continue":
      reflectionLayer.set(null);
      net.send({ type: "reflect.continue" });
      return;
    case "travel.request":
      if (view instanceof SpaceView) view.setAutopilot(String(params.planetId));
      return;
    case "dialogue.say":
      if (!dialogue || !input) return;
      dialogue.lines.push({ speaker: "player", text: input });
      dialogue.waiting = true;
      dialogue.intents = [];
      net.send({ type: "dialogue.say", npcId: String(params.npcId), text: input });
      renderDialogue();
      return;
    case "ui.close":
      closeDialogue();
      return;
    case "use":
      if (params.eventId) {
        net.send({ type: "event.choose", eventId: String(params.eventId), choiceId: String(params.choiceId) });
        eventLayer.set(null);
        return;
      }
  }
  net.send({ type: "action", action: { verb: a.verb, params } });
}

// ---------- server messages ----------
function onMessage(m: ServerMessage): void {
  switch (m.type) {
    case "welcome":
      state.player = m.player;
      state.system = m.system;
      state.llm = m.llm;
      viewKey = "";
      renderLlm();
      syncView();
      break;
    case "state": {
      const prevLives = state.player?.spirit.livesLived;
      state.player = m.player;
      syncView();
      if (m.player.spirit.livesLived !== prevLives && m.player.location.phase === "space") renderSpaceHud();
      break;
    }
    case "system":
      state.system = m.system;
      state.planet = state.civ = state.scene = null;
      state.npcs = [];
      syncView();
      break;
    case "planet.summary":
      if (state.system) state.system.planets = state.system.planets.map((p) => (p.id === m.planet.id ? m.planet : p));
      if (nearPlanet?.id === m.planet.id) onNear(m.planet);
      break;
    case "planet.detail":
      state.planet = m.planet;
      state.civ = m.civilization;
      break;
    case "scene":
      state.scene = m.scene;
      state.npcs = m.npcs;
      planetHud = m.ui;
      closeDialogue();
      viewKey = viewKey.startsWith("surface:") ? "" : viewKey;
      syncView();
      break;
    case "npc.say":
      if (dialogue && dialogue.npc.id === m.reply.npcId) {
        dialogue.lines.push({ speaker: "npc", text: m.reply.say });
        dialogue.intents = m.reply.intents;
        dialogue.waiting = false;
        renderDialogue();
        if (m.reply.intents.some((i) => i.type === "end_conversation")) setTimeout(closeDialogue, 1800);
      }
      break;
    case "event":
      eventLayer.set(layouts.event(theme(), m.event));
      break;
    case "toast":
      toast(m.text, m.tone);
      break;
    case "loading":
      loading.hidden = m.done;
      loading.textContent = m.what;
      break;
    case "death":
      closeDialogue();
      omenLayer.set(null);
      eventLayer.set(null);
      prompt.hidden = true;
      reflectionLayer.set(layouts.reflection(m.report));
      break;
    case "llm":
      state.llm = m.status;
      renderLlm();
      break;
    case "error":
      toast(m.message, "bad");
      break;
  }
  hudLayer.update();
}

function renderLlm(): void {
  const s = state.llm;
  if (!s) return;
  const dot = div(`dot ${s.busy ? "busy" : s.online ? "on" : ""}`);
  llmStatus.replaceChildren(dot, `${s.provider === "none" ? "procedural (no LLM)" : `${s.provider} · ${s.model}`}${s.provider !== "none" && !s.online ? " · offline" : ""}${s.busy ? " · thinking…" : ""}`);
}

const net = new Net(onMessage, (connected) => (offline.hidden = connected));
net.connect();

// ---------- global keys and timers ----------
addEventListener("keydown", (e) => {
  if (e.code === "Escape" && dialogue) return closeDialogue();
  if (document.activeElement instanceof HTMLInputElement) return;
  if (e.code === "Enter" && reflectionLayer.open) return dispatch({ verb: "reflect.continue" });
  if (nearPlanet && state.player?.location.phase === "space" && (e.code === "Digit1" || e.code === "Digit2"))
    dispatch({ verb: "incarnate.request", params: { planetId: nearPlanet.id, mode: e.code === "Digit1" ? "born" : "arrive" } });
});

setInterval(() => {
  if (net.connected && state.player?.location.phase === "space" && view instanceof SpaceView) net.send({ type: "space.tick", boosting: view.boosting });
}, 1000);

function resize(): void {
  renderer.setSize(innerWidth, innerHeight);
  labels.setSize(innerWidth, innerHeight);
  view?.resize(innerWidth, innerHeight);
}
addEventListener("resize", resize);
resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  if (!view) return;
  view.update(dt);
  view.render();
  labels.render(view.scene, view.camera);
});
