// Player pieces on the board: one procedural character per player, tinted in
// the player's colour. Movement is a queue of tile-by-tile hops built from
// server position changes (teleports — jail, long card jumps — fly straight);
// on top of that each figure breathes, turns to face where it's going,
// squashes and stretches through hops, steps foot over foot, cheers when it
// buys or earns, sulks when it pays, stamps when it's jailed, fidgets when idle, slumps
// in jail, lies down and fades when bankrupt, and dances when it wins.

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DoubleSide, Vector3, type Group, type Mesh, type MeshBasicMaterial } from 'three';
import type { GameView, PlayerState } from '../../../../shared/types.ts';
import { tileWidth, tokenSpot } from '../layout.ts';
import {
  CharacterFigure, EMOTE_MS, EMOTE_OUT, Tinter, emotePose, newRig, poseRig, useCharacterMaterials, type EmoteKind, type PoseInput,
} from './Figure.tsx';
import { ReactionBubble } from './ReactionBubble.tsx';
import { diceSettleAt, holdUntil } from '../sequence.ts';
import { FLY_MS, HOP_MS, MAX_HOPS } from '../../../../shared/pacing.ts';
import { celebrateGo } from '../GoConfetti.tsx';
import { pieceObjects } from '../camera.ts';

/** An emoji reaction currently showing over a player's character. */
export interface PieceReaction { emoji: string; seq: number }

/** The middle of the board, where the dice land. */
const CENTRE = new Vector3(0, 0, 0);
const LAND_MS = 150;
/** A resting piece winds up (crouches) this long before its first hop. */
const CROUCH_MS = 120;
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

