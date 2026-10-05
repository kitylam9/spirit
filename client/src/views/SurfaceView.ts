import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AssetManifest, NPC, Scene } from "@spirit/shared";
import { exitTarget, npcSpawns } from "@spirit/shared";
import { Input, disposeScene, fbm, makeLabel, rngFrom, valueNoise, type View } from "./common.js";

type Instance = Scene["instances"][number];
type Interactable = NonNullable<Scene["interactables"]>[number];
type Exit = Scene["exits"][number];

export type Target =
  | { kind: "npc"; npc: NPC; label: string }
  | { kind: "interactable"; it: Interactable; label: string }
  | { kind: "exit"; exit: Exit; label: string };

const MATERIAL_COLORS: [string, string][] = [
  ["grass", "#5d8a3a"], ["sand", "#d8c08a"], ["snow", "#eef3f8"], ["ice", "#cfe6f5"], ["mud", "#5a4a32"], ["basalt", "#3a3634"],
  ["asphalt", "#3c3f45"], ["metal-grate", "#5a606a"], ["ash", "#6e6a66"], ["crystal", "#9fd8ff"], ["fieldstone", "#8f8a7e"],
  ["leaves", "#3f7a34"], ["pine", "#2f5a34"], ["fire", "#ff7a1a"], ["neon", "#19d3ff"], ["polymer", "#d8dde6"],
  ["thatch", "#b89a5a"], ["timber", "#7a5232"], ["wood", "#8a5a32"], ["brick", "#9a4e3a"], ["clay", "#b0704a"], ["mud-brick", "#a0764e"],
  ["marble", "#e8e4dc"], ["concrete", "#9a9a96"], ["glass", "#9fc6d8"], ["steel", "#7c848e"], ["iron", "#4a4a4e"], ["metal", "#8a9098"],
  ["bone", "#e6dcc4"], ["hide", "#8a6a48"], ["stone", "#8d8a84"], ["rock", "#7a7670"], ["carbon", "#2a2c30"], ["chrome", "#c8ccd4"],
];

function materialColor(keyword: string | undefined, fallback = "#888888"): string {
  const k = (keyword ?? "").toLowerCase();
  for (const [name, color] of MATERIAL_COLORS) if (k.includes(name)) return color;
  if (!k) return fallback;
  let h = 0;
  for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `#${new THREE.Color().setHSL((h % 360) / 360, 0.18, 0.5).getHexString()}`;
}

function windowTexture(lit: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1a1c22";
  g.fillRect(0, 0, 64, 64);
  const rnd = rngFrom(lit);
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      g.fillStyle = rnd() < 0.55 ? lit : "#2a2e38";
      g.fillRect(x * 16 + 4, y * 16 + 4, 8, 9);
    }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Collider { x: number; z: number; r: number }
interface NpcBody { npc: NPC; group: THREE.Group; home: THREE.Vector3; target: THREE.Vector3; wait: number; wanders: boolean }

const PLAYER_SPEED = 4.5;
const RUN = 1.8;
const HALF = 48;

