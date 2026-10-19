// Houses and hotels: bigger than the real pieces would be at this scale, in
// strong edition colours with a light rim round each one (an inverted hull
// out of tone mapping, so it reads as a glow from across the table), standing
// on the inner strip of their tile (layout.ts buildingSpots), well clear of
// where the pieces stand and walk (tokenSpot keeps them toward the outer
// edge). A new one drops onto its lot, squashes and settles with a puff of
// dust.
//
// Instanced: one draw call for every house's body, one for their windows,
// the same for hotels, one per rim and one for the dust, however many are
// built (the old per-building clones cost eight calls each, shadows included).
// The models come from buildings.glb; code-drawn stand-ins of the same shape
// fill in while it loads or if it cannot.

import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BackSide, BoxGeometry, BufferAttribute, BufferGeometry, Color, IcosahedronGeometry, InstancedMesh, Matrix4,
  MeshBasicMaterial, MeshStandardMaterial, Object3D, type Material, type Mesh,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ASSETS } from './assets.gen.ts';

export interface BuildingSpot { key: string; x: number; z: number; rotY: number; hotel: boolean }

/** One kind of building: its solid shell (vertex-coloured), its windows, and the shape its rim is drawn from. */
interface Kit { solid: BufferGeometry; glass: BufferGeometry | null; glassMat: Material | null }

const MAX_HOUSES = 160;
const MAX_HOTELS = 48;
const DROP_MS = 620;
const DUST_MS = 650;
const DUST_BITS = 8;
const MAX_DUST = DUST_BITS * 12;
/** The rim: the shell blown up this much, drawn inside out. */
const RIM = 1.09;

const dummy = new Object3D();
const mtx = new Matrix4();
const dustGeo = new IcosahedronGeometry(1, 0);
const dustMat = new MeshStandardMaterial({ color: '#efe6d6', roughness: 1 });

/** Only position and normal, unindexed, so parts from anywhere merge. */
function plain(g: BufferGeometry): BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g.clone();
  const out = new BufferGeometry();
  out.setAttribute('position', src.getAttribute('position'));
  if (!src.getAttribute('normal')) src.computeVertexNormals();
  out.setAttribute('normal', src.getAttribute('normal'));
  return out;
}

/** Parts merged into one geometry, each painted its colour. */
function paint(parts: { geo: BufferGeometry; color: Color }[]): BufferGeometry {
  const geos = parts.map(({ geo, color }) => {
    const g = plain(geo);
    const n = g.getAttribute('position').count;
    const c = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) { c[k * 3] = color.r; c[k * 3 + 1] = color.g; c[k * 3 + 2] = color.b; }
    g.setAttribute('color', new BufferAttribute(c, 3));
    return g;
  });
  const merged = mergeGeometries(geos)!;
  geos.forEach(g => g.dispose());
  return merged;
}

/** The roof a touch lighter than the walls (a darker one went muddy under the table light). */
const roofOf = (c: string) => new Color(c).lerp(new Color('#ffffff'), 0.1);
/** The white trim takes on some of the building's colour, so from across the table it reads as that colour, not as white. */
const trimOf = (trim: Color, c: string) => trim.clone().lerp(new Color(c), 0.45);

function modelKit(scene: Object3D, name: string, color: string): Kit {
  const src = scene.getObjectByName(name);
  if (!src) throw new Error(`buildings.glb has no ${name}`);
  const parts: { geo: BufferGeometry; color: Color }[] = [];
  let glass: BufferGeometry | null = null;
  let glassMat: Material | null = null;
  src.updateWorldMatrix(true, true);
  const inv = new Matrix4().copy(src.matrixWorld).invert();
  src.traverse(o => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const mat = m.material as MeshStandardMaterial;
    // Relative to the building's own origin (its base, centred).
    const geo = m.geometry.clone().applyMatrix4(mtx.multiplyMatrices(inv, m.matrixWorld));
    if (mat.name === 'BuildingGlass') {
      glass = geo;
      glassMat = mat.clone();
      return;
    }
    parts.push({
      geo,
      color: mat.name === 'BuildingBody' ? new Color(color) : mat.name === 'BuildingRoof' ? roofOf(color) : trimOf(mat.color, color),
    });
  });
  return { solid: paint(parts), glass, glassMat };
}

