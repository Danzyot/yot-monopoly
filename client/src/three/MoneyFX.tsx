// Money you can see move. Whenever cash changes hands, a little stream of gold
// coins arcs across the board from whoever paid to whoever got paid (the bank
// is the middle of the board), and the amount floats up over each piece,
// tagged with the player's name in their colour: green when it comes in, red
// when it goes out. Each payment gets its own label (passing GO and paying
// rent on the same move are two, not one net number), read from the log lines
// that came with the change; whatever those don't explain shows as a net
// change. A batch plays when the move it came with is over (three/sequence.ts
// plans that on the clock), so rent lands after the piece does, never on the
// next player's turn.

import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CylinderGeometry, InstancedMesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import type { GameView, LogEntry } from '../../../shared/types.ts';
import { tile } from './layout.ts';
import { movesFreeAt, planEnd, stageView } from './sequence.ts';

const MAX_COINS = 64;
const FLIGHT_MS = 650;
const STAGGER_MS = 55;
const LABEL_MS = 1700;
/** Several labels over one piece go up one after another. */
const LABEL_GAP_MS = 520;

interface Flight { from: Vector3; to: Vector3; coins: number; start: number }
interface Label {
  id: number; pos: [number, number, number]; text: string; gain: boolean; start: number;
  name: string; color: string; what?: string; delay: number;
}
type LabelDraft = Omit<Label, 'start' | 'id'>;

const coinGeo = new CylinderGeometry(0.085, 0.085, 0.022, 18);
const coinMat = new MeshStandardMaterial({ color: '#f4c542', metalness: 0.8, roughness: 0.28, emissive: '#5a3c00', emissiveIntensity: 0.4 });
const dummy = new Object3D();
const BANK = new Vector3(0, 0.35, 0);
const SLOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const HIDDEN: [number, number, number] = [0, -50, 0];

/** The payer's or payee's name over the amount, on their colour. */
const CHIP = {
  display: 'block', width: 'fit-content', margin: '0 auto 3px', padding: '2px 7px', borderRadius: 8,
  font: '800 11px/1.2 Nunito, sans-serif', color: '#fff', WebkitTextStroke: '0', textShadow: '0 1px 2px rgba(0,0,0,0.6)',
  maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis',
} as const;
const WHAT = { fontSize: '0.6em' } as const;

const coinsFor = (amount: number) => Math.max(3, Math.min(12, Math.round(Math.log2(Math.max(2, amount / 5)) + 1)));

/** A short word for what a payment was for (the engine's reason). */
function whatFor(reason?: string): string | undefined {
  if (!reason) return undefined;
  if (reason.startsWith('rent')) return 'rent';
  if (reason === 'pot') return 'jackpot';
  return reason;
}

/** The log lines added since `last` (the newest line seen before). */
function linesSince(log: LogEntry[], last: LogEntry | undefined): LogEntry[] {
  if (!last) return [];
  let k = log.length - 1;
  while (k >= 0 && log[k] !== last && !(log[k].t === last.t && log[k].text === last.text)) k--;
  return k >= 0 ? log.slice(k + 1) : log.filter(l => l.t > last.t);
}

