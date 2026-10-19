// A holder's own Chog: the base Chog model's body, hands and feet with the
// head assembled from the trait parts file (models/characters/chog-traits.glb,
// tools/blender/chog_traits.py) the token's look calls for — the bare face or
// the skull, one eyes part (plus the laser beams), one mouth part — merged
// into the same few skinned meshes as any character (merged.ts). Skin, mane,
// lens and laser colours are the figure's materials (chogMaterials); the aura
// and the Radioactive glow are live effects (ChogAura.tsx, useCharacterMaterials).

import { Matrix4, Vector3, type Object3D } from 'three';
import type { ChogLook } from '../../../../shared/chogs/traits.ts';
import { RIG_BONES, collect, mergeChunks, newChunks, type CharacterModel } from './merged.ts';
import type { LookColors } from './parts.tsx';

type V3 = [number, number, number];
const ORIGIN = new Vector3();

/** Per traits-file scene, the merged models built so far, by their part combination. */
const cache = new WeakMap<Object3D, Map<string, CharacterModel>>();

/** The trait parts a look needs from the traits file, as node names. */
export function chogHeadParts(look: ChogLook, beams: boolean): string[] {
  const parts = [look.form === 'skull' ? 'chog_HeadSkull' : 'chog_HeadBare', `chog_Eyes_${look.eyes}`];
  if (look.eyes === 'laser' && beams) parts.push('chog_LaserBeams');
  if (look.mouth) parts.push(`chog_Mouth_${look.mouth}`);
  return parts;
}

/**
 * The merged model of a token: `base` is the loaded chog.glb scene, `traits`
 * the loaded chog-traits.glb scene. Built once per part combination and shared
 * by every figure of a token with the same parts (a figure's own colours live
 * in its materials, not here).
 */
export function chogTokenModel(base: Object3D, traits: Object3D, look: ChogLook, beams: boolean): CharacterModel {
  let models = cache.get(traits);
  if (!models) cache.set(traits, (models = new Map()));
  const parts = chogHeadParts(look, beams);
  const key = `${parts.join('|')}|${look.lids ? 'lids' : ''}`;
  let model = models.get(key);
  if (!model) models.set(key, (model = build(base, traits, parts, look.lids)));
  return model;
}

function build(base: Object3D, traits: Object3D, parts: string[], lids: boolean): CharacterModel {
  const bones = [...RIG_BONES];
  const chunks = newChunks();
  const hinges: CharacterModel['hinges'] = {};
  const place = new Matrix4();
  const add = (node: Object3D | undefined, bone: number) => {
    if (node) collect(node, place.compose(ORIGIN, node.quaternion, node.scale), bone, chunks);
  };
  bones.forEach((name, bone) => {
    if (name === 'Head') {
      for (const part of parts) add(traits.getObjectByName(part), bone);
      return;
    }
    const node = base.getObjectByName(`chog_${name}`);
    if (!node) return;
    if (name === 'LidL' || name === 'LidR') {
      // The base eyes' blinking lids only fit the base eye shape.
      const hinge = node.userData.hinge as V3 | undefined;
      if (!lids || !hinge) return;
      hinges[name] = hinge;
    }
    add(node, bone);
  });
  return { geos: mergeChunks(chunks), bones, hinges };
}

/** The colours a token puts on the character material set (over the base Chog's own). */
export function chogColors(look: ChogLook): LookColors {
  return { ...look.colors };
}
