// A holder's own Chog: the base Chog model's body, hands and feet with the
// parts its traits call for from the trait parts file
// (models/characters/chog-traits.glb, tools/blender/chog_traits.py and
// chog_wear.py): on the head the bare face or the skull, its mane (cut back
// under a hat), one eyes part (plus the laser beams), one mouth part and its
// hat; on the body its outfit; in the right hand what it holds — merged into
// the same few skinned meshes as any character (merged.ts). Skin, mane, lens
// and laser colours are the figure's materials (chogMaterials); the hat and
// outfit are painted on a texture of its own (chogPaint.ts); the aura and the
// Radioactive glow are live effects (ChogAura.tsx, useCharacterMaterials).

import { Matrix4, Vector3, type Object3D } from 'three';
import { chogParts, type ChogLook } from '../../../../shared/chogs/traits.ts';
import { RIG_BONES, collect, mergeChunks, newChunks, type CharacterModel } from './merged.ts';
import type { LookColors } from './parts.tsx';

type V3 = [number, number, number];
const ORIGIN = new Vector3();

/** Per traits-file scene, the merged models built so far, by their part combination. */
const cache = new WeakMap<Object3D, Map<string, CharacterModel>>();

/**
 * The merged model of a token: `base` is the loaded chog.glb scene, `traits`
 * the loaded chog-traits.glb scene. Built once per part combination and shared
 * by every figure of a token with the same parts (a figure's own colours live
 * in its materials and paint, not here).
 */
export function chogTokenModel(base: Object3D, traits: Object3D, look: ChogLook, beams: boolean): CharacterModel {
  let models = cache.get(traits);
  if (!models) cache.set(traits, (models = new Map()));
  const parts = chogParts(look, beams);
  const key = `${[...parts.Head, ...parts.Body, ...parts.HandR].join('|')}|${look.lids ? 'lids' : ''}`;
  let model = models.get(key);
  if (!model) models.set(key, (model = build(base, traits, parts, look.lids)));
  return model;
}

function build(base: Object3D, traits: Object3D, parts: ReturnType<typeof chogParts>, lids: boolean): CharacterModel {
  const bones = [...RIG_BONES];
  const chunks = newChunks();
  const hinges: CharacterModel['hinges'] = {};
  const place = new Matrix4();
  const add = (node: Object3D | undefined, bone: number) => {
    if (node) collect(node, place.compose(ORIGIN, node.quaternion, node.scale), bone, chunks);
  };
  bones.forEach((name, bone) => {
    if (name === 'Head') {
      for (const part of parts.Head) add(traits.getObjectByName(part), bone);
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
    // The outfit over the onesie; the prop in the right hand.
    const extra = name === 'Body' ? parts.Body : name === 'HandR' ? parts.HandR : [];
    for (const part of extra) add(traits.getObjectByName(part), bone);
  });
  return { geos: mergeChunks(chunks), bones, hinges };
}

/** The colours a token puts on the character material set (over the base Chog's own). */
export function chogColors(look: ChogLook): LookColors {
  return { ...look.colors };
}
