// Player pieces on the board: one procedural character per player, tinted in
// the player's colour. Movement plays the server's move record leg by leg
// (three/sequence.ts plans it on the clock: walk to the Chance square, wait
// while the card is read, walk on), hop by hop; jail and long jumps fly
// straight. Every hop has a planned start time, so a slow frame rate skips
// hops instead of stretching the walk. On top of that each figure breathes, turns to face where it's going,
// squashes and stretches through hops, steps foot over foot, cheers when it
// buys or earns, sulks when it pays, stamps when it's jailed, fidgets when idle, slumps
// in jail, lies down and fades when bankrupt, and dances when it wins. The
// reactions pull out props (moveFx.ts: a SOLD sign, a cash wad, a hard hat…)
// and make their own sounds; each hop lands with a footfall.

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DoubleSide, Vector3, type Group, type Mesh, type MeshBasicMaterial } from 'three';
import type { GameView, PlayerState } from '../../../../shared/types.ts';
import { legTiles, routeBetween, tileWidth, tokenSpot } from '../layout.ts';
import {
  CharacterFigure, EMOTE_MS, EMOTE_OUT, Tinter, emotePose, newRig, poseRig, useCharacterMaterials, type EmoteKind, type PoseInput,
} from './Figure.tsx';
import { ReactionBubble } from './ReactionBubble.tsx';
import { clearMove, hopPose } from './moves.ts';
import { MoveFX, flightSound, propHandMirrored, stepSound } from './moveFx.ts';
import { diceSettleAt, plansFor, reserveWalk, stageView, stagedGameKey } from '../sequence.ts';
import { HOP_MS, MAX_HOPS, legWalkMs } from '../../../../shared/pacing.ts';
import type { MoveLeg } from '../../../../shared/types.ts';
import { celebrateGo } from '../GoConfetti.tsx';
import { pieceObjects } from '../camera.ts';
import { isPieceHeld } from '../cinematics/store.ts';

/** An emoji reaction currently showing over a player's character. */
export interface PieceReaction { emoji: string; seq: number }

/** The middle of the board, where the dice land. */
const CENTRE = new Vector3(0, 0, 0);
const LAND_MS = 150;
/** A resting piece winds up (crouches) this long before the first hop of a leg (inside the wait before it). */
const CROUCH_MS = 120;
/** ?perf debugging: each piece's move state (window.__yotWalk). */
const walkDebug = new Map<string, () => object>();
if (typeof window !== 'undefined') Object.assign(window, { __yotWalk: () => ({ pieces: [...walkDebug].map(([id, f]) => ({ id: id.slice(-6), ...f() })) }) });
/** After the landing squash, a smaller rebound stretch. */
const REBOUND_MS = 170;

export type { EmoteKind };
export interface Emote { kind: EmoteKind; seq: number }
/** Idle fidgets and how likely each is. */
const IDLES: [EmoteKind, number][] = [['look', 0.32], ['wave', 0.14], ['shrug', 0.16], ['stretch', 0.16], ['fidget', 0.22]];
function pickIdle(): EmoteKind {
  let r = Math.random();
  for (const [kind, w] of IDLES) { r -= w; if (r <= 0) return kind; }
  return 'look';
}
/**
 * Figures are modelled ~0.45 tall. From the table camera that is a speck, so
 * they are drawn bigger — as big as the tile allows: full size alone on a
 * 40-space board, smaller on the narrow 48-space tiles and when a tile is
 * crowded (pieces sharing a space stand ~0.22–0.26 apart).
 */
function figureScale(n: number, count: number): number {
  const roomy = Math.min(1.15, Math.sqrt(tileWidth(n) / tileWidth(40)));
  const crowd = count <= 1 ? 1 : count <= 2 ? 0.88 : count <= 4 ? 0.76 : 0.64;
  return 1.7 * roomy * crowd;
}

/** One hop (or flight) of a walk, on the performance.now() clock. */
interface Seg {
  tile: number;
  t0: number;
  dur: number;
  fly: boolean;
  /** The leap out of the jail cell. */
  leap: boolean;
  /** Starts a leg from rest: the piece crouches just before it. */
  first: boolean;
}

