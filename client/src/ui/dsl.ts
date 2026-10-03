import type { UILayout } from "@spirit/shared";
import { get } from "../state.js";

type Node = UILayout["root"];
type Props = NonNullable<Node["props"]>;
export type UiAction = NonNullable<Props["action"]>;

export interface Rendered {
  el: HTMLElement;
  /** Re-reads every bound value; call after state changes. */
  update(): void;
}

const MAX_DEPTH = 6;
const MAX_NODES = 60;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function format(value: unknown, fmt: Props["format"]): string {
  if (value == null) return "–";
  if (typeof value !== "number") return String(value);
  switch (fmt) {
    case "int":
      return String(Math.round(value));
    case "percent":
      return `${Math.round(value)}%`;
    case "currency":
      return `${Math.round(value * 100) / 100} ${get("/world/currency")}`.trim();
    default:
      return String(Math.round(value * 10) / 10);
  }
}

/**
 * Renders a validated UI layout from the UI Generator agent. Only whitelisted components exist;
 * text is always set via textContent, so generated strings can never inject markup.
 */
export function renderLayout(layout: UILayout, dispatch: (a: UiAction, input?: string) => void): Rendered {
  const updaters: (() => void)[] = [];
  let count = 0;

  const node = (n: Node, depth: number): HTMLElement | null => {
    if (depth > MAX_DEPTH || ++count > MAX_NODES) return null;
    const p: Props = n.props ?? {};
    const kids = () => (n.children ?? []).map((c) => node(c, depth + 1)).filter((e): e is HTMLElement => !!e);
    switch (n.type) {
      case "Panel": {
        const el = h("div", `ui-panel w-${p.width ?? "sm"} v-${p.variant ?? "default"}${p.anchor ? ` anchor anchor-${p.anchor}` : ""}`);
        if (p.title) el.append(h("div", "ui-panel-title", p.title));
        el.append(...kids());
        return el;
      }
      case "Stack": {
        const el = h("div", `ui-stack dir-${p.direction ?? "column"} align-${p.align ?? "stretch"}`);
        el.style.gap = `${p.gap ?? 8}px`;
        el.append(...kids());
        return el;
      }
      case "Text": {
        const el = h("div", `ui-text t-${p.style ?? "body"}`, p.text ?? "");
        if (p.bind) updaters.push(() => (el.textContent = format(get(p.bind!), p.format)));
        return el;
      }
      case "Dialog": {
        const el = h("div", "ui-dialog");
        if (p.title) el.append(h("div", "ui-dialog-speaker", p.title));
        el.append(h("div", "ui-dialog-text", p.text ?? ""));
        return el;
      }
      case "Stat": {
        const el = h("div", "ui-stat");
        const value = h("span", "ui-stat-value");
        el.append(h("span", "ui-stat-label", p.label ?? ""), value);
        if (p.bind) updaters.push(() => (value.textContent = format(get(p.bind!), p.format)));
        return el;
      }
      case "Bar": {
        const el = h("div", `ui-bar c-${p.color ?? "accent"}`);
        const fill = h("div", "ui-bar-fill");
        const value = h("span", "ui-bar-value");
        const track = h("div", "ui-bar-track");
        track.append(fill);
        el.append(h("span", "ui-bar-label", p.label ?? ""), value, track);
        const max = p.max ?? 100;
        if (p.bind)
          updaters.push(() => {
            const v = Number(get(p.bind!) ?? 0);
            fill.style.width = `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
            value.textContent = String(Math.round(v));
            el.classList.toggle("warn", p.warnBelow !== undefined && v < p.warnBelow);
          });
        return el;
      }
      case "Button": {
        const el = h("button", `ui-button c-${p.color ?? "accent"}`, p.label ?? "");
        if (p.hotkey) el.append(h("kbd", "", p.hotkey));
        if (p.action) el.onclick = () => dispatch(p.action!);
        return el;
      }
      case "Choice": {
        const el = h("div", "ui-choice");
        for (const o of p.options ?? []) {
          const b = h("button", "ui-button ui-choice-option", o.label);
          if (o.hint) b.append(h("span", "ui-hint", o.hint));
          b.disabled = !!o.disabled;
          b.onclick = () => dispatch(o.action);
          el.append(b);
        }
        return el;
      }
      case "TextInput": {
        const el = h("form", "ui-input");
        const input = h("input", "");
        input.placeholder = p.placeholder ?? "";
        input.maxLength = 300;
        el.append(input, h("button", "ui-button", p.label ?? "Say"));
        el.onsubmit = (e) => {
          e.preventDefault();
          const text = input.value.trim();
          if (!text || !p.action) return;
          input.value = "";
          dispatch(p.action, text);
        };
        return el;
      }
      case "Inventory": {
        const el = h("div", "ui-inventory");
        el.style.gridTemplateColumns = `repeat(${p.columns ?? 4}, 1fr)`;
        if (p.bind)
          updaters.push(() => {
            const items = (get(p.bind!) as { itemId: string; name: string; qty: number }[] | undefined) ?? [];
            const sig = items.map((i) => `${i.itemId}:${i.qty}`).join(",");
            if (el.dataset.sig === sig) return;
            el.dataset.sig = sig;
            el.replaceChildren(
              ...items.map((i) => {
                const b = h("button", "ui-item", i.name);
                b.title = `${i.name} — click to eat`;
                b.append(h("span", "ui-item-qty", `×${i.qty}`));
                b.onclick = () => dispatch({ verb: "eat", params: { itemId: i.itemId } });
                return b;
              }),
            );
            if (!items.length) el.append(h("div", "ui-text t-whisper", "Empty-handed."));
          });
        return el;
      }
      case "Divider":
        return h("hr", "ui-divider");
      default:
        return null;
    }
  };

  const root = h("div", `ui-layout theme-${layout.theme} screen-${layout.screen}`);
  if (layout.accentOverride && /^#[0-9a-f]{6}$/i.test(layout.accentOverride)) root.style.setProperty("--accent", layout.accentOverride);
  const tree = node(layout.root, 0);
  if (tree) root.append(tree);
  const update = () => updaters.forEach((u) => u());
  update();
  return { el: root, update };
}
