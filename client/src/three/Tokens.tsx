// Player pieces. Each token is built from primitives for now; to use real
// models later, drop a GLB per token into client/public/models/ and swap the
// body in <TokenModel> for drei's useGLTF — nothing else needs to change.

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import type { Group } from 'three';
import type { PlayerState, TokenId } from '../../../shared/types.ts';
import { tokenSpot } from './layout.ts';

const HOP_MS = 170;

function Metal({ color }: { color: string }) {
  return <meshStandardMaterial color={color} metalness={0.75} roughness={0.28} />;
}

export function TokenModel({ token, color }: { token: TokenId; color: string }) {
  const m = <Metal color={color} />;
  switch (token) {
    case 'car':
      return (
        <group>
          <mesh castShadow position={[0, 0.09, 0]}><boxGeometry args={[0.34, 0.1, 0.18]} />{m}</mesh>
          <mesh castShadow position={[-0.02, 0.17, 0]}><boxGeometry args={[0.16, 0.08, 0.15]} />{m}</mesh>
          {[[-0.11, 0.09], [0.11, 0.09], [-0.11, -0.09], [0.11, -0.09]].map(([x, z], k) => (
            <mesh key={k} castShadow position={[x, 0.05, z]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.05, 0.05, 0.04, 16]} />
              <meshStandardMaterial color="#222" roughness={0.6} />
            </mesh>
          ))}
        </group>
      );
    case 'hat':
      return (
        <group>
          <mesh castShadow position={[0, 0.015, 0]}><cylinderGeometry args={[0.2, 0.2, 0.03, 32]} />{m}</mesh>
          <mesh castShadow position={[0, 0.16, 0]}><cylinderGeometry args={[0.12, 0.13, 0.27, 32]} />{m}</mesh>
          <mesh position={[0, 0.06, 0]}><cylinderGeometry args={[0.135, 0.135, 0.05, 32]} /><meshStandardMaterial color="#111" /></mesh>
        </group>
      );
    case 'dog':
      return (
        <group>
          <mesh castShadow position={[0, 0.13, 0]} scale={[1.5, 0.9, 0.9]}><sphereGeometry args={[0.1, 20, 16]} />{m}</mesh>
          <mesh castShadow position={[0.15, 0.24, 0]}><sphereGeometry args={[0.075, 20, 16]} />{m}</mesh>
          <mesh castShadow position={[0.23, 0.22, 0]} rotation={[0, 0, -Math.PI / 2]}><coneGeometry args={[0.035, 0.08, 12]} />{m}</mesh>
          <mesh castShadow position={[0.13, 0.3, 0.05]}><coneGeometry args={[0.025, 0.07, 8]} />{m}</mesh>
          <mesh castShadow position={[0.13, 0.3, -0.05]}><coneGeometry args={[0.025, 0.07, 8]} />{m}</mesh>
          {[[-0.09, 0.05], [0.09, 0.05], [-0.09, -0.05], [0.09, -0.05]].map(([x, z], k) => (
            <mesh key={k} castShadow position={[x, 0.04, z]}><cylinderGeometry args={[0.022, 0.022, 0.09, 8]} />{m}</mesh>
          ))}
        </group>
      );
    case 'ship':
      return (
        <group>
          <mesh castShadow position={[0, 0.06, 0]} scale={[1, 0.5, 0.45]}><sphereGeometry args={[0.2, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />{m}</mesh>
          <mesh castShadow position={[0, 0.07, 0]}><boxGeometry args={[0.34, 0.03, 0.16]} />{m}</mesh>
          <mesh castShadow position={[0, 0.22, 0]}><cylinderGeometry args={[0.012, 0.012, 0.3, 8]} />{m}</mesh>
          <mesh castShadow position={[0.05, 0.22, 0]} rotation={[0, 0, 0]}><boxGeometry args={[0.1, 0.18, 0.01]} /><meshStandardMaterial color="#f4f1e8" /></mesh>
        </group>
      );
    case 'boot':
      return (
        <group>
          <mesh castShadow position={[-0.04, 0.16, 0]}><boxGeometry args={[0.13, 0.26, 0.13]} />{m}</mesh>
          <mesh castShadow position={[0.05, 0.045, 0]}><boxGeometry args={[0.3, 0.09, 0.14]} />{m}</mesh>
          <mesh castShadow position={[0.19, 0.06, 0]}><sphereGeometry args={[0.07, 16, 12]} />{m}</mesh>
        </group>
      );
    case 'iron':
      return (
        <group>
          <mesh castShadow position={[0, 0.05, 0]} rotation={[0, Math.PI / 6, 0]} scale={[1.4, 1, 1]}><cylinderGeometry args={[0.13, 0.15, 0.1, 3]} />{m}</mesh>
          <mesh castShadow position={[-0.02, 0.17, 0]} rotation={[0, 0, Math.PI / 2]}><torusGeometry args={[0.07, 0.02, 10, 20, Math.PI]} />{m}</mesh>
        </group>
      );
    case 'cat':
      return (
        <group>
          <mesh castShadow position={[0, 0.12, 0]}><capsuleGeometry args={[0.08, 0.1, 8, 16]} />{m}</mesh>
          <mesh castShadow position={[0, 0.29, 0]}><sphereGeometry args={[0.075, 20, 16]} />{m}</mesh>
          <mesh castShadow position={[0.04, 0.37, 0]}><coneGeometry args={[0.028, 0.07, 8]} />{m}</mesh>
          <mesh castShadow position={[-0.04, 0.37, 0]}><coneGeometry args={[0.028, 0.07, 8]} />{m}</mesh>
          <mesh castShadow position={[0, 0.07, -0.1]} rotation={[0.9, 0, 0]}><torusGeometry args={[0.07, 0.015, 8, 16, Math.PI]} />{m}</mesh>
        </group>
      );
    case 'duck':
    default:
      return (
        <group>
          <mesh castShadow position={[0, 0.1, 0]} scale={[1.3, 0.9, 1]}><sphereGeometry args={[0.11, 20, 16]} />{m}</mesh>
          <mesh castShadow position={[0.1, 0.24, 0]}><sphereGeometry args={[0.07, 20, 16]} />{m}</mesh>
          <mesh castShadow position={[0.18, 0.23, 0]} rotation={[0, 0, -Math.PI / 2]}><coneGeometry args={[0.03, 0.08, 12]} /><meshStandardMaterial color="#ff9d00" /></mesh>
        </group>
      );
  }
}

interface Anim {
  shown: number;    // space the piece is drawn at / heading to
  queue: number[];  // spaces still to hop through
  from: [number, number];
  to: [number, number];
  t0: number;
  dur: number;
}

function Token({ p, slot, count, highlight, n }: { p: PlayerState; slot: number; count: number; highlight: boolean; n: number }) {
  const ref = useRef<Group>(null);
  const anim = useRef<Anim | null>(null);

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

  useFrame(() => {
    const a = anim.current!;
    const g = ref.current;
    if (!g) return;
    const now = performance.now();
    let k = a.t0 ? (now - a.t0) / a.dur : 1;
    if (k >= 1 && a.queue.length) {
      const next = a.queue.shift()!;
      const final = a.queue.length === 0;
      a.from = [g.position.x, g.position.z];
      a.to = final ? tokenSpot(next, slot, count, p.inJail, n) : tokenSpot(next, 0, 1, false, n);
      a.dur = Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]) > 2 ? 750 : HOP_MS;
      a.shown = next;
      a.t0 = now;
      k = 0;
    }
    if (k >= 1) {
      // Settle into the (possibly changed) slot when other tokens arrive/leave.
      const [x, z] = tokenSpot(a.shown, slot, count, p.inJail, n);
      g.position.x += (x - g.position.x) * 0.2;
      g.position.z += (z - g.position.z) * 0.2;
      g.position.y += (0 - g.position.y) * 0.3;
    } else {
      const e = k * k * (3 - 2 * k);
      g.position.x = a.from[0] + (a.to[0] - a.from[0]) * e;
      g.position.z = a.from[1] + (a.to[1] - a.from[1]) * e;
      g.position.y = Math.sin(Math.PI * k) * (a.dur > HOP_MS ? 1.6 : 0.28);
    }
    // Idle bob for whoever's turn it is.
    const s = highlight ? 1.12 + Math.sin(now / 250) * 0.04 : 1;
    g.scale.setScalar(s);
  });

  return (
    <group ref={ref} position={initial}>
      <group scale={1.25}>
        <TokenModel token={p.token} color={p.color} />
      </group>
      {highlight && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
          <ringGeometry args={[0.2, 0.26, 32]} />
          <meshBasicMaterial color={p.color} transparent opacity={0.9} />
        </mesh>
      )}
    </group>
  );
}

export function Tokens({ players, current, n }: { players: PlayerState[]; current: string; n: number }) {
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

  return (
    <>
      {players.filter(p => !p.bankrupt).map(p => {
        const s = slots.get(p.id)!;
        return <Token key={p.id} p={p} slot={s.slot} count={s.count} highlight={p.id === current} n={n} />;
      })}
    </>
  );
}
