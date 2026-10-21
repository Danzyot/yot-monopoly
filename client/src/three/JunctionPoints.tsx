// The points at Junction (a board with a lane, shared/route.ts): a signal
// post beside the lane's mouth with a lit arrow on top, like a weathervane,
// pointing the way every piece walking past will go: north up the lane, or
// west on round the loop. It swings round when someone throws the points.

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { CylinderGeometry, ExtrudeGeometry, MeshStandardMaterial, Shape, type Group } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { C, W } from './layout.ts';

const POST_H = 0.5;
/** Just east of the lane's mouth, in the centre (clear of the tiles, the piles and the dice). */
const AT: [number, number] = [C / 2 + 0.22, W / 2 - C - 0.22];

/** Post and cap as one geometry: one draw call. */
const postGeo = mergeGeometries([
  new CylinderGeometry(0.03, 0.045, POST_H, 12).translate(0, POST_H / 2, 0),
  new CylinderGeometry(0.075, 0.075, 0.04, 16).translate(0, POST_H, 0),
]);
/** A flat arrow pointing along -z, lying in the XZ plane. */
const arrowGeo = (() => {
  const s = new Shape();
  s.moveTo(0, 0.3); s.lineTo(0.17, 0.08); s.lineTo(0.06, 0.08); s.lineTo(0.06, -0.24);
  s.lineTo(-0.06, -0.24); s.lineTo(-0.06, 0.08); s.lineTo(-0.17, 0.08); s.closePath();
  return new ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.01, bevelSegments: 1 })
    .rotateX(-Math.PI / 2);
})();
const postMat = new MeshStandardMaterial({ color: '#2b2b33', metalness: 0.7, roughness: 0.35 });

/** Yaw that turns the arrow (made pointing north, -z) the way the points are set: north up the lane, west round the loop. */
const yawFor = (points: 'lane' | 'loop') => (points === 'lane' ? 0 : Math.PI / 2);

export function JunctionPoints({ points, color }: { points: 'lane' | 'loop'; color: string }) {
  const arrow = useRef<Group>(null);
  const mat = useMemo(() => new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.4 }), [color]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame((_, dt) => {
    const g = arrow.current;
    if (!g) return;
    const want = yawFor(points);
    // Swing round to the new setting.
    g.rotation.y += (want - g.rotation.y) * Math.min(1, dt * 6);
    g.position.y = POST_H + 0.06 + Math.sin(performance.now() / 380) * 0.015;
  });
  return (
    <group position={[AT[0], 0, AT[1]]}>
      <mesh geometry={postGeo} material={postMat} castShadow />
      <group ref={arrow} rotation={[0, yawFor(points), 0]} position={[0, POST_H + 0.06, 0]}>
        <mesh geometry={arrowGeo} material={mat} castShadow />
      </group>
    </group>
  );
}
