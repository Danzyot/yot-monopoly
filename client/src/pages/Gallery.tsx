// The character gallery: every playable character on a turntable, with its
// whole animation set on buttons — the same rig and poses the board uses.

import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Group } from 'three';
import { CHARACTER_DEFS, type CharacterId } from '../../../shared/characters.ts';
import { CHARACTER_PREF_KEY } from '../components/Lobby.tsx';
import { toast } from '../toast.tsx';
import {
  CharacterFigure, EMOTE_MS, EMOTE_OUT, emotePose, newRig, poseRig, useCharacterMaterials, type EmoteKind, type PoseInput,
} from '../three/characters/Figure.tsx';
import { SceneEnv } from '../three/SceneEnv.tsx';

type Move = 'idle' | 'walk' | 'jail' | 'win' | EmoteKind;

const MOVES: { id: Move; label: string }[] = [
  { id: 'idle', label: '😌 Idle' },
  { id: 'walk', label: '🚶 Walk' },
  { id: 'wave', label: '👋 Wave' },
  { id: 'look', label: '👀 Look around' },
  { id: 'shrug', label: '🤷 Shrug' },
  { id: 'stretch', label: '🥱 Stretch' },
  { id: 'fidget', label: '🦶 Fidget' },
  { id: 'cheer', label: '🎉 Cheer' },
  { id: 'pump', label: '💪 Yes!' },
  { id: 'taunt', label: '😏 Taunt' },
  { id: 'sad', label: '😞 Pay up' },
  { id: 'stomp', label: '😤 Jailed' },
  { id: 'jail', label: '🔒 In jail' },
  { id: 'win', label: '🏆 Winner' },
];

/** Gallery walk: hop period, with a wind-up crouch before each run of four hops and a landing rest after. */
const GALLERY_HOP_MS = 420;
const GALLERY_CROUCH_MS = 120;
const GALLERY_REST_MS = 520;
const GALLERY_HOPS = 4;
const GALLERY_WALK_MS = GALLERY_CROUCH_MS + GALLERY_HOPS * GALLERY_HOP_MS + GALLERY_REST_MS;

const COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#ec407a'];

