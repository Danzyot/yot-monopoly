// Models built in Blender (tools/blender) and loaded as GLB. Each has a
// code-drawn stand-in that shows while the file downloads and stays if it
// fails, so a slow or broken asset never leaves a hole in the scene.

import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useTexture } from '@react-three/drei';
import {
  Color, MeshBasicMaterial, MeshStandardMaterial, RingGeometry, SRGBColorSpace,
  type Material, type Mesh, type Object3D,
} from 'three';
import { ASSETS } from './assets.gen.ts';

class ModelErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.warn('3D model failed to load; using the built-in stand-in.', e); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/**
 * Show `children` (a model) once loaded; `fallback` until then, and `failed`
 * (by default the same) for good if it fails. `lights` stay up from the start,
 * over the stand-in and the model alike, and go only if the model fails: a
 * light coming or going mid-scene changes the shader of every lit material.
 */
export function WithModel({ fallback, failed = fallback, lights, children }: {
  fallback: ReactNode; failed?: ReactNode; lights?: ReactNode; children: ReactNode;
}) {
  return (
    <ModelErrorBoundary fallback={failed}>
      {lights}
      <Suspense fallback={fallback}>{children}</Suspense>
    </ModelErrorBoundary>
  );
}

function meshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse(o => { if ((o as Mesh).isMesh) out.push(o as Mesh); });
  return out;
}

/** A light-baked scene from tools/blender: its model, lightmap and lightmap strength (blib.bake_lightmap). */
export interface BakedAsset { url: string; lightmap: string; lightmapIntensity: number; lightmapLow?: string }

/** The lightmap a scene uses: the half-size one on Low (and Auto on weak devices), when it has one. */
export const lightmapFor = (asset: BakedAsset, lite: boolean) => (lite && asset.lightmapLow) || asset.lightmap;

/**
 * A light-baked room or set: every surface is unlit and multiplied by the
 * baked lightmap (uv1), so it costs no live lights. Meshes named `RoomGlow…`
 * (fire, lamp shade, the night outside, neon) show their own colour at full
 * strength.
 */
export function BakedScene({ asset, lite = false }: { asset: BakedAsset; lite?: boolean }) {
  const { url, lightmapIntensity } = asset;
  const gltf = useGLTF(url);
  const light = useTexture(lightmapFor(asset, lite));
  const scene = useMemo(() => {
    // The lightmap rides on the second UV set; the plain-colour mesh has only that one.
    light.flipY = false;
    light.colorSpace = SRGBColorSpace;
    light.channel = 1;
    const light0 = light.clone();
    light0.channel = 0;
    const root = gltf.scene.clone(true);
    for (const m of meshes(root)) {
      const old = m.material as MeshStandardMaterial;
      const glowing = m.name.startsWith('RoomGlow');
      const lit = !glowing;
      const lm = m.geometry.attributes.uv1 ? light : light0;
      const map = old.map ?? old.emissiveMap ?? null;
      const color = map ? new Color('#ffffff') : glowing && old.emissive.getHex() ? old.emissive.clone() : old.color.clone();
      m.material = new MeshBasicMaterial({
        map,
        color,
        vertexColors: !!m.geometry.attributes.color,
        lightMap: lit ? lm : null,
        lightMapIntensity: lightmapIntensity,
        // Flames and the lamp read as light sources: keep them out of tone mapping.
        toneMapped: !glowing || !!map,
      });
      (old as Material).dispose();
      m.castShadow = false;
      m.receiveShadow = false;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
    }
    return root;
  }, [gltf.scene, light, lightmapIntensity]);
  return <primitive object={scene} />;
}

/** The Classic room (tools/blender/classic_room.py). */
export const ClassicRoom = ({ lite }: { lite?: boolean }) => <BakedScene asset={ASSETS.classicRoom} lite={lite} />;

/** The round game table, its finish recoloured to the room's table style. */
export function ModelTable({ color, roughness, metalness }: { color: string; roughness: number; metalness: number }) {
  const gltf = useGLTF(ASSETS.table.url);
  const scene = useMemo(() => {
    const root = gltf.scene.clone(true);
    for (const m of meshes(root)) {
      m.receiveShadow = true;
      m.castShadow = false;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]) as MeshStandardMaterial[];
      m.material = mats.map(mat => {
        const c = mat.clone();
        if (mat.name === 'TableFinish') {
          c.color.set(color);
          c.roughness = roughness;
          c.metalness = metalness;
        }
        return c;
      });
      if (mats.length === 1) m.material = (m.material as Material[])[0];
    }
    return root;
  }, [gltf.scene, color, roughness, metalness]);
  return <primitive object={scene} />;
}

export interface BuildingSpot { key: string; x: number; z: number; rotY: number; hotel: boolean }

