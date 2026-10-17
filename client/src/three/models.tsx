// Models built in Blender (tools/blender) and loaded as GLB. Each has a
// code-drawn stand-in that shows while the file downloads and stays if it
// fails, so a slow or broken asset never leaves a hole in the scene.

import { Component, Suspense, useMemo, type ReactNode } from 'react';
import { useGLTF, useTexture } from '@react-three/drei';
import {
  Color, MeshBasicMaterial, MeshStandardMaterial, SRGBColorSpace, type Material, type Mesh, type Object3D,
} from 'three';
import { ASSETS } from './assets.gen.ts';

class ModelErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.warn('3D model failed to load; using the built-in stand-in.', e); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Show `children` (a model) once loaded; `fallback` until then and for good if it fails. */
export function WithModel({ fallback, children }: { fallback: ReactNode; children: ReactNode }) {
  return (
    <ModelErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </ModelErrorBoundary>
  );
}

function meshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse(o => { if ((o as Mesh).isMesh) out.push(o as Mesh); });
  return out;
}

/**
 * The Classic room: every surface is unlit and multiplied by the baked
 * lightmap (uv1), so it costs no live lights. Glowing parts (fire, lamp
 * shade, the night outside) show their own colour at full strength.
 */
export function ClassicRoom() {
  const { url, lightmap, lightmapIntensity } = ASSETS.classicRoom;
  const gltf = useGLTF(url);
  const light = useTexture(lightmap);
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
        const tint = (mat: Material) => {
          const c = (mat as MeshStandardMaterial).clone();
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
  return (
    <group>
      {spots.map(s => <Building key={s.key} proto={s.hotel ? protos.hotel : protos.house} spot={s} />)}
    </group>
  );
}

function Building({ proto, spot }: { proto: Object3D; spot: BuildingSpot }) {
  // One clone per building, kept across re-renders (geometry and materials are shared).
  const obj = useMemo(() => proto.clone(), [proto]);
  return <primitive object={obj} position={[spot.x, 0, spot.z]} rotation={[0, spot.rotY, 0]} />;
}

/** Start downloading the shared models before the first scene asks for them. */
export function preloadModels() {
  useGLTF.preload(ASSETS.table.url);
  useGLTF.preload(ASSETS.buildings.url);
  useGLTF.preload(ASSETS.characters.url);
}
