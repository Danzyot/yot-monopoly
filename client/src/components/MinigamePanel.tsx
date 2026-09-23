import { useEffect, useRef, useState } from 'react';
import { resolveTheme } from '../../../shared/themes.ts';
import {
  MINIGAME_INFO, WHEEL_SEGMENTS, cardLabel, cardRank, type MinigameMove, type MinigameView,
} from '../../../shared/minigames.ts';
import type { GameView, PlayerState } from '../../../shared/types.ts';
import { act } from '../net.ts';
import { toastError } from '../toast.tsx';

/** How long the client-side wheel animation runs; the server's result screen outlasts it. */
const SPIN_MS = 4_000;

type Kind<K extends MinigameView['kind']> = Extract<MinigameView, { kind: K }>;

interface Ctx {
  mg: MinigameView;
  me: string;
  /** Seconds left on the current stage (server clock), or null when secret. */
  left: number | null;
  who: (id: string) => PlayerState | undefined;
  cur: (n: number) => string;
  send: (m: MinigameMove) => void;
  busy: boolean;
}

/**
 * The arcade overlay: one panel for whichever mini-game is running. Everyone
 * sees it — players, the ones sitting this round out, and spectators — but only
 * participants get buttons. All state comes from the server's view; the only
 * client-side flourish is the wheel's spin animation.
 */