interface Anim {
  shown: number;    // space the piece is drawn at / heading to
  queue: number[];  // spaces still to hop through
  from: [number, number];
  to: [number, number];
  t0: number;
  dur: number;
  /** Was behind bars when the last state arrived (the first hop out is a leap over them). */
  jailed: boolean;
  /** The next hop to start is the leap out of the cell; the one under way is. */
  leapNext: boolean;
  leap: boolean;
  /** When the wind-up crouch before the next move began (0: none pending). */
  crouchAt: number;
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

function Piece({ p, slot, count, turn, winner, emote, n, reaction, focusId, waitingToRoll }: {
  p: PlayerState; slot: number; count: number; turn: boolean; winner: boolean; emote?: Emote; n: number;
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
  const mats = useCharacterMaterials(p.character, p.color);
  const tinter = useMemo(() => new Tinter(mats), [mats]);
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
    anim.current = { shown: p.position, queue: [], from: target, to: target, t0: 0, dur: HOP_MS, jailed: p.inJail, leapNext: false, leap: false, crouchAt: 0 };
  } else if (anim.current.queue.at(-1) !== p.position && anim.current.shown !== p.position) {
    const a = anim.current;
    const start = a.queue.at(-1) ?? a.shown;
    const steps = (p.position - start + n) % n;
    // Teleports (jail, "go back 3") fly straight; normal moves hop tile by tile.
    if (p.inJail || steps > MAX_HOPS || steps === 0) a.queue.push(p.position);
    else for (let k = 1; k <= steps; k++) a.queue.push((start + k) % n);
    // Out of jail on a roll: the first hop clears the bars.
    a.leapNext = a.jailed && !p.inJail && steps > 0 && steps <= MAX_HOPS;
  }
  if (anim.current) anim.current.jailed = p.inJail;
  if (!motion.current) {
    // Someone already out when we arrive (reload mid-game) is simply not drawn.
    const out = p.bankrupt ? 1 : 0;
    motion.current = {
      yaw: 0, phase: Math.random() * Math.PI * 2, landAt: 0, pending: null, emote: null, emoteAt: 0,
      lastEmote: emote?.seq ?? 0, nextIdle: performance.now() + 5000 + Math.random() * 8000, hops: 0,
      slump: p.inJail ? 1 : 0, lie: out, grey: 0, opacity: 1 - out, marker: 0,
      scale: figureScale(n, count), watch: 0, waitSince: 0, tap: 0, hopping: false, hopSeen: 0,
      pose: { time: 0, phase: 0, slump: 0, lie: 0, handsUp: 0, squash: 1 },
    };
  } else if (emote && emote.seq !== motion.current.lastEmote) {
    motion.current.lastEmote = emote.seq;
    motion.current.pending = emote.kind;
  }

  useFrame((state, delta) => {
    const a = anim.current!;
    const m = motion.current!;
    const g = ref.current;
    if (!g || !yawRef.current) return;
    const dt = Math.min(delta, 0.1);
    const now = performance.now();
    const time = state.clock.elapsedTime;

    let k = a.t0 ? (now - a.t0) / a.dur : 1;
    // A fresh move waits for the dice to land first.
    const settle = diceSettleAt();
    const waiting = k >= 1 && a.queue.length > 0 && now < settle;
    // Anticipation: a piece starting from rest crouches for a beat first (a
    // move chained straight onto the last hop just keeps going).
    const resting = k >= 1 && !(a.t0 > 0 && now - (a.t0 + a.dur) < 400);
    if (a.queue.length && resting && !a.crouchAt) a.crouchAt = Math.max(now, settle - CROUCH_MS);
    const crouchT = a.crouchAt ? (now - a.crouchAt) / CROUCH_MS : 2;
    if (a.queue.length) holdUntil(Math.max(now, waiting ? settle : now) + (crouchT < 1 ? CROUCH_MS : 0) + a.queue.length * HOP_MS + LAND_MS + 250);
    while (k >= 1 && a.queue.length && !waiting && crouchT >= 1) {
      // Chain hops back to back from when the previous one ended rather than
      // from this frame, so slow frames (phones, software GL) can't leave a
      // piece trailing behind the game; hops that are already over resolve
      // in this loop without being drawn.
      const prevEnd = a.t0 + a.dur;
      const chained = a.t0 > 0 && now - prevEnd < 400;
      const next = a.queue.shift()!;
      m.hops++;
      const final = a.queue.length === 0;
      a.leap = a.leapNext;
      a.leapNext = false;
      a.crouchAt = 0;
      a.from = chained ? a.to : [g.position.x, g.position.z];
      a.to = final ? tokenSpot(next, slot, count, p.inJail, n) : tokenSpot(next, 0, 1, false, n);
      a.dur = Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]) > 2 ? FLY_MS : a.leap ? HOP_MS * 2 : HOP_MS;
      a.shown = next;
      a.t0 = chained ? prevEnd : now;
      // Onto or over GO: confetti as the hop lands.
      if (next === 0 && !p.inJail) celebrateGo(a.t0 + a.dur);
      k = (now - a.t0) / a.dur;
    }
    const hopping = k < 1;
    const long = a.dur > HOP_MS;

    const o = m.pose;
    o.time = time; o.phase = m.phase; o.handsUp = 0; o.squash = 1;
    o.walk = undefined; o.look = 0; o.wave = 0; o.pump = 0; o.sad = 0; o.stomp = 0; o.tap = undefined;
    o.cheer = 0; o.crouch = 0; o.shrug = 0; o.stretch = 0; o.fidget = 0; o.taunt = 0; o.kick = 0; o.dt = dt;
    let spin = 0;
    let lift = 0;
    let faceYaw: number;

    if (hopping) {
      const e = k * k * (3 - 2 * k);
      g.position.x = a.from[0] + (a.to[0] - a.from[0]) * e;
      g.position.z = a.from[1] + (a.to[1] - a.from[1]) * e;
      // A leap out of the cell goes high enough to clear the bars (JailCell is 0.42 tall).
      lift = Math.sin(Math.PI * k) * (long ? 1.6 : a.leap ? 1.1 : 0.3);
      // Stretch in the air, a quick squash on take-off.
      o.squash = 1 + Math.sin(Math.PI * k) * 0.2 - Math.max(0, 1 - k / 0.15) * 0.18;
      if (long) { o.handsUp = Math.sin(Math.PI * k); spin = k * Math.PI * 2; } else o.walk = k;
      // Hop to hop, the arms get a smaller jolt as each foot comes down.
      if (m.hops !== m.hopSeen) { if (m.hopSeen) o.kick = -0.5; m.hopSeen = m.hops; }
      faceYaw = Math.atan2(a.to[0] - a.from[0], a.to[1] - a.from[1]);
      m.landAt = now + a.dur * (1 - k);
      holdUntil(m.landAt + LAND_MS + 250);
    } else {
      if (!p.bankrupt) {
        // Settle into the (possibly changed) slot when other pieces arrive/leave.
        const [x, z] = tokenSpot(a.shown, slot, count, p.inJail, n);
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
      if (m.hopping) o.kick = -0.9;
      if (crouchT < 1 && !p.bankrupt) o.crouch = Math.min(1, crouchT * 1.6) * (crouchT >= 0 ? 1 : 0);

      // Reactions start once the piece has landed; idle fidgets fill the quiet.
      if (m.pending && !p.bankrupt) { m.emote = m.pending; m.pending = null; m.emoteAt = now; }
      const running = m.emote && now - m.emoteAt < EMOTE_MS[m.emote];
      if (!running) m.emote = null;
      if (!running && !winner && !p.bankrupt && !p.inJail && now > m.nextIdle) {
        m.emote = pickIdle();
        m.emoteAt = now;
        m.nextIdle = now + 9000 + Math.random() * 12000;
      }
      if (winner && !p.bankrupt) {
        emotePose(o, 'win', 0, time);
        lift = EMOTE_OUT.lift; spin = EMOTE_OUT.spin;
      } else if (m.emote) {
        emotePose(o, m.emote, (now - m.emoteAt) / EMOTE_MS[m.emote], time);
        lift = EMOTE_OUT.lift; spin = EMOTE_OUT.spin;
      }
    }
    m.hopping = hopping;
    g.position.y = lift;

    m.yaw = turnToward(m.yaw, faceYaw, hopping ? 16 : 5, dt);
    yawRef.current.rotation.y = m.yaw + spin;

    m.slump = approach(m.slump, p.inJail && !p.bankrupt ? 1 : 0, 4, dt);
    m.lie = approach(m.lie, p.bankrupt ? 1 : 0, 3, dt);
    m.grey = approach(m.grey, p.bankrupt ? 0.85 : p.inJail ? 0.6 : 0, 3, dt);
    // Fade only once it has fallen over.
    m.opacity = p.bankrupt ? (m.lie > 0.9 ? approach(m.opacity, 0, 1.5, dt) : m.opacity) : approach(m.opacity, 1, 4, dt);
    tinter.set(m.grey, m.opacity);
    g.visible = m.opacity > 0.02;

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
          <CharacterFigure id={p.character} mats={mats} rig={rig} />
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

export function Pieces({ game, n, reactions }: {
  game: GameView; n: number;
  /** Reactions to pop over characters, by player id. */
  reactions?: Record<string, PieceReaction>;
}) {
  const { players, owned, current, winner, phase } = game;

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

  // Reactions come from diffing consecutive views: a deed newly theirs or
  // cash from the bank → a cheer (a fist pump for small change); a big rent
  // taken off another player → a taunt; cash going out → a sad slump; just
  // sent to jail → a stomping tantrum.
  const prev = useRef<{ cash: Map<string, number>; owner: Map<number, string>; jail: Set<string> } | null>(null);
  const [emotes, setEmotes] = useState<Record<string, Emote>>({});
  useEffect(() => {
    const cash = new Map(players.map(p => [p.id, p.cash]));
    const owner = new Map(Object.entries(owned).map(([k, o]) => [Number(k), o.owner]));
    const jail = new Set(players.filter(p => p.inJail).map(p => p.id));
    const was = prev.current;
    prev.current = { cash, owner, jail };
    if (!was) return;
    const picks: [string, EmoteKind][] = [];
    // Someone paying in the same update means the money came from a player, not the bank.
    const paid = players.some(q => !q.bankrupt && q.cash < (was.cash.get(q.id) ?? q.cash));
    for (const p of players) {
      if (p.bankrupt) continue;
      const before = was.cash.get(p.id) ?? p.cash;
      const bought = [...owner].some(([i, o]) => o === p.id && was.owner.get(i) !== p.id);
      if (p.inJail && !was.jail.has(p.id)) picks.push([p.id, 'stomp']);
      else if (bought) picks.push([p.id, 'cheer']);
      else if (p.cash > before) picks.push([p.id, p.cash - before < 150 ? 'pump' : paid ? 'taunt' : 'cheer']);
      else if (p.cash < before) picks.push([p.id, 'sad']);
    }
    if (!picks.length) return;
    setEmotes(e => {
      const next = { ...e };
      for (const [id, kind] of picks) next[id] = { kind, seq: (e[id]?.seq ?? 0) + 1 };
      return next;
    });
  }, [players, owned]);

  return (
    <>
      {players.map(p => {
        const s = slots.get(p.id) ?? { slot: 0, count: 1 };
        return (
          <Piece key={p.id} p={p} slot={s.slot} count={s.count} n={n}
            turn={p.id === current && !winner} winner={p.id === winner} emote={emotes[p.id]}
            reaction={reactions?.[p.id]} focusId={winner ?? current} waitingToRoll={phase === 'roll'} />
        );
      })}
    </>
  );
}