/** The code-drawn stand-in: walls and a pitched roof, the GLB's size. */
function drawnKit(hotel: boolean, color: string): Kit {
  const [w, h, d] = hotel ? [0.36, 0.2, 0.19] : [0.13, 0.11, 0.14];
  const walls = new BoxGeometry(w, h, d).translate(0, h / 2, 0);
  const r = hotel ? 0.13 : 0.1;
  const roof = new BoxGeometry(r, r, d * 1.05).rotateZ(Math.PI / 4).scale(w / (r * 1.414), 0.7, 1).translate(0, h, 0);
  return { solid: paint([{ geo: walls, color: new Color(color) }, { geo: roof, color: roofOf(color) }]), glass: null, glassMat: null };
}

/** A rim colour that stands out from the building and the purple board: lighter, or gold for a pale building. */
function rimOf(color: string): Color {
  const c = new Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return hsl.l > 0.7 ? new Color('#ffd23f') : c.lerp(new Color('#ffffff'), 0.55);
}

export function ModelBuildings(props: { spots: BuildingSpot[]; house: string; hotel: string; tileW: number }) {
  const gltf = useGLTF(ASSETS.buildings.url);
  const kits = useMemo(() => ({
    house: modelKit(gltf.scene, 'House', props.house),
    hotel: modelKit(gltf.scene, 'Hotel', props.hotel),
  }), [gltf.scene, props.house, props.hotel]);
  return <InstancedBuildings {...props} kits={kits} />;
}

export function DrawnBuildings(props: { spots: BuildingSpot[]; house: string; hotel: string; tileW: number }) {
  const kits = useMemo(() => ({ house: drawnKit(false, props.house), hotel: drawnKit(true, props.hotel) }), [props.house, props.hotel]);
  return <InstancedBuildings {...props} kits={kits} />;
}

