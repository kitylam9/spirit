import type { ClientMessage, PlayerState, ServerSettings, SettingsInfo } from "@spirit/shared";
import { controls, menu, saveControls } from "../views/common.js";

type Difficulty = PlayerState["difficulty"];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

const row = (label: string, input: HTMLElement, hint = "") =>
  el("label", { className: "settings-row" }, el("span", {}, label), input, ...(hint ? [el("small", {}, hint)] : []));

function select<T extends string>(value: T, options: [T, string][]): HTMLSelectElement {
  const s = el("select");
  for (const [v, label] of options) s.append(el("option", { value: v, textContent: label, selected: v === value }));
  return s;
}

const number = (value: number, min: number, max: number, step: number) => el("input", { type: "number", value: String(value), min: String(min), max: String(max), step: String(step) });
const check = (checked: boolean, disabled = false) => el("input", { type: "checkbox", checked, disabled });

/** The gear menu: restart, look controls (browser) and server settings (until the server restarts). */
export class SettingsMenu {
  private host = el("div", { className: "ui-layout theme-spirit settings" });
  private button = el("button", { className: "settings-gear", title: "Settings (Esc)", textContent: "⚙" });

  constructor(
    parent: HTMLElement,
    private ctx: { send(m: ClientMessage): void; info(): SettingsInfo | null; difficulty(): Difficulty | undefined },
  ) {
    this.host.hidden = true;
    this.button.onclick = () => this.toggle();
    parent.append(this.button, this.host);
  }

  get open(): boolean {
    return menu.open;
  }

  toggle(): void {
    if (menu.open) this.close();
    else this.show();
  }

  close(): void {
    menu.open = false;
    this.host.hidden = true;
    this.host.replaceChildren();
  }

  show(): void {
    menu.open = true;
    this.host.hidden = false;
    this.ctx.send({ type: "settings.get" });
    this.render();
  }

  /** Re-renders with fresh server settings if the menu is open. */
  refresh(): void {
    if (menu.open) this.render();
  }