interface Anim {
  shown: number;    // space the piece is drawn at / heading to
  /** Where the piece ends up once every planned hop is done. */
  target: number;
  /** Planned hops, in order; `next` is the first not yet started. */
  segs: Seg[];
  next: number;
  /** The hop under way (or the last one, until the piece is at rest). */
  cur: Seg | null;
  from: [number, number];
  to: [number, number];
  /** Was behind bars when the last state arrived (a walk out starts with a leap over them). */
  jailed: boolean;
  /** The last move (sequence.ts plan) taken into `segs`, and the game it belongs to. */
  planSeq: number;
  game: number | null;
}

/** Queue a leg's hops starting at `t0`. */
function addLeg(a: Anim, leg: Pick<MoveLeg, 'to' | 'kind' | 'steps' | 'leap' | 'via'>, t0: number, n: number) {
  const walk = legWalkMs(leg);
  const steps = leg.steps ?? 0;
  if (walk > 0 && leg.kind !== 'jail' && leg.kind !== 'teleport' && steps !== 0 && Math.abs(steps) <= MAX_HOPS) {
    // Tile by tile (backwards for "go back 3"), from where the server says the
    // leg began, and the way it went at Junction on a board with a lane.
    let t = t0;
    legTiles(leg, n).forEach((tile, k) => {
      const leap = k === 0 && !!leg.leap;
      const dur = leap ? HOP_MS * 2 : HOP_MS;
      a.segs.push({ tile, t0: t, dur, fly: false, leap, first: k === 0 });
      t += dur;
    });
  } else if (walk > 0) {
    a.segs.push({ tile: leg.to, t0, dur: walk, fly: true, leap: false, first: true });
  }
  a.target = leg.to;
}

/** Everything the frame loop eases between; lives in a ref, not React state. */
interface Motion {
  yaw: number;
  phase: number;
  landAt: number;
  pending: EmoteKind | null;
  emote: EmoteKind | null;
  emoteAt: number;
  lastEmote: number;
  nextIdle: number;
  hops: number;
  slump: number;
  lie: number;
  grey: number;
  opacity: number;
  marker: number;
  scale: number;
  /** Head turn toward whoever is playing (radians, + to its left). */
  watch: number;
  /** When this piece's player was first left waiting to roll (0: not waiting); foot-tap blend. */
  waitSince: number;
  tap: number;
  /** Was mid-hop last frame, and which hop was drawn last (each landing jolts the arms). */
  hopping: boolean;
  hopSeen: number;
  /** When the victory dance began (0: not dancing). */
  winAt: number;
  /** Reused every frame, so posing allocates nothing. */
  pose: PoseInput;
}

/** Ease `v` toward `to` at `rate` per second, frame-rate independent. */
const approach = (v: number, to: number, rate: number, dt: number) => v + (to - v) * (1 - Math.exp(-rate * dt));

function turnToward(from: number, to: number, rate: number, dt: number): number {
  let d = to - from;
  d = Math.atan2(Math.sin(d), Math.cos(d)); // shortest way round
  return from + d * (1 - Math.exp(-rate * dt));
}

