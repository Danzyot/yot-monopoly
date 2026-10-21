// The players at the table: Monopoly's chibi characters (three/characters),
// one per seat in the player's colour and outfit (a holder's own NFT Chog for theirs, which wears
// its own traits), standing at the rim behind their hand.
// They breathe and glance at whoever is playing, lean in to play a card,
// cheer when they call "Last card!", sulk when they are caught or hit with a
// draw, pump a fist for a Purge or a Blitz, taunt as they stack a penalty on,
// grey out when the Mercy rule knocks them out of the round (LastCardFire
// sets anyone on one card alight), and the match winner hops into the middle
// of the table for the victory dance. Our own figure is kept out of sight (the camera is our eyes)
// until a cut or the podium calls for it.

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { Vector3, type Group, type Mesh, type MeshBasicMaterial, type Object3D } from 'three';
import type { CardsPlayerView, CardsStep } from '../../../../shared/cards/types.ts';
import type { CardsSeatView } from '../../../../shared/cards/room.ts';
import {
  CharacterFigure, EMOTE_MS, EMOTE_OUT, Tinter, emotePose, newRig, poseRig, useCharacterMaterials, type EmoteKind, type PoseInput,
} from '../../three/characters/Figure.tsx';
import { clearMove } from '../../three/characters/moves.ts';
import { SEASON_CHARACTERS } from '../../../../shared/season.ts';
import { CENTRE, FELT_Y, FIG_SCALE, faceCentreYaw, seatPos } from './layout.ts';
import type { SceneState } from './state.ts';

const IDLES: EmoteKind[] = ['look', 'shrug', 'stretch', 'fidget', 'wave'];

/** What a figure does about a step (the one it is about). */
function emoteFor(s: CardsStep, id: string): EmoteKind | null {
  switch (s.type) {
    case 'call': return s.player === id ? 'cheer' : null;
    case 'catch': return s.target === id ? 'sad' : s.player === id ? 'taunt' : null;
    case 'skip': return s.player === id ? 'shrug' : null;
    case 'timeout': return s.player === id ? 'stretch' : null;
    case 'draw': return s.player === id && s.reason !== 'turn' && s.reason !== 'start' ? 'sad' : null;
    case 'challenge':
      if (s.bluff) return s.target === id ? 'pump' : s.player === id ? 'sad' : null;
      return s.player === id ? 'taunt' : s.target === id ? 'sad' : null;
    case 'swap': return s.player === id || s.target === id ? 'shrug' : null;
    case 'roundEnd': return s.winner === id ? 'cheer' : null;
    case 'purge':
    case 'blitz': return s.player === id ? 'pump' : null;
    case 'stack': return s.player === id ? 'taunt' : null;
    case 'roulette': return s.player === id ? 'shrug' : null;
    case 'mercy': return s.player === id ? 'sad' : null;
    default: return null;
  }
}

const approach = (v: number, to: number, rate: number, dt: number) => v + (to - v) * (1 - Math.exp(-rate * dt));
function turnToward(from: number, to: number, rate: number, dt: number): number {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + d * (1 - Math.exp(-rate * dt));
}

const target = new Vector3();

interface Motion {
  phase: number;
  seq: number;
  seen: Set<number>;
  emote: EmoteKind | null;
  emoteAt: number;
  nextIdle: number;
  winAt: number;
  yaw: number;
  look: number;
  grey: number;
  opacity: number;
  ring: number;
  placed: boolean;
  pose: PoseInput;
}

