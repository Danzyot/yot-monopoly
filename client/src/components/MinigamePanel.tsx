import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { resolveTheme } from '../../../shared/themes.ts';
import {
  MINIGAME_INFO, WHEEL_SEGMENTS, cardLabel, cardRank, type MinigameMove, type MinigameView,
} from '../../../shared/minigames.ts';
import { SETTLE_MS } from '../../../shared/pacing.ts';
import type { GameView, PlayerState } from '../../../shared/types.ts';
import { act } from '../net.ts';
import { playArcadeLose, playArcadeWin, playCountdownBeep, playRight, playTick } from '../sound.ts';
import { toastError } from '../toast.tsx';
import { holdUntil, movesFreeAt, reserveWalk, stageView, useSceneBusy } from '../three/sequence.ts';

/** How long the client-side wheel animation runs; the server's result screen outlasts it. */
const SPIN_MS = 4_000;
/** How long dice tumble before they show the server's roll. */
const TUMBLE_MS = 900;
/**
 * A round whose clocks started this long ago comes up even if this device is
 * still playing the move that led here: a slow scene must not cost anyone the round.
 */
const LATE_MS = 300;

/** Elements that Space / Enter activate themselves: the panel's shortcuts leave those keys to them. */
const ACTIVATES = 'button, a, [role=button], [role=tab]';
/** Elements that take every key (typing, picking): the shortcuts stay out of their way entirely. */
const TYPES_IN = 'input, textarea, select, [contenteditable]:not([contenteditable=false])';

type Kind<K extends MinigameView['kind']> = Extract<MinigameView, { kind: K }>;

/** Animations are a flourish: anyone who asked their OS for less motion gets the result straight away. */
function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface Ctx {
  mg: MinigameView;
  me: string;
  /** Seconds left on the current stage (server clock), or null when secret. */
  left: number | null;
  /** Fraction of the current stage still to run, 0..1, or null when secret. */
  frac: number | null;
  who: (id: string) => PlayerState | undefined;
  cur: (n: number) => string;
  send: (m: MinigameMove) => void;
  busy: boolean;
  /** Keyboard shortcuts register here; the panel owns the one window listener. */
  keys: { current: ((e: KeyboardEvent) => boolean) | null };
}

/**
 * The arcade overlay: one panel for whichever mini-game is running. Everyone
 * sees it — players, the ones sitting this round out, and spectators — but only
 * participants get buttons. All state comes from the server's view; the client
 * adds the show: the wheel's spin, tumbling dice, card flips, the lights, the
 * confetti, and the sounds that go with them.
 *
 * A round waits for the move that landed on the arcade to play out (the dice,
 * the walk, a card, a cutscene): the server starts its clocks then
 * (Game.holdMinigame, MinigameView.startsAt), and the panel stays out of the
 * way until then too.
 */