export function MoneyFX({ game, n, currency }: { game: GameView; n: number; currency: string }) {
  stageView(game);
  const prev = useRef<Map<string, number> | null>(null);
  const lastLine = useRef<LogEntry | undefined>(game.log.at(-1));
  // Each batch waits for the move it came with (its planned end), not for
  // later moves: a bot's rent must not wait behind the next player's dice.
  const pending = useRef<{ flights: Omit<Flight, 'start'>[]; labels: LabelDraft[]; at: number }[]>([]);
  const flights = useRef<Flight[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const mesh = useRef<InstancedMesh>(null);
  const labelSeq = useRef(0);

  const spotOf = useMemo(() => (pos: number) => {
    const g = tile(pos, n);
    return new Vector3(g.x, 0.95, g.z);
  }, [n]);

  // Work out who paid whom: from the money lines of the log first, then the change in everyone's cash.
  useEffect(() => {
    const cash = new Map(game.players.map(p => [p.id, p.cash]));
    const was = prev.current;
    prev.current = cash;
    const fresh = linesSince(game.log, lastLine.current);
    lastLine.current = game.log.at(-1);
    if (!was || game.phase === 'over') return;
    const byId = new Map(game.players.map(p => [p.id, p]));
    const out: Omit<Flight, 'start'>[] = [];
    const items: { id: string; d: number; what?: string }[] = [];
    const explained = new Map<string, number>();
    const credit = (id: string, d: number) => explained.set(id, (explained.get(id) ?? 0) + d);
    for (const l of fresh) {
      if (!l.amount || l.owed) continue;
      const from = l.from ? byId.get(l.from) : undefined;
      const to = l.to ? byId.get(l.to) : undefined;
      if (!from && !to) continue;
      const what = whatFor(l.reason);
      if (from) { items.push({ id: from.id, d: -l.amount, what }); credit(from.id, -l.amount); }
      if (to) { items.push({ id: to.id, d: l.amount, what }); credit(to.id, l.amount); }
      out.push({ from: from ? spotOf(from.position) : BANK.clone(), to: to ? spotOf(to.position) : BANK.clone(), coins: coinsFor(l.amount) });
    }
    // Whatever the lines don't account for (a purchase, a trade, a card, an older server): the net change.
    const rest = game.players
      .map(p => ({ p, d: p.cash - (was.get(p.id) ?? p.cash) - (explained.get(p.id) ?? 0) }))
      .filter(x => x.d !== 0);
    const losers = rest.filter(x => x.d < 0);
    const gainers = rest.filter(x => x.d > 0);
    const lost = -losers.reduce((a, x) => a + x.d, 0);
    const won = gainers.reduce((a, x) => a + x.d, 0);
    if (lost === won && (gainers.length === 1 || losers.length === 1)) {
      // Player to player (a trade's cash, "pay each player", a birthday).
      for (const l of losers) for (const g of gainers) {
        const amount = gainers.length === 1 ? -l.d : g.d;
        out.push({ from: spotOf(l.p.position), to: spotOf(g.p.position), coins: coinsFor(amount) });
      }
    } else {
      for (const l of losers) out.push({ from: spotOf(l.p.position), to: BANK.clone(), coins: coinsFor(-l.d) });
      for (const g of gainers) out.push({ from: BANK.clone(), to: spotOf(g.p.position), coins: coinsFor(g.d) });
    }
    for (const x of rest) items.push({ id: x.p.id, d: x.d });
    if (!items.length) return;
    const per = new Map<string, number>();
    const lbls: LabelDraft[] = items.map(({ id, d, what }) => {
      const p = byId.get(id)!;
      const s = spotOf(p.position);
      const k = per.get(id) ?? 0;
      per.set(id, k + 1);
      return {
        pos: [s.x, s.y + 0.35, s.z], text: `${d > 0 ? '+' : '−'}${currency}${Math.abs(d).toLocaleString()}`, gain: d > 0,
        name: p.name, color: p.color, what, delay: k * LABEL_GAP_MS,
      };
    });
    // Play when the move these lines came with is over; anything else once whatever is moving has.
    let at = movesFreeAt();
    for (const l of fresh) if (l.move !== undefined) at = Math.max(at, planEnd(l.move) ?? 0);
    pending.current.push({ flights: out, labels: lbls, at });
  }, [game.players, game.phase, game.log, spotOf, currency]);

  useFrame(() => {
    const now = performance.now();
    if (pending.current.some(b => now >= b.at)) {
      const batch = pending.current.filter(b => now >= b.at);
      pending.current = pending.current.filter(b => now < b.at);
      const newLabels: Label[] = [];
      for (const b of batch) {
        for (const f of b.flights) flights.current.push({ ...f, start: now });
        for (const l of b.labels) newLabels.push({ ...l, id: ++labelSeq.current, start: now + l.delay });
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
    // (A label held back behind another starts later: wait for the last one to finish.)
    const last = Math.max(...labels.map(l => l.start));
    const t = setTimeout(() => {
      const now = performance.now();
      setLabels(ls => ls.filter(l => now - l.start < LABEL_MS));
    }, Math.max(0, last - performance.now()) + LABEL_MS + 50);
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
            {l && (
              <span key={l.id} className={`fx-money ${l.gain ? 'gain' : 'loss'}`}
                style={{ animationDelay: `${l.delay}ms`, animationFillMode: 'both', textAlign: 'center' }}>
                <b style={{ ...CHIP, background: l.color }}>{l.name}</b>
                {l.text}{l.what && <small style={WHAT}> {l.what}</small>}
              </span>
            )}
          </Html>
        );
      })}
    </>
  );
}
