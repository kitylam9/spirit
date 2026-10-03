import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { PlanetSummary, StarSystemSummary } from "@spirit/shared";
import { TIER_NAMES } from "../state.js";
import { Input, disposeScene, fbm, glowTexture, makeLabel, rngFrom, valueNoise, type View } from "./common.js";

const SPEED = 55;
const BOOST = 3;
const NEAR = 45;
const TRAIL = 90;

const atmosphereMaterial = (color: THREE.Color) =>
  new THREE.ShaderMaterial({
    uniforms: { color: { value: color } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 color; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - max(dot(vN, vV), 0.0), 2.5); gl_FragColor = vec4(color * 1.6, f); }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

function planetTextures(p: PlanetSummary): { map: THREE.Texture; emissive: THREE.Texture | null } {
  const w = 512, h = 256;
  const noise = valueNoise(p.seed);
  const rnd = rngFrom(`${p.seed}:lights`);
  const cols = p.palette.map((c) => new THREE.Color(c));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = (y / h) * 4 + Math.sin((x / w) * Math.PI * 2) * 0.5;
      const u = x / w;
      const n = fbm(noise, u * 8, v, 5) * (1 - u) + fbm(noise, (u - 1) * 8, v, 5) * u;
      const band = Math.min(cols.length - 1, Math.floor(n * cols.length * 1.15));
      const c = cols[band].clone().lerp(cols[(band + 1) % cols.length], (n * cols.length) % 1 * 0.4);
      const polar = Math.abs(y / h - 0.5) * 2;
      if (polar > 0.86) c.lerp(new THREE.Color("#f4f8ff"), 0.8);
      const i = (y * w + x) * 4;
      img.data[i] = c.r * 255;
      img.data[i + 1] = c.g * 255;
      img.data[i + 2] = c.b * 255;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;

  const tier = Number(p.tier.slice(1));
  if (tier < 3) return { map, emissive: null };
  const lw = w * 2, lh = h * 2;
  const lc = document.createElement("canvas");
  lc.width = lw;
  lc.height = lh;
  const lg = lc.getContext("2d")!;
  lg.fillStyle = "#000";
  lg.fillRect(0, 0, lw, lh);
  lg.fillStyle = tier >= 6 ? "#ff5ad0" : tier >= 5 ? "#9fe7ff" : "#ffd27a";
  // Lights cluster in a few "cities" instead of uniform noise.
  for (let c = 0; c < tier * 6; c++) {
    const cx = rnd() * lw, cy = lh * 0.2 + rnd() * lh * 0.6, spread = 10 + rnd() * 40;
    for (let i = 0; i < 40 + tier * 12; i++) lg.fillRect(cx + (rnd() - 0.5) * spread * 2, cy + (rnd() - 0.5) * spread, 1.5, 1.5);
  }
  const emissive = new THREE.CanvasTexture(lc);
  emissive.colorSpace = THREE.SRGBColorSpace;
  return { map, emissive };
}

export class SpaceView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.5, 12000);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private input: Input;
  private spirit = new THREE.Group();
  private velocity = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private planets: { summary: PlanetSummary; mesh: THREE.Mesh }[] = [];
  private trail: THREE.Line;
  private trailPoints: THREE.Vector3[] = [];
  private near: PlanetSummary | null = null;
  autopilot: string | null = null;
  boosting = false;

  constructor(
    private renderer: THREE.WebGLRenderer,
    system: StarSystemSummary,
    private events: { onNear(p: PlanetSummary | null): void; onAutopilot(planetId: string | null): void },
  ) {
    this.scene.background = new THREE.Color("#02030a");
    renderer.toneMappingExposure = 1;
    this.input = new Input(renderer.domElement);

    // Stars.
    const rnd = rngFrom(system.seed);
    const starPos = new Float32Array(6000 * 3);
    const starCol = new Float32Array(6000 * 3);
    for (let i = 0; i < 6000; i++) {
      const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize().multiplyScalar(5000 + rnd() * 3000);
      starPos.set([v.x, v.y, v.z], i * 3);
      const c = new THREE.Color().setHSL(0.55 + rnd() * 0.2, 0.4, 0.6 + rnd() * 0.4);
      starCol.set([c.r, c.g, c.b], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    sg.setAttribute("color", new THREE.BufferAttribute(starCol, 3));
    this.scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true })));

    // Sun.
    const sunColor = new THREE.Color(system.starColor);
    const sun = new THREE.Mesh(new THREE.SphereGeometry(40, 48, 24), new THREE.MeshBasicMaterial({ color: sunColor.clone().multiplyScalar(3) }));
    this.scene.add(sun);
    const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: sunColor, blending: THREE.AdditiveBlending, depthWrite: false }));
    sunGlow.scale.setScalar(260);
    this.scene.add(sunGlow);
    this.scene.add(new THREE.PointLight(sunColor, 3, 0, 0));
    this.scene.add(new THREE.AmbientLight("#334", 0.6));

    // Planets.
    for (const p of system.planets) {
      const { map, emissive } = planetTextures(p);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(p.radius, 64, 32),
        new THREE.MeshStandardMaterial({ map, emissiveMap: emissive, emissive: emissive ? new THREE.Color("#ffffff") : new THREE.Color("#000"), emissiveIntensity: 0.9, roughness: 0.85 }),
      );
      mesh.position.set(...p.position);
      mesh.rotation.z = 0.3;
      const atmo = new THREE.Mesh(new THREE.SphereGeometry(p.radius * 1.12, 48, 24), atmosphereMaterial(new THREE.Color(p.palette[2] ?? p.palette[0])));
      mesh.add(atmo);
      if (p.hasRings) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(p.radius * 1.4, p.radius * 2.1, 96),
          new THREE.MeshBasicMaterial({ color: p.palette[1] ?? "#ccc", side: THREE.DoubleSide, transparent: true, opacity: 0.45 }),
        );
        ring.rotation.x = Math.PI / 2.3;
        mesh.add(ring);
      }
      const label = makeLabel({ title: p.name, sub: TIER_NAMES[p.tier] }, "planet");
      label.position.set(0, p.radius * 1.35, 0);
      label.element.onclick = () => this.setAutopilot(p.id);
      mesh.add(label);
      this.scene.add(mesh);
      this.planets.push({ summary: p, mesh });
    }

    // The spirit: a point of light with a glow and a trail.
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.45, 24, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.8, 2.2) }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: "#8090c0", blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(4);
    this.spirit.add(core, glow, new THREE.PointLight("#cfd8ff", 4, 60, 1.5));
    this.scene.add(this.spirit);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    const tc = new Float32Array(TRAIL * 3);
    for (let i = 0; i < TRAIL; i++) tc.set([0.7 * (1 - i / TRAIL), 0.8 * (1 - i / TRAIL), 1 - i / TRAIL], i * 3);
    tg.setAttribute("color", new THREE.BufferAttribute(tc, 3));
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending }));
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);

    // Start between the sun and the nearest world, facing it.
    const first = [...system.planets].sort((a, b) => new THREE.Vector3(...a.position).length() - new THREE.Vector3(...b.position).length())[0];
    const target = new THREE.Vector3(...first.position);
    this.spirit.position.copy(target.clone().normalize().multiplyScalar(110)).setY(20);
    const dir = target.clone().sub(this.spirit.position).normalize();
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = Math.asin(dir.y);
    for (let i = 0; i < TRAIL; i++) this.trailPoints.push(this.spirit.position.clone());

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 1.0, 0.6, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setAutopilot(planetId: string | null): void {
    this.autopilot = planetId;
    this.events.onAutopilot(planetId);
  }

  private forward(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  update(dt: number): void {
    const [dx, dy] = this.input.takeDrag();
    this.yaw -= dx * 0.004;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - dy * 0.004));
    const fwd = this.forward();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const i = this.input;
    const move = new THREE.Vector3()
      .addScaledVector(fwd, (i.down("KeyW", "ArrowUp") ? 1 : 0) - (i.down("KeyS", "ArrowDown") ? 1 : 0))
      .addScaledVector(right, (i.down("KeyD", "ArrowRight") ? 1 : 0) - (i.down("KeyA", "ArrowLeft") ? 1 : 0))
      .addScaledVector(new THREE.Vector3(0, 1, 0), (i.down("Space") ? 1 : 0) - (i.down("KeyC", "ControlLeft") ? 1 : 0));
    this.boosting = i.down("ShiftLeft", "ShiftRight") && move.lengthSq() > 0;
    if (move.lengthSq() > 0 && this.autopilot) this.setAutopilot(null);

    let desired = move.lengthSq() > 0 ? move.normalize().multiplyScalar(SPEED * (this.boosting ? BOOST : 1)) : new THREE.Vector3();
    if (this.autopilot) {
      const p = this.planets.find((x) => x.summary.id === this.autopilot);
      if (p) {
        const to = p.mesh.position.clone().sub(this.spirit.position);
        const dist = to.length() - p.summary.radius;
        if (dist < NEAR * 0.6) this.setAutopilot(null);
        else {
          const dir = to.normalize();
          desired = dir.clone().multiplyScalar(SPEED * Math.min(1.6, 0.4 + dist / 200));
          const tYaw = Math.atan2(-dir.x, -dir.z);
          const dYaw = Math.atan2(Math.sin(tYaw - this.yaw), Math.cos(tYaw - this.yaw));
          this.yaw += dYaw * Math.min(1, dt * 2);
          this.pitch += (Math.asin(dir.y) - this.pitch) * Math.min(1, dt * 2);
        }
      }
    }
    this.velocity.lerp(desired, Math.min(1, dt * 3));
    this.spirit.position.addScaledVector(this.velocity, dt);

    // Do not fly into planets or the sun.
    let nearest: PlanetSummary | null = null;
    let nearestDist = Infinity;
    for (const p of this.planets) {
      p.mesh.rotation.y += dt * 0.03;
      const d = this.spirit.position.distanceTo(p.mesh.position) - p.summary.radius;
      if (d < 4) this.spirit.position.sub(p.mesh.position).setLength(p.summary.radius + 4).add(p.mesh.position);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = p.summary;
      }
    }
    if (this.spirit.position.length() < 48) this.spirit.position.setLength(48);
    const nowNear = nearestDist < NEAR ? nearest : null;
    if (nowNear?.id !== this.near?.id) {
      this.near = nowNear;
      this.events.onNear(nowNear);
    }

    // Trail and chase camera.
    this.trailPoints.unshift(this.spirit.position.clone());
    this.trailPoints.length = TRAIL;
    const attr = this.trail.geometry.getAttribute("position") as THREE.BufferAttribute;
    this.trailPoints.forEach((pt, k) => attr.setXYZ(k, pt.x, pt.y, pt.z));
    attr.needsUpdate = true;
    const camTarget = this.spirit.position.clone().addScaledVector(fwd, -14).add(new THREE.Vector3(0, 4, 0));
    this.camera.position.lerp(camTarget, Math.min(1, dt * 6));
    this.camera.lookAt(this.spirit.position.clone().addScaledVector(fwd, 12));
  }

  render(): void {
    this.composer.render();
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
  }

  dispose(): void {
    this.input.dispose();
    this.composer.dispose();
    disposeScene(this.scene);
  }
}