function Turntable({ id, color, move, startedAt }: { id: CharacterId; color: string; move: Move; startedAt: number }) {
  const spin = useRef<Group>(null);
  const body = useRef<Group>(null);
  const rig = useMemo(newRig, []);
  const mats = useCharacterMaterials(id, color);
  // One PoseInput reused every frame; which hop of the walk was drawn last (its landing jolts the arms).
  const pose = useRef<PoseInput>({ time: 0, phase: 0, slump: 0, lie: 0, handsUp: 0, squash: 1 });
  const hopRef = useRef(-1);
  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;
    const dt = Math.min(delta, 0.1);
    const o = pose.current;
    o.time = t; o.phase = 0; o.slump = 0; o.lie = 0; o.handsUp = 0; o.squash = 1; o.dt = dt; o.kick = 0;
    o.walk = undefined; o.look = 0; o.wave = 0; o.pump = 0; o.sad = 0; o.stomp = 0; o.cheer = 0; o.crouch = 0;
    o.shrug = 0; o.stretch = 0; o.fidget = 0; o.taunt = 0;
    let lift = 0, twirl = 0;
    switch (move) {
      case 'idle': break;
      case 'jail': o.slump = 1; break;
      case 'walk': {
        // Wind up, four hops on the spot (alternating the leading foot), land, rest; repeat.
        const ms = (performance.now() - startedAt) % GALLERY_WALK_MS;
        if (ms < GALLERY_CROUCH_MS) {
          o.crouch = Math.min(1, (ms / GALLERY_CROUCH_MS) * 1.6);
          hopRef.current = -1;
        } else if (ms < GALLERY_CROUCH_MS + GALLERY_HOPS * GALLERY_HOP_MS) {
          const hop = Math.floor((ms - GALLERY_CROUCH_MS) / GALLERY_HOP_MS);
          const k = ((ms - GALLERY_CROUCH_MS) % GALLERY_HOP_MS) / GALLERY_HOP_MS;
          o.walk = k;
          o.stride = hop % 2 ? 1 : -1;
          lift = Math.sin(Math.PI * k) * 0.08;
          o.squash = 1 + Math.sin(Math.PI * k) * 0.12 - Math.max(0, 1 - k / 0.15) * 0.12;
          if (hop !== hopRef.current && hopRef.current >= 0) o.kick = -0.5;
          hopRef.current = hop;
        } else {
          // Landing squash, rebound, and the arms slapping down then settling.
          const land = (ms - GALLERY_CROUCH_MS - GALLERY_HOPS * GALLERY_HOP_MS) / 150;
          if (land < 1) o.squash = 1 - Math.sin(Math.PI * land) * 0.22;
          else if (land < 2.2) o.squash = 1 + Math.sin(Math.PI * (land - 1) / 1.2) * 0.06;
          if (hopRef.current >= 0) { o.kick = -0.9; hopRef.current = -1; }
        }
        break;
      }
      case 'win':
        emotePose(o, 'win', 0, t);
        lift = EMOTE_OUT.lift; twirl = EMOTE_OUT.spin;
        break;
      default: {
        const c = ((performance.now() - startedAt) % EMOTE_MS[move]) / EMOTE_MS[move];
        emotePose(o, move, c, t);
        lift = EMOTE_OUT.lift; twirl = EMOTE_OUT.spin;
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
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  // A shared link (/characters?c=robot) opens on that character.
  const fromLink = Math.max(0, CHARACTER_DEFS.findIndex(c => c.id === params.get('c')));
  const [i, setI] = useState(fromLink);
  const [color, setColor] = useState(COLORS[1]);
  const [move, setMove] = useState<Move>('idle');
  const [startedAt, setStartedAt] = useState(() => performance.now());
  const def = CHARACTER_DEFS[i];
  const pick = (m: Move) => { setMove(m); setStartedAt(performance.now()); };
  const go = (d: number) => setI(x => (x + d + CHARACTER_DEFS.length) % CHARACTER_DEFS.length);
  useEffect(() => {
    document.title = `${def.name} · Characters`;
    if (params.get('c') !== def.id) setParams({ c: def.id }, { replace: true });
    return () => { document.title = 'Yot Monopoly'; };
  }, [def, params, setParams]);
  const playAs = () => {
    try { localStorage.setItem(CHARACTER_PREF_KEY, def.id); } catch { /* private mode */ }
    toast(`${def.emoji} You'll play as ${def.name}`);
    nav('/');
  };
  const share = async () => {
    const url = `${location.origin}/characters?c=${def.id}`;
    const data = { title: `${def.name} · Yot Monopoly`, text: def.blurb, url };
    try {
      if (navigator.share && navigator.canShare?.(data)) { await navigator.share(data); return; }
    } catch { /* cancelled: fall through to copy */ }
    try { await navigator.clipboard.writeText(url); toast('Link copied!'); } catch { toast(url); }
  };
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
      <section className="panel gallery-panel" aria-live="polite">
        <h1 className="gallery-title"><span aria-hidden>{def.emoji}</span> {def.name}</h1>
        <p className="gallery-blurb">{def.blurb}</p>
        <div className="gallery-cta">
          <button className="btn primary chunky" onClick={playAs}>Play as {def.name}</button>
          <button className="btn ghost small" onClick={share} aria-label={`Share a link to ${def.name}`}>🔗 Share</button>
        </div>
        <h2 className="gallery-sub">Moves</h2>
        <div className="gallery-moves" role="group" aria-label="Moves">
          {MOVES.map(m => (
            <button key={m.id} className={`btn small ${move === m.id ? 'primary' : ''}`} aria-pressed={move === m.id} onClick={() => pick(m.id)}>{m.label}</button>
          ))}
        </div>
        <div className="gallery-colors" role="radiogroup" aria-label="Player colour">
          {COLORS.map(c => (
            <button key={c} className={`color-pick ${color === c ? 'on' : ''}`} style={{ background: c }}
              aria-label={`Colour ${c}`} aria-checked={color === c} role="radio" onClick={() => setColor(c)} />
          ))}
        </div>
        <h2 className="gallery-sub">All characters</h2>
        <div className="gallery-thumbs" role="group" aria-label="Characters">
          {CHARACTER_DEFS.map((c, k) => (
            <button key={c.id} className={`gallery-thumb ${k === i ? 'on' : ''}`} onClick={() => setI(k)} title={`${c.name} — ${c.blurb}`} aria-pressed={k === i}>
              <span aria-hidden>{c.emoji}</span><small>{c.name}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