function Piece({ p, slot, count, turn, winner, emote, n, reaction, focusId, waitingToRoll, own = false }: {
  p: PlayerState; slot: number; count: number; turn: boolean; winner: boolean; emote?: Emote; n: number;
  /** This is the local player's piece (its moves are a little louder, and it fidgets out loud). */
  own?: boolean;
  reaction?: PieceReaction;
  /** Whose turn it is: everyone else's heads follow that piece round the board. */
  focusId?: string | null;
  /** The game is waiting on the current player to roll (it taps its foot if that drags). */
  waitingToRoll?: boolean;
}) {
  const ref = useRef<Group>(null);
  const yawRef = useRef<Group>(null);
  const scaleRef = useRef<Group>(null);
  const markerRef = useRef<Group>(null);
  const ringRef = useRef<Mesh>(null);
  const rig = useMemo(newRig, []);
  const mats = useCharacterMaterials(p.character, p.color, p.chogToken);
  const tinter = useMemo(() => new Tinter(mats), [mats]);
  // Props, thrown bits and foley for the moves.
  const fx = useMemo(() => new MoveFX(), []);
  useEffect(() => () => fx.dispose(), [fx]);
  const mirror = propHandMirrored(p.character);
  const anim = useRef<Anim | null>(null);
  const motion = useRef<Motion | null>(null);
  // The follow camera tracks this piece.
  useEffect(() => {
    const g = ref.current;
    if (!g) return;
    pieceObjects.set(p.id, g);
    return () => { if (pieceObjects.get(p.id) === g) pieceObjects.delete(p.id); };
  }, [p.id]);

  // Build the hop path whenever the server position changes.
  const target = tokenSpot(p.position, slot, count, p.inJail, n);
  // Initial placement only; afterwards useFrame owns the position (a changing
  // prop here would snap the piece and kill the hop animation).
  const [initial] = useState<[number, number, number]>(() => [target[0], 0, target[1]]);
  if (!anim.current) {
    // Whatever moves were staged before this piece appeared are history.
    const seen = plansFor(p.id, 0).at(-1)?.seq ?? 0;
    anim.current = {
      shown: p.position, target: p.position, segs: [], next: 0, cur: null, from: target, to: target,
      jailed: p.inJail, planSeq: seen, game: stagedGameKey(),
    };
  } else {
    const a = anim.current;
    if (a.game !== stagedGameKey()) { a.game = stagedGameKey(); a.planSeq = 0; }
    // The moves sequence.ts has planned for this player, each leg at its planned time.
    for (const plan of plansFor(p.id, a.planSeq)) {
      a.planSeq = plan.seq;
      if (plan.initial) { a.target = plan.legs.at(-1)?.to ?? a.target; continue; }
      for (const leg of plan.legs) addLeg(a, leg, leg.t0, n);
    }
    if (a.target !== p.position) {
      // A change no move record explains (an older server, a missed update):
      // work out the walk from the positions, after the dice if there were any.
      const way = routeBetween(a.target, p.position, n);
      const steps = way.length;
      const leg: Pick<MoveLeg, 'to' | 'kind' | 'steps' | 'leap' | 'via'> = p.inJail || steps > MAX_HOPS
        ? { to: p.position, kind: p.inJail ? 'jail' : 'teleport' }
        : { to: p.position, kind: 'roll', steps, leap: a.jailed && !p.inJail, via: way };
      addLeg(a, leg, reserveWalk(diceSettleAt(), legWalkMs(leg)), n);
    }
  }
  anim.current.jailed = p.inJail;
  if (!motion.current) {
    // Someone already out when we arrive (reload mid-game) is simply not drawn.
    const out = p.bankrupt ? 1 : 0;
    motion.current = {
      yaw: 0, phase: Math.random() * Math.PI * 2, landAt: 0, pending: null, emote: null, emoteAt: 0,
      lastEmote: emote?.seq ?? 0, nextIdle: performance.now() + 5000 + Math.random() * 8000, hops: 0,
      slump: p.inJail ? 1 : 0, lie: out, grey: 0, opacity: 1 - out, marker: 0,
      scale: figureScale(n, count), watch: 0, waitSince: 0, tap: 0, hopping: false, hopSeen: 0, winAt: 0,
      pose: { time: 0, phase: 0, slump: 0, lie: 0, handsUp: 0, squash: 1 },
    };
  } else if (emote && emote.seq !== motion.current.lastEmote) {
    motion.current.lastEmote = emote.seq;
    motion.current.pending = emote.kind;
  }

  useEffect(() => {
    walkDebug.set(p.id, () => {
      const a = anim.current!;
      const now = performance.now();
      const last = a.segs.at(-1);
      return { shown: a.shown, target: a.target, planSeq: a.planSeq, hopsLeft: a.segs.length - a.next, doneInMs: last ? Math.round(last.t0 + last.dur - now) : 0 };
    });
    return () => { walkDebug.delete(p.id); };
  }, [p.id]);

  useFrame((state, delta) => {
    const a = anim.current!;
    const m = motion.current!;
    const g = ref.current;
    if (!g || !yawRef.current) return;
    const dt = Math.min(delta, 0.1);
    const now = performance.now();
    const time = state.clock.elapsedTime;

    // Start every hop whose planned time has come. Hops that are already over
    // by now (a slow frame, a hidden tab) resolve here without being drawn: the
    // piece skips ahead and stays on schedule; it never stretches the walk.
    let started = 0;
    while (a.next < a.segs.length && a.segs[a.next].t0 <= now) {
      const s = a.segs[a.next++];
      a.from = a.cur ? a.to : [g.position.x, g.position.z];
      // The very last hop lands in this piece's slot; the rest pass through the middle of the tile.
      a.to = a.next === a.segs.length ? tokenSpot(s.tile, slot, count, p.inJail, n) : tokenSpot(s.tile, 0, 1, false, n);
      a.cur = s;
      a.shown = s.tile;
      m.hops++;
      started++;
      // Onto or over GO: confetti as the hop lands (not for hops long gone).
      if (s.tile === 0 && !p.inJail && s.t0 + s.dur > now - 300) celebrateGo(s.t0 + s.dur);
    }
    const cur = a.cur;
    const k = cur ? (now - cur.t0) / cur.dur : 1;
    const hopping = !!cur && k < 1;
    if (cur && !hopping) {
      m.landAt = cur.t0 + cur.dur;
      if (a.next >= a.segs.length) { a.segs = []; a.next = 0; }
      a.cur = null;
    }
    // Anticipation: a leg starting from rest crouches for a beat first (inside the wait before it).
    const nextSeg = a.segs[a.next];
    const crouchT = !hopping && nextSeg?.first ? (now - (nextSeg.t0 - CROUCH_MS)) / CROUCH_MS : 2;
    const long = !!cur && cur.fly;
    const leap = !!cur && cur.leap;

    const o = m.pose;
    o.time = time; o.phase = m.phase; o.handsUp = 0; o.squash = 1;
    o.walk = undefined; o.look = 0; o.wave = 0; o.pump = 0; o.sad = 0; o.stomp = 0; o.tap = undefined;
    o.cheer = 0; o.crouch = 0; o.shrug = 0; o.stretch = 0; o.fidget = 0; o.taunt = 0; o.kick = 0; o.dt = dt;
    clearMove(o);
    o.mirror = mirror;
    let spin = 0;
    let lift = 0;
    let faceYaw: number;

    if (hopping && cur) {
      // A hop carries its speed straight across (the weight is in the arc);
      // a long flight eases off and in.
      const e = long ? k * k * (3 - 2 * k) : k;
      g.position.x = a.from[0] + (a.to[0] - a.from[0]) * e;
      g.position.z = a.from[1] + (a.to[1] - a.from[1]) * e;
      // A gravity arc, squat on take-off and stretched in the air (moves.ts).
      // A leap out of the cell goes high enough to clear the bars (JailCell is 0.42 tall).
      lift = hopPose(o, k) * (long ? 1.6 : leap ? 1.1 : 0.3);
      if (long) { o.handsUp = Math.sin(Math.PI * k); spin = k * Math.PI * 2; } else o.walk = k;
      // Hop to hop, the arms get a smaller jolt as each foot comes down.
      if (m.hops !== m.hopSeen) { if (m.hopSeen) o.kick = -0.5; m.hopSeen = m.hops; hopSounds(m.hopping || started > 1, long || leap, own); }
      faceYaw = Math.atan2(a.to[0] - a.from[0], a.to[1] - a.from[1]);
      m.landAt = cur.t0 + cur.dur;
    } else {
      if (!p.bankrupt) {
        // Settle into the (possibly changed) slot when other pieces arrive/leave;
        // between legs (a card being read) it waits in the middle of the tile.
        const [x, z] = a.next < a.segs.length ? tokenSpot(a.shown, 0, 1, false, n) : tokenSpot(a.shown, slot, count, p.inJail, n);
        g.position.x += (x - g.position.x) * 0.2;
        g.position.z += (z - g.position.z) * 0.2;
      }
      // At rest, turn to face the viewer so faces are readable.
      faceYaw = Math.atan2(state.camera.position.x - g.position.x, state.camera.position.z - g.position.z);
      // Landing: a squash, then a smaller rebound stretch; the arms get a jolt
      // on the landing frame and spring back a beat behind the body.
      const land = (now - m.landAt) / LAND_MS;
      if (m.landAt && land < 1) o.squash = 1 - Math.sin(Math.PI * land) * 0.22;
      else if (m.landAt && land < 1 + REBOUND_MS / LAND_MS) o.squash = 1 + Math.sin(Math.PI * (land - 1) * LAND_MS / REBOUND_MS) * 0.06;
      if (m.hopping) { o.kick = -0.9; stepSound(own ? 1 : 0.7); }
      if (crouchT < 1 && !p.bankrupt) o.crouch = Math.min(1, crouchT * 1.6) * (crouchT >= 0 ? 1 : 0);

      // Reactions start once the piece has landed; idle fidgets fill the quiet.
      if (m.pending && (!p.bankrupt || m.pending === 'surrender')) { m.emote = m.pending; m.pending = null; m.emoteAt = now; }
      const running = m.emote && now - m.emoteAt < EMOTE_MS[m.emote];
      if (!running) m.emote = null;
      if (!running && !winner && !p.bankrupt && now > m.nextIdle) {
        // Behind bars the only fidget is the tin cup on the bars.
        m.emote = p.inJail ? 'rattle' : pickIdle();
        m.emoteAt = now;
        m.nextIdle = now + 9000 + Math.random() * 12000;
      }
      if (winner && !p.bankrupt) {
        m.winAt ||= now;
        emotePose(o, 'win', (now - m.winAt) / 1000, time);
        lift = EMOTE_OUT.lift; spin = EMOTE_OUT.spin;
        fx.cue('win', now - m.winAt, own ? 1 : 0.6, own);
      } else if (m.emote) {
        emotePose(o, m.emote, (now - m.emoteAt) / EMOTE_MS[m.emote], time);
        lift = EMOTE_OUT.lift; spin = EMOTE_OUT.spin;
        // Everyone's reactions are heard (others' a little quieter); idle fidgets only your own.
        fx.cue(m.emote, now - m.emoteAt, own ? 1 : 0.6, own, own);
      } else fx.cue(null, 0);
    }
    m.hopping = hopping;
    g.position.y = lift;

    m.yaw = turnToward(m.yaw, faceYaw, hopping ? 16 : 5, dt);
    yawRef.current.rotation.y = m.yaw + spin;

    m.slump = approach(m.slump, p.inJail && !p.bankrupt ? 1 : 0, 4, dt);
    // Bankrupt: the white flag first, then over it goes.
    m.lie = approach(m.lie, p.bankrupt && m.emote !== 'surrender' && m.pending !== 'surrender' ? 1 : 0, 3, dt);
    m.grey = approach(m.grey, p.bankrupt ? 0.85 : p.inJail ? 0.6 : 0, 3, dt);
    // Fade only once it has fallen over.
    m.opacity = p.bankrupt ? (m.lie > 0.9 ? approach(m.opacity, 0, 1.5, dt) : m.opacity) : approach(m.opacity, 1, 4, dt);
    tinter.set(m.grey, m.opacity);
    g.visible = m.opacity > 0.02;
    // ── Cutscene hook (three/cinematics): while a cutscene plays this piece, its double is drawn instead. ──
    if (isPieceHeld(p.id)) g.visible = false;

    // Grow/shrink smoothly as pieces join or leave the tile.
    m.scale = approach(m.scale, figureScale(n, count), 6, dt);
    scaleRef.current?.scale.setScalar(m.scale);

    // At rest, keep an eye on whoever is playing (within what a neck can turn);
    // the one playing eyes the dice in the middle while its player dithers.
    let watch = 0;
    const mine = focusId === p.id;
    const focus = focusId && !mine && !hopping && !winner && !p.bankrupt ? pieceObjects.get(focusId) : undefined;
    const idle = mine && waitingToRoll && !hopping && !winner && !p.bankrupt && !p.inJail && !m.emote;
    if (!idle) m.waitSince = 0;
    else if (!m.waitSince) m.waitSince = now;
    const waited = m.waitSince ? (now - m.waitSince) / 1000 : 0;
    const tapping = waited > 6;
    const aim = focus ? focus.position : tapping ? CENTRE : null;
    if (aim) {
      const dx = aim.x - g.position.x, dz = aim.z - g.position.z;
      if (dx * dx + dz * dz > 0.04) {
        const rel = Math.atan2(Math.sin(Math.atan2(dx, dz) - m.yaw), Math.cos(Math.atan2(dx, dz) - m.yaw));
        watch = Math.max(-1, Math.min(1, rel)) * (p.inJail ? 0.5 : 0.85);
      }
    }
    m.watch = approach(m.watch, watch, 3, dt);
    m.tap = approach(m.tap, tapping ? 1 : 0, 4, dt);

    o.slump = m.slump; o.lie = m.lie;
    o.stride = m.hops % 2 ? 1 : -1;
    o.look = (o.look ?? 0) + m.watch * (1 - Math.abs(o.look ?? 0));
    o.tap = m.tap > 0.02 ? m.tap : undefined;
    poseRig(rig, o);
    fx.update(rig, mirror, -lift / m.scale);

    // Whose turn: a bobbing, spinning arrow above the head and a ground ring.
    m.marker = approach(m.marker, turn && !winner && !p.bankrupt ? 1 : 0, 8, dt);
    if (markerRef.current) {
      markerRef.current.visible = m.marker > 0.01;
      markerRef.current.scale.setScalar(m.marker);
      markerRef.current.position.y = 0.78 + Math.sin(time * 4) * 0.04;
      markerRef.current.rotation.y = time * 2;
    }
    if (ringRef.current) {
      ringRef.current.visible = m.marker > 0.01;
      (ringRef.current.material as MeshBasicMaterial).opacity = m.marker * (0.6 + Math.sin(time * 5) * 0.25);
      ringRef.current.position.y = (0.006 - lift) / m.scale; // stays on the board mid-hop
      const s = 1 + ((time * 0.8) % 1) * 0.15;
      ringRef.current.scale.set(s, s, 1);
    }
  });

  return (
    <group ref={ref} position={initial}>
      <group ref={scaleRef}>
        <group ref={yawRef}>
          <CharacterFigure id={p.character} mats={mats} rig={rig} outfit={p.outfit} chogToken={p.chogToken} />
          <primitive object={fx.fx} />
          {winner && <Crown />}
        </group>
        <group ref={markerRef} visible={false}>
          <mesh rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.09, 0.17, 4]} />
            <meshStandardMaterial color={p.color} emissive={p.color} emissiveIntensity={0.7} roughness={0.35} />
          </mesh>
        </group>
        <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
          <ringGeometry args={[0.15, 0.19, 32]} />
          <meshBasicMaterial color={p.color} transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
      <ReactionBubble emoji={reaction && !p.bankrupt ? reaction.emoji : undefined} seq={reaction?.seq} />
    </group>
  );
}

