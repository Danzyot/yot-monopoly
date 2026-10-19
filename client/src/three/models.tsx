// Models built in Blender (tools/blender) and loaded as GLB. Each has a
// code-drawn stand-in that shows while the file downloads and stays if it
// fails, so a slow or broken asset never leaves a hole in the scene.

import { Component, Suspense, useMemo, type ReactNode } from 'react';
import { useGLTF, useTexture } from '@react-three/drei';
import {
  Color, MeshBasicMaterial, MeshStandardMaterial, SRGBColorSpace,
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