export default function MinigamePanel({ game, me, skew }: { game: GameView; me: string; skew: number }) {
  const mg = game.minigame;
  const theme = resolveTheme(game.themeId, game.mapId);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  // The wheel's result waits for the wheel to stop.
  const [revealAt, setRevealAt] = useState(0);
  const stageKey = mg ? `${mg.seq}:${mg.stage}` : '';
  useEffect(() => {
    if (!mg) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [!!mg]);
  useEffect(() => {
    if (mg?.stage === 'result') setRevealAt(mg.kind === 'wheel' ? Date.now() + SPIN_MS : 0);
  }, [stageKey]);
  if (!mg) return null;

  const info = MINIGAME_INFO[mg.kind];
  const left = mg.endsAt === null ? null : Math.max(0, Math.ceil((mg.endsAt - (now + skew)) / 1000));
  const ctx: Ctx = {
    mg, me, left, busy,
    who: id => game.players.find(p => p.id === id),
    cur: n => `${theme.currency}${n}`,
    send: m => {
      setBusy(true);
      act({ type: 'minigame', move: m }).catch(toastError).finally(() => setBusy(false));
    },
  };
  const revealed = mg.stage === 'result' && now >= revealAt;
  const playing = mg.players.includes(me);
  const host = ctx.who(mg.host);

  return (
    <div className="mg" data-kind={mg.kind} role="dialog" aria-label={info.title}>
      <div className="mg-head">
        <span className="mg-icon" aria-hidden>{info.icon}</span>
        <div className="grow">
          <small>ARCADE{host ? <> · <b style={{ color: host.color }}>{host.name}</b> landed here</> : null}</small>
          <b className="mg-title">{info.title}</b>
        </div>
        {mg.stage === 'play' && left !== null && <span className={`mg-clock ${left <= 3 ? 'hot' : ''}`}>⏱ {left}s</span>}
      </div>
      <p className="mg-blurb small muted">{info.blurb}{!playing && mg.stage === 'play' ? ' — you are watching this one.' : ''}</p>

      <div className="mg-body">
        {mg.kind === 'diceDuel' && <Duel {...ctx} mg={mg} />}
        {mg.kind === 'highLow' && <HighLow {...ctx} mg={mg} />}
        {mg.kind === 'reaction' && <Reaction {...ctx} mg={mg} />}
        {mg.kind === 'quickMath' && <QuickMath {...ctx} mg={mg} />}
        {mg.kind === 'wheel' && <Wheel {...ctx} mg={mg} />}
      </div>

      {revealed && mg.result && (
        <div className="mg-result">
          <p className="mg-headline">{mg.result.headline}</p>
          <div className="mg-payouts">
            {mg.result.payouts.length === 0 && <span className="muted small">No prize this time.</span>}
            {mg.result.payouts.map((p, i) => {
              const pl = ctx.who(p.player);
              return (
                <span key={i} className={`mg-pay ${p.amount < 0 ? 'neg' : ''}`}>
                  <b style={{ color: pl?.color }}>{pl?.name}</b>{' '}
                  {p.jailCard ? '🎫 Get Out of Jail Free' : `${p.amount < 0 ? '−' : '+'}${ctx.cur(Math.abs(p.amount))}`}
                </span>
              );
            })}
          </div>
          {mg.host === me && (
            <button className="btn primary mg-continue" disabled={busy} onClick={() => ctx.send({ kind: 'continue' })}>
              Continue{left !== null ? ` (${left}s)` : ''}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Name({ p }: { p: PlayerState | undefined }) {
  return <b style={{ color: p?.color }}>{p?.name ?? '—'}</b>;
}

// ---- Dice Duel ------------------------------------------------------------------

const PIPS: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

function Die({ n }: { n: number | null }) {
  return (
    <span className={`mg-die ${n === null ? 'blank' : ''}`}>
      {n === null ? '?' : Array.from({ length: 9 }, (_, i) => <i key={i} className={PIPS[n].includes(i) ? 'on' : ''} />)}
    </span>
  );
}

function Duel({ mg, me, who, cur, send, busy }: Ctx & { mg: Kind<'diceDuel'> }) {
  const sides = [mg.host, mg.opponent];
  const totals = sides.map(id => (mg.rolls[id] ? mg.rolls[id][0] + mg.rolls[id][1] : null));
  const winner = totals[0] !== null && totals[1] !== null && totals[0] !== totals[1]
    ? sides[totals[0] > totals[1] ? 0 : 1] : null;
  return (
    <>
      <div className="mg-duel">
        {sides.map((id, i) => {
          const r = mg.rolls[id];
          return (
            <div key={id} className={`mg-duelist ${winner === id ? 'win' : ''}`}>
              <Name p={who(id)} />
              <div className="mg-dice"><Die n={r ? r[0] : null} /><Die n={r ? r[1] : null} /></div>
              <span className="mg-total">{totals[i] ?? '–'}</span>
              {i === 0 && <span className="mg-vs">VS</span>}
            </div>
          );
        })}
      </div>
      <p className="small center">Prize <b>{cur(mg.prize)}</b> from the bank</p>
      {mg.stage === 'play' && sides.includes(me) && (
        mg.rolls[me]
          ? <p className="small center muted">Waiting for your opponent…</p>
          : <button className="btn primary mg-big" disabled={busy} onClick={() => send({ kind: 'roll' })}>🎲 Roll!</button>
      )}
    </>
  );
}

// ---- High or Low ----------------------------------------------------------------

function Card({ c, big }: { c: number; big?: boolean }) {
  const label = cardLabel(c);
  const red = /[♥♦]/.test(label);
  return <span className={`mg-card ${big ? 'big' : ''} ${red ? 'red' : ''}`}>{label}</span>;
}

function HighLow({ mg, me, who, cur, send, busy }: Ctx & { mg: Kind<'highLow'> }) {
  const live = mg.cards[mg.cards.length - 1];
  // Three doublings to the cap: 50 → 100 → 200 → 400.
  const steps = [mg.maxPrize / 8, mg.maxPrize / 4, mg.maxPrize / 2, mg.maxPrize];
  const mine = mg.host === me && mg.stage === 'play';
  return (
    <>
      <div className="mg-cards">
        {mg.cards.slice(0, -1).slice(-4).map(c => <Card key={c} c={c} />)}
        <Card c={live} big />
      </div>
      <div className="mg-ladder">
        {steps.map(v => (
          <span key={v} className={`${v === mg.prize ? 'on' : ''} ${v === mg.prize && mg.outcome === 'bust' ? 'bust' : ''}`}>{cur(v)}</span>
        ))}
      </div>
      {mine ? (
        <div className="mg-row">
          <button className="btn mg-big" disabled={busy} onClick={() => send({ kind: 'higher' })}>▲ Higher</button>
          <button className="btn mg-big" disabled={busy} onClick={() => send({ kind: 'lower' })}>▼ Lower</button>
          <button className="btn primary mg-big mg-wide" disabled={busy} onClick={() => send({ kind: 'cashOut' })}>Cash out {cur(mg.prize)}</button>
        </div>
      ) : mg.stage === 'play' ? (
        <p className="small center muted"><Name p={who(mg.host)} /> is holding {cur(mg.prize)} — on a {rankName(cardRank(live))}…</p>
      ) : null}
    </>
  );
}

function rankName(r: number): string {
  return r === 1 ? 'ace' : r === 11 ? 'jack' : r === 12 ? 'queen' : r === 13 ? 'king' : String(r);
}

// ---- Reaction Race ----------------------------------------------------------------

function Reaction({ mg, me, who, cur, send }: Ctx & { mg: Kind<'reaction'> }) {
  const inIt = mg.players.includes(me);
  const out = mg.early.includes(me);
  const over = mg.stage === 'result';
  const state = over ? 'done' : out ? 'out' : mg.go ? 'go' : 'wait';
  const label = { wait: 'Wait for it…', go: 'GO! TAP!', out: 'Too early — you are out', done: mg.winner ? 'Done!' : 'Round over' }[state];
  return (
    <>
      <button
        className={`mg-pad ${state}`}
        disabled={!inIt || out || over}
        // pointerdown, not click: every millisecond counts on a phone.
        onPointerDown={e => {
          e.preventDefault();
          if (inIt && !out && !over) send({ kind: 'tap' });
        }}
      >
        {label}
        {inIt && state === 'wait' && <small>tapping now disqualifies you</small>}
        {!inIt && !over && <small>watching</small>}
      </button>
      <p className="small center">First tap after GO wins <b>{cur(mg.prize)}</b></p>
      {mg.early.length > 0 && (
        <p className="small center muted">Jumped the gun: {mg.early.map((id, i) => <span key={id}>{i ? ', ' : ''}<Name p={who(id)} /></span>)}</p>
      )}
      {mg.winner && <p className="center"><Name p={who(mg.winner)} /> in <b>{mg.winnerMs} ms</b></p>}
    </>
  );
}

// ---- Quick Math -------------------------------------------------------------------

function QuickMath({ mg, me, who, cur, send, busy }: Ctx & { mg: Kind<'quickMath'> }) {
  const inIt = mg.players.includes(me);
  const locked = mg.locked.includes(me);
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => setPicked(null), [mg.seq]);
  const over = mg.stage === 'result';
  return (
    <>
      <div className="mg-question">{mg.question} = <span className="accent">{mg.answer ?? '?'}</span></div>
      <div className="mg-options">
        {mg.options.map(v => (
          <button key={v}
            className={`btn mg-big ${mg.answer === v ? 'right' : ''} ${picked === v && mg.answer !== v && (locked || over) ? 'wrong' : ''}`}
            disabled={!inIt || locked || over || busy}
            onClick={() => { setPicked(v); send({ kind: 'answer', value: v }); }}>
            {v}
          </button>
        ))}
      </div>
      <p className="small center">
        {locked && !over ? <span className="warn">Wrong — you are locked out this round. </span> : null}
        First correct answer wins <b>{cur(mg.prize)}</b>
      </p>
      {mg.locked.length > 0 && (
        <p className="small center muted">Locked out: {mg.locked.map((id, i) => <span key={id}>{i ? ', ' : ''}<Name p={who(id)} /></span>)}</p>
      )}
    </>
  );
}

// ---- Wheel Spin -------------------------------------------------------------------

const TOTAL_WEIGHT = WHEEL_SEGMENTS.reduce((a, s) => a + s.weight, 0);
/** Each segment's [start, end] angle in degrees, clockwise from the pointer; sized by its odds. */
const ARCS = WHEEL_SEGMENTS.reduce<[number, number][]>((acc, s) => {
  const from = acc.length ? acc[acc.length - 1][1] : 0;
  acc.push([from, from + (s.weight / TOTAL_WEIGHT) * 360]);
  return acc;
}, []);

function polar(deg: number, r: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad)];
}

function Wheel({ mg, me, who, send, busy, cur }: Ctx & { mg: Kind<'wheel'> }) {
  const [rot, setRot] = useState(0);
  const spunFor = useRef<number | null>(null);
  useEffect(() => {
    if (mg.segment === null || spunFor.current === mg.seq) return;
    spunFor.current = mg.seq;
    const [a, b] = ARCS[mg.segment];
    // Land somewhere inside the segment (not dead centre) after five turns.
    const inside = a + (b - a) * (0.3 + ((mg.seq * 37) % 40) / 100);
    const t = setTimeout(() => setRot(360 * 5 + (360 - inside)), 30);
    return () => clearTimeout(t);
  }, [mg.segment, mg.seq]);
  return (
    <>
      <div className="mg-wheel">
        <span className="mg-pointer" aria-hidden>▼</span>
        <svg viewBox="0 0 200 200" style={{ transform: `rotate(${rot}deg)`, transitionDuration: `${SPIN_MS}ms` }}>
          {WHEEL_SEGMENTS.map((s, i) => {
            const [a, b] = ARCS[i];
            const [x1, y1] = polar(a, 96), [x2, y2] = polar(b, 96);
            const mid = (a + b) / 2;
            const [tx, ty] = polar(mid, 62);
            // Labels run along the radius; flip the left half so none read upside down.
            return (
              <g key={i}>
                <path d={`M100 100 L${x1} ${y1} A96 96 0 ${b - a > 180 ? 1 : 0} 1 ${x2} ${y2} Z`} fill={s.color} stroke="#0b0f18" strokeWidth="1.5" />
                <text x={tx} y={ty} transform={`rotate(${mid > 180 ? mid + 90 : mid - 90} ${tx} ${ty})`} textAnchor="middle" dominantBaseline="middle"
                  fontSize={s.label.length > 6 ? 8.5 : 12} fontWeight="800" fill={s.amount < 0 ? '#fff' : '#0b0f18'}>
                  {s.jailCard ? '🎫 FREE' : s.amount < 0 ? `−${cur(-s.amount)}` : s.amount >= 250 ? `★${cur(s.amount)}` : cur(s.amount)}
                </text>
              </g>
            );
          })}
          <circle cx="100" cy="100" r="15" fill="#0b0f18" stroke="#fff" strokeWidth="2" />
        </svg>
      </div>
      {mg.stage === 'play' && (mg.host === me
        ? <button className="btn primary mg-big" disabled={busy} onClick={() => send({ kind: 'spin' })}>🎡 Spin!</button>
        : <p className="small center muted">Waiting for <Name p={who(mg.host)} /> to spin…</p>)}
    </>
  );
}