/** A new hop has begun: the footfall of the one before it (when chained), a whoosh when this one flies. */
function hopSounds(chained: boolean, flies: boolean, mine: boolean) {
  const v = mine ? 1 : 0.7;
  if (chained) stepSound(v);
  if (flies) flightSound(v);
}

/** Gold crown floating over the winner's head. */
function Crown() {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = 0.56 + Math.sin(clock.elapsedTime * 3) * 0.02;
  });
  return (
    <group ref={ref}>
      <mesh>
        <cylinderGeometry args={[0.085, 0.075, 0.05, 16, 1, true]} />
        <meshStandardMaterial color="#f4c542" emissive="#b8860b" emissiveIntensity={0.4} metalness={0.8} roughness={0.3} side={DoubleSide} />
      </mesh>
      {[0, 1, 2, 3, 4].map(k => {
        const a = (k / 5) * Math.PI * 2;
        return (
          <mesh key={k} position={[Math.sin(a) * 0.08, 0.05, Math.cos(a) * 0.08]}>
            <coneGeometry args={[0.022, 0.06, 6]} />
            <meshStandardMaterial color="#f4c542" emissive="#b8860b" emissiveIntensity={0.4} metalness={0.8} roughness={0.3} />
          </mesh>
        );
      })}
    </group>
  );
}

