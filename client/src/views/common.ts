import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

export interface View {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  update(dt: number): void;
  render(): void;
  resize(w: number, h: number): void;
  dispose(): void;
}

/** Small deterministic RNG so a seed always produces the same scenery. */
export function rngFrom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2D value noise with smooth interpolation, in [0, 1]. */
export function valueNoise(seed: string): (x: number, y: number) => number {
  const rnd = rngFrom(seed);
  const perm = Array.from({ length: 512 }, () => rnd());
  const at = (x: number, y: number) => perm[(((x * 73856093) ^ (y * 19349663)) >>> 0) % 512];
  const s = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = s(x - xi), yf = s(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

export function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves = 4): number {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    v += noise(x * f, y * f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return v / norm;
}

export function makeLabel(html: { title: string; sub?: string }, cls = ""): CSS2DObject {
  const el = document.createElement("div");
  el.className = `label ${cls}`;
  const t = document.createElement("div");
  t.textContent = html.title;
  el.append(t);
  if (html.sub) {
    const s = document.createElement("div");
    s.className = "sub";
    s.textContent = html.sub;
    el.append(s);
  }
  return new CSS2DObject(el);
}

/** Removes CSS2D labels (their DOM elements are only removed on 'removed') and frees GPU resources. */
export function disposeScene(scene: THREE.Scene): void {
  const labels: CSS2DObject[] = [];
  scene.traverse((o) => {
    if (o instanceof CSS2DObject) labels.push(o);
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
  });
  for (const l of labels) l.removeFromParent();
}

export function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export const isTyping = () => {
  const a = document.activeElement;
  return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement;
};

/** Keyboard and mouse-drag look input, scoped to one view. */
export class Input {
  keys = new Set<string>();
  dragX = 0;
  dragY = 0;
  private dragging = false;
  private handlers: [EventTarget, string, EventListener][] = [];

  constructor(private canvas: HTMLElement, private onKey?: (code: string) => void) {
    this.on(window, "keydown", (e) => {
      const k = e as KeyboardEvent;
      if (isTyping()) return;
      this.keys.add(k.code);
      if (!k.repeat) this.onKey?.(k.code);
    });
    this.on(window, "keyup", (e) => this.keys.delete((e as KeyboardEvent).code));
    this.on(window, "blur", () => this.keys.clear());
    this.on(canvas, "pointerdown", (e) => {
      this.dragging = true;
      canvas.setPointerCapture((e as PointerEvent).pointerId);
      (document.activeElement as HTMLElement | null)?.blur?.();
    });
    this.on(canvas, "pointerup", () => (this.dragging = false));
    this.on(canvas, "pointermove", (e) => {
      if (!this.dragging) return;
      this.dragX += (e as PointerEvent).movementX;
      this.dragY += (e as PointerEvent).movementY;
    });
  }

  private on(t: EventTarget, type: string, fn: EventListener): void {
    t.addEventListener(type, fn);
    this.handlers.push([t, type, fn]);
  }

  down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  takeDrag(): [number, number] {
    const d: [number, number] = [this.dragX, this.dragY];
    this.dragX = this.dragY = 0;
    return d;
  }

  dispose(): void {
    for (const [t, type, fn] of this.handlers) t.removeEventListener(type, fn);
  }
}
