// Money you can see move. Whenever cash changes hands, a little stream of gold
// coins arcs across the board from whoever paid to whoever got paid (the bank
// is the middle of the board), and the amount floats up over each piece:
// green when it comes in, red when it goes out. It plays once the dice and
// the walk are done, so rent lands after the piece does.

import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CylinderGeometry, InstancedMesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import type { GameView } from '../../../shared/types.ts';
import { tile } from './layout.ts';
import { sceneFreeAt } from './sequence.ts';

const MAX_COINS = 64;
const FLIGHT_MS = 650;
const STAGGER_MS = 55;
const LABEL_MS = 1700;

interface Flight { from: Vector3; to: Vector3; coins: number; start: number }
interface Label { id: number; pos: [number, number, number]; text: string; gain: boolean; start: number }

const coinGeo = new CylinderGeometry(0.085, 0.085, 0.022, 18);
const coinMat = new MeshStandardMaterial({ color: '#f4c542', metalness: 0.8, roughness: 0.28, emissive: '#5a3c00', emissiveIntensity: 0.4 });
const dummy = new Object3D();
const BANK = new Vector3(0, 0.35, 0);
const SLOTS = [0, 1, 2, 3, 4, 5, 6, 7];
const HIDDEN: [number, number, number] = [0, -50, 0];

const coinsFor = (amount: number) => Math.max(3, Math.min(12, Math.round(Math.log2(Math.max(2, amount / 5)) + 1)));

export function MoneyFX({ game, n, currency }: { game: GameView; n: number; currency: string }) {
  const prev = useRef<Map<string, number> | null>(null);
  // Each batch waits for the scene it belongs to (the roll and walk that caused
  // it), not for later moves: a bot's purchase must not wait behind the next
  // player's dice and then pop up beside them. `frames` counts frames since it
  // arrived; on the second the pieces have reported their walk and `at` is fixed.
  const pending = useRef<{ flights: Omit<Flight, 'start'>[]; labels: Omit<Label, 'start' | 'id'>[]; frames: number; at: number }[]>([]);
  const flights = useRef<Flight[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const mesh = useRef<InstancedMesh>(null);
  const labelSeq = useRef(0);

  const spotOf = useMemo(() => (pos: number) => {
    const g = tile(pos, n);
    return new Vector3(g.x, 0.95, g.z);
  }, [n]);

  // Work out who paid whom from the change in everyone's cash.
  useEffect(() => {
    const cash = new Map(game.players.map(p => [p.id, p.cash]));
    const was = prev.current;
    prev.current = cash;
    if (!was || game.phase === 'over') return;
    const deltas = game.players
      .map(p => ({ p, d: p.cash - (was.get(p.id) ?? p.cash) }))
      .filter(x => x.d !== 0);
    if (!deltas.length) return;
    const losers = deltas.filter(x => x.d < 0);
    const gainers = deltas.filter(x => x.d > 0);
    const lost = -losers.reduce((a, x) => a + x.d, 0);
    const won = gainers.reduce((a, x) => a + x.d, 0);
    const out: Omit<Flight, 'start'>[] = [];
    if (lost === won && (gainers.length === 1 || losers.length === 1)) {
      // Player to player (rent, a trade's cash, "pay each player", a birthday).
      for (const l of losers) for (const g of gainers) {
        const amount = gainers.length === 1 ? -l.d : g.d;
        out.push({ from: spotOf(l.p.position), to: spotOf(g.p.position), coins: coinsFor(amount) });
      }
    } else {
      for (const l of losers) out.push({ from: spotOf(l.p.position), to: BANK.clone(), coins: coinsFor(-l.d) });
      for (const g of gainers) out.push({ from: BANK.clone(), to: spotOf(g.p.position), coins: coinsFor(g.d) });
    }
    const lbls = deltas.map(({ p, d }) => {
      const s = spotOf(p.position);
      return { pos: [s.x, s.y + 0.35, s.z] as [number, number, number], text: `${d > 0 ? '+' : '−'}${currency}${Math.abs(d).toLocaleString()}`, gain: d > 0 };
    });
    pending.current.push({ flights: out, labels: lbls, frames: 0, at: Infinity });
  }, [game.players, game.phase, spotOf, currency]);

  useFrame(() => {
    const now = performance.now();
    // Start each batch once the scene it arrived with is over.
    for (const b of pending.current) if (++b.frames === 2) b.at = sceneFreeAt();
    if (pending.current.some(b => now >= b.at)) {
      const batch = pending.current.filter(b => now >= b.at);
      pending.current = pending.current.filter(b => now < b.at);
      const newLabels: Label[] = [];
      for (const b of batch) {
        for (const f of b.flights) flights.current.push({ ...f, start: now });
        for (const l of b.labels) newLabels.push({ ...l, id: ++labelSeq.current, start: now });
      }
      if (newLabels.length) setLabels(ls => [...ls, ...newLabels]);
    }
    const m = mesh.current;
    if (!m) return;
    let k = 0;
    flights.current = flights.current.filter(f => now - f.start < FLIGHT_MS + f.coins * STAGGER_MS + 50);
    for (const f of flights.current) {
      for (let c = 0; c < f.coins && k < MAX_COINS; c++) {
        const t = (now - f.start - c * STAGGER_MS) / FLIGHT_MS;
        if (t <= 0 || t >= 1) continue;
        const e = t * t * (3 - 2 * t);
        const lift = Math.sin(Math.PI * t) * (1.1 + 0.25 * Math.sin(c * 1.7));
        dummy.position.lerpVectors(f.from, f.to, e);
        dummy.position.y += lift;
        // A little scatter so the stream reads as many coins, not one.
        dummy.position.x += Math.sin(c * 2.3) * 0.08 * Math.sin(Math.PI * t);
        dummy.position.z += Math.cos(c * 1.9) * 0.08 * Math.sin(Math.PI * t);
        dummy.rotation.set(t * 9 + c, t * 4, Math.PI / 2 * 0.7);
        const pop = Math.min(1, t * 6) * Math.min(1, (1 - t) * 6);
        dummy.scale.setScalar(0.4 + 0.6 * pop);
        dummy.updateMatrix();
        m.setMatrixAt(k++, dummy.matrix);
      }
    }
    m.count = k;
    m.instanceMatrix.needsUpdate = true;
  });

  // Labels clean themselves up.
  useEffect(() => {
    if (!labels.length) return;
    const t = setTimeout(() => {
      const now = performance.now();
      setLabels(ls => ls.filter(l => now - l.start < LABEL_MS));
    }, LABEL_MS + 50);
    return () => clearTimeout(t);
  }, [labels]);

  return (
    <>
      <instancedMesh ref={mesh} args={[coinGeo, coinMat, MAX_COINS]} count={0} castShadow frustumCulled={false} />
      {/* A fixed pool of label slots that stay mounted (only their content changes):
          mounting and unmounting drei portals mid-update can trip React's DOM bookkeeping. */}
      {SLOTS.map(k => {
        const l = labels.find(x => x.id % SLOTS.length === k);
        return (
          <Html key={k} center position={l?.pos ?? HIDDEN} zIndexRange={[4, 0]} pointerEvents="none">
            {l && <span key={l.id} className={`fx-money ${l.gain ? 'gain' : 'loss'}`}>{l.text}</span>}
          </Html>
        );
      })}
    </>
  );
}