export function Pieces({ game, n, reactions, me }: {
  game: GameView; n: number;
  /** The local player (their own piece's moves are a little louder). */
  me?: string;
  /** Reactions to pop over characters, by player id. */
  reactions?: Record<string, PieceReaction>;
}) {
  const { players, owned, current, winner, phase } = game;
  // Plan this view's move (if the HUD has not already) before the pieces read it.
  stageView(game);

  // Slot assignment per tile so pieces sharing a space don't overlap.
  const slots = useMemo(() => {
    const m = new Map<string, { slot: number; count: number }>();
    const byTile = new Map<string, PlayerState[]>();
    for (const p of players) {
      if (p.bankrupt) continue;
      const key = `${p.position}:${p.inJail ? 'in' : 'out'}`;
      byTile.set(key, [...(byTile.get(key) ?? []), p]);
    }
    for (const list of byTile.values()) list.forEach((p, k) => m.set(p.id, { slot: k, count: list.length }));
    return m;
  }, [players]);

  // Reactions come from diffing consecutive views (pickReactions, below).
  const prev = useRef<ReactionSnapshot | null>(null);
  const [emotes, setEmotes] = useState<Record<string, Emote>>({});
  const { trades } = game;
  useEffect(() => {
    const now = snapshot(players, owned, trades);
    const was = prev.current;
    prev.current = now;
    if (!was) return;
    const picks = pickReactions(players, was, now, n);
    if (!picks.length) return;
    setEmotes(e => {
      const next = { ...e };
      for (const [id, kind] of picks) next[id] = { kind, seq: (e[id]?.seq ?? 0) + 1 };
      return next;
    });
  }, [players, owned, trades, n]);

  return (
    <>
      {players.map(p => {
        const s = slots.get(p.id) ?? { slot: 0, count: 1 };
        return (
          <Piece key={p.id} p={p} slot={s.slot} count={s.count} n={n}
            turn={p.id === current && !winner} winner={p.id === winner} emote={emotes[p.id]}
            reaction={reactions?.[p.id]} focusId={winner ?? current} waitingToRoll={phase === 'roll'} own={p.id === me} />
        );
      })}
    </>
  );
}

