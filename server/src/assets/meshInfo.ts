export type MeshFormat = "glb" | "stl" | "obj";

/** The client wires Draco and meshopt decoders into GLTFLoader, but no KTX2 transcoder. */
const UNSUPPORTED = new Set(["KHR_texture_basisu"]);

/** Triangle count read from the file itself; throws when the file is not a usable mesh. */
export function triangleCount(bytes: Uint8Array, format: MeshFormat): number {
  if (format === "glb") return glbTriangles(bytes);
  if (format === "stl") return stlTriangles(bytes);
  return objTriangles(new TextDecoder().decode(bytes));
}

function glbTriangles(bytes: Uint8Array): number {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB");
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + dv.getUint32(12, true)))) as {
    extensionsRequired?: string[];
    accessors?: { count: number }[];
    meshes?: { primitives: { mode?: number; indices?: number; attributes: { POSITION?: number } }[] }[];
  };
  const blocked = (json.extensionsRequired ?? []).filter((e) => UNSUPPORTED.has(e));
  if (blocked.length) throw new Error(`needs ${blocked.join(", ")}`);
  let tris = 0;
  for (const mesh of json.meshes ?? []) {
    for (const p of mesh.primitives) {
      const count = json.accessors?.[p.indices ?? p.attributes.POSITION ?? -1]?.count ?? 0;
      const mode = p.mode ?? 4;
      if (mode === 4) tris += Math.floor(count / 3);
      else if (mode === 5 || mode === 6) tris += Math.max(0, count - 2);
    }
  }
  return tris;
}

function stlTriangles(bytes: Uint8Array): number {
  if (bytes.byteLength >= 84) {
    const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
    if (84 + n * 50 === bytes.byteLength) return n;
  }
  return new TextDecoder().decode(bytes).match(/facet\s+normal/g)?.length ?? 0;
}

function objTriangles(text: string): number {
  let tris = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("f ")) tris += Math.max(0, line.trim().split(/\s+/).length - 3);
  }
  return tris;
}