export class SurfaceView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 20000);
  private input: Input;
  private height: (x: number, z: number) => number = () => 0;
  private colliders: Collider[] = [];
  private player = new THREE.Group();
  private npcs: NpcBody[] = [];
  private flickers: { light: THREE.PointLight; base: number; phase: number }[] = [];
  private camYaw = Math.PI;
  private camPitch = 0.35;
  private target: Target | null = null;
  private time = 0;
  private loader = new GLTFLoader();
  private models = new Map<string, Promise<THREE.Object3D>>();
  /** Placeholder groups per instance id (several when the instance is scattered). */
  private placed = new Map<string, THREE.Group[]>();
  private disposed = false;
  talkingTo: string | null = null;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private data: Scene,
    npcs: NPC[],
    assets: AssetManifest[],
    start: [number, number, number] | undefined,
    private events: { onPrompt(text: string | null): void; onInteract(t: Target): void },
  ) {
    renderer.toneMappingExposure = 0.6;
    this.input = new Input(renderer.domElement, (code) => {
      if (code === "KeyE" && this.target) this.events.onInteract(this.target);
    });
    const env = data.environment;
    const tier = Number(data.tier.slice(1));
    const night = env.lighting.sun.elevation < 0;

    // Terrain: flat center for the settlement, hills toward the edges.
    if (env.terrain.kind === "heightmap") {
      const noise = valueNoise(env.terrain.seed ?? data.id);
      const amp = env.terrain.amplitude ?? 2;
      this.height = (x, z) => {
        const r = Math.hypot(x, z);
        const ramp = Math.min(1, Math.max(0, (r - 14) / 26));
        return (fbm(noise, x / 22 + 50, z / 22 + 50, 4) - 0.35) * amp * 2.2 * ramp * ramp + ramp * amp;
      };
    }
    const tg = new THREE.PlaneGeometry(240, 240, 160, 160);
    tg.rotateX(-Math.PI / 2);
    const pos = tg.getAttribute("position") as THREE.BufferAttribute;
    const groundBase = new THREE.Color(materialColor(env.terrain.material, "#6a7a4a"));
    const colors = new Float32Array(pos.count * 3);
    const tint = valueNoise(`${data.id}:tint`);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, this.height(x, z));
      const c = groundBase.clone().multiplyScalar(0.82 + tint(x / 6, z / 6) * 0.3);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    tg.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    tg.computeVertexNormals();
    const ground = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Sky, fog and light.
    const sun = env.lighting.sun;
    const sunDir = new THREE.Vector3(Math.cos(sun.elevation) * Math.sin(sun.azimuth), Math.sin(sun.elevation), Math.cos(sun.elevation) * Math.cos(sun.azimuth));
    const sky = new Sky();
    sky.scale.setScalar(10000);
    const u = sky.material.uniforms;
    u.turbidity.value = env.weather === "fog" || env.weather === "cloudy" ? 12 : 5;
    u.rayleigh.value = night ? 0.15 : 1.6;
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.8;
    u.sunPosition.value.copy(sunDir);
    this.scene.add(sky);
    if (night) {
      const rnd = rngFrom(`${data.id}:stars`);
      const sp = new Float32Array(2500 * 3);
      for (let i = 0; i < 2500; i++) {
        const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 0.9 + 0.1, rnd() * 2 - 1).normalize().multiplyScalar(4000);
        sp.set([v.x, v.y, v.z], i * 3);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
      this.scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: false, color: "#ffffff", fog: false })));
    }
    if (env.fog) this.scene.fog = new THREE.FogExp2(env.fog.color, env.fog.density * (night ? 1.6 : 1));
    const dl = new THREE.DirectionalLight(sun.color, night ? 0.35 : sun.intensity * 1.2);
    dl.position.copy(sunDir.clone().setY(Math.max(0.25, sunDir.y)).multiplyScalar(80));
    dl.castShadow = !!sun.castShadows;
    dl.shadow.mapSize.set(2048, 2048);
    Object.assign(dl.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 250 });
    dl.shadow.bias = -0.0005;
    this.scene.add(dl);
    this.scene.add(new THREE.HemisphereLight(env.lighting.ambient.color, groundBase, env.lighting.ambient.intensity * 1.6));
    for (const pl of (env.lighting.pointLights ?? []).slice(0, 12)) {
      const light = new THREE.PointLight(pl.color, pl.intensity * 6, pl.range * 1.5, 1.6);
      light.position.set(pl.position[0], this.height(pl.position[0], pl.position[2]) + pl.position[1], pl.position[2]);
      this.scene.add(light);
      if (pl.flicker) this.flickers.push({ light, base: light.intensity, phase: Math.random() * 10 });
    }

    // Props.
    const lit = tier >= 6 ? "#ff7ad9" : tier >= 5 ? "#bfefff" : "#ffd98a";
    const windows = tier >= 4 ? windowTexture(lit) : null;
    for (const inst of data.instances) this.addInstance(inst, tier, night, windows);
    for (const m of assets) this.applyAsset(m, data.instances.filter((i) => i.assetRef === m.id).map((i) => i.id));

    // Exits: glowing rings with a beam.
    for (const exit of data.exits) {
      const [x, , z] = exit.position;
      const y = this.height(x, z);
      const r = exit.radius ?? 3;
      const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.8, r, 48), new THREE.MeshBasicMaterial({ color: "#b8a4ff", transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, y + 0.05, z);
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.8, r * 0.8, 14, 32, 1, true),
        new THREE.MeshBasicMaterial({ color: "#b8a4ff", transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      beam.position.set(x, y + 7, z);
      const label = makeLabel({ title: exit.label, sub: exitTarget(exit).pending ? "unexplored" : undefined });
      label.position.set(x, y + 4, z);
      this.scene.add(ring, beam, label);
    }

    // People.
    const byId = new Map(npcs.map((n) => [n.id, n]));
    for (const sp of npcSpawns(data)) {
      const npc = sp.npcId ? byId.get(sp.npcId) : undefined;
      if (!npc) continue;
      const group = this.person(npc.id, false);
      const home = new THREE.Vector3(sp.position[0], 0, sp.position[2]);
      home.y = this.height(home.x, home.z);
      group.position.copy(home);
      group.rotation.y = Math.atan2(-home.x, -home.z);
      const label = makeLabel({ title: npc.name, sub: npc.role });
      label.position.set(0, 2.2, 0);
      group.add(label);
      this.scene.add(group);
      this.npcs.push({ npc, group, home, target: home.clone(), wait: Math.random() * 4, wanders: sp.behavior === "wander" || sp.behavior === "work" });
    }

    // The player: a person with a faint spirit light inside.
    this.player = this.person("player", true);
    const p0 = start ?? (data.spawnPoints[0].position as [number, number, number]);
    this.player.position.set(p0[0], this.height(p0[0], p0[2]), p0[2]);
    this.scene.add(this.player);
    this.camYaw = Math.atan2(this.player.position.x, this.player.position.z);
  }

  private person(id: string, isPlayer: boolean): THREE.Group {
    const rnd = rngFrom(id);
    const g = new THREE.Group();
    const cloth = isPlayer ? new THREE.Color("#d8d2ff") : new THREE.Color().setHSL(rnd(), 0.35, 0.35 + rnd() * 0.25);
    const skin = new THREE.Color().setHSL(0.07, 0.4, 0.3 + rnd() * 0.45);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.9, 4, 12), new THREE.MeshStandardMaterial({ color: cloth, roughness: 0.8 }));
    body.position.y = 0.8;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 }));
    head.position.y = 1.55;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.1), head.material);
    nose.position.set(0, 1.55, -0.22);
    for (const m of [body, head]) m.castShadow = true;
    g.add(body, head, nose);
    if (isPlayer) {
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: "#ffffff" }));
      core.position.set(0, 1.05, -0.3);
      const light = new THREE.PointLight("#b8a4ff", 2, 4, 2);
      light.position.set(0, 1.1, -0.4);
      g.add(core, light);
    }
    return g;
  }

  private addInstance(inst: Instance, tier: number, night: boolean, windows: THREE.CanvasTexture | null): void {
    const proc = inst.procedural;
    if (!proc) return;
    const rnd = rngFrom(inst.id);
    const [sx, sy, sz] = (proc.size ?? [1, 1, 1]) as [number, number, number];
    const color = proc.color ?? materialColor(proc.material);
    const std = (c: string | THREE.Color, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...extra });
    const count = Math.max(1, inst.count ?? 1);

    for (let n = 0; n < count; n++) {
      const g = new THREE.Group();
      let radius = Math.max(sx, sz) * 0.5;
      const scale = count > 1 ? 0.7 + rnd() * 0.6 : (inst.transform.scale ?? 1);
      switch (proc.kind) {
        case "building-block": {
          let map: THREE.Texture | undefined;
          if (windows) {
            map = windows.clone();
            map.repeat.set(Math.max(1, Math.round(sx / 3)), Math.max(1, Math.round(sy / 3)));
          }
          const bodyMat = map ? std(color, { map, emissive: night ? "#ffffff" : "#000000", emissiveIntensity: 0.8 }) : std(color);
          if (windows && night) bodyMat.emissiveMap = bodyMat.map;
          const body = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), bodyMat);
          body.position.y = sy / 2;
          g.add(body);
          if (tier <= 3) {
            const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(sx, sz) * 0.78, sy * 0.55, 4), std(tier <= 1 ? "#a08850" : "#7a3a2a"));
            roof.position.y = sy + sy * 0.27;
            roof.rotation.y = Math.PI / 4;
            roof.scale.set(sx / Math.max(sx, sz), 1, sz / Math.max(sx, sz));
            g.add(roof);
          }
          const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.1, 0.1), std("#2a1e14"));
          door.position.set(0, 1.05, sz / 2 + 0.05);
          g.add(door);
          radius = Math.max(sx, sz) * 0.62;
          break;
        }
        case "tree": {
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * sx * 0.3, 0.28 * sx * 0.3, sy * 0.45, 8), std("#5a3e26"));
          trunk.position.y = sy * 0.22;
          g.add(trunk);
          if (proc.material === "pine") {
            for (let k = 0; k < 3; k++) {
              const cone = new THREE.Mesh(new THREE.ConeGeometry(sx * (0.5 - k * 0.12), sy * 0.4, 8), std(color));
              cone.position.y = sy * (0.42 + k * 0.2);
              g.add(cone);
            }
          } else {
            const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(sx * 0.5, 1), std(new THREE.Color(color).offsetHSL(0, 0, (rnd() - 0.5) * 0.1), { flatShading: true }));
            crown.position.y = sy * 0.62;
            crown.scale.y = 1.2;
            g.add(crown);
          }
          radius = 0.5;
          break;
        }
        case "rock": {
          const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), std(color, { flatShading: true, emissive: proc.material === "crystal" ? color : "#000", emissiveIntensity: 0.3 }));
          rock.scale.set(sx, sy, sz);
          rock.position.y = sy * 0.3;
          rock.rotation.set(rnd(), rnd() * 6, rnd());
          g.add(rock);
          break;
        }
        case "stall": {
          const wood = std(materialColor(proc.material, "#8a5a32"));
          const counter = new THREE.Mesh(new THREE.BoxGeometry(sx, 1, sz * 0.5), wood);
          counter.position.set(0, 0.5, sz * 0.25);
          const canopy = new THREE.Mesh(new THREE.BoxGeometry(sx * 1.1, 0.08, sz * 1.1), std(color));
          canopy.position.y = sy;
          canopy.rotation.x = 0.12;
          g.add(counter, canopy);
          for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, sy, 6), wood);
            post.position.set((px * sx) / 2.1, sy / 2, (pz * sz) / 2.1);
            g.add(post);
          }
          break;
        }
        case "lamp": {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, sy, 8), std(materialColor(proc.material, "#333")));
          pole.position.y = sy / 2;
          const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2) }));
          bulb.position.y = sy;
          g.add(pole, bulb);
          radius = 0.3;
          break;
        }
        case "crate": {
          const box = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), std(materialColor(proc.material, "#8a5a32")));
          box.position.y = sy / 2;
          box.rotation.y = rnd() * 6;
          g.add(box);
          radius = 0;
          break;
        }
        case "fence": {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, Math.max(0.08, sz)), std(color));
          rail.position.y = sy / 2;
          g.add(rail);
          radius = 0;
          break;
        }
        default: {
          const emissive = proc.material === "fire" || proc.material === "neon";
          const geo =
            proc.kind === "cylinder" ? new THREE.CylinderGeometry(sx / 2, sx / 2, sy, 20)
            : proc.kind === "sphere" ? new THREE.SphereGeometry(sx / 2, 20, 14)
            : proc.kind === "cone" ? new THREE.ConeGeometry(sx / 2, sy, 16)
            : proc.kind === "capsule" ? new THREE.CapsuleGeometry(sx / 2, Math.max(0.01, sy - sx), 4, 12)
            : proc.kind === "plane" ? new THREE.BoxGeometry(sx, 0.05, sz)
            : new THREE.BoxGeometry(sx, sy, sz);
          const mesh = new THREE.Mesh(geo, emissive ? new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.5) }) : std(color));
          mesh.position.y = proc.kind === "plane" ? 0.03 : sy / 2;
          g.add(mesh);
        }
      }

      let [x, , z] = inst.transform.position;
      if (count > 1) {
        const a = rnd() * Math.PI * 2;
        const d = Math.sqrt(rnd()) * (inst.scatterRadius ?? 3);
        x += Math.cos(a) * d;
        z += Math.sin(a) * d;
      }
      if (Math.abs(x) > HALF + 20 || Math.abs(z) > HALF + 20) continue;
      g.scale.setScalar(scale);
      g.position.set(x, this.height(x, z), z);
      g.rotation.y = count > 1 ? rnd() * Math.PI * 2 : (inst.transform.rotationY ?? 0);
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      g.userData.instanceId = inst.id;
      this.scene.add(g);
      this.placed.set(inst.id, [...(this.placed.get(inst.id) ?? []), g]);
      if (radius > 0) this.colliders.push({ x, z, r: radius * scale });
      if (n === 0 && /^inst-(building-[01]|food-stall|focal)$/.test(inst.id)) {
        const label = makeLabel({ title: inst.label ?? "" });
        label.position.set(x, this.height(x, z) + sy * (inst.id.startsWith("inst-building") && tier <= 3 ? 1.7 : 1.15) + 0.6, z);
        this.scene.add(label);
      }
    }
  }

  /**
   * Swaps the placeholders of `instanceIds` for the model. It is scaled to the placeholder's
   * height, with its footprint capped so buildings keep their spacing.
   */
  applyAsset(m: AssetManifest, instanceIds: string[]): void {
    const url = m.files.primary.url;
    let model = this.models.get(url);
    if (!model) {
      model = this.loader.loadAsync(url).then((gltf) => gltf.scene);
      this.models.set(url, model);
    }
    model
      .then((src) => {
        if (this.disposed) return;
        const box = new THREE.Box3().setFromObject(src);
        const size = box.getSize(new THREE.Vector3()).max(new THREE.Vector3(1e-3, 1e-3, 1e-3));
        const center = box.getCenter(new THREE.Vector3());
        for (const id of instanceIds) {
          const inst = this.data.instances.find((i) => i.id === id);
          const [sx, sy, sz] = (inst?.procedural?.size ?? inst?.assetRequest?.expectedSize ?? [1, 1, 1]) as number[];
          const footprint = Math.max(sx, sz) * 1.5 + 1;
          const s = Math.min(sy / size.y, footprint / Math.max(size.x, size.z));
          for (const g of this.placed.get(id) ?? []) {
            // Model geometry is shared with the cached source; only placeholder meshes are disposed.
            if (!g.userData.hasModel)
              g.traverse((o) => {
                const mesh = o as THREE.Mesh;
                mesh.geometry?.dispose();
                if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((mat) => mat.dispose());
              });
            g.userData.hasModel = true;
            const copy = src.clone();
            copy.position.set(-center.x, -box.min.y, -center.z);
            const fitted = new THREE.Group().add(copy);
            fitted.scale.setScalar(s);
            fitted.traverse((o) => {
              if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
            });
            g.clear();
            g.add(fitted);
          }
        }
      })
      .catch((err) => console.warn(`[assets] could not load ${m.id}:`, err));
  }

  private instancePos(id: string): THREE.Vector3 | null {
    const inst = this.data.instances.find((i) => i.id === id);
    if (!inst) return null;
    const [x, , z] = inst.transform.position;
    return new THREE.Vector3(x, this.height(x, z), z);
  }

  private findTarget(): Target | null {
    const p = this.player.position;
    let best: Target | null = null;
    let bestScore = Infinity;
    const consider = (t: Target, dist: number, reach: number) => {
      if (dist < reach && dist - reach < bestScore) {
        bestScore = dist - reach;
        best = t;
      }
    };
    for (const n of this.npcs) consider({ kind: "npc", npc: n.npc, label: `Talk to ${n.npc.name}` }, n.group.position.distanceTo(p), 2.6);
    for (const it of this.data.interactables ?? []) {
      const pos = this.instancePos(it.instanceId);
      const inst = this.data.instances.find((i) => i.id === it.instanceId);
      if (!pos || !inst) continue;
      const size = (inst.procedural?.size ?? [1, 1, 1]) as number[];
      consider({ kind: "interactable", it, label: it.label }, Math.hypot(pos.x - p.x, pos.z - p.z), Math.max(size[0], size[2]) * 0.62 + 2);
    }
    for (const exit of this.data.exits) {
      consider({ kind: "exit", exit, label: exit.label }, Math.hypot(exit.position[0] - p.x, exit.position[2] - p.z), (exit.radius ?? 3) + 0.5);
    }
    return best;
  }

  update(dt: number): void {
    this.time += dt;
    const [dx, dy] = this.input.takeDrag();
    this.camYaw -= dx * 0.005;
    this.camPitch = Math.max(0.05, Math.min(1.2, this.camPitch + dy * 0.004));
    const i = this.input;
    const f = (i.down("KeyW", "ArrowUp") ? 1 : 0) - (i.down("KeyS", "ArrowDown") ? 1 : 0);
    const s = (i.down("KeyD", "ArrowRight") ? 1 : 0) - (i.down("KeyA", "ArrowLeft") ? 1 : 0);
    if (i.down("KeyQ")) this.camYaw += dt * 1.8;
    if (i.down("KeyR")) this.camYaw -= dt * 1.8;
    const fwd = new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const move = fwd.multiplyScalar(f).add(right.multiplyScalar(s));
    const p = this.player.position;
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(PLAYER_SPEED * (i.down("ShiftLeft", "ShiftRight") ? RUN : 1) * dt);
      p.add(move);
      this.player.rotation.y = Math.atan2(-move.x, -move.z);
      if (this.talkingTo) this.talkingTo = null;
    }
    for (const c of this.colliders) {
      const ddx = p.x - c.x, ddz = p.z - c.z;
      const d = Math.hypot(ddx, ddz);
      if (d < c.r + 0.35 && d > 1e-4) {
        p.x = c.x + (ddx / d) * (c.r + 0.35);
        p.z = c.z + (ddz / d) * (c.r + 0.35);
      }
    }
    p.x = Math.max(-HALF, Math.min(HALF, p.x));
    p.z = Math.max(-HALF, Math.min(HALF, p.z));
    p.y = this.height(p.x, p.z);

    // NPCs wander near home; whoever you talk to stops and faces you.
    for (const n of this.npcs) {
      const g = n.group;
      if (this.talkingTo === n.npc.id) {
        g.rotation.y = Math.atan2(-(p.x - g.position.x), -(p.z - g.position.z));
        continue;
      }
      if (!n.wanders) continue;
      n.wait -= dt;
      const to = n.target.clone().sub(g.position).setY(0);
      if (to.length() > 0.2) {
        to.setLength(Math.min(to.length(), 1.1 * dt));
        g.position.add(to);
        g.position.y = this.height(g.position.x, g.position.z);
        g.rotation.y = Math.atan2(-to.x, -to.z);
      } else if (n.wait <= 0) {
        n.wait = 3 + Math.random() * 5;
        n.target.set(n.home.x + (Math.random() - 0.5) * 7, 0, n.home.z + (Math.random() - 0.5) * 7);
      }
    }
    for (const fl of this.flickers) fl.light.intensity = fl.base * (0.8 + Math.sin(this.time * 13 + fl.phase) * 0.1 + Math.sin(this.time * 7.3 + fl.phase) * 0.1);

    const t = this.findTarget();
    if (t?.label !== this.target?.label) this.events.onPrompt(t ? t.label : null);
    this.target = t;

    const dist = 7;
    const cam = new THREE.Vector3(
      p.x + Math.sin(this.camYaw) * Math.cos(this.camPitch) * dist,
      p.y + 1.6 + Math.sin(this.camPitch) * dist,
      p.z + Math.cos(this.camYaw) * Math.cos(this.camPitch) * dist,
    );
    cam.y = Math.max(cam.y, this.height(cam.x, cam.z) + 0.5);
    this.camera.position.lerp(cam, Math.min(1, dt * 10));
    this.camera.lookAt(p.x, p.y + 1.5, p.z);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    this.input.dispose();
    disposeScene(this.scene);
    this.events.onPrompt(null);
  }
}