// ---- reactions --------------------------------------------------------------
// What each piece does about the latest update, from diffing two views. In
// order of precedence: out of the game → the white flag; sent to jail → a
// stomping tantrum; a trade gone through → the contract; a deed bought → the
// SOLD sign; a house or hotel up → the hard hat; passed GO → the party
// popper; cash from the bank → a cheer (a coin flip for small change); rent
// taken off another player → a taunt with the wad; cash going out → paying up
// (the money bag and the sad trombone when it hurts); a trade offered → on
// the phone.

interface ReactionSnapshot {
  cash: Map<string, number>;
  pos: Map<string, number>;
  owner: Map<number, string>;
  houses: Map<number, number>;
  jail: Set<string>;
  out: Set<string>;
  /** Open trade offers: id → who made it. */
  trades: Map<string, string>;
}

function snapshot(players: PlayerState[], owned: GameView['owned'], trades: GameView['trades'] | undefined): ReactionSnapshot {
  return {
    cash: new Map(players.map(p => [p.id, p.cash])),
    pos: new Map(players.map(p => [p.id, p.position])),
    owner: new Map(Object.entries(owned).map(([k, o]) => [Number(k), o.owner])),
    houses: new Map(Object.entries(owned).map(([k, o]) => [Number(k), o.houses])),
    jail: new Set(players.filter(p => p.inJail).map(p => p.id)),
    out: new Set(players.filter(p => p.bankrupt).map(p => p.id)),
    trades: new Map((trades ?? []).map(t => [t.id, t.from])),
  };
}