  private render(): void {
    const info = this.ctx.info();
    const panel = el("div", { className: "ui-panel anchor anchor-center w-md" }, el("div", { className: "ui-panel-title", textContent: "Settings" }));

    const restart = el("button", { className: "ui-button", textContent: "Restart in a new universe" });
    restart.onclick = () => {
      if (!confirm("End this life and start over in a new universe? Spirit Energy and lives lived are kept.")) return;
      this.ctx.send({ type: "restart" });
      this.close();
    };
    const difficulty = select<Difficulty>(this.ctx.difficulty() ?? "seeker", [
      ["wanderer", "Wanderer (gentle)"],
      ["seeker", "Seeker (normal)"],
      ["ascetic", "Ascetic (harsh)"],
    ]);
    panel.append(section("Game"), restart, row("Difficulty", difficulty));

    // Look controls apply at once and stay in this browser.
    const sens = el("input", { type: "range", min: "0.2", max: "3", step: "0.1", value: String(controls.sensitivity) });
    const dist = el("input", { type: "range", min: "0.6", max: "2", step: "0.1", value: String(controls.cameraDistance) });
    const invert = check(controls.invertY);
    const liveControls = () => {
      controls.sensitivity = Number(sens.value);
      controls.cameraDistance = Number(dist.value);
      controls.invertY = invert.checked;
      saveControls();
    };
    for (const i of [sens, dist, invert]) i.oninput = liveControls;
    panel.append(section("Controls"), row("Mouse sensitivity", sens), row("Camera distance", dist), row("Invert Y", invert));

    if (!info) {
      panel.append(el("div", { className: "ui-hint", textContent: "Loading server settings…" }), this.footer(null));
      this.host.replaceChildren(panel);
      return;
    }
    const s = info.settings;

    const provider = select(s.llm.provider, [
      ["openrouter", "OpenRouter"],
      ["ollama", "Ollama (local)"],
      ["llamacpp", "llama.cpp / LM Studio (local)"],
      ["openai", "OpenAI-compatible"],
      ["none", "None (procedural)"],
    ]);
    const model = el("input", { type: "text", value: s.llm.model, placeholder: info.defaultModels[s.llm.provider] });
    provider.onchange = () => {
      model.value = "";
      model.placeholder = info.defaultModels[provider.value as ServerSettings["llm"]["provider"]];
    };
    const jsonMode = select(s.llm.jsonMode, [
      ["", "Provider default"],
      ["schema", "JSON Schema"],
      ["object", "JSON object"],
      ["off", "Off (schema in prompt)"],
    ]);
    const concurrency = number(s.llm.maxConcurrency, 1, 8, 1);
    const timeout = number(Math.round(s.llm.timeoutMs / 1000), 10, 600, 10);
    panel.append(
      section("AI"),
      row("Provider", provider),
      row("Model", model, "Empty = provider default"),
      row("JSON mode", jsonMode),
      row("Parallel requests", concurrency),
      row("Timeout (s)", timeout),
      el("div", { className: "ui-hint", textContent: "API keys and server URLs stay in .env." }),
    );

    const cost = number(s.gameplay.descentCost, 0, 50, 1);
    const drain = number(s.gameplay.seDrain, 0, 5, 0.1);
    const loot = number(s.gameplay.objectsPerScene, 1, 24, 1);
    panel.append(section("Gameplay"), row("Descent cost (SE)", cost), row("Spirit Energy drain ×", drain), row("Objects per scene", loot, "New scenes only"));

    const a = s.assets;
    const ph = check(a.polyhaven);
    const sf = check(a.sketchfab && info.available.sketchfab, !info.available.sketchfab);
    const oxSf = check(a.objaverse.sketchfab);
    const oxSi = check(a.objaverse.smithsonian);
    const oxGh = check(a.objaverse.github && info.available.github, !info.available.github);
    const oxTv = check(a.objaverse.thingiverse && info.available.thingiverse, !info.available.thingiverse);
    panel.append(
      section("3D models"),
      row("Scene props: Poly Haven", ph),
      row("Scene props: Sketchfab", sf, info.available.sketchfab ? "" : "needs SKETCHFAB_API_TOKEN"),
      row("Body objects: Sketchfab", oxSf),
      row("Body objects: Smithsonian", oxSi),
      row("Body objects: GitHub", oxGh, info.available.github ? "" : "needs the objaverse index"),
      row("Body objects: Thingiverse", oxTv, info.available.thingiverse ? "" : "needs the index and THINGIVERSE_TOKEN"),
    );

    const settings = (): ServerSettings => ({
      llm: {
        provider: provider.value as ServerSettings["llm"]["provider"],
        model: model.value.trim(),
        jsonMode: jsonMode.value as ServerSettings["llm"]["jsonMode"],
        maxConcurrency: Number(concurrency.value),
        timeoutMs: Number(timeout.value) * 1000,
      },
      gameplay: { descentCost: Number(cost.value), seDrain: Number(drain.value), objectsPerScene: Number(loot.value) },
      assets: {
        polyhaven: ph.checked,
        sketchfab: sf.checked,
        objaverse: { sketchfab: oxSf.checked, smithsonian: oxSi.checked, github: oxGh.checked, thingiverse: oxTv.checked },
      },
    });
    panel.append(this.footer(() => this.ctx.send({ type: "settings.set", settings: settings(), difficulty: difficulty.value as Difficulty })));
    this.host.replaceChildren(panel);
  }

  private footer(save: (() => void) | null): HTMLElement {
    const close = el("button", { className: "ui-button c-muted", textContent: "Close" });
    close.onclick = () => this.close();
    const ok = el("button", { className: "ui-button", textContent: "Save", disabled: !save });
    ok.onclick = () => {
      save?.();
      this.close();
    };
    return el("div", { className: "settings-footer" }, close, ok);
  }
}

const section = (title: string) => el("div", { className: "settings-section", textContent: title });