export default function MinigamePanel({ game, me, skew }: { game: GameView; me: string; skew: number }) {
  const mg = game.minigame;
  const theme = resolveTheme(game.themeId, game.mapId);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  // The result waits for the show: the wheel to stop, the last dice to settle.
  // Worked out during the render the result arrives in (keyed by stage), so not
  // even that first render gives it away.
  const reveal = useRef({ key: '', at: 0 });
  /** The round whose play stage this panel has shown (its dice tumble when the result lands). */
  const liveSeq = useRef<number | null>(null);
  const keys = useRef<((e: KeyboardEvent) => boolean) | null>(null);
  const panelKeys = useRef<((e: KeyboardEvent) => boolean) | null>(null);
  // When each timed stage was first seen, so the ring knows how full it started.
  const starts = useRef<Record<string, number>>({});
  const sungFor = useRef<number | null>(null);
  const beepedAt = useRef<string>('');
  const stageKey = mg ? `${mg.seq}:${mg.stage}` : '';
  // The scene is still playing the move that got here (sequence.ts: its plan, and anything else holding the HUD).
  stageView(game);
  const sceneBusy = useSceneBusy();
  /** The round the panel has already come up for: once up, it stays up. */
  const shownSeq = useRef<number | null>(null);
  useEffect(() => {
    if (!mg) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [!!mg]);
  // One keyboard listener for the whole panel; the live game decides what the keys do.
  useEffect(() => {
    if (!mg) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      // Typing goes to the field; Space / Enter on a focused button press that button, not a shortcut.
      if (t && (t.closest(TYPES_IN) || (t as HTMLElement).isContentEditable)) return;
      if (t?.closest(ACTIVATES) && (e.key === ' ' || e.key === 'Enter')) return;
      if (e.repeat) return;
      if (keys.current?.(e) || panelKeys.current?.(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [!!mg]);
  if (!mg) return null;

  const info = MINIGAME_INFO[mg.kind];
  const clock = game.paused ? game.paused.at : now + skew;
  if (shownSeq.current !== mg.seq) {
    // Past the server's start (plus a breath) the clocks are running: come up even if this scene is still busy.
    const late = mg.startsAt !== undefined && clock > mg.startsAt + LATE_MS;
    const waiting = mg.stage === 'play' && !game.paused && !late
      && (sceneBusy || movesFreeAt() > performance.now() || (mg.startsAt !== undefined && clock < mg.startsAt));
    // (Re-rendered every 100 ms while a round is on, so it comes up on time.)
    if (waiting) return null;
    shownSeq.current = mg.seq;
  }
  if (mg.stage === 'play') liveSeq.current = mg.seq;
  const motion = !reducedMotion();
  /** How long the show runs once the deciding move arrives: the wheel's spin, the last dice tumbling. */
  const showMs = !motion ? 0 : mg.kind === 'wheel' ? SPIN_MS : mg.kind === 'diceDuel' ? TUMBLE_MS : 0;
  if (reveal.current.key !== stageKey) {
    // The wheel always spins up to its segment; dice tumble only for a roll that arrives while the panel is up.
    const shows = mg.stage === 'result' && showMs > 0 && (mg.kind === 'wheel' || liveSeq.current === mg.seq);
    reveal.current = { key: stageKey, at: shows ? Date.now() + showMs : 0 };
    // What the round paid waits for the show too: the coins, the money pop-ups and the log line
    // (movesFreeAt) come up as it ends (and the player cards' cash, sceneFreeAt). Nothing walks meanwhile.
    if (shows) reserveWalk(performance.now(), Math.max(0, showMs - SETTLE_MS));
  }
  // The player cards render before this panel, so they take the result's cash change before the
  // lines above run: until the deciding move arrives, keep the scene held a show ahead (and a
  // re-render's breath, so the cash never beats the result on screen).
  if (mg.stage === 'play' && showMs > 0) holdUntil(performance.now() + showMs + 150);
  const revealAt = reveal.current.at;
  // Frozen at the pause while the game is paused.
  const left = mg.endsAt === null ? null : Math.max(0, Math.ceil((mg.endsAt - clock) / 1000));
  let frac: number | null = null;
  if (mg.endsAt !== null) {
    const k = `${stageKey}:${mg.endsAt}`;
    if (!(k in starts.current)) starts.current[k] = clock;
    const total = Math.max(1000, mg.endsAt - starts.current[k]);
    frac = Math.max(0, Math.min(1, (mg.endsAt - clock) / total));
  }
  const playing = mg.players.includes(me);
  const revealed = mg.stage === 'result' && now >= revealAt;
  const host = ctxWho(mg.host);
  const myPay = revealed ? mg.result?.payouts.find(p => p.player === me) : undefined;
  const won = !!myPay && (myPay.amount > 0 || !!myPay.jailCard);
  const lost = revealed && playing && !won;

  // The win / lose sting plays when the result is actually shown (after the wheel stops).
  if (revealed && sungFor.current !== mg.seq) {
    sungFor.current = mg.seq;
    if (won) playArcadeWin();
    else if (lost) playArcadeLose();
  }
  // Last three seconds of my move tick down audibly.
  if (mg.stage === 'play' && playing && left !== null && left <= 3 && left > 0) {
    const k = `${stageKey}:${mg.endsAt}:${left}`;
    if (beepedAt.current !== k) { beepedAt.current = k; playCountdownBeep(0, left === 1); }
  }

  function ctxWho(id: string) { return game.players.find(p => p.id === id); }
  const ctx: Ctx = {
    mg, me, left, frac, busy, keys,
    who: ctxWho,
    cur: n => `${theme.currency}${n}`,
    send: m => {
      setBusy(true);
      act({ type: 'minigame', move: m }).catch(toastError).finally(() => setBusy(false));
    },
  };
  // Result stage: the host can skip ahead with Space / Enter.
  panelKeys.current = null;
  if (revealed) {
    panelKeys.current = e => {
      if (mg.host === me && (e.key === ' ' || e.key === 'Enter') && !busy) { ctx.send({ kind: 'continue' }); return true; }
      return false;
    };
  }

  const prize = mg.kind === 'wheel' ? `up to ${ctx.cur(Math.max(...WHEEL_SEGMENTS.map(s => s.amount)))}`
    : mg.kind === 'highLow' ? `up to ${ctx.cur(mg.maxPrize)}` : ctx.cur(mg.prize);
  const winners = new Set(revealed ? (mg.result?.payouts.filter(p => p.amount > 0 || p.jailCard).map(p => p.player) ?? []) : []);

  return (
    <div className={`mg ${revealed ? (won ? 'mga-won' : lost ? 'mga-lost' : 'mga-over') : ''}`} data-kind={mg.kind} role="dialog" aria-label={info.title}>
      <div className="mg-head">
        <span className="mg-icon" aria-hidden>{info.icon}</span>
        <div className="grow">
          <small>ARCADE{host ? <> · <b style={{ color: host.color }}>{host.name}</b> landed here</> : null}</small>
          <b className="mg-title">{info.title}</b>
        </div>
        {mg.stage === 'play' && mg.kind === 'highLow' && left !== null && <span className="mga-hint">time's up → banked for you</span>}
        {mg.stage === 'play' && left !== null && frac !== null && <Ring left={left} frac={frac} />}
        {mg.stage === 'play' && left === null && <span className="mga-secret" title="The clock is hidden for this one">⏱ ?</span>}
      </div>
      <div className="mga-meta">
        <div className="mga-players" aria-label="Playing">
          {mg.players.map(id => {
            const p = ctxWho(id);
            return (
              <span key={id} className={`mga-chip ${id === me ? 'me' : ''} ${winners.has(id) ? 'crown' : ''}`} style={{ '--c': p?.color } as CSSProperties}>
                {winners.has(id) ? '👑 ' : ''}{p?.name ?? '—'}
              </span>
            );
          })}
          {!playing && mg.stage === 'play' && <span className="mga-chip watch">👀 you</span>}
        </div>
        <span className="mga-prize">🏆 {prize}</span>
      </div>
      <p className="mg-blurb small muted">{info.blurb}</p>

      <div className="mg-body">
        {mg.kind === 'diceDuel' && <Duel {...ctx} mg={mg} />}
        {mg.kind === 'highLow' && <HighLow {...ctx} mg={mg} />}
        {mg.kind === 'reaction' && <Reaction {...ctx} mg={mg} />}
        {mg.kind === 'quickMath' && <QuickMath {...ctx} mg={mg} />}
        {mg.kind === 'wheel' && <Wheel {...ctx} mg={mg} />}
      </div>

      {revealed && mg.result && (
        <div className="mg-result">
          {won && <Confetti seed={mg.seq} />}
          <p className="mg-headline">{mg.result.headline}</p>
          <div className="mg-payouts">
            {mg.result.payouts.length === 0 && <span className="muted small">No prize this time.</span>}
            {mg.result.payouts.map((p, i) => {
              const pl = ctxWho(p.player);
              return (
                <span key={i} className={`mg-pay ${p.amount < 0 ? 'neg' : ''}`}>
                  <b style={{ color: pl?.color }}>{pl?.name}</b>{' '}
                  {p.jailCard ? '🎫 Get Out of Jail Free' : `${p.amount < 0 ? '−' : '+'}${ctx.cur(Math.abs(p.amount))}`}
                </span>
              );
            })}
          </div>
          {mg.host === me && (
            <button className="btn primary chunky mg-continue" disabled={busy} onClick={() => ctx.send({ kind: 'continue' })}>
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

/** The deadline as a draining ring with the seconds inside. */
function Ring({ left, frac }: { left: number; frac: number }) {
  const r = 17, c = 2 * Math.PI * r;
  return (
    <span className={`mga-ring ${left <= 3 ? 'hot' : ''}`} role="timer" aria-label={`${left} seconds left`}>
      <svg viewBox="0 0 40 40" aria-hidden>
        <circle cx="20" cy="20" r={r} className="track" />
        <circle cx="20" cy="20" r={r} className="arc" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
      </svg>
      <b>{left}</b>
    </span>
  );
}

/** A burst of paper from the top of the panel; purely decorative. */
function Confetti({ seed }: { seed: number }) {
  const bits = Array.from({ length: 28 }, (_, i) => {
    const h = (seed * 7919 + i * 104729) % 1000;
    return { x: (h % 100), d: (h % 7) / 10, r: ((h * 13) % 360), hue: (h * 31) % 360, s: 0.7 + ((h % 5) / 10) };
  });
  return (
    <span className="mga-confetti" aria-hidden>
      {bits.map((b, i) => (
        <i key={i} style={{ left: `${b.x}%`, animationDelay: `${b.d}s`, '--r': `${b.r}deg`, '--h': b.hue, '--s': b.s } as CSSProperties} />
      ))}
    </span>
  );
}

// ---- Dice Duel ------------------------------------------------------------------

const PIPS: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

function Die({ n, tumbling }: { n: number | null; tumbling?: boolean }) {
  return (
    <span className={`mg-die ${n === null ? 'blank' : ''} ${tumbling ? 'tumble' : ''}`}>
      {n === null ? '?' : Array.from({ length: 9 }, (_, i) => <i key={i} className={PIPS[n].includes(i) ? 'on' : ''} />)}
    </span>
  );
}

/** Shows a pair of dice; a fresh roll tumbles through random faces before settling on the real one. */
function DicePair({ roll, onSettled }: { roll: [number, number] | undefined; onSettled: (settled: boolean) => void }) {
  const [shown, setShown] = useState<[number, number] | null>(roll ?? null);
  const [tumbling, setTumbling] = useState(false);
  const seen = useRef<string>(roll ? roll.join() : '');
  useEffect(() => {
    const key = roll ? roll.join() : '';
    if (!roll) { setShown(null); setTumbling(false); seen.current = ''; onSettled(false); return; }
    if (seen.current === key) return;
    seen.current = key;
    if (reducedMotion()) { setShown(roll); onSettled(true); return; }
    setTumbling(true);
    onSettled(false);
    const spin = setInterval(() => setShown([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)] as [number, number]), 90);
    const stop = setTimeout(() => { clearInterval(spin); setShown(roll); setTumbling(false); onSettled(true); }, TUMBLE_MS);
    return () => { clearInterval(spin); clearTimeout(stop); };
  }, [roll?.join()]);
  return <div className="mg-dice"><Die n={shown ? shown[0] : null} tumbling={tumbling} /><Die n={shown ? shown[1] : null} tumbling={tumbling} /></div>;
}

function Duel({ mg, me, who, cur, send, busy, keys }: Ctx & { mg: Kind<'diceDuel'> }) {
  const sides = [mg.host, mg.opponent];
  const [settled, setSettled] = useState<Record<string, boolean>>({});
  const totals = sides.map(id => (mg.rolls[id] && settled[id] ? mg.rolls[id][0] + mg.rolls[id][1] : null));
  const both = totals[0] !== null && totals[1] !== null;
  const winner = both && totals[0] !== totals[1] ? sides[totals[0]! > totals[1]! ? 0 : 1] : null;
  const canRoll = mg.stage === 'play' && sides.includes(me) && !mg.rolls[me];
  keys.current = e => {
    if (canRoll && !busy && (e.key === ' ' || e.key === 'Enter')) { send({ kind: 'roll' }); return true; }
    return false;
  };
  return (
    <>
      <div className="mg-duel">
        {sides.map((id, i) => (
          <div key={id} className={`mg-duelist ${winner === id ? 'win' : ''} ${both && !winner ? 'tie' : ''} ${id === me ? 'me' : ''}`}>
            <Name p={who(id)} />
            <DicePair roll={mg.rolls[id]} onSettled={ok => setSettled(s => (s[id] === ok ? s : { ...s, [id]: ok }))} />
            <span className="mg-total">{totals[i] ?? (mg.rolls[id] ? '…' : '–')}</span>
            {winner === id && <span className="mga-crown" aria-label="winner">👑</span>}
            {i === 0 && <span className="mg-vs">VS</span>}
          </div>
        ))}
      </div>
      {both && !winner && <p className="small center"><b>Tie!</b> The prize is split.</p>}
      {mg.stage === 'play' && sides.includes(me) && (
        mg.rolls[me]
          ? <p className="small center muted">Waiting for your opponent…</p>
          : <button className="btn primary chunky mg-big" disabled={busy} onClick={() => send({ kind: 'roll' })}>🎲 Roll! <kbd>space</kbd></button>
      )}
    </>
  );
}

// ---- High or Low ----------------------------------------------------------------

function CardFace({ c }: { c: number }) {
  const label = cardLabel(c);
  const red = /[♥♦]/.test(label);
  const suit = label.slice(-1);
  return (
    <span className={`mga-face ${red ? 'red' : ''}`}>
      <small>{label.slice(0, -1)}<br />{suit}</small>
      <b>{suit}</b>
      <small className="flip">{label.slice(0, -1)}<br />{suit}</small>
    </span>
  );
}

/** The live card, dealt face down and flipped over. */
function FlipCard({ c, bust }: { c: number; bust: boolean }) {
  const [flipped, setFlipped] = useState(reducedMotion());
  useEffect(() => {
    if (flipped) return;
    const t = requestAnimationFrame(() => setFlipped(true));
    return () => cancelAnimationFrame(t);
  }, []);
  return (
    <span className={`mga-flip ${flipped ? 'flipped' : ''} ${bust ? 'bust' : ''}`}>
      <span className="mga-flip-inner">
        <span className="mga-back" aria-hidden />
        <CardFace c={c} />
      </span>
    </span>
  );
}

/** A number that rolls up to its new value rather than jumping. */
function CountUp({ value, fmt }: { value: number; fmt: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reducedMotion()) { setShown(value); from.current = value; return; }
    const start = from.current, t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const x = Math.min(1, (t - t0) / 600);
      const e = 1 - (1 - x) * (1 - x);
      setShown(Math.round(start + (value - start) * e));
      if (x < 1) raf = requestAnimationFrame(step); else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{fmt(shown)}</>;
}

function HighLow({ mg, me, who, cur, send, busy, keys }: Ctx & { mg: Kind<'highLow'> }) {
  const live = mg.cards[mg.cards.length - 1];
  // Three doublings to the cap: 50 → 100 → 200 → 400.
  const steps = [mg.maxPrize / 8, mg.maxPrize / 4, mg.maxPrize / 2, mg.maxPrize];
  const mine = mg.host === me && mg.stage === 'play';
  const guesses = mg.cards.length - 1;
  const prevLen = useRef(mg.cards.length);
  useEffect(() => {
    if (mg.cards.length > prevLen.current && mg.outcome === null && mg.host === me) playRight(0.3);
    prevLen.current = mg.cards.length;
  }, [mg.cards.length]);
  keys.current = e => {
    if (!mine || busy) return false;
    if (e.key === 'ArrowUp') { send({ kind: 'higher' }); return true; }
    if (e.key === 'ArrowDown') { send({ kind: 'lower' }); return true; }
    if (e.key === ' ' || e.key === 'Enter') { send({ kind: 'cashOut' }); return true; }
    return false;
  };
  return (
    <>
      <div className="mg-cards">
        {mg.cards.slice(0, -1).slice(-4).map(c => <span key={c} className={`mg-card ${/[♥♦]/.test(cardLabel(c)) ? 'red' : ''}`}>{cardLabel(c)}</span>)}
        <FlipCard key={`${mg.seq}:${mg.cards.length}`} c={live} bust={mg.outcome === 'bust'} />
      </div>
      <div className="mga-pot">
        <small>POT</small>
        <b className={mg.outcome === 'bust' ? 'bust' : mg.outcome === 'cashed' ? 'cashed' : ''}>
          <CountUp value={mg.outcome === 'bust' ? 0 : mg.prize} fmt={cur} />
        </b>
        <span className="mga-pips" aria-label={`${guesses} right so far`}>
          {[0, 1, 2].map(i => (
            <i key={i} className={i < guesses ? 'on' : i === guesses && mg.outcome === 'bust' ? 'bust' : ''} />
          ))}
        </span>
      </div>
      <div className="mg-ladder">
        {steps.map(v => (
          <span key={v} className={`${v === mg.prize ? 'on' : ''} ${v === mg.prize && mg.outcome === 'bust' ? 'bust' : ''}`}>{cur(v)}</span>
        ))}
      </div>
      {mine ? (
        <div className="mg-row">
          <button className="btn chunky mg-big mga-up" disabled={busy} onClick={() => send({ kind: 'higher' })}>▲ Higher <kbd>↑</kbd></button>
          <button className="btn chunky mg-big mga-down" disabled={busy} onClick={() => send({ kind: 'lower' })}>▼ Lower <kbd>↓</kbd></button>
          <button className="btn gold chunky mg-big mg-wide" disabled={busy} onClick={() => send({ kind: 'cashOut' })}>💰 Cash out {cur(mg.prize)} <kbd>space</kbd></button>
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

function Reaction({ mg, me, who, cur, send, keys }: Ctx & { mg: Kind<'reaction'> }) {
  const inIt = mg.players.includes(me);
  const out = mg.early.includes(me);
  const over = mg.stage === 'result';
  const state = over ? 'done' : out ? 'out' : mg.go ? 'go' : 'wait';
  const label = { wait: 'WAIT…', go: 'TAP!', out: 'TOO EARLY', done: mg.winner ? 'DONE' : 'NO TAPS' }[state];
  const canTap = inIt && !out && !over;
  const tap = () => { if (canTap) send({ kind: 'tap' }); };
  // Only a player still in the race claims the key: anyone else's Space / Enter is theirs.
  keys.current = e => {
    if (canTap && (e.key === ' ' || e.key === 'Enter')) { tap(); return true; }
    return false;
  };
  return (
    <>
      <div className={`mga-lights ${state}`} aria-hidden>
        <i className="red" /><i className="amber" /><i className="green" />
      </div>
      <button
        className={`mg-pad ${state}`}
        disabled={!inIt || out || over}
        // pointerdown, not click: every millisecond counts on a phone.
        onPointerDown={e => { e.preventDefault(); tap(); }}
        // Focused, it is the pad's own key (the panel's shortcut stands aside for a focused button).
        onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) tap(); } }}
      >
        <span className="mga-pad-word">{label}</span>
        {inIt && state === 'wait' && <small>tapping now disqualifies you</small>}
        {inIt && state === 'go' && <small>space works too</small>}
        {inIt && state === 'out' && <small>you jumped the gun</small>}
        {!inIt && !over && <small>watching</small>}
      </button>
      <p className="small center">First tap after green wins <b>{cur(mg.prize)}</b></p>
      {(mg.early.length > 0 || over) && (
        <ul className="mga-times">
          {mg.players.map(id => {
            const early = mg.early.includes(id);
            const win = mg.winner === id;
            return (
              <li key={id} className={win ? 'win' : early ? 'early' : ''}>
                <span>{win ? '👑 ' : ''}<Name p={who(id)} /></span>
                <b>{win ? `${mg.winnerMs} ms` : early ? 'false start' : over ? '—' : '…'}</b>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

// ---- Quick Math -------------------------------------------------------------------

function QuickMath({ mg, me, who, cur, send, busy, frac, keys }: Ctx & { mg: Kind<'quickMath'> }) {
  const inIt = mg.players.includes(me);
  const locked = mg.locked.includes(me);
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => setPicked(null), [mg.seq]);
  const over = mg.stage === 'result';
  const can = inIt && !locked && !over && !busy;
  const pick = (v: number) => { setPicked(v); send({ kind: 'answer', value: v }); };
  keys.current = e => {
    const i = Number(e.key) - 1;
    if (can && i >= 0 && i < mg.options.length) { pick(mg.options[i]); return true; }
    return false;
  };
  const flash = over ? (mg.winner === me ? 'good' : '') : locked ? 'bad' : '';
  return (
    <>
      <div className={`mga-eq ${flash}`}>
        <span className="mg-question">{mg.question} = <span className={mg.answer === null ? 'q' : 'a'}>{mg.answer ?? '?'}</span></span>
        {frac !== null && !over && (
          <span className="mga-bar" aria-hidden><i className={frac < 0.3 ? 'low' : ''} style={{ width: `${frac * 100}%` }} /></span>
        )}
      </div>
      <div className="mg-options">
        {mg.options.map((v, i) => (
          <button key={v}
            className={`btn chunky mg-big ${mg.answer === v ? 'right' : ''} ${picked === v && mg.answer !== v && (locked || over) ? 'wrong' : ''}`}
            disabled={!can}
            onClick={() => pick(v)}>
            <kbd>{i + 1}</kbd>{v}
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
const LIGHTS = 24;

function polar(deg: number, r: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad)];
}

/** Which wedge sits under the pointer when the wheel is turned `rot` degrees clockwise. */
function wedgeAt(rot: number): number {
  const a = ((360 - (rot % 360)) + 360) % 360;
  const i = ARCS.findIndex(([x, y]) => a >= x && a < y);
  return i < 0 ? 0 : i;
}

function Wheel({ mg, me, who, send, busy, cur, keys }: Ctx & { mg: Kind<'wheel'> }) {
  const svg = useRef<SVGSVGElement>(null);
  const pointer = useRef<HTMLSpanElement>(null);
  const [landed, setLanded] = useState<number | null>(null);
  const [spinning, setSpinning] = useState(false);
  const spunFor = useRef<number | null>(null);
  useEffect(() => {
    if (mg.segment === null || spunFor.current === mg.seq) return;
    spunFor.current = mg.seq;
    const [a, b] = ARCS[mg.segment];
    // Land somewhere inside the segment (not dead centre) after five turns.
    const inside = a + (b - a) * (0.3 + ((mg.seq * 37) % 40) / 100);
    const target = 360 * 5 + (360 - inside);
    const el = svg.current;
    if (!el) return;
    if (reducedMotion()) { el.style.transform = `rotate(${target}deg)`; setLanded(mg.segment); return; }
    setSpinning(true);
    const t0 = performance.now();
    let last = wedgeAt(0);
    let raf = 0;
    let wobble = 0;
    const frame = (t: number) => {
      const x = Math.min(1, (t - t0) / SPIN_MS);
      // Fast start, long smooth deceleration: the last turn takes half the time.
      const e = 1 - Math.pow(1 - x, 3.4);
      const rot = target * e;
      el.style.transform = `rotate(${rot}deg)`;
      const w = wedgeAt(rot);
      if (w !== last) {
        last = w;
        playTick();
        if (pointer.current) {
          pointer.current.style.transform = 'translateX(-50%) rotate(-14deg)';
          clearTimeout(wobble);
          wobble = window.setTimeout(() => { if (pointer.current) pointer.current.style.transform = ''; }, 70);
        }
      }
      if (x < 1) raf = requestAnimationFrame(frame);
      else { setSpinning(false); setLanded(mg.segment); }
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); clearTimeout(wobble); };
  }, [mg.segment, mg.seq]);
  const canSpin = mg.stage === 'play' && mg.host === me && mg.segment === null;
  keys.current = e => {
    if (canSpin && !busy && (e.key === ' ' || e.key === 'Enter')) { send({ kind: 'spin' }); return true; }
    return false;
  };
  const hit = landed !== null ? WHEEL_SEGMENTS[landed] : null;
  return (
    <>
      <div className={`mg-wheel ${spinning ? 'spinning' : ''} ${landed !== null ? 'landed' : ''}`}>
        <span ref={pointer} className="mg-pointer" aria-hidden />
        <svg ref={svg} viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="99" fill="#0b0f18" />
          {WHEEL_SEGMENTS.map((s, i) => {
            const [a, b] = ARCS[i];
            const [x1, y1] = polar(a, 86), [x2, y2] = polar(b, 86);
            const mid = (a + b) / 2;
            const [tx, ty] = polar(mid, 56);
            // Labels run along the radius; flip the left half so none read upside down.
            return (
              <g key={i} className={landed === i ? 'hit' : landed !== null ? 'dim' : ''}>
                <path d={`M100 100 L${x1} ${y1} A86 86 0 ${b - a > 180 ? 1 : 0} 1 ${x2} ${y2} Z`} fill={s.color} stroke="#0b0f18" strokeWidth="1.5" />
                <text x={tx} y={ty} transform={`rotate(${mid > 180 ? mid + 90 : mid - 90} ${tx} ${ty})`} textAnchor="middle" dominantBaseline="middle"
                  fontSize={s.label.length > 6 ? 8 : 11.5} fontWeight="800" fill={s.amount < 0 ? '#fff' : '#0b0f18'}>
                  {s.jailCard ? '🎫 FREE' : s.amount < 0 ? `−${cur(-s.amount)}` : s.amount >= 250 ? `★${cur(s.amount)}` : cur(s.amount)}
                </text>
              </g>
            );
          })}
          {Array.from({ length: LIGHTS }, (_, i) => {
            const [x, y] = polar((i / LIGHTS) * 360, 93);
            return <circle key={i} cx={x} cy={y} r="2.6" className={`mga-bulb ${i % 2 ? 'b' : 'a'}`} />;
          })}
          <circle cx="100" cy="100" r="16" fill="#0b0f18" stroke="#fff" strokeWidth="2.5" />
          <circle cx="100" cy="100" r="9" fill="#ffd23f" />
        </svg>
        {hit && (
          <span className="mga-hit" style={{ '--c': hit.color } as CSSProperties}>
            {hit.jailCard ? '🎫 JAIL FREE' : hit.amount < 0 ? `LOSE ${cur(-hit.amount)}` : hit.amount >= 250 ? `★ JACKPOT ${cur(hit.amount)}` : cur(hit.amount)}
          </span>
        )}
      </div>
      {mg.stage === 'play' && (mg.host === me
        ? <button className="btn primary chunky mg-big" disabled={busy || !canSpin} onClick={() => send({ kind: 'spin' })}>🎡 Spin! <kbd>space</kbd></button>
        : <p className="small center muted">Waiting for <Name p={who(mg.host)} /> to spin…</p>)}
      {spinning && <p className="small center muted">Round and round…</p>}
    </>
  );
}
