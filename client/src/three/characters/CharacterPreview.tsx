// Compact live preview of one character for the lobby picker: the figure in
// the player's colour, turning slowly and breathing, with a happy hop each
// time the pick (or colour) changes. Falls back to the emoji badge when the
// device has no WebGL.

import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { Group } from 'three';
import { getCharacter, type CharacterId } from '../../../../shared/characters.ts';
import { CharacterFigure, newRig, poseRig, useCharacterMaterials } from './Figure.tsx';

let webglOk: boolean | null = null;
function hasWebGL(): boolean {
  if (webglOk === null) {
    try {
      const c = document.createElement('canvas');
      webglOk = !!(c.getContext('webgl2') ?? c.getContext('webgl'));
    } catch {
      webglOk = false;
    }
  }
  return webglOk;
}

const HOP_S = 0.8;

function Spinning({ id, color }: { id: CharacterId; color: string }) {
  const ref = useRef<Group>(null);
  const rig = useMemo(newRig, []);
  const mats = useCharacterMaterials(id, color);
  const start = useRef<number | null>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    start.current ??= t;
    const c = (t - start.current) / HOP_S;
    const hop = c < 1 ? Math.abs(Math.sin(Math.PI * c)) : 0;
    if (ref.current) {
      ref.current.rotation.y = Math.sin(t * 0.7) * 0.7 + (c < 1 ? c * Math.PI * 2 : 0);
      ref.current.position.y = hop * 0.12;
    }
    poseRig(rig, { time: t, phase: 0, slump: 0, lie: 0, handsUp: hop, squash: 1 + hop * 0.15 });
  });
  return (
    <group ref={ref}>
      <CharacterFigure id={id} mats={mats} rig={rig} />
    </group>
  );
}

export default function CharacterPreview({ character, color }: { character: CharacterId; color: string }) {
  if (!hasWebGL()) {
    return <span className="char-preview-emoji" style={{ background: color }}>{getCharacter(character).emoji}</span>;
  }
  return (
    <Canvas className="char-preview-canvas" dpr={[1, 2]} gl={{ alpha: true, antialias: true }}
      camera={{ position: [0, 0.34, 1.2], fov: 30 }}
      onCreated={({ camera }) => camera.lookAt(0, 0.24, 0)}>
      <hemisphereLight args={['#ffffff', '#443355', 1.1]} />
      <directionalLight position={[1.5, 2.5, 2]} intensity={2.2} />
      <directionalLight position={[-2, 1, -1.5]} intensity={0.9} color={color} />
      {/* Remount per pick/colour so the "picked!" hop replays. */}
      <Spinning key={`${character}${color}`} id={character} color={color} />
    </Canvas>
  );
}
