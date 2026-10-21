// A character model (models/characters/<id>.glb) folded into a handful of
// draw calls. The file has one node per rig part (body, head, hands, feet,
// eyelids, signature garments), each split into a primitive per material:
// some 25 meshes a figure. Here every part is merged into one skinned mesh per
// material group, rigidly bound to a bone that rides on the rig group the part
// used to hang from, so the rig animates it exactly as before:
//
//   main  - the player's colour (its own material, tinted per player)
//   skin  - skin (its own material)
//   cloth - clothes (their own material)
//   atlas - every other material (hair, ink, white, denim, metal, gold, glow, c1–c3, outfit accents…)
//           as one material whose colour, roughness, metalness and glow come from a
//           tiny per-figure texture, one texel per material key
//   paint - a token Chog's hat and outfit (material `paint`), coloured by its own
//           painted texture through the parts' UVs (chogPaint.ts)
//
// The merged geometry is built once per loaded file and shared by every figure
// of that character; each figure gets its own bones, skeleton and atlas
// material (which follows the figure's materials, so jail grey and the
// bankrupt fade still apply).

import {
  Bone, BufferAttribute, BufferGeometry, Color, DataTexture, Matrix3, Matrix4, MeshStandardMaterial, NearestFilter,
  NoColorSpace, RGBAFormat, SRGBColorSpace, Skeleton, SkinnedMesh, Vector3,
  type Material, type Mesh, type Object3D,
} from 'three';
import type { MatKey, Mats } from './parts.tsx';

type V3 = [number, number, number];

/** Rig parts with a bone of their own, in bone order; garments follow. */
export const RIG_BONES = ['Body', 'Head', 'HandL', 'HandR', 'FootL', 'FootR', 'LidL', 'LidR'] as const;
export type RigBone = (typeof RIG_BONES)[number];

type Group = 'main' | 'skin' | 'cloth' | 'atlas' | 'paint';
const OWN: Partial<Record<MatKey, Group>> = { main: 'main', skin: 'skin', cloth: 'cloth' };
/** Materials drawn from the atlas, one texel each. */
const ATLAS_KEYS: MatKey[] = [
  'accent', 'white', 'ink', 'metal', 'gold', 'glow', 'glass', 'wood', 'hair', 'denim', 'c1', 'c2', 'c3',
  'red', 'pink', 'purple', 'leaf', 'sky',
];
const ATLAS_W = 32;

/** Merged geometry, one per material group present. */
export type MergedGeos = { group: Group; geo: BufferGeometry }[];

export interface CharacterModel {
  geos: MergedGeos;
  /** Bone names (RIG_BONES, then garment node names like 'Top'), indexing the geometry's skinIndex. */
  bones: string[];
  /** Eyelid hinges (head space) for the characters that blink. */
  hinges: Partial<Record<'LidL' | 'LidR', V3>>;
}

/** The material key a part was exported with (`<id>:<key>`); 'paint' is a token Chog's textured hat and outfit. */
const keyOf = (m: Material): MatKey | 'paint' => (m.name.split(':')[1] ?? 'main') as MatKey | 'paint';
const groupOf = (k: MatKey | 'paint'): Group => (k === 'paint' ? 'paint' : OWN[k] ?? (ATLAS_KEYS.includes(k) ? 'atlas' : 'main'));

const models = new WeakMap<Object3D, Map<string, CharacterModel>>();
const ORIGIN = new Vector3();
const tmpM = new Matrix4();

/**
 * The merged model of character `cid` in a loaded scene (built once per scene and mane).
 * `mane`: for a character whose mane is a node of its own (the Chog's `chog_Hair_<mane>`), which cut of it
 * the head wears (the whole one, 'full', unless an outfit hat calls for a cut-down one: Outfit.tsx).
 */
export function characterModel(scene: Object3D, cid: string, garments: string[], mane = 'full'): CharacterModel {
  let byMane = models.get(scene);
  if (!byMane) models.set(scene, (byMane = new Map()));
  let model = byMane.get(mane);
  if (!model) byMane.set(mane, (model = build(scene, cid, garments, mane)));
  return model;
}

interface Chunk { geo: BufferGeometry; rel: Matrix4; bone: number; texel: number }
export type Chunks = Record<Group, Chunk[]>;
export const newChunks = (): Chunks => ({ main: [], skin: [], cloth: [], atlas: [], paint: [] });

/**
 * Add the meshes under `node` to `chunks`, bound to `bone`, in the node's own
 * frame (its parent's transforms dropped) placed by `place`. The exporters
 * write one primitive (mesh) per material, so each mesh has one material.
 */
