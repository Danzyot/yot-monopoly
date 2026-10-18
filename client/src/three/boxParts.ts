// Boxes drawn as "sides + top" instead of six faces. A BoxGeometry given a
// six-material array costs one draw call per face (and again in the shadow
// pass), though five of the faces share a material. Regrouped here into two
// groups, sides then top, several boxes merged into one geometry: the board
// is two draw calls instead of six, a card pile (three boxes) two instead of
// eighteen. Use with a two-material array: [sides, top].

import { BoxGeometry, BufferAttribute, BufferGeometry, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** BoxGeometry's face order is +x, -x, +y, -y, +z, -z: the top is group 2. */
const TOP = 2;

export interface PlacedBox {
  size: [number, number, number];
  position?: [number, number, number];
  /** Turn about the vertical axis. */
  rotY?: number;
}

export function boxesSidesTop(boxes: PlacedBox[]): BufferGeometry {
  const m = new Matrix4(), q = new Quaternion(), e = new Euler(), v = new Vector3(), one = new Vector3(1, 1, 1);
  const parts = boxes.map(({ size, position = [0, 0, 0], rotY = 0 }) =>
    new BoxGeometry(...size).applyMatrix4(m.compose(v.set(...position), q.setFromEuler(e.set(0, rotY, 0)), one)));
  // Where each box's faces sit in the merged index buffer.
  const ranges: { start: number; count: number; top: boolean }[] = [];
  let offset = 0;
  for (const g of parts) {
    for (const grp of g.groups) ranges.push({ start: offset + grp.start, count: grp.count, top: grp.materialIndex === TOP });
    offset += g.index!.count;
  }
  const merged = mergeGeometries(parts);
  parts.forEach(g => g.dispose());
  const src = merged.index!.array;
  const out = new (src.constructor as Uint16ArrayConstructor | Uint32ArrayConstructor)(src.length);
  let n = 0;
  for (const top of [false, true]) {
    for (const r of ranges) if (r.top === top) { out.set(src.subarray(r.start, r.start + r.count), n); n += r.count; }
  }
  const sides = ranges.filter(r => !r.top).reduce((a, r) => a + r.count, 0);
  merged.setIndex(new BufferAttribute(out, 1));
  merged.clearGroups();
  merged.addGroup(0, sides, 0);
  merged.addGroup(sides, n - sides, 1);
  return merged;
}
