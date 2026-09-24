// Player pieces on the board: one procedural character per player, tinted in
// the player's colour. Movement is a queue of tile-by-tile hops built from
// server position changes (teleports — jail, long card jumps — fly straight);
// on top of that each figure breathes, turns to face where it's going,
// squashes and stretches through hops, cheers when it buys or earns, slumps
// in jail, lies down and fades when bankrupt, and dances when it wins.

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DoubleSide, type Group, type Mesh, type MeshBasicMaterial } from 'three';
import type { GameView, PlayerState } from '../../../../shared/types.ts';
import { tileWidth, tokenSpot } from '../layout.ts';
import { CharacterFigure, Tinter, newRig, poseRig, useCharacterMaterials } from './Figure.tsx';
import { ReactionBubble } from './ReactionBubble.tsx';

/** An emoji reaction currently showing over a player's character. */
export interface PieceReaction { emoji: string; seq: number }

const HOP_MS = 190;
const LAND_MS = 150;
const CHEER_MS = 1000;
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
}

/** Everything the frame loop eases between; lives in a ref, not React state. */
interface Motion {
  yaw: number;
  phase: number;
  landAt: number;
  cheerPending: boolean;
  cheerAt: number;
  lastCheer: number;
  slump: number;
  lie: number;
  grey: number;
  opacity: number;
  marker: number;
  scale: number;
}

/** Ease `v` toward `to` at `rate` per second, frame-rate independent. */
const approach = (v: number, to: number, rate: number, dt: number) => v + (to - v) * (1 - Math.exp(-rate * dt));

function turnToward(from: number, to: number, rate: number, dt: number): number {
  let d = to - from;
  d = Math.atan2(Math.sin(d), Math.cos(d)); // shortest way round
  return from + d * (1 - Math.exp(-rate * dt));
}

