// The character gallery: every playable character on a turntable, with its
// whole animation set on buttons — the same rig and poses the board uses.

import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useMemo, useRef, useState } from 'react';
import type { Group } from 'three';
import { CHARACTER_DEFS, type CharacterId } from '../../../shared/characters.ts';
import { CharacterFigure, newRig, poseRig, useCharacterMaterials, type PoseInput } from '../three/characters/Figure.tsx';
import { SceneEnv } from '../three/SceneEnv.tsx';

type Move = 'idle' | 'walk' | 'wave' | 'cheer' | 'pump' | 'sad' | 'stomp' | 'look' | 'jail' | 'win';

const MOVES: { id: Move; label: string }[] = [
  { id: 'idle', label: '😌 Idle' },
  { id: 'walk', label: '🚶 Walk' },
  { id: 'wave', label: '👋 Wave' },
  { id: 'cheer', label: '🎉 Cheer' },
  { id: 'pump', label: '💪 Yes!' },
  { id: 'sad', label: '😞 Pay up' },
  { id: 'stomp', label: '😤 Jailed' },
  { id: 'look', label: '👀 Look around' },
  { id: 'jail', label: '🔒 In jail' },
  { id: 'win', label: '🏆 Winner' },
];

const COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#ec407a'];

const env = (c: number) => Math.max(0, Math.min(1, c * 5, (1 - c) * 5));

function Turntable({ id, color, move, startedAt }: { id: CharacterId; color: string; move: Move; startedAt: number }) {
  const spin = useRef<Group>(null);
  const body = useRef<Group>(null);
  const rig = useMemo(newRig, []);
  const mats = useCharacterMaterials(id, color);
  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;
    const c = ((performance.now() - startedAt) % 1800) / 1800;
    const o: PoseInput = { time: t, phase: 0, slump: 0, lie: 0, handsUp: 0, squash: 1 };
    let lift = 0, twirl = 0;
    switch (move) {
      case 'walk': {
        // Hop after hop on the spot, alternating the leading foot.
        const k = (t % 0.42) / 0.42;
        o.walk = k;
        o.stride = Math.floor(t / 0.42) % 2 ? 1 : -1;
        lift = Math.sin(Math.PI * k) * 0.08;
        o.squash = 1 + Math.sin(Math.PI * k) * 0.12 - Math.max(0, 1 - k / 0.15) * 0.12;
        break;
      }
      case 'wave': o.wave = env(c); break;
      case 'cheer':
        lift = Math.abs(Math.sin(Math.PI * 2 * c)) * 0.22 * (1 - c * 0.3);
        o.squash = 1 + lift * 0.8;
        o.handsUp = Math.sin(Math.PI * c);
        twirl = Math.PI * 2 * (c * c * (3 - 2 * c));
        break;
      case 'pump': o.pump = env(c); lift = Math.abs(Math.sin(Math.PI * 4 * c)) * 0.06 * o.pump; break;
      case 'sad': o.sad = env(c); break;
      case 'stomp': o.stomp = c; break;
      case 'look': o.look = Math.sin(c * Math.PI * 2) * 0.75 * env(c * 1.2); break;
      case 'jail': o.slump = 1; break;
      case 'win': {
        const w = (t % 0.9) / 0.9;
        lift = Math.abs(Math.sin(Math.PI * w)) * 0.26;
        o.squash = 1 + lift * 0.7;
        o.handsUp = 1;
        twirl = t * 2.5;
        break;
      }
    }
    poseRig(rig, o);
    if (body.current) {
      body.current.position.y = lift;
      body.current.rotation.y = twirl;
    }
    // Turn slowly while idle; face the viewer for the moves.
    if (spin.current) {
      if (move === 'idle') spin.current.rotation.y += Math.min(delta, 0.1) * 0.35;
      else spin.current.rotation.y *= 1 - Math.min(1, delta * 4);
    }
  });
  return (
    <group ref={spin}>
      <group ref={body}>
        <CharacterFigure id={id} mats={mats} rig={rig} />
      </group>
    </group>
  );
}

export default function Gallery() {
  const [i, setI] = useState(0);
  const [color, setColor] = useState(COLORS[1]);
  const [move, setMove] = useState<Move>('idle');
  const [startedAt, setStartedAt] = useState(() => performance.now());
  const def = CHARACTER_DEFS[i];
  const pick = (m: Move) => { setMove(m); setStartedAt(performance.now()); };
  const go = (d: number) => setI(x => (x + d + CHARACTER_DEFS.length) % CHARACTER_DEFS.length);
  return (
    <div className="gallery">
      <div className="gallery-stage">
        <Canvas dpr={[1, 2]} shadows camera={{ position: [0, 0.44, 1.45], fov: 32 }}
          onCreated={({ camera }) => camera.lookAt(0, 0.22, 0)}>
          <color attach="background" args={['#14347e']} />
          <SceneEnv intensity={0.8} />
          <hemisphereLight args={['#ffffff', '#1b2b55', 0.6]} />
          <directionalLight castShadow position={[1.2, 2.4, 1.6]} intensity={2.2} shadow-mapSize={[1024, 1024]} />
          <directionalLight position={[-1.8, 1, -1.4]} intensity={0.8} color={color} />
          <mesh receiveShadow position={[0, -0.03, 0]}>
            <cylinderGeometry args={[0.36, 0.4, 0.06, 64]} />
            <meshStandardMaterial color="#f4c542" metalness={0.6} roughness={0.35} />
          </mesh>
          <Turntable key={`${def.id}`} id={def.id} color={color} move={move} startedAt={startedAt} />
          <OrbitControls enablePan={false} target={[0, 0.22, 0]} minDistance={0.7} maxDistance={2.4}
            minPolarAngle={0.4} maxPolarAngle={Math.PI / 2.05} />
        </Canvas>
        <button className="btn gallery-arrow left" onClick={() => go(-1)} aria-label="Previous character">‹</button>
        <button className="btn gallery-arrow right" onClick={() => go(1)} aria-label="Next character">›</button>
      </div>
      <section className="panel gallery-panel">
        <h2>{def.emoji} {def.name}</h2>
        <p className="muted">{def.blurb}</p>
        <div className="gallery-moves">
          {MOVES.map(m => (
            <button key={m.id} className={`btn small ${move === m.id ? 'primary' : ''}`} onClick={() => pick(m.id)}>{m.label}</button>
          ))}
        </div>
        <div className="gallery-colors" role="radiogroup" aria-label="Player colour">
          {COLORS.map(c => (
            <button key={c} className={`color-pick ${color === c ? 'on' : ''}`} style={{ background: c }}
              aria-label={`Colour ${c}`} aria-checked={color === c} role="radio" onClick={() => setColor(c)} />
          ))}
        </div>
        <div className="gallery-thumbs">
          {CHARACTER_DEFS.map((c, k) => (
            <button key={c.id} className={`gallery-thumb ${k === i ? 'on' : ''}`} onClick={() => setI(k)} title={c.name}>
              <span>{c.emoji}</span><small>{c.name}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
