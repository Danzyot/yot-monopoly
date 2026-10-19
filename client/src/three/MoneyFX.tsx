// Money you can see move. Whenever cash changes hands, a little stream of gold
// coins arcs across the board from whoever paid to whoever got paid (the bank
// is the middle of the board), and the amount floats up over each piece,
// tagged with the player's name in their colour: green when it comes in, red
// when it goes out. Each payment gets its own label (passing GO and paying
// rent on the same move are two, not one net number), read from the log lines
// that came with the change; whatever those don't explain shows as a net
// change, with what it was for when a line says ("bought Boardwalk"). Each
// line plays when the move it came with is over (three/sequence.ts plans that
// on the clock; salary as the piece passes GO), so rent lands after the piece
// does, never on the next player's turn, and one state that brings several
// turns' lines plays each with its own move. Each batch goes up on a timer
// set for its planned time, not on the next frame that notices it is due: a
// slow device (few frames, or none while the board is busy) shows it on time
// and lets the coins skip ahead rather than show it late.

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { CylinderGeometry, InstancedMesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import type { GameView, LogEntry } from '../../../shared/types.ts';
import { tile } from './layout.ts';
import { freeBefore, goPassTimes, movesFreeAt, planEnd, stageView } from './sequence.ts';
import { usePins } from './overlay.ts';

const MAX_COINS = 64;
const FLIGHT_MS = 650;
const STAGGER_MS = 55;
const LABEL_MS = 1700;
/** Several labels over one piece go up one after another. */
const LABEL_GAP_MS = 520;

interface Flight { from: Vector3; to: Vector3; coins: number; start: number }
/** A floating amount: over whose piece, how much, and what for. */
interface LabelDraft {
  /** The player's id: several labels over one piece go up one after another. */
  id: string; pos: [number, number, number]; text: string; gain: boolean;
  name: string; color: string; what?: string;
  /** Salary for passing GO: within one move it goes up before the rest (a card's payment), as the piece passed GO first. */
  salary?: boolean;
}
/** What plays together, from `at` (performance.now() time). */
interface Batch { flights: Omit<Flight, 'start'>[]; labels: LabelDraft[]; at: number }

const coinGeo = new CylinderGeometry(0.085, 0.085, 0.022, 18);
const coinMat = new MeshStandardMaterial({ color: '#f4c542', metalness: 0.8, roughness: 0.28, emissive: '#5a3c00', emissiveIntensity: 0.4 });
const dummy = new Object3D();
const BANK = new Vector3(0, 0.35, 0);
/** At most this many amounts float at once; a new one retires the oldest. */
const MAX_LABELS = 8;

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

/**
 * When each of `lines` plays (performance.now() times), and whether it is a
 * salary popping as the piece passes GO:
 *   - a line that came with a move plays when that move is over (three/sequence.ts
 *     planEnd), except salary for passing GO, which pops as the piece hops onto GO;
 *   - a line with no move (a jail fine paid before rolling, a trade, building)
 *     plays at once or, while a move is still playing, as soon as the board is
 *     free: when the move after it takes over, or once everything has played.
 */
function lineTimes(lines: LogEntry[], n: number): { at: number; go: boolean }[] {
  const go = new Map<number, number[]>();
  return lines.map((l, i) => {
    if (l.move !== undefined) {
      const end = planEnd(l.move) ?? movesFreeAt();
      if (l.reason === 'salary') {
        let times = go.get(l.move);
        if (!times) go.set(l.move, times = goPassTimes(l.move, n));
        const t = times.shift();
        if (t !== undefined) return { at: Math.min(t, end), go: true };
      }
      return { at: end, go: false };
    }
    const next = lines.slice(i + 1).find(x => x.move !== undefined && planEnd(x.move) !== undefined);
    return { at: next ? freeBefore(next.move!) : movesFreeAt(), go: false };
  });
}

/** Log lines that change someone's cash without saying how much (the net change covers that), and what they were for. */
const NET_REASONS: { re: RegExp; what: (m: RegExpMatchArray) => string; pays: boolean }[] = [
  { re: / bought (.+) for \S+\.$/, what: m => `bought ${m[1]}`, pays: true },
  { re: / won (.+) for \S+?( after \d+ bids)?\.$/, what: m => `won ${m[1]}`, pays: true },
  { re: / built (?:a house|a hotel) on (.+)\.$/, what: m => `built on ${m[1]}`, pays: true },
  { re: / lifted the mortgage on (.+) for /, what: m => `unmortgaged ${m[1]}`, pays: true },
  { re: / sold (a house|the hotel) on /, what: m => (m[1] === 'a house' ? 'sold a house' : 'sold a hotel'), pays: false },
  { re: / mortgaged (.+) for /, what: m => `mortgaged ${m[1]}`, pays: false },
  { re: / won \S+ from the bank \((.+)\)\.$/, what: m => m[1], pays: false },
];
const TRADE = / accepted .+'s trade\.$/;

/**
 * What an unexplained change of `id`'s cash (`d`) was for, from the lines
 * about them ("bought Boardwalk"), and when to show it: with the first of
 * those lines. Several different reasons read "3 deals".
 */
function netReason(lines: LogEntry[], id: string, d: number, when: { at: number }[]): { what?: string; at: number } | undefined {
  const found: { what: string; at: number }[] = [];
  lines.forEach((l, i) => {
    if (l.amount) return;
    // A trade's cash moves both ways: the accepting line is about one side only.
    if (TRADE.test(l.text)) { found.push({ what: 'trade', at: when[i].at }); return; }
    if (l.who !== id) return;
    const r = NET_REASONS.find(x => x.re.test(l.text));
    // Buying and building only ever cost, selling and mortgaging only pay.
    if (r && r.pays === d < 0) found.push({ what: r.what(l.text.match(r.re)!), at: when[i].at });
  });
  if (!found.length) return undefined;
  const kinds = [...new Set(found.map(f => f.what))];
  return { what: kinds.length === 1 ? kinds[0] : `${kinds.length} deals`, at: found[0].at };
}

export function MoneyFX({ game, n, currency }: { game: GameView; n: number; currency: string }) {
  stageView(game);
  const prev = useRef<Map<string, number> | null>(null);
  const lastLine = useRef<LogEntry | undefined>(game.log.at(-1));
  // Each batch waits for the move it came with (its planned end), not for
  // later moves: a bot's rent must not wait behind the next player's dice.
  const pending = useRef(new Set<ReturnType<typeof setTimeout>>());
  /** When each player's piece is free for its next label (labels over one piece queue up, LABEL_GAP_MS apart). */
  const nextLabel = useRef(new Map<string, number>());
  const flights = useRef<Flight[]>([]);
  // The floating amounts: plain DOM pinned over the board (three/overlay.ts),
  // there only while they show (no drei <Html> per slot).
  const pins = usePins();
  const shown = useRef<{ pin: ReturnType<typeof pins.add>; timer: ReturnType<typeof setTimeout> }[]>([]);
  useEffect(() => () => {
    for (const l of shown.current) clearTimeout(l.timer);
    shown.current = [];
    pending.current.forEach(clearTimeout);
    pending.current.clear();
  }, []);
  const showLabel = (l: LabelDraft, now: number) => {
    const delay = Math.max(0, (nextLabel.current.get(l.id) ?? 0) - now);
    nextLabel.current.set(l.id, now + delay + LABEL_GAP_MS);
    if (shown.current.length >= MAX_LABELS) {
      const old = shown.current.shift()!;
      clearTimeout(old.timer);
      pins.remove(old.pin);
    }
    const el = document.createElement('span');
    el.className = `fx-money ${l.gain ? 'gain' : 'loss'}`;
    Object.assign(el.style, { animationDelay: `${delay}ms`, animationFillMode: 'both', textAlign: 'center' });
    const chip = document.createElement('b');
    Object.assign(chip.style, CHIP, { background: l.color, maxWidth: `${CHIP.maxWidth}px`, margin: CHIP.margin, padding: CHIP.padding, borderRadius: `${CHIP.borderRadius}px` });
    chip.textContent = l.name;
    el.append(chip, document.createTextNode(l.text));
    if (l.what) {
      const what = document.createElement('small');
      what.style.fontSize = WHAT.fontSize;
      what.textContent = ` ${l.what}`;
      el.append(what);
    }
    const pin = pins.add(el, new Vector3(...l.pos), [4, 0]);
    const entry = {
      pin,
      timer: setTimeout(() => {
        pins.remove(pin);
        shown.current = shown.current.filter(x => x !== entry);
      }, delay + LABEL_MS + 50),
    };
    shown.current.push(entry);
  };
  const mesh = useRef<InstancedMesh>(null);

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
    // One state can bring several turns' worth of lines (the server coalesces
    // its broadcasts): each line plays with its own move, not all of them at
    // the end of the latest one.
    const when = lineTimes(fresh, n);
    const batches = new Map<number, Batch>();
    const batch = (at: number) => {
      let b = batches.get(at);
      if (!b) batches.set(at, b = { flights: [], labels: [], at });
      return b;
    };
    const label = (id: string, d: number, what: string | undefined, s: Vector3, salary = false): LabelDraft => {
      const p = byId.get(id)!;
      return {
        id, pos: [s.x, s.y + 0.35, s.z], text: `${d > 0 ? '+' : '−'}${currency}${Math.abs(d).toLocaleString()}`, gain: d > 0,
        name: p.name, color: p.color, what, salary,
      };
    };
    const explained = new Map<string, number>();
    const credit = (id: string, d: number) => explained.set(id, (explained.get(id) ?? 0) + d);
    fresh.forEach((l, i) => {
      if (!l.amount || l.owed) return;
      const from = l.from ? byId.get(l.from) : undefined;
      const to = l.to ? byId.get(l.to) : undefined;
      if (!from && !to) return;
      const what = whatFor(l.reason);
      const { at, go } = when[i];
      const b = batch(at);
      // Salary popping as the piece passes GO shows over GO, not where the piece ends up.
      const spot = (p: { position: number }) => spotOf(go ? 0 : p.position);
      const salary = l.reason === 'salary';
      if (from) { b.labels.push(label(from.id, -l.amount, what, spot(from), salary)); credit(from.id, -l.amount); }
      if (to) { b.labels.push(label(to.id, l.amount, what, spot(to), salary)); credit(to.id, l.amount); }
      b.flights.push({ from: from ? spot(from) : BANK.clone(), to: to ? spot(to) : BANK.clone(), coins: coinsFor(l.amount) });
    });
    // Whatever the lines don't account for (a purchase, a trade, building, an older server): the net change,
    // saying what it was for when a line does ("bought Boardwalk").
    const rest = game.players
      .map(p => ({ p, d: p.cash - (was.get(p.id) ?? p.cash) - (explained.get(p.id) ?? 0) }))
      .filter(x => x.d !== 0);
    if (rest.length) {
      // With the line that explains it; unexplained, once everything this state brought has played.
      const latest = Math.max(movesFreeAt(), ...when.map(w => w.at));
      const why = rest.map(x => netReason(fresh, x.p.id, x.d, when));
      const atOf = (x: typeof rest[number]) => why[rest.indexOf(x)]?.at ?? latest;
      const losers = rest.filter(x => x.d < 0);
      const gainers = rest.filter(x => x.d > 0);
      const lost = -losers.reduce((a, x) => a + x.d, 0);
      const won = gainers.reduce((a, x) => a + x.d, 0);
      if (lost === won && (gainers.length === 1 || losers.length === 1)) {
        // Player to player (a trade's cash, "pay each player", a birthday).
        for (const l of losers) for (const g of gainers) {
          const amount = gainers.length === 1 ? -l.d : g.d;
          batch(Math.max(atOf(l), atOf(g))).flights.push({ from: spotOf(l.p.position), to: spotOf(g.p.position), coins: coinsFor(amount) });
        }
      } else {
        for (const l of losers) batch(atOf(l)).flights.push({ from: spotOf(l.p.position), to: BANK.clone(), coins: coinsFor(-l.d) });
        for (const g of gainers) batch(atOf(g)).flights.push({ from: BANK.clone(), to: spotOf(g.p.position), coins: coinsFor(g.d) });
      }
      rest.forEach((x, i) => batch(atOf(x)).labels.push(label(x.p.id, x.d, why[i]?.what, spotOf(x.p.position))));
    }
    // Oldest first, so labels over one piece queue up in the order they happened
    // (timers due at the same moment fire in the order they were set).
    const now = performance.now();
    for (const b of [...batches.values()].sort((x, y) => x.at - y.at)) {
      // Passing GO comes before whatever the move ends with (sort is stable).
      b.labels.sort((x, y) => Number(!x.salary) - Number(!y.salary));
      const timer = setTimeout(() => {
        pending.current.delete(timer);
        // Timed from when the batch was due, not when the timer got round to it.
        for (const f of b.flights) flights.current.push({ ...f, start: b.at });
        for (const l of b.labels) showLabel(l, b.at);
      }, Math.max(0, b.at - now));
      pending.current.add(timer);
    }
  }, [game.players, game.phase, game.log, spotOf, currency, n]);

  // Only the coins move here (the labels' pins place themselves, three/overlay.ts).
  useFrame(() => {
    const now = performance.now();
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

  return <instancedMesh ref={mesh} args={[coinGeo, coinMat, MAX_COINS]} count={0} castShadow frustumCulled={false} />;
}
