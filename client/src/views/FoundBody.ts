import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { AssetManifest, FoundObject, PlayerState } from "@spirit/shared";
import { rngFrom } from "./common.js";

/** Found-object loading and body assembly (docs/09-found-bodies.md §2). */
export type Body = NonNullable<NonNullable<PlayerState["incarnation"]>["body"]>;
type Part = Body["core"];

const draco = new DRACOLoader().setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
const gltfLoader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
const stlLoader = new STLLoader();
const objLoader = new OBJLoader();
const cache = new Map<string, Promise<THREE.Object3D>>();

/** Untextured formats (STL, OBJ) get a color from the planet palette, picked per object. */
function tintFor(id: string, palette: string[]): THREE.Color {
  const c = new THREE.Color(palette.length ? palette[Math.floor(rngFrom(id)() * palette.length)] : "#b08d57");
  return c.offsetHSL(0, 0.05, 0.08);
}

async function loadModel(m: AssetManifest, tint: THREE.Color): Promise<THREE.Object3D> {
  const url = m.files.primary.url;
  const mat = () => new THREE.MeshStandardMaterial({ color: tint, roughness: 0.55, metalness: 0.15 });
  if (m.files.primary.mime === "model/stl") {
    const geo = await stlLoader.loadAsync(url);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat());
    mesh.rotation.x = -Math.PI / 2; // 3D-printing files are Z-up
    return new THREE.Group().add(mesh);
  }
  if (m.files.primary.mime === "model/obj") {
    const group = await objLoader.loadAsync(url);
    group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = mat();
    });
    return group;
  }
  return (await gltfLoader.loadAsync(url)).scene;
}

function proceduralModel(p: NonNullable<FoundObject["procedural"]>): THREE.Object3D {
  const geo =
    p.shape === "sphere" ? new THREE.SphereGeometry(0.5, 20, 14)
    : p.shape === "cylinder" ? new THREE.CylinderGeometry(0.3, 0.3, 1, 20)
    : p.shape === "cone" ? new THREE.ConeGeometry(0.4, 1, 16)
    : p.shape === "torus" ? new THREE.TorusGeometry(0.4, 0.14, 12, 28)
    : new THREE.BoxGeometry(0.9, 0.7, 0.8);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.6, metalness: 0.2 }));
}

/** Centered on its bounding box, largest side 1 m. */
function normalize(src: THREE.Object3D): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(src);
  const size = box.getSize(new THREE.Vector3());
  const wrap = new THREE.Group();
  src.position.sub(box.getCenter(new THREE.Vector3()));
  wrap.add(src);
  wrap.scale.setScalar(1 / Math.max(size.x, size.y, size.z, 1e-4));
  wrap.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
  });
  return new THREE.Group().add(wrap);
}

/** A fresh copy of the object, normalized to a 1 m cube (geometry is shared with a cache). */
export function loadFound(o: FoundObject, assets: Map<string, AssetManifest>, palette: string[]): Promise<THREE.Object3D> {
  let p = cache.get(o.id);
  if (!p) {
    const m = o.assetRef ? assets.get(o.assetRef) : undefined;
    p = (o.procedural ? Promise.resolve(proceduralModel(o.procedural)) : m ? loadModel(m, tintFor(o.id, palette)) : Promise.reject(new Error(`no model for ${o.id}`))).then(normalize);
    p.catch(() => cache.delete(o.id));
    cache.set(o.id, p);
  }
  return p.then((src) => src.clone());
}

/** Largest side in meters for each use of an object. */
export function objectSize(o: FoundObject | undefined, role: "core" | "part" | "loose"): number {
  const s = o?.suggestedSize ?? 0.6;
  return role === "core" ? THREE.MathUtils.clamp(s, 0.6, 1.8) : role === "part" ? THREE.MathUtils.clamp(s, 0.2, 1.5) : THREE.MathUtils.clamp(s, 0.3, 1.5);
}

/** Sets an object's transform from a body part; `size` is its largest side before the part's scale. */
export function placePart(mesh: THREE.Object3D, part: Pick<Part, "position" | "rotation" | "scale">, size: number): void {
  mesh.position.fromArray(part.position);
  mesh.rotation.set(part.rotation[0], part.rotation[1], part.rotation[2]);
  mesh.scale.setScalar(size * part.scale);
}

/**
 * The player's found body: `root` sits at the player's feet, `frame` is the core's frame
 * (part positions are relative to it) and is raised so the lowest point touches the ground.
 */
export class BodyAssembly {
  readonly root = new THREE.Group();
  readonly frame = new THREE.Group();
  height = 1;
  private key = "";
  private version = 0;

  constructor() {
    this.root.add(this.frame);
  }

  async set(body: Body, objects: Map<string, FoundObject>, assets: Map<string, AssetManifest>, palette: string[]): Promise<void> {
    const key = JSON.stringify(body);
    // A leftover placement preview (rejected pickup) also forces a rebuild.
    if (key === this.key && this.frame.children.length === 1 + body.parts.length) return;
    this.key = key;
    const version = ++this.version;
    const parts = [{ part: body.core, role: "core" as const }, ...body.parts.map((part) => ({ part, role: "part" as const }))];
    const meshes = await Promise.all(
      parts.map(async ({ part, role }) => {
        const o = objects.get(part.objectId);
        const mesh = o ? await loadFound(o, assets, palette).catch(() => missing()) : missing();
        placePart(mesh, part, objectSize(o, role));
        mesh.userData.partId = part.partId;
        return mesh;
      }),
    );
    if (version !== this.version) return;
    this.frame.clear();
    this.frame.add(...meshes);
    this.ground();
  }

  /** Raises the frame so the body stands on the ground; call after adding or moving parts. */
  ground(): void {
    this.frame.position.y = 0;
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.frame);
    if (box.isEmpty()) return;
    const base = this.root.getWorldPosition(new THREE.Vector3()).y;
    this.frame.position.y = base - box.min.y;
    this.height = box.max.y - box.min.y;
  }

  /** Meshes of the attached parts (for raycasting new attachment points). */
  meshes(except?: THREE.Object3D): THREE.Object3D[] {
    return this.frame.children.filter((c) => c !== except);
  }
}

function missing(): THREE.Object3D {
  return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: "#777", wireframe: true }));
}
