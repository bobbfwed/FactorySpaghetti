// Minimal .glb reader (no Three.js, no DOM): returns the vertex positions of each mesh primitive
// with its material name. Used by the tests to measure the models; the browser loads models with
// Three's GLTFLoader instead. Handles what tools/convert-3mf.mjs writes: float32 positions,
// interleaved or not, node transforms ignored (the converter writes none).

export interface GlbPart {
  readonly material: string;
  readonly positions: Float32Array; // x, y, z triples
  /** Triangle vertex indices, when the primitive has them (unsigned byte, short or int). */
  readonly indices?: Uint32Array;
}

interface GltfJson {
  meshes?: Array<{ primitives: Array<{ attributes: Record<string, number>; material?: number; indices?: number }> }>;
  accessors?: Array<{ bufferView?: number; byteOffset?: number; count: number; componentType: number; type: string }>;
  bufferViews?: Array<{ byteOffset?: number; byteLength: number; byteStride?: number }>;
  materials?: Array<{ name?: string }>;
}

export function parseGlb(bytes: Uint8Array): GlbPart[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('not a glb file');
  const jsonLen = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen))) as GltfJson;
  const binStart = 20 + jsonLen + 8;
  const parts: GlbPart[] = [];
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives) {
      const accIndex = prim.attributes['POSITION'];
      if (accIndex === undefined) continue;
      const acc = json.accessors![accIndex]!;
      if (acc.componentType !== 5126 || acc.type !== 'VEC3') throw new Error('unexpected position format');
      const bv = json.bufferViews![acc.bufferView!]!;
      const stride = bv.byteStride ?? 12;
      const base = binStart + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      const positions = new Float32Array(acc.count * 3);
      for (let i = 0; i < acc.count; i++) {
        for (let k = 0; k < 3; k++) positions[i * 3 + k] = view.getFloat32(base + i * stride + k * 4, true);
      }
      const material = prim.material !== undefined ? (json.materials?.[prim.material]?.name ?? '') : '';
      let indices: Uint32Array | undefined;
      if (prim.indices !== undefined) {
        const ia = json.accessors![prim.indices]!;
        const ibv = json.bufferViews![ia.bufferView!]!;
        const size = ia.componentType === 5125 ? 4 : ia.componentType === 5123 ? 2 : 1;
        const at = binStart + (ibv.byteOffset ?? 0) + (ia.byteOffset ?? 0);
        indices = new Uint32Array(ia.count);
        for (let i = 0; i < ia.count; i++) {
          indices[i] = size === 4 ? view.getUint32(at + i * 4, true) : size === 2 ? view.getUint16(at + i * 2, true) : view.getUint8(at + i);
        }
      }
      parts.push(indices ? { material, positions, indices } : { material, positions });
    }
  }
  return parts;
}
