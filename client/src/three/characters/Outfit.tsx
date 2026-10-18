// Outfit items worn over a character (shared/outfits.ts). The models come from
// tools/blender/outfits.py (models/outfits.glb), one node per item modelled on
// a canonical figure; outfitFit.json moves and stretches each onto every
// character, or hides it where the character's own hat or helmet is in the way.
//
// Cheap on purpose: every piece wearing an item shares its geometry (clones of
// one loaded node), and the item uses the wearing figure's own materials (its
// `main` is the player's colour), so it adds no materials and greys / fades
// with the figure in jail or bankruptcy.

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import type { Material, Mesh, Object3D } from 'three';
import { ASSETS } from '../assets.gen.ts';
import { WithModel } from '../models.tsx';
import type { CharacterId } from '../../../../shared/characters.ts';
import { OUTFIT_SLOTS, getOutfitItem, type Outfit, type OutfitSlot } from '../../../../shared/outfits.ts';
import type { Mats } from './parts.tsx';
import type { Rig } from './Figure.tsx';
import FIT_JSON from './outfitFit.json';

type V3 = [number, number, number];
interface Anchor { p: V3; s: V3 }
interface Fit {
  canonical: Record<OutfitSlot, Anchor>;
  chars: Partial<Record<string, Record<OutfitSlot, Anchor>>>;
  hide: Partial<Record<string, string[]>>;
  items: Partial<Record<string, Partial<Record<string, { p?: V3; s?: number | V3 }>>>>;
  neckOverBody: V3;
}
const FIT = FIT_JSON as unknown as Fit;

/** False when `item` can't be worn by this character (it is hidden on them). */
export function itemFits(character: CharacterId, item: string): boolean {
  return !FIT.hide[character]?.includes(item);
}

/** Where an item goes on a character, in its anchor's frame (rig.head or rig.pose); null when hidden. */
export function outfitPlacement(character: CharacterId, item: string, outfit: Outfit): Anchor | null {
  const def = getOutfitItem(item);
  if (!def || !itemFits(character, item)) return null;
  const anchor = FIT.chars[character]?.[def.slot] ?? FIT.canonical[def.slot];
  const tweak = FIT.items[item]?.[character];
  const ts = tweak?.s ?? 1;
  const p = anchor.p.map((v, i) => v + (tweak?.p?.[i] ?? 0)) as V3;
  let s = anchor.s.map((v, i) => v * (typeof ts === 'number' ? ts : ts[i])) as V3;
  // A neck item over a jacket widens to sit on its collar.
  if (def.slot === 'neck' && outfit.body && itemFits(character, outfit.body)) {
    s = s.map((v, i) => v * FIT.neckOverBody[i]) as V3;
  }
  return { p, s };
}

const ATTACH: Record<OutfitSlot, 'head' | 'pose'> = { head: 'head', eyes: 'head', neck: 'pose', body: 'pose' };
/** Small items cost a shadow pass for no visible shadow. */
const CASTS: Record<OutfitSlot, boolean> = { head: true, eyes: false, neck: false, body: true };

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
    const out: { obj: Object3D; at: 'head' | 'pose' }[] = [];
    for (const s of OUTFIT_SLOTS) {
      const item = outfit[s.id];
      const place = item ? outfitPlacement(id, item, outfit) : null;
      const src = item && place ? gltf.scene.getObjectByName(item) : null;
      if (!item || !place || !src) continue;
      // Shares the loaded geometry; only the transform and material references are per piece.
      const obj = src.clone(true);
      obj.position.set(...place.p);
      obj.rotation.set(0, 0, 0);
      obj.scale.set(...place.s);
      obj.traverse((o: Object3D) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        const swap = (mat: Material) => mats[(mat.name.split(':')[1] ?? 'main') as keyof Mats] ?? mats.main;
        m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
        m.castShadow = CASTS[s.id];
      });
      out.push({ obj, at: ATTACH[s.id] });
    }
    return out;
    // `key` stands in for the outfit object, which may be a new object with the same items.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf.scene, id, key, mats]);
  useEffect(() => () => { for (const w of worn) w.obj.removeFromParent(); }, [worn]);
  // The rig's groups can be swapped (the drawn stand-in gives way to the model), so re-hang when they change.
  useFrame(() => {
    for (const w of worn) {
      const parent = rig[w.at];
      if (parent && w.obj.parent !== parent) parent.add(w.obj);
    }
  });
  return null;
}

useGLTF.preload(ASSETS.outfits.url);