/** Paying out this much (or half of everything it had) is a big hit. */
const BIG_PAY = 250;

function pickReactions(players: PlayerState[], was: ReactionSnapshot, now: ReactionSnapshot, n: number): [string, EmoteKind][] {
  const picks: [string, EmoteKind][] = [];
  // Someone paying in the same update means the money came from a player, not the bank.
  const paid = players.some(q => !q.bankrupt && q.cash < (was.cash.get(q.id) ?? q.cash));
  // Deeds passing between two players still in the game: a trade.
  const traded = new Set<string>();
  for (const [i, o] of now.owner) {
    const from = was.owner.get(i);
    if (from && from !== o && !now.out.has(from)) { traded.add(from); traded.add(o); }
  }
  const offering = new Set<string>();
  for (const [id, from] of now.trades) if (!was.trades.has(id)) offering.add(from);
  for (const p of players) {
    if (p.bankrupt) {
      if (!was.out.has(p.id)) picks.push([p.id, 'surrender']);
      continue;
    }
    const before = was.cash.get(p.id) ?? p.cash;
    const bought = [...now.owner].some(([i, o]) => o === p.id && !was.owner.has(i));
    const built = [...now.houses].some(([i, h]) => now.owner.get(i) === p.id && was.owner.get(i) === p.id && h > (was.houses.get(i) ?? 0));
    // Came round the corner on an ordinary move (a trip to jail flies the other way).
    const from = was.pos.get(p.id) ?? p.position;
    const way = routeBetween(from, p.position, n);
    const passedGo = !p.inJail && way.length > 0 && way.length <= 12 && way.includes(0);
    if (p.inJail && !was.jail.has(p.id)) picks.push([p.id, 'stomp']);
    else if (traded.has(p.id)) picks.push([p.id, 'deal']);
    else if (bought) picks.push([p.id, 'sold']);
    else if (built) picks.push([p.id, 'build']);
    else if (p.cash > before) picks.push([p.id, passedGo ? 'popper' : p.cash - before < 150 ? 'pump' : paid ? 'taunt' : 'cheer']);
    else if (p.cash < before) picks.push([p.id, before - p.cash >= Math.min(BIG_PAY, before / 2) ? 'sad' : 'pay']);
    else if (offering.has(p.id)) picks.push([p.id, 'phone']);
  }
  return picks;
}
