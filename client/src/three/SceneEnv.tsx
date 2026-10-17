// Image-based lighting for everything lit live (characters, dice, table,
// houses, the board). Without an environment map, metal is black and gloss is
// flat; with one, the knight's armour, the dice and the table's varnish pick
// up proper reflections.
//
// The Classic room uses a 360° panorama of itself rendered in Blender
// (tools/blender/classic_env.py), so pieces reflect its lamp, fire and window.
// Every other scene uses three's procedural studio room (no download).

import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { EquirectangularReflectionMapping, PMREMGenerator, SRGBColorSpace, TextureLoader, type Texture } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export function SceneEnv({ url, intensity = 1, rotation = 0 }: { url?: string; intensity?: number; rotation?: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    let env: Texture | null = null;
    let cancelled = false;
    const apply = (t: Texture) => {
      if (cancelled) { t.dispose(); return; }
      env = t;
      scene.environment = t;
      scene.environmentIntensity = intensity;
      scene.environmentRotation.set(0, rotation, 0);
    };
    const studio = () => {
      const room = new RoomEnvironment();
      apply(pmrem.fromScene(room, 0.04).texture);
      room.dispose();
    };
    if (url) {
      new TextureLoader().load(url, tex => {
        tex.mapping = EquirectangularReflectionMapping;
        tex.colorSpace = SRGBColorSpace;
        apply(pmrem.fromEquirectangular(tex).texture);
        tex.dispose();
      }, undefined, studio);
    } else {
      studio();
    }
    return () => {
      cancelled = true;
      if (scene.environment === env) scene.environment = null;
      env?.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, url, intensity, rotation]);
  return null;
}