function Seat({ p, seat, state, lite }: { p: CardsPlayerView; seat?: CardsSeatView; state: RefObject<SceneState | null>; lite: boolean }) {
  const character = seat?.character ?? SEASON_CHARACTERS[0];
  const color = seat?.color ?? '#9aa7ff';
  // A holder's own Chog Genesis token, assembled from its traits (Monopoly's pieces do the same).
  const chogToken = seat?.chogToken;
  const rig = useMemo(newRig, []);
  const mats = useCharacterMaterials(character, color, chogToken);
  const tinter = useMemo(() => new Tinter(mats), [mats]);
  const root = useRef<Group>(null);
  const yawRef = useRef<Group>(null);
  const ring = useRef<Mesh>(null);
  const anchor = useRef<Object3D>(null);
  const m = useRef<Motion | null>(null);
  m.current ??= {
    phase: Math.random() * Math.PI * 2, seq: -1, seen: new Set(), emote: null, emoteAt: 0,
    nextIdle: performance.now() + 6000 + Math.random() * 9000, winAt: 0, yaw: 0, look: 0, grey: 0, opacity: 1, ring: 0, placed: false,
    pose: { time: 0, phase: 0, slump: 0, lie: 0, handsUp: 0, squash: 1 },
  };

  useEffect(() => {
    const st = state.current;
    const a = anchor.current;
    if (!st || !a) return;
    st.anchors.set(p.id, a);
    return () => { st.anchors.delete(p.id); };
  }, [p.id, state]);

  useFrame(({ clock, camera }, delta) => {
    const st = state.current;
    const g = root.current;
    const mo = m.current!;
    if (!st || !g || !yawRef.current) return;
    const dt = Math.min(delta, 0.1);
    const now = performance.now();
    const time = clock.elapsedTime;
    const { frame, podium, me } = st;
    const live = st.view.phase !== 'over' && st.view.phase !== 'roundOver';
    const angle = st.angles.get(p.id) ?? Math.PI * 1.5;
    const mine = p.id === me;
    const winner = podium === p.id;

    // Where to stand: the seat, or the middle of the table for the victory dance.
    if (winner) target.set(CENTRE.x, FELT_Y, CENTRE.z + 0.3);
    else seatPos(angle, undefined, target);
    // The podium cuts in with the winner already in the middle (the camera cuts there at the same moment).
    if (!mo.placed || (winner && !mo.winAt)) { g.position.copy(target); mo.placed = true; }
    else g.position.lerp(target, 1 - Math.exp(-5 * dt));

    // Reactions, from the steps of the play staging now (each once, as it starts).
    const play = frame.play;
    if (play) {
      if (play.seq !== mo.seq) { mo.seq = play.seq; mo.seen.clear(); }
      for (const s of play.steps) {
        if (s.at > now || mo.seen.has(s.index)) continue;
        mo.seen.add(s.index);
        const e = emoteFor(s.step, p.id);
        if (e) { mo.emote = e; mo.emoteAt = now; }
      }
    }

    const o = mo.pose;
    o.time = time; o.phase = mo.phase; o.handsUp = 0; o.squash = 1;
    o.walk = undefined; o.look = 0; o.wave = 0; o.pump = 0; o.sad = 0; o.stomp = 0; o.tap = undefined;
    o.cheer = 0; o.crouch = 0; o.shrug = 0; o.stretch = 0; o.fidget = 0; o.taunt = 0; o.kick = 0; o.dt = dt;
    clearMove(o);
    let lift = 0, spin = 0;

    if (winner) {
      mo.winAt ||= now;
      emotePose(o, 'win', (now - mo.winAt) / 1000, time);
      lift = EMOTE_OUT.lift; spin = EMOTE_OUT.spin;
    } else {
      mo.winAt = 0;
      const running = mo.emote && now - mo.emoteAt < EMOTE_MS[mo.emote];
      if (!running) mo.emote = null;
      if (!running && !p.left && now > mo.nextIdle && !frame.busy) {
        mo.emote = IDLES[Math.floor(Math.random() * IDLES.length)];
        mo.emoteAt = now;
        mo.nextIdle = now + 10000 + Math.random() * 14000;
      }
      if (mo.emote) {
        emotePose(o, mo.emote, (now - mo.emoteAt) / EMOTE_MS[mo.emote], time);
        lift = EMOTE_OUT.lift; spin = EMOTE_OUT.spin;
      }
      // Playing a card: lean in over the table and reach out, then sit back.
      if (play) {
        for (const s of play.steps) {
          if (s.step.type !== 'play' || s.step.player !== p.id || s.at > now || now >= s.end) continue;
          const k = (now - s.at) / Math.max(1, s.end - s.at);
          const bell = Math.sin(Math.PI * Math.min(1, k * 1.3));
          o.lean = (o.lean ?? 0) + 0.22 * bell;
          o.nod = (o.nod ?? 0) + 0.12 * bell;
          o.reach![1] = bell;
          const r = o.reachAt!;
          r[5] = -0.06; r[6] = 0.2 + 0.06 * bell; r[7] = 0.16; r[8] = -0.4; r[9] = -0.2;
        }
      }
    }

    // Face the middle of the table (the camera, for the dance); glance at whoever is playing.
    const faceYaw = winner ? Math.atan2(camera.position.x - g.position.x, camera.position.z - g.position.z) : faceCentreYaw(angle);
    mo.yaw = turnToward(mo.yaw, faceYaw, 4, dt);
    let look = 0;
    const focus = frame.current;
    if (!winner && focus && focus !== p.id) {
      const fa = st.angles.get(focus);
      if (fa !== undefined) {
        const f = focus === me ? camera.position : seatPos(fa, undefined, target);
        const rel = Math.atan2(f.x - g.position.x, f.z - g.position.z) - mo.yaw;
        look = Math.max(-1, Math.min(1, Math.atan2(Math.sin(rel), Math.cos(rel)))) * 0.8;
      }
    }
    mo.look = approach(mo.look, look, 3, dt);
    o.look = (o.look ?? 0) + mo.look * (1 - Math.abs(o.look ?? 0));
    o.stride = 1;
    poseRig(rig, o);

    g.position.y = FELT_Y + lift * 1.6;
    yawRef.current.rotation.y = mo.yaw + spin;

    // Left players fade to grey (knocked-out ones half way: they are back next round); our own figure shows only when wanted.
    mo.grey = approach(mo.grey, p.left ? 0.85 : p.out && live ? 0.6 : 0, 3, dt);
    mo.opacity = approach(mo.opacity, p.left ? 0.45 : 1, 3, dt);
    tinter.set(mo.grey, mo.opacity);
    g.visible = !mine || st.showMe;

    // Whose turn: a pulsing ring on the felt in the seat's colour.
    mo.ring = approach(mo.ring, frame.current === p.id && live && !winner ? 1 : 0, 8, dt);
    const r = ring.current;
    if (r) {
      r.visible = mo.ring > 0.01;
      (r.material as MeshBasicMaterial).opacity = mo.ring * (0.55 + Math.sin(time * 5) * 0.25);
      r.position.y = (0.004 - lift * 1.6) / FIG_SCALE;
      const k = 1 + ((time * 0.8) % 1) * 0.15;
      r.scale.set(k, k, 1);
    }
  });

  return (
    <group ref={root}>
      <group scale={FIG_SCALE}>
        <group ref={yawRef}>
          <CharacterFigure id={character} mats={mats} rig={rig} lite={lite} outfit={seat?.outfit} chogToken={chogToken} />
        </group>
        {/* Just over the head: the seat's chip sits on it (pinned by CardsScene). */}
        <object3D ref={anchor} position={[0, 0.6, 0]} />
        <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
          <ringGeometry args={[0.17, 0.215, 40]} />
          <meshBasicMaterial color={color} transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

export function Seats({ players, seats, state, lite }: {
  players: CardsPlayerView[]; seats: Record<string, CardsSeatView>; state: RefObject<SceneState | null>; lite: boolean;
}) {
  return <>{players.map(p => <Seat key={p.id} p={p} seat={seats[p.id]} state={state} lite={lite} />)}</>;
}
