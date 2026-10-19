// Image-based lighting for everything lit live (characters, dice, table,
// houses, the board). Without an environment map, metal is black and gloss is
// flat; with one, the knight's armour, the dice and the table's varnish pick
// up proper reflections.
//
// The Classic room uses a 360° panorama of itself rendered in Blender
// (tools/blender/classic_env.py), so pieces reflect its lamp, fire and window.
// Every other scene uses three's procedural studio room (no download).
//
// The panorama suspends the scene until it is in, and the map goes on before
// the first frame: a map arriving after the scene is up changes the shader of
// every lit material, and relinking them all is a long stall on Windows.

import { useThree } from '@react-three/fiber';
import { use, useEffect, useLayoutEffect, useState } from 'react';
import { EquirectangularReflectionMapping, PMREMGenerator, SRGBColorSpace, TextureLoader, type Texture } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** Each panorama, loaded once per page (null when it fails: the studio room stands in). */
const panoramas = new Map<string, Promise<Texture | null>>();
const loaded = new Map<string, Texture | null>();
export function preloadPanorama(url: string): Promise<Texture | null> {
  let p = panoramas.get(url);
  if (!p) {
    p = new Promise<Texture | null>(resolve => new TextureLoader().load(url, tex => {
      tex.mapping = EquirectangularReflectionMapping;
      tex.colorSpace = SRGBColorSpace;
      resolve(tex);
    }, undefined, () => resolve(null))).then(t => { loaded.set(url, t); return t; });
    panoramas.set(url, p);
  }
  return p;
}

export function SceneEnv({ url, intensity = 1, rotation = 0 }: { url?: string; intensity?: number; rotation?: number }) {
  const { gl, scene } = useThree();
  // The panorama on show. A scene that starts with one waits for it (suspends);
  // a scene that changes to another keeps the old reflections until the new
  // one is in, rather than blanking.
  const [shown, setShown] = useState(url);
  if (shown && !loaded.has(shown)) use(preloadPanorama(shown));
  useEffect(() => {
    if (url === shown) return;
    if (!url || loaded.has(url)) { setShown(url); return; }
    let live = true;
    void preloadPanorama(url).then(() => { if (live) setShown(url); });
    return () => { live = false; };
  }, [url, shown]);
  const source = shown ? loaded.get(shown) ?? null : null;
  useLayoutEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    let env: Texture;
    if (source) {
      env = pmrem.fromEquirectangular(source).texture;
      // Only the GPU copy: the image stays for the next scene that reflects it.
      source.dispose();
    } else {
      const room = new RoomEnvironment();
      env = pmrem.fromScene(room, 0.04).texture;
      room.dispose();
    }
    scene.environment = env;
    scene.environmentIntensity = intensity;
    scene.environmentRotation.set(0, rotation, 0);
    return () => {
      if (scene.environment === env) scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, source, intensity, rotation]);
  return null;
}