function InstancedBuildings({ spots, house, hotel, tileW, kits }: {
  spots: BuildingSpot[]; house: string; hotel: string; tileW: number; kits: { house: Kit; hotel: Kit };
}) {
  const refs = {
    house: useRef<InstancedMesh>(null), houseGlass: useRef<InstancedMesh>(null), houseRim: useRef<InstancedMesh>(null),
    hotel: useRef<InstancedMesh>(null), hotelGlass: useRef<InstancedMesh>(null), hotelRim: useRef<InstancedMesh>(null),
    dust: useRef<InstancedMesh>(null),
  };
  // Sized to the tile: four houses side by side fill the strip with a gap between; a hotel takes most of it. Taller than the model, to read from above.
  const houseS = Math.min(1.2, Math.max(0.85, ((tileW / 4.2) * 0.86) / 0.16));
  const hotelS = Math.min(1.35, Math.max(1, (tileW * 0.6) / 0.39));
  const mats = useMemo(() => {
    const solid = (c: string) => new MeshStandardMaterial({
      vertexColors: true, roughness: 0.3, metalness: 0, emissive: new Color(c), emissiveIntensity: 0.28,
    });
    const rim = (c: string) => new MeshBasicMaterial({ color: rimOf(c), side: BackSide, toneMapped: false });
    return { house: solid(house), hotel: solid(hotel), houseRim: rim(house), hotelRim: rim(hotel) };
  }, [house, hotel]);
  useEffect(() => () => { for (const m of Object.values(mats)) m.dispose(); }, [mats]);
  useEffect(() => () => {
    for (const k of [kits.house, kits.hotel]) { k.solid.dispose(); k.glass?.dispose(); k.glassMat?.dispose(); }
  }, [kits]);

  // Buildings already standing when the board appears are just there; new ones drop in.
  const born = useRef<Map<string, number> | null>(null);
  const dirty = useRef(true);
  const busyUntil = useRef(0);
  if (born.current === null) born.current = new Map(spots.map(s => [s.key, 0]));
  useEffect(() => {
    const now = performance.now();
    const seen = born.current!;
    // A hotel sold back down to houses: the houses are simply there in its place.
    const hotelLots = new Set([...seen.keys()].filter(k => k.endsWith('-h')).map(k => k.split('-')[0]));
    for (const s of spots) if (!seen.has(s.key)) seen.set(s.key, s.hotel || !hotelLots.has(s.key.split('-')[0]) ? now : 0);
    for (const k of [...seen.keys()]) if (!spots.some(s => s.key === k)) seen.delete(k);
    dirty.current = true;
    busyUntil.current = now + DROP_MS + DUST_MS;
  }, [spots]);

  useLayoutEffect(() => {
    // Instance colours from the start (white), so the dust never changes shader mid-game.
    const d = refs.dust.current;
    if (d && !d.instanceColor) d.setColorAt(0, new Color('#ffffff'));
  }, []);

  useFrame(() => {
    const now = performance.now();
    if (!dirty.current && now > busyUntil.current) return;
    if (now > busyUntil.current) dirty.current = false;
    const H = refs.house.current, HG = refs.houseGlass.current, HR = refs.houseRim.current;
    const O = refs.hotel.current, OG = refs.hotelGlass.current, OR = refs.hotelRim.current, D = refs.dust.current;
    if (!H || !HR || !O || !OR || !D) return;
    let h = 0, o = 0, dust = 0;
    for (const s of spots) {
      if (s.hotel ? o >= MAX_HOTELS : h >= MAX_HOUSES) continue;
      const base = s.hotel ? hotelS : houseS;
      const t0 = born.current!.get(s.key) ?? 0;
      const t = t0 ? (now - t0) / DROP_MS : 1;
      // Falls onto the lot, then squashes and settles.
      let y = 0, sx = 1, sy = 1;
      if (t < 0.5) {
        const k = Math.max(0, t) / 0.5;
        y = 0.8 * (1 - k * k);
        sx = 0.9; sy = 1.14;
      } else if (t < 1) {
        const k = (t - 0.5) / 0.5;
        const q = Math.sin(k * Math.PI * 2) * (1 - k) * 0.26;
        sx = 1 + q * 0.5; sy = 1 - q;
      }
      dummy.position.set(s.x, y, s.z);
      dummy.rotation.set(0, s.rotY, 0);
      dummy.scale.set(base * sx, base * sy * (s.hotel ? 1.1 : 1.3), base * sx);
      dummy.updateMatrix();
      const at = s.hotel ? o++ : h++;
      (s.hotel ? O : H).setMatrixAt(at, dummy.matrix);
      (s.hotel ? OG : HG)?.setMatrixAt(at, dummy.matrix);
      dummy.scale.multiplyScalar(RIM);
      dummy.updateMatrix();
      (s.hotel ? OR : HR).setMatrixAt(at, dummy.matrix);
      // The dust: a ring of crumbs kicked out from the base at the impact, shrinking away.
      const since = t0 ? now - t0 - DROP_MS * 0.5 : -1;
      if (since >= 0 && since < DUST_MS && dust + DUST_BITS <= MAX_DUST) {
        const k = since / DUST_MS;
        const reach = (s.hotel ? 0.34 : 0.2) * (0.5 + (1 - (1 - k) ** 2));
        for (let b = 0; b < DUST_BITS; b++) {
          const a = (b / DUST_BITS) * Math.PI * 2 + s.x * 3;
          dummy.position.set(s.x + Math.cos(a) * reach, 0.02 + Math.sin(k * Math.PI) * 0.07, s.z + Math.sin(a) * reach);
          dummy.rotation.set(a, a * 2, 0);
          dummy.scale.setScalar((s.hotel ? 0.045 : 0.032) * (1 - k));
          dummy.updateMatrix();
          D.setMatrixAt(dust++, dummy.matrix);
        }
      }
    }
    H.count = HR.count = h;
    O.count = OR.count = o;
    if (HG) HG.count = h;
    if (OG) OG.count = o;
    D.count = dust;
    for (const m of [H, HG, HR, O, OG, OR, D]) if (m) m.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={refs.house} args={[kits.house.solid, mats.house, MAX_HOUSES]} count={0} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh ref={refs.houseRim} args={[kits.house.solid, mats.houseRim, MAX_HOUSES]} count={0} frustumCulled={false} />
      {kits.house.glass && kits.house.glassMat && (
        <instancedMesh ref={refs.houseGlass} args={[kits.house.glass, kits.house.glassMat, MAX_HOUSES]} count={0} frustumCulled={false} />
      )}
      <instancedMesh ref={refs.hotel} args={[kits.hotel.solid, mats.hotel, MAX_HOTELS]} count={0} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh ref={refs.hotelRim} args={[kits.hotel.solid, mats.hotelRim, MAX_HOTELS]} count={0} frustumCulled={false} />
      {kits.hotel.glass && kits.hotel.glassMat && (
        <instancedMesh ref={refs.hotelGlass} args={[kits.hotel.glass, kits.hotel.glassMat, MAX_HOTELS]} count={0} frustumCulled={false} />
      )}
      <instancedMesh ref={refs.dust} args={[dustGeo, dustMat, MAX_DUST]} count={0} castShadow={false} frustumCulled={false} />
    </group>
  );
}