export function collect(node: Object3D, place: Matrix4, bone: number, chunks: Chunks) {
  node.updateWorldMatrix(true, true);
  const inv = new Matrix4().multiplyMatrices(place, tmpM.copy(node.matrixWorld).invert());
  node.traverse(o => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const k = keyOf(Array.isArray(m.material) ? m.material[0] : m.material);
    const rel = new Matrix4().multiplyMatrices(inv, m.matrixWorld);
    chunks[groupOf(k)].push({ geo: m.geometry, rel, bone, texel: Math.max(0, ATLAS_KEYS.indexOf(k as MatKey)) });
  });
}

/** One geometry per material group that has any chunks. */
export function mergeChunks(chunks: Chunks): MergedGeos {
  return (Object.keys(chunks) as Group[])
    .filter(g => chunks[g].length)
    .map(group => ({ group, geo: merge(chunks[group], group === 'atlas' ? 'texel' : group === 'paint' ? 'own' : null) }));
}

function build(scene: Object3D, cid: string, garments: string[], mane: string): CharacterModel {
  const bones = [...RIG_BONES, ...garments];
  const chunks = newChunks();
  const hinges: CharacterModel['hinges'] = {};
  const place = new Matrix4();
  bones.forEach((name, bone) => {
    const node = scene.getObjectByName(`${cid}_${name}`);
    if (!node) return;
    if (name === 'LidL' || name === 'LidR') {
      const hinge = node.userData.hinge as V3 | undefined;
      if (!hinge) return;
      hinges[name] = hinge;
    }
    // Part-local space: the node as if moved to the origin (the bone supplies its rig pivot).
    collect(node, place.compose(ORIGIN, node.quaternion, node.scale), bone, chunks);
    // A mane of its own rides the head (head space, like the head node).
    const hair = name === 'Head' ? scene.getObjectByName(`${cid}_Hair_${mane}`) ?? scene.getObjectByName(`${cid}_Hair_full`) : undefined;
    if (hair) collect(hair, place.compose(ORIGIN, hair.quaternion, hair.scale), bone, chunks);
  });
  return { geos: mergeChunks(chunks), bones, hinges };
}

const vP = new Vector3();
const nm = new Matrix3();

