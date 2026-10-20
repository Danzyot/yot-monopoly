// Outfit items worn over a character (shared/outfits.ts). The models come from
// tools/blender/outfits.py (models/outfits.glb), one node per item modelled on
// a canonical figure; outfitFit.json moves and stretches each onto every
// character, or hides it where the character's own hat or helmet is in the way.
//
// Cheap on purpose: a figure's worn items are merged into a few skinned meshes
// (one per material group, merged.ts) on two bones, one riding the head and one
// the body, so a whole outfit costs two or three draw calls. The items use the
// wearing figure's own materials (its `main` is the player's colour), so they
// grey / fade with the figure in jail or bankruptcy.

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { ASSETS } from '../assets.gen.ts';
import { WithModel } from '../models.tsx';
import type { CharacterId } from '../../../../shared/characters.ts';
import { OUTFIT_SLOTS, getOutfitItem, type Outfit, type OutfitSlot } from '../../../../shared/outfits.ts';
import type { Mats } from './parts.tsx';
import type { Rig } from './Figure.tsx';
import { collect, mergeChunks, newChunks, skinnedSet } from './merged.ts';
import FIT_JSON from './outfitFit.json';

type V3 = [number, number, number];
interface Anchor { p: V3; s: V3 }
interface Fit {
  canonical: Record<OutfitSlot, Anchor>;
  chars: Partial<Record<string, Record<OutfitSlot, Anchor>>>;
  hide: Partial<Record<string, string[]>>;
  items: Partial<Record<string, Partial<Record<string, { p?: V3; s?: number | V3 }>>>>;
  neckOverBody: V3;
  /** Per character with a mane of its own, the cut of it worn under each head item (the whole one otherwise). */
  mane: Partial<Record<string, Partial<Record<string, string>>>>;
}
const FIT = FIT_JSON as unknown as Fit;

/** False when `item` can't be worn by this character (it is hidden on them). */
export function itemFits(character: CharacterId, item: string): boolean {
  return !FIT.hide[character]?.includes(item);
}

/**
 * Which cut of its mane a character wears with this outfit (models/characters/<id>.glb `<id>_Hair_<cut>`):
 * the Chog's spikes are cut back round a hat so some always show without poking through it.
 */
export function outfitMane(character: CharacterId, outfit: Outfit): string {
  const head = outfit.head;
  return (head && itemFits(character, head) && FIT.mane[character]?.[head]) || 'full';
}

/**
 * Where an item goes on a character, in its anchor's frame (rig.head or rig.pose); null when hidden,
 * and for signature items, which the character's own model draws (Figure.tsx).
 */
export function outfitPlacement(character: CharacterId, item: string, outfit: Outfit): Anchor | null {
  const def = getOutfitItem(item);
  if (!def || def.node || !itemFits(character, item)) return null;
  const anchor = FIT.chars[character]?.[def.slot] ?? FIT.canonical[def.slot];
  const tweak = FIT.items[item]?.[character];
  const ts = tweak?.s ?? 1;
  const p = anchor.p.map((v, i) => v + (tweak?.p?.[i] ?? 0)) as V3;
  let s = anchor.s.map((v, i) => v * (typeof ts === 'number' ? ts : ts[i])) as V3;
  // A neck item over a jacket widens to sit on its collar (not over a character's own tee).
  if (def.slot === 'neck' && outfit.body && !getOutfitItem(outfit.body)?.node && itemFits(character, outfit.body)) {
    s = s.map((v, i) => v * FIT.neckOverBody[i]) as V3;
  }
  return { p, s };
}

const ATTACH: Record<OutfitSlot, 'head' | 'pose'> = { head: 'head', eyes: 'head', neck: 'pose', body: 'pose' };
/** Bones of the merged outfit, by the rig group each rides. */
const BONES = ['head', 'pose'] as const;
const NO_TURN = new Quaternion();

/** Dress a figure: hangs each worn item on the rig's head or body group. Draws nothing until outfits.glb loads. */
export function OutfitLayer(props: { id: CharacterId; outfit?: Outfit; mats: Mats; rig: Rig }) {
  if (!props.outfit || !Object.keys(props.outfit).length) return null;
  return (
    <WithModel fallback={null}>
      <WornItems {...props} outfit={props.outfit} />
    </WithModel>
  );
}

function WornItems({ id, outfit, mats, rig }: { id: CharacterId; outfit: Outfit; mats: Mats; rig: Rig }) {
  const gltf = useGLTF(ASSETS.outfits.url);
  const key = OUTFIT_SLOTS.map(s => outfit[s.id] ?? '').join('|');
  const worn = useMemo(() => {
    const chunks = newChunks();
    const place = new Matrix4();
    for (const s of OUTFIT_SLOTS) {
      const item = outfit[s.id];
      const at = item ? outfitPlacement(id, item, outfit) : null;
      const src = item && at ? gltf.scene.getObjectByName(item) : null;
      if (!src || !at) continue;
      // The item's node moved onto its anchor and stretched to fit, in its rig group's frame.
      place.compose(new Vector3(...at.p), NO_TURN, new Vector3(...at.s));
      collect(src, place, BONES.indexOf(ATTACH[s.id]), chunks);
    }
    const geos = mergeChunks(chunks);
    return geos.length ? { geos, set: skinnedSet(geos, [...BONES], mats) } : null;
    // `key` stands in for the outfit object, which may be a new object with the same items.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf.scene, id, key, mats]);
  useEffect(() => () => {
    if (!worn) return;
    for (const o of [...worn.set.meshes, ...Object.values(worn.set.bones)]) o.removeFromParent();
    worn.set.dispose();
    for (const g of worn.geos) g.geo.dispose();
  }, [worn]);
  // The rig's groups can be swapped (the drawn stand-in gives way to the model), so re-hang when they change.
  useFrame(() => {
    if (!worn) return;
    for (const at of BONES) {
      const parent = rig[at], bone = worn.set.bones[at];
      if (parent && bone.parent !== parent) parent.add(bone);
    }
    for (const m of worn.set.meshes) if (rig.pose && m.parent !== rig.pose) rig.pose.add(m);
  });
  return null;
}

useGLTF.preload(ASSETS.outfits.url);