function Piece({ p, slot, count, turn, winner, cheer, n, reaction }: {
  p: PlayerState; slot: number; count: number; turn: boolean; winner: boolean; cheer: number; n: number;
  reaction?: PieceReaction;
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

  // Build the hop path whenever the server position changes.
  const target = tokenSpot(p.position, slot, count, p.inJail, n);
  // Initial placement only; afterwards useFrame owns the position (a changing
  // prop here would snap the piece and kill the hop animation).
  const [initial] = useState<[number, number, number]>(() => [target[0], 0, target[1]]);
  if (!anim.current) {
    anim.current = { shown: p.position, queue: [], from: target, to: target, t0: 0, dur: HOP_MS };
  } else if (anim.current.queue.at(-1) !== p.position && anim.current.shown !== p.position) {
    const a = anim.current;
    const start = a.queue.at(-1) ?? a.shown;
    const steps = (p.position - start + n) % n;
    // Teleports (jail, "go back 3") fly straight; normal moves hop tile by tile.
    if (p.inJail || steps > 12 || steps === 0) a.queue.push(p.position);
    else for (let k = 1; k <= steps; k++) a.queue.push((start + k) % n);
  }
  if (!motion.current) {
    // Someone already out when we arrive (reload mid-game) is simply not drawn.
    const out = p.bankrupt ? 1 : 0;
    motion.current = {
      yaw: 0, phase: Math.random() * Math.PI * 2, landAt: 0, cheerPending: false, cheerAt: 0,
      lastCheer: cheer, slump: p.inJail ? 1 : 0, lie: out, grey: 0, opacity: 1 - out, marker: 0,
      scale: figureScale(n, count),
    };
  } else if (cheer !== motion.current.lastCheer) {
    motion.current.lastCheer = cheer;
    motion.current.cheerPending = true;
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
    while (k >= 1 && a.queue.length) {
      // Chain hops back to back from when the previous one ended rather than
      // from this frame, so slow frames (phones, software GL) can't leave a
      // piece trailing behind the game; hops that are already over resolve
      // in this loop without being drawn.
      const prevEnd = a.t0 + a.dur;
      const chained = a.t0 > 0 && now - prevEnd < 400;
      const next = a.queue.shift()!;
      const final = a.queue.length === 0;
      a.from = chained ? a.to : [g.position.x, g.position.z];
      a.to = final ? tokenSpot(next, slot, count, p.inJail, n) : tokenSpot(next, 0, 1, false, n);
      a.dur = Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]) > 2 ? 750 : HOP_MS;
      a.shown = next;
      a.t0 = chained ? prevEnd : now;
      k = (now - a.t0) / a.dur;
    }
    const hopping = k < 1;
    const long = a.dur > HOP_MS;

    let squash = 1;
    let handsUp = 0;
    let spin = 0;
    let lift = 0;
    let faceYaw: number;

    if (hopping) {
      const e = k * k * (3 - 2 * k);
      g.position.x = a.from[0] + (a.to[0] - a.from[0]) * e;
      g.position.z = a.from[1] + (a.to[1] - a.from[1]) * e;
      lift = Math.sin(Math.PI * k) * (long ? 1.6 : 0.3);
      // Stretch in the air, a quick squash on take-off.
      squash = 1 + Math.sin(Math.PI * k) * 0.2 - Math.max(0, 1 - k / 0.15) * 0.18;
      if (long) { handsUp = Math.sin(Math.PI * k); spin = k * Math.PI * 2; }
      faceYaw = Math.atan2(a.to[0] - a.from[0], a.to[1] - a.from[1]);
      m.landAt = now + a.dur * (1 - k);
    } else {
      if (!p.bankrupt) {
        // Settle into the (possibly changed) slot when other pieces arrive/leave.
        const [x, z] = tokenSpot(a.shown, slot, count, p.inJail, n);
        g.position.x += (x - g.position.x) * 0.2;
        g.position.z += (z - g.position.z) * 0.2;
      }
      // At rest, turn to face the viewer so faces are readable.
      faceYaw = Math.atan2(state.camera.position.x - g.position.x, state.camera.position.z - g.position.z);
      const land = (now - m.landAt) / LAND_MS;
      if (m.landAt && land < 1) squash = 1 - Math.sin(Math.PI * land) * 0.22;

      if (m.cheerPending && !p.bankrupt) { m.cheerPending = false; m.cheerAt = now; }
      if (winner && !p.bankrupt) {
        // Endless victory dance: bouncing, arms up, twirling.
        const c = (time % 0.9) / 0.9;
        lift = Math.abs(Math.sin(Math.PI * c)) * 0.26;
        squash = 1 + lift * 0.7 - Math.max(0, 1 - Math.min(c, 1 - c) / 0.08) * 0.15;
        handsUp = 1;
        spin = time * 2.5;
      } else if (m.cheerAt && now - m.cheerAt < CHEER_MS) {
        // Two happy jumps with a twirl.
        const c = (now - m.cheerAt) / CHEER_MS;
        lift = Math.abs(Math.sin(Math.PI * 2 * c)) * 0.22 * (1 - c * 0.3);
        squash = 1 + lift * 0.8;
        handsUp = Math.sin(Math.PI * c);
        spin = Math.PI * 2 * (c * c * (3 - 2 * c));
      }
    }
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

    poseRig(rig, { time, phase: m.phase, slump: m.slump, lie: m.lie, handsUp, squash });

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
      {reaction && !p.bankrupt && <ReactionBubble emoji={reaction.emoji} seq={reaction.seq} />}
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
  const { players, owned, current, winner } = game;

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

  // Happy moments come from diffing consecutive views: a deed that is newly
  // theirs (bought, won at auction, traded for) or cash that went up (rent
  // received, GO, a lucky card). Each bumps that player's cheer counter.
  const prev = useRef<{ cash: Map<string, number>; owner: Map<number, string> } | null>(null);
  const [cheers, setCheers] = useState<Record<string, number>>({});
  useEffect(() => {
    const cash = new Map(players.map(p => [p.id, p.cash]));
    const owner = new Map(Object.entries(owned).map(([k, o]) => [Number(k), o.owner]));
    const was = prev.current;
    prev.current = { cash, owner };
    if (!was) return;
    const happy = players.filter(p => !p.bankrupt && (
      p.cash > (was.cash.get(p.id) ?? p.cash)
      || [...owner].some(([i, o]) => o === p.id && was.owner.get(i) !== p.id)
    ));
    if (!happy.length) return;
    setCheers(c => {
      const next = { ...c };
      for (const p of happy) next[p.id] = (next[p.id] ?? 0) + 1;
      return next;
    });
  }, [players, owned]);

  return (
    <>
      {players.map(p => {
        const s = slots.get(p.id) ?? { slot: 0, count: 1 };
        return (
          <Piece key={p.id} p={p} slot={s.slot} count={s.count} n={n}
            turn={p.id === current && !winner} winner={p.id === winner} cheer={cheers[p.id] ?? 0}
            reaction={reactions?.[p.id]} />
        );
      })}
    </>
  );
}