/** Concatenate chunks into one geometry: position, normal, skinIndex/skinWeight (rigid), uv (the atlas texel, or the parts' own). */
function merge(chunks: Chunk[], uvs: 'texel' | 'own' | null): BufferGeometry {
  let nv = 0, ni = 0;
  for (const c of chunks) {
    nv += c.geo.attributes.position.count;
    ni += c.geo.index ? c.geo.index.count : c.geo.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const si = new Uint8Array(nv * 4);
  const sw = new Uint8Array(nv * 4);
  const uv = uvs ? new Float32Array(nv * 2) : null;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v0 = 0, i0 = 0;
  for (const c of chunks) {
    const p = c.geo.attributes.position, n = c.geo.attributes.normal, t = c.geo.attributes.uv;
    nm.getNormalMatrix(c.rel);
    const u = (c.texel + 0.5) / ATLAS_W;
    for (let i = 0; i < p.count; i++) {
      const o = (v0 + i) * 3;
      vP.fromBufferAttribute(p, i).applyMatrix4(c.rel);
      pos[o] = vP.x; pos[o + 1] = vP.y; pos[o + 2] = vP.z;
      if (n) {
        vP.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
        nor[o] = vP.x; nor[o + 1] = vP.y; nor[o + 2] = vP.z;
      }
      si[(v0 + i) * 4] = c.bone;
      sw[(v0 + i) * 4] = 255;
      if (uv && uvs === 'own') { uv[(v0 + i) * 2] = t ? t.getX(i) : 0; uv[(v0 + i) * 2 + 1] = t ? t.getY(i) : 0; }
      else if (uv) { uv[(v0 + i) * 2] = u; uv[(v0 + i) * 2 + 1] = 0.5; }
    }
    const index = c.geo.index;
    const count = index ? index.count : p.count;
    for (let i = 0; i < count; i++) idx[i0 + i] = v0 + (index ? index.getX(i) : i);
    v0 += p.count;
    i0 += count;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('skinIndex', new BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new BufferAttribute(sw, 4, true));
  if (uv) g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(new BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * A skeleton whose bones are plain objects hung on the rig. A bone that is
 * hidden (or under a hidden group: a garment not worn, an open eyelid)
 * collapses its part to a point, so it draws nothing.
 */
class RigSkeleton extends Skeleton {
  update() {
    const out = this.boneMatrices;
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i];
      let shown = true;
      for (let o: Object3D | null = b; o; o = o.parent) if (!o.visible) { shown = false; break; }
      const e = b.matrixWorld.elements;
      const k = i * 16;
      for (let j = 0; j < 16; j++) out[k + j] = shown || j >= 12 ? e[j] : 0;
    }
    if (this.boneTexture) this.boneTexture.needsUpdate = true;
  }
}

const IDENTITY = new Matrix4();
const tmp = new Color();

/** The atlas material: one texel of colour, roughness/metalness and glow per material key, following the figure's materials. */
class Atlas {
  readonly material: MeshStandardMaterial;
  private color: DataTexture;
  private seen = ATLAS_KEYS.map(() => new Color(-1, -1, -1));
  constructor(private mats: Mats) {
    const tex = (srgb: boolean) => {
      const t = new DataTexture(new Uint8Array(ATLAS_W * 4), ATLAS_W, 1, RGBAFormat);
      t.magFilter = t.minFilter = NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
      return t;
    };
    this.color = tex(true);
    const pbr = tex(false), glow = tex(true);
    ATLAS_KEYS.forEach((k, i) => {
      const m = mats[k];
      // glTF packing: roughness in green, metalness in blue.
      pbr.image.data.set([0, Math.round(m.roughness * 255), Math.round(m.metalness * 255), 255], i * 4);
      m.emissive.getRGB(tmp, SRGBColorSpace);
      const s = m.emissiveIntensity / 1.4;
      glow.image.data.set([tmp.r, tmp.g, tmp.b].map(v => Math.min(255, Math.round(v * s * 255))).concat(255), i * 4);
    });
    pbr.needsUpdate = glow.needsUpdate = true;
    this.material = new MeshStandardMaterial({
      name: 'atlas', map: this.color, roughnessMap: pbr, metalnessMap: pbr, roughness: 1, metalness: 1,
      emissiveMap: glow, emissive: '#ffffff', emissiveIntensity: 1.4,
    });
    this.sync();
  }
  /** Pick up colour (jail grey) and opacity (bankrupt fade) changes from the figure's materials. */
  sync() {
    let dirty = false;
    const data = this.color.image.data as Uint8Array;
    ATLAS_KEYS.forEach((k, i) => {
      const c = this.mats[k].color;
      if (c.equals(this.seen[i])) return;
      this.seen[i].copy(c);
      c.getRGB(tmp, SRGBColorSpace);
      data.set([Math.round(tmp.r * 255), Math.round(tmp.g * 255), Math.round(tmp.b * 255), 255], i * 4);
      dirty = true;
    });
    if (dirty) this.color.needsUpdate = true;
    const ref = this.mats.white, m = this.material;
    if (m.transparent !== ref.transparent) { m.transparent = ref.transparent; m.needsUpdate = true; }
    m.opacity = ref.opacity;
    m.depthWrite = ref.depthWrite;
  }
  dispose() {
    this.material.map?.dispose();
    this.material.roughnessMap?.dispose();
    this.material.emissiveMap?.dispose();
    this.material.dispose();
  }
}

export interface SkinnedSet {
  meshes: SkinnedMesh[];
  /** One per bone name: hang each on the rig group its part follows. */
  bones: Record<string, Bone>;
  /** Frees the skeleton and atlas (not the geometry, which may be shared). */
  dispose(): void;
}

/**
 * A figure of `model` in this figure's materials: its meshes, and bones to hang on the rig.
 * `paint` is the material of a token Chog's painted hat and outfit (chogPaint.ts).
 */
export const figureMeshes = (model: CharacterModel, mats: Mats, paint?: MeshStandardMaterial | null): SkinnedSet =>
  skinnedSet(model.geos, model.bones, mats, paint);

/** A textured material follows the figure's white: jail grey (its colour) and the bankrupt fade (its opacity). */
function followWhite(m: MeshStandardMaterial, mats: Mats) {
  const ref = mats.white;
  if (!m.color.equals(ref.color)) m.color.copy(ref.color);
  if (m.transparent !== ref.transparent) { m.transparent = ref.transparent; m.needsUpdate = true; }
  m.opacity = ref.opacity;
  m.depthWrite = ref.depthWrite;
}

/** Skinned meshes for merged geometry in a figure's materials, with a bone per name (skinIndex order). */
export function skinnedSet(geos: MergedGeos, names: string[], mats: Mats, paint?: MeshStandardMaterial | null): SkinnedSet {
  const bones = names.map(name => Object.assign(new Bone(), { name }));
  const skeleton = new RigSkeleton(bones, bones.map(() => new Matrix4()));
  const atlas = geos.some(g => g.group === 'atlas') ? new Atlas(mats) : null;
  const meshes = geos.map(({ group, geo }) => {
    const material = group === 'atlas' && atlas ? atlas.material : group === 'paint' ? paint ?? mats.white : mats[group as MatKey];
    const mesh = new SkinnedMesh(geo, material);
    mesh.bind(skeleton, IDENTITY);
    // Bones move the parts anywhere around the figure; the mesh's own bounds would cull them wrongly.
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    if (group === 'atlas' && atlas) mesh.onBeforeRender = () => atlas.sync();
    if (group === 'paint' && paint) mesh.onBeforeRender = () => followWhite(paint, mats);
    return mesh;
  });
  return {
    meshes,
    bones: Object.fromEntries(bones.map(b => [b.name, b])),
    dispose() {
      skeleton.dispose();
      atlas?.dispose();
    },
  };
}