/** Houses and hotels from buildings.glb, body and roof in the edition's colours. */
export function ModelBuildings({ spots, house, hotel }: { spots: BuildingSpot[]; house: string; hotel: string }) {
  const gltf = useGLTF(ASSETS.buildings.url);
  const protos = useMemo(() => {
    const make = (name: string, color: string) => {
      const src = gltf.scene.getObjectByName(name);
      if (!src) throw new Error(`buildings.glb has no ${name}`);
      const root = src.clone(true);
      root.position.set(0, 0, 0);
      for (const m of meshes(root)) {
        m.castShadow = true;
        m.receiveShadow = true;
        // Glossy moulded plastic, like the real pieces, tinted to the edition
        // (standard, not a physical clear coat: the same at this size, and a
        // much quicker shader to compile).
        const tint = (mat: Material) => {
          const src = mat as MeshStandardMaterial;
          if (src.name === 'BuildingGlass') return src.clone();
          const c = new MeshStandardMaterial({
            name: src.name, color: src.color, roughness: Math.min(src.roughness, 0.26), metalness: 0,
          });
          if (c.name === 'BuildingBody') c.color.set(color);
          if (c.name === 'BuildingRoof') c.color.set(color).multiplyScalar(0.72);
          return c;
        };
        m.material = Array.isArray(m.material) ? m.material.map(tint) : tint(m.material);
      }
      return root;
    };
    return { house: make('House', house), hotel: make('Hotel', hotel) };
  }, [gltf.scene, house, hotel]);
  // Buildings already standing when the board appears are just there; new ones drop in.
  const standing = useRef<Set<string> | null>(null);
  if (standing.current === null) standing.current = new Set(spots.map(s => s.key));
  useEffect(() => { standing.current = new Set(); }, []);
  // A hotel sold back down to houses: the houses are simply there in its place.
  const hotelLots = useRef(new Set<string>());
  useEffect(() => { hotelLots.current = new Set(spots.filter(s => s.hotel).map(s => s.key.split('-')[0])); });
  const drops = (s: BuildingSpot) => !standing.current!.has(s.key) && (s.hotel || !hotelLots.current.has(s.key.split('-')[0]));
  return (
    <group>
      {spots.map(s => (
        <Building key={s.key} proto={s.hotel ? protos.hotel : protos.house} spot={s} drop={drops(s)} />
      ))}
    </group>
  );
}

const DROP_MS = 620;
// The dust ring kicked up on landing (starts at the half-way impact, gone before the drop ends).
const PUFF_MS = 300;
const PUFF_GEO = new RingGeometry(0.55, 1, 28);

function Building({ proto, spot, drop }: { proto: Object3D; spot: BuildingSpot; drop: boolean }) {
  // One clone per building, kept across re-renders (geometry and materials are shared).
  const obj = useMemo(() => proto.clone(), [proto]);
  const start = useRef(drop ? performance.now() : 0);
  const puff = useRef<Mesh>(null);
  const puffMat = useMemo(() => new MeshBasicMaterial({ color: '#e9e2d2', transparent: true, opacity: 0, depthWrite: false }), []);
  useEffect(() => () => puffMat.dispose(), [puffMat]);
  const puffSize = spot.hotel ? 0.3 : 0.17;
  // Falls onto the lot, then squashes and settles while a puff of dust spreads and fades.
  useFrame(() => {
    if (!start.current) return;
    const t = (performance.now() - start.current) / DROP_MS;
    const ring = puff.current;
    if (t >= 1) {
      obj.position.y = 0;
      obj.scale.set(1, 1, 1);
      if (ring) ring.visible = false;
      start.current = 0;
    } else if (t < 0.5) {
      const k = t / 0.5;
      obj.position.y = 0.7 * (1 - k * k);
      obj.scale.set(0.92, 1.1, 0.92);
    } else {
      const k = (t - 0.5) / 0.5;
      const s = Math.sin(k * Math.PI * 2) * (1 - k) * 0.24;
      obj.position.y = 0;
      obj.scale.set(1 + s * 0.5, 1 - s, 1 + s * 0.5);
      if (ring) {
        const p = Math.min(1, (t - 0.5) * DROP_MS / PUFF_MS);
        const grow = 1 - (1 - p) ** 2;
        ring.visible = p < 1;
        ring.scale.setScalar(puffSize * (0.5 + grow));
        puffMat.opacity = 0.55 * (1 - p);
      }
    }
  });
  return (
    <group position={[spot.x, 0, spot.z]} rotation={[0, spot.rotY, 0]}>
      <primitive object={obj} />
      {drop && <mesh ref={puff} geometry={PUFF_GEO} material={puffMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} visible={false} />}
    </group>
  );
}

/**
 * Start downloading the shared models before the first scene asks for them.
 * The houses only with `game`: the home page's turning board has none, so a
 * first visit does not wait on them. The characters load one file each, only
 * those at the table (preloadCharacters in characters/Figure.tsx, from the lobby).
 */
export function preloadModels(game: boolean) {
  useGLTF.preload(ASSETS.table.url);
  if (!game) return;
  useGLTF.preload(ASSETS.buildings.url);
}
