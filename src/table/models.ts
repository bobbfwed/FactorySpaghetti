// Loads the converted print models (public/models/*.glb) into plain geometry + material parts,
// ready to be drawn as InstancedMeshes. Each .glb holds one mesh primitive per colour, with a named
// material (body, inlay-black, icon-green, player, ...).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface ModelPart {
  readonly material: string;
  readonly geometry: THREE.BufferGeometry;
  readonly mat: THREE.MeshStandardMaterial;
}

export type ModelLib = ReadonlyMap<string, readonly ModelPart[]>;

export const MODEL_NAMES = [
  'tile-blank', 'tile-plate-factory', 'tile-sphere-factory', 'tile-tesseract-factory', 'tile-power-plant',
  'mine-1', 'mine-2', 'mine-3', 'belt', 'meeple', 'control-module', 'ore', 'plate', 'sphere', 'tesseract', 'teleporter',
] as const;

export async function loadModels(base: string, names: readonly string[] = MODEL_NAMES): Promise<ModelLib> {
  const loader = new GLTFLoader();
  const root = base.replace(/\/+$/, '');
  const entries = await Promise.all(names.map(async (name): Promise<[string, ModelPart[]]> => {
    const gltf = await loader.loadAsync(`${root}/${name}.glb`);
    gltf.scene.updateMatrixWorld(true);
    const parts: ModelPart[] = [];
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrixWorld); // identity for the converter's output, kept for safety
      geometry.computeBoundingSphere();
      const src = mesh.material as THREE.MeshStandardMaterial;
      const mat = src.clone();
      if (mat.name === 'player') mat.color.set(0xffffff); // tinted per instance with the owner's colour
      parts.push({ material: src.name, geometry, mat });
    });
    return [name, parts];
  }));
  return new Map(entries);
}

/**
 * Far level of detail: the same library with the heavy parts simplified (tile and mine bodies, the
 * belt), used when the camera is zoomed out far enough that the removed detail is under a pixel.
 * A finished board has ~97 tiles of 2,500 triangles and ~55 belts of 1,500; this keeps the
 * zoomed-out view inside the 300,000-triangle budget. Parts not listed share the near geometry.
 */
export async function farDetail(lib: ModelLib, keep: Readonly<Record<string, number>>): Promise<ModelLib> {
  const { SimplifyModifier } = await import('three/addons/modifiers/SimplifyModifier.js');
  const mod = new SimplifyModifier();
  const next = new Map<string, readonly ModelPart[]>();
  for (const [name, parts] of lib) {
    next.set(name, await Promise.all(parts.map(async (part): Promise<ModelPart> => {
      const ratio = keep[`${name}/${part.material}`] ?? keep[part.material];
      if (ratio === undefined) return part;
      const count = part.geometry.getAttribute('position').count;
      const geometry = await mod.modify(part.geometry, Math.floor(count * (1 - ratio)));
      geometry.computeBoundingSphere();
      return { ...part, geometry };
    })));
  }
  return next;
}

export function triangleCount(g: THREE.BufferGeometry): number {
  return (g.getIndex()?.count ?? g.getAttribute('position').count) / 3;
}

export function partsOf(lib: ModelLib, name: string): readonly ModelPart[] {
  const p = lib.get(name);
  if (!p) throw new Error(`model ${name} not loaded`);
  return p;
}
