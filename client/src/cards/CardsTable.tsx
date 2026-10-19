// The card table: the 3D room (three/CardsScene.tsx: the Chog lounge, the
// players' characters at a round felt, every card in flight) with the HUD in
// the DOM over it — each opponent's chip pinned over their figure (a row on
// phones), the prompts, our hand fanned along the bottom — or, without
// WebGL, the 2D table: players round an oval, the piles in the middle.
// Everything that moves is staged by sequence.ts: this file draws a frame of
// it (the pose, and the steps animating now) and holds the buttons and
// prompts until a play has shown.

import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { COLOR_LABEL, cardName, isWild, type Card, type CardColor, CARD_COLORS } from '../../../shared/cards/deck.ts';
import { CARDS_HOUSE_RULES } from '../../../shared/cards/rules.ts';
import { LAST_CARD_CALL, CARDS_GAME_NAME } from '../../../shared/cards/meta.ts';
import type { CardsAction, CardsLogEntry, CardsPlayerView, CardsStep, CardsView } from '../../../shared/cards/types.ts';
import { CARDS_AUTOPLAY_GRACE_MS, matchLabel, type CardsRoomView, type CardsSeatView } from '../../../shared/cards/room.ts';
import { CARDS_PODIUM_MS } from '../../../shared/cards/pacing.ts';
import { getCharacter } from '../../../shared/characters.ts';
import { SEASON_CHARACTERS } from '../../../shared/season.ts';
import type { ChatMsg } from '../net.ts';
import { cardsAct, cardsCall, cardsChat } from './net.ts';
import { CardArt, CardBack, CardFace, CARD_HEX } from './CardFace.tsx';
import { useCardsSequence, type CardsFrame, type StagedStep } from './sequence.ts';
import { toast, toastError } from '../toast.tsx';
import { useAuth } from '../auth.tsx';
import { askConfirm, CloseX, Modal } from '../components/Modal.tsx';
import Chat from '../components/Chat.tsx';
import { Avatar } from '../components/Avatar.tsx';
import MusicPlayer from '../components/MusicPlayer.tsx';
import { useMusicScene } from '../music.ts';
import { useAmbience } from '../ambience.ts';
import { QUALITY_LEVELS, useQuality } from '../three/quality.ts';
import { useCinematicPref } from '../three/cinematic.ts';
import { useCardsSounds } from './useCardsSounds.ts';

// The 3D table brings three.js: fetched when a table is first seen (the 2D felt stands in while it loads).
const CardsScene = lazy(() => import('./three/CardsScene.tsx'));

let webglOk: boolean | null = null;
/** Can this browser draw the 3D table? (?2d in the URL asks for the flat one.) */
function hasWebGL(): boolean {
  if (webglOk === null) {
    try {
      const c = document.createElement('canvas');
      webglOk = !!(c.getContext('webgl2') ?? c.getContext('webgl'));
    } catch {
      webglOk = false;
    }
  }
  return webglOk && !location.search.includes('2d');
}

/** The system's "less motion" wish: no camera cuts, no cards in flight. */
function useReducedMotion(): boolean {
  const q = '(prefers-reduced-motion: reduce)';
  const [r, setR] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(q);
    const on = () => setR(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return r;
}

/** The room the music and the ambience follow: the Chog lounge. */
const CHOG_ROOM = { mapId: 'classic', themeId: 'chog' };

type Pt = { x: number; y: number };

/** Phones and narrow windows: opponents in a row, the hand scrolls. */
function useCompact(): boolean {
  const q = '(max-width: 760px)';
  const [c, setC] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(q);
    const on = () => setC(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return c;
}

/** Re-render every `ms` while `on` (countdowns, catch windows). */
function useTicker(on: boolean, ms = 500): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setN(x => x + 1), ms);
    return () => clearInterval(id);
  }, [on, ms]);
  return n;
}

/** Where each player sits on the stage (percent of its box). Seat order runs clockwise from us. */
function seatLayout(players: CardsPlayerView[], me: string | null, compact: boolean): Record<string, Pt> {
  const at: Record<string, Pt> = {};
  const i = me ? players.findIndex(p => p.id === me) : -1;
  const others = i >= 0 ? [...players.slice(i + 1), ...players.slice(0, i)] : players;
  if (i >= 0) at[me!] = { x: 50, y: compact ? 108 : 112 };
  const n = others.length;
  others.forEach((p, k) => {
    if (compact) {
      // One row, or two (staggered) for a big table.
      const rows = n > 4 ? 2 : 1;
      const per = Math.ceil(n / rows);
      const row = Math.floor(k / per), col = k % per, inRow = row === 0 ? per : n - per;
      at[p.id] = { x: inRow === 1 ? 50 : 12 + (76 * col) / (inRow - 1), y: rows === 1 ? 9 : 7 + row * 14 };
    } else if (i >= 0) {
      // From our left, over the top, round to our right.
      const t = Math.PI - 0.3 + ((k + 1) / (n + 1)) * (Math.PI + 0.6);
      at[p.id] = { x: 50 + 43 * Math.cos(t), y: 47 + 39 * Math.sin(t) };
    } else {
      const t = Math.PI / 2 + (k * 2 * Math.PI) / n;
      at[p.id] = { x: 50 + 43 * Math.cos(t), y: 50 + 38 * Math.sin(t) };
    }
  });
  return at;
}

const PILE: Record<'compact' | 'wide', { pile: Pt; discard: Pt }> = {
  wide: { pile: { x: 42, y: 49 }, discard: { x: 58, y: 49 } },
  compact: { pile: { x: 33, y: 53 }, discard: { x: 64, y: 53 } },
};

const pos = (p: Pt): CSSProperties => ({ left: `${p.x}%`, top: `${p.y}%` });

/** The turn ring: drains over the turn timer (starts full while the clock is held). */
function TurnRing({ endsAt, total, skew }: { endsAt: number | null; total: number; skew: number }) {
  if (!endsAt || !total) return <svg className="ct-ring" viewBox="0 0 100 100" aria-hidden><circle cx="50" cy="50" r="46" className="ct-ring-on" /></svg>;
  const now = Date.now() + skew;
  const start = endsAt - total;
  const style = { animationDuration: `${total}ms`, animationDelay: `${start - now}ms` } as CSSProperties;
  return (
    <svg className="ct-ring" viewBox="0 0 100 100" aria-hidden>
      <circle cx="50" cy="50" r="46" className="ct-ring-track" />
      <circle key={endsAt} cx="50" cy="50" r="46" className="ct-ring-run" pathLength={100} style={style} />
    </svg>
  );
}

function SeatAvatar({ seat, size = 46 }: { seat?: CardsSeatView; size?: number }) {
  const ch = getCharacter(seat?.character ?? SEASON_CHARACTERS[0]);
  return (
    <span className="ct-ava-badge" style={{ background: seat?.color ?? '#888', width: size, height: size, fontSize: size * 0.5 }} aria-hidden>
      {ch.emoji}
      {seat && !seat.isBot && <span className="ct-ava-me"><Avatar src={seat.avatar} size={Math.round(size * 0.4)} /></span>}
    </span>
  );
}

/** One opponent round the table. */
function SeatChip({ p, seat, at, view, frame, skew, now, canCatch, compact, pin }: {
  p: CardsPlayerView; seat?: CardsSeatView; at: Pt; view: CardsView; frame: CardsFrame; skew: number; now: number;
  canCatch: boolean; compact: boolean;
  /** Pinned over the player's 3D figure (the scene places it); otherwise at `at`. */
  pin?: (el: HTMLElement | null) => void;
}) {
  const turn = frame.current === p.id && (view.phase !== 'roundOver' && view.phase !== 'over');
  const count = frame.counts[p.id] ?? p.cards;
  const oc = view.oneCard.find(o => o.player === p.id);
  const called = !!oc && oc.calledAt !== null && count === 1;
  const away = seat?.awayAt && !seat.isBot ? Math.max(0, Math.ceil((seat.awayAt + CARDS_AUTOPLAY_GRACE_MS - now) / 1000)) : null;
  const fan = Math.min(count, compact ? 4 : 7);
  return (
    <div className={`ct-seat ${turn ? 'turn' : ''} ${p.left ? 'left' : ''} ${compact ? 'compact' : ''} ${pin ? 'pinned' : ''}`}
      style={{ ...(pin ? {} : pos(at)), '--seat': seat?.color ?? '#888' } as CSSProperties} data-player={p.id} ref={pin}>
      <div className="ct-ava">
        {turn && <TurnRing endsAt={frame.busy ? null : view.turnEndsAt} total={view.rules.turnSeconds * 1000} skew={skew} />}
        <SeatAvatar seat={seat} size={compact ? 38 : 50} />
        {view.dealer === p.id && <span className="ct-dealer" title="Dealer">D</span>}
      </div>
      <div className="ct-seat-name">{p.name}{p.isBot && <em className="ct-tag">bot</em>}</div>
      <div className="ct-seat-hand" aria-label={`${count} card${count === 1 ? '' : 's'}`}>
        <span className="ct-mini-fan" aria-hidden>
          {Array.from({ length: fan }, (_, k) => <i key={k} style={{ transform: `rotate(${(k - (fan - 1) / 2) * 9}deg)` }} />)}
        </span>
        <b>{count}</b>
      </div>
      {view.rules.match === 'points' && !compact && <div className="ct-seat-score">{p.score} pts</div>}
      {turn && !compact && <div className="ct-turn-tag">{frame.busy ? 'playing…' : 'their turn'}</div>}
      {called && <div className="ct-badge-last">{LAST_CARD_CALL}</div>}
      {p.left && <div className="ct-badge-note">left</div>}
      {!p.left && p.afk && <div className="ct-badge-note">auto-play</div>}
      {!p.left && !p.afk && away !== null && (
        <div className="ct-badge-note warn" title={`${p.name} lost connection — auto-play takes over in ${away} s if not back`}>
          {away > 0 ? `offline · auto-play in ${away}s` : 'offline · auto-play'}
        </div>
      )}
      {canCatch && (
        <button className="btn small danger ct-catch" onClick={() => cardsAct({ type: 'catch', target: p.id }).catch(toastError)}>
          Catch!
        </button>
      )}
    </div>
  );
}

/**
 * What is animating right now: cards in flight, flashes, banners. On the 3D
 * table the cards fly in the scene and the flashes are pinned over whoever
 * they are about (data-at), so here they only get their text.
 */
function Effects({ frame, layout, piles, names, me, three, fxRef }: {
  frame: CardsFrame; layout: Record<string, Pt>; piles: { pile: Pt; discard: Pt }; names: Record<string, string>; me: string | null;
  three: boolean; fxRef?: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="ct-fx" aria-hidden ref={fxRef}>
      {frame.active.map(s => <Effect key={`${frame.play?.seq}-${s.index}`} s={s} layout={layout} piles={piles} names={names} me={me} three={three} />)}
    </div>
  );
}

function fly(from: Pt, to: Pt, dur: number, delay = 0, extra: CSSProperties = {}): CSSProperties {
  return {
    '--fx': `${from.x}%`, '--fy': `${from.y}%`, '--tx': `${to.x}%`, '--ty': `${to.y}%`,
    animationDuration: `${dur}ms`, animationDelay: `${delay}ms`, ...extra,
  } as CSSProperties;
}

function Effect({ s, layout, piles, names, me, three }: {
  s: StagedStep; layout: Record<string, Pt>; piles: { pile: Pt; discard: Pt }; names: Record<string, string>; me: string | null; three: boolean;
}) {
  const st: CardsStep = s.step;
  const dur = s.end - s.at;
  // Negative for a step already under way, so a late mount joins it in step.
  const left = s.at - performance.now();
  const seatAt = (id: string) => layout[id] ?? { x: 50, y: 50 };
  /** A flash over a player (their id), the pile or the discard: placed here in 2D, by the scene in 3D. */
  const flash = (where: string, text: ReactNode, cls = '') => {
    const at = where === 'pile' ? piles.pile : where === 'discard' ? piles.discard : seatAt(where);
    return (
      <div className={`ct-flash ${cls}`} data-at={three ? where : undefined}
        style={{ ...(three ? {} : pos(at)), animationDuration: `${dur}ms`, animationDelay: `${left}ms` }}>{text}</div>
    );
  };
  const banner = (text: ReactNode, cls = '') => (
    <div className={`ct-banner ${cls}`} style={{ animationDuration: `${dur}ms`, animationDelay: `${left}ms` }}>{text}</div>
  );
  switch (st.type) {
    case 'play':
      if (three) return st.jumpIn ? flash(st.player, 'Jump in!', 'call') : null;
      return (
        <div className={`ct-fly ${st.jumpIn ? 'jump' : ''}`} style={fly(seatAt(st.player), piles.discard, dur, left)}>
          <CardFace card={st.card} />
          {st.jumpIn && <span className="ct-fly-tag">Jump in!</span>}
        </div>
      );
    case 'draw': {
      const n = Math.min(st.count, 8);
      const gap = n > 1 ? Math.min(110, (dur - 380) / (n - 1)) : 0;
      const mine = st.player === me && st.cards;
      return (
        <>
          {!three && Array.from({ length: n }, (_, k) => (
            <div key={k} className="ct-fly draw" style={fly(piles.pile, seatAt(st.player), 380, left + k * gap)}>
              <CardArt card={mine ? st.cards![k] ?? null : null} />
            </div>
          ))}
          {st.count > 1 && flash(st.player, `+${st.count}`, 'draw')}
        </>
      );
    }
    case 'deal': {
      const per = Math.min(st.count, 3);
      const n = st.order.length * per;
      const gap = n > 1 ? Math.max(20, (dur - 360) / n) : 0;
      return (
        <>
          {!three && Array.from({ length: n }, (_, k) => (
            <div key={k} className="ct-fly draw" style={fly(piles.pile, seatAt(st.order[k % st.order.length]), 360, left + k * gap)}>
              <CardBack />
            </div>
          ))}
          {banner(<>Round {st.round}<small>{names[st.dealer] ?? 'The dealer'} deals</small></>, 'deal')}
        </>
      );
    }
    case 'flip':
      if (three) return null;
      return (
        <div className="ct-flip" style={{ ...pos(piles.discard), animationDuration: `${dur}ms`, animationDelay: `${left}ms` }}>
          <CardFace card={st.card} />
        </div>
      );
    case 'skip': return flash(st.player, <><span className="ct-ico">⊘</span>Skipped!</>, 'skip');
    case 'reverse': return banner(<><span className="ct-ico spin">⟲</span>Reverse!</>, 'reverse');
    case 'color':
      if (three) return flash('discard', `${COLOR_LABEL[st.color]}!`, `wild ${st.color}`);
      return (
        <div className="ct-burst" style={{ ...pos(piles.discard), '--cc': CARD_HEX[st.color].base, animationDuration: `${dur}ms`, animationDelay: `${left}ms` } as CSSProperties} />
      );
    case 'swap': return banner(<>{names[st.player]} ⇄ {names[st.target]}<small>hands swapped</small></>, 'swap');
    case 'rotate': return banner(<>Pass it on!<small>every hand moves {st.direction === 1 ? 'clockwise' : 'anticlockwise'}</small></>, 'swap');
    case 'challenge':
      // The 3D table cuts to the challenge with its own title card.
      if (three) return null;
      return banner(<>Challenge!<small>{st.bluff ? `It was a bluff — ${names[st.target]} draws 4` : `It was legal — ${names[st.player]} draws 6`}</small></>, st.bluff ? 'good' : 'bad');
    case 'call': return flash(st.player, LAST_CARD_CALL, three ? 'call big' : 'call');
    case 'catch': return flash(st.target, <>Caught!<small>by {names[st.player]}</small></>, 'catch');
    case 'pass': return flash(st.player, 'Pass', 'soft');
    case 'timeout': return flash(st.player, '⏱ Time!', 'soft');
    case 'leave': return flash(st.player, 'Left', 'soft');
    case 'reshuffle': return flash('pile', 'Reshuffle', 'soft');
    case 'roundEnd':
      // In 3D the camera cuts to the winner with a title card; the match's last round goes on to the podium.
      if (three) return null;
      return banner(<>{names[st.winner]} {st.blocked ? 'takes' : 'wins'} the round!<small>+{st.points} points</small></>, 'win');
  }
}

/** Our hand: fanned on wide screens, a scrolling row on phones. */
function Hand({ cards, view, frame, compact, onPlay, rects, handRef }: {
  cards: Card[]; view: CardsView; frame: CardsFrame; compact: boolean; onPlay: (c: Card) => void;
  /** Where each card was last drawn (by id): the 3D table flies a play out from there. */
  rects?: Map<number, DOMRect>; handRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const you = view.you!;
  const playable = new Set(frame.busy ? [] : you.playable);
  const myStep = view.current === you.id && (view.phase === 'play' || view.phase === 'drawn');
  const n = cards.length;
  const spread = compact ? 0 : Math.min(7, 60 / Math.max(1, n));
  const overlap = compact ? 0 : Math.max(-62, Math.min(-8, -86 + 900 / Math.max(n, 1) * 0.5));
  const own = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = own.current;
    if (!rects || !el) return;
    // Now, and once the cards have slid into place (they take 0.15 s).
    const note = () => { for (const b of el.querySelectorAll<HTMLElement>('button[data-card]')) rects.set(Number(b.dataset.card), b.getBoundingClientRect()); };
    note();
    const t = setTimeout(note, 220);
    return () => clearTimeout(t);
  });
  return (
    <div className={`ct-hand ${compact ? 'row' : 'fan'}`} role="list" aria-label="Your hand"
      ref={el => { own.current = el; if (handRef) handRef.current = el; }}>
      {cards.map((c, i) => {
        const can = playable.has(c.id);
        const off = i - (n - 1) / 2;
        const style: CSSProperties = compact ? {} : {
          transform: `rotate(${off * spread}deg) translateY(${Math.abs(off) * Math.abs(off) * spread * 0.18}px)`,
          marginLeft: i === 0 ? 0 : overlap,
          zIndex: i,
        };
        const jump = can && view.current !== you.id;
        return (
          <button key={c.id} role="listitem" style={style} data-card={c.id}
            className={`ct-card ${can ? 'can' : ''} ${!can && myStep && !frame.busy ? 'dim' : ''} ${you.drawn === c.id ? 'drawn' : ''} ${jump ? 'jump' : ''}`}
            aria-label={`${cardName(c)}${can ? (jump ? ', jump in' : ', playable') : ''}`}
            aria-disabled={!can}
            onClick={() => can && onPlay(c)}>
            <CardFace card={c} />
            {jump && <span className="ct-card-tag">Jump in!</span>}
          </button>
        );
      })}
    </div>
  );
}

function ColorPicker({ title, onPick, onCancel }: { title: string; onPick: (c: CardColor) => void; onCancel?: () => void }) {
  return (
    <div className="ct-prompt ct-colors" role="dialog" aria-label={title}>
      <h3>{title}</h3>
      <div className="ct-color-grid">
        {CARD_COLORS.map(c => (
          <button key={c} className="ct-color" style={{ '--cc': CARD_HEX[c].base, '--cd': CARD_HEX[c].deep } as CSSProperties}
            onClick={() => onPick(c)} data-color={c}>
            {COLOR_LABEL[c]}
          </button>
        ))}
      </div>
      {onCancel && <button className="btn small ghost" onClick={onCancel}>Cancel</button>}
    </div>
  );
}

function SwapPicker({ view, seats, onPick, onCancel }: {
  view: CardsView; seats: Record<string, CardsSeatView>; onPick: (id: string) => void; onCancel?: () => void;
}) {
  const me = view.you!.id;
  return (
    <div className="ct-prompt" role="dialog" aria-label="Swap hands with">
      <h3>Swap hands with…</h3>
      <div className="ct-swap-list">
        {view.players.filter(p => p.id !== me && !p.left).map(p => (
          <button key={p.id} className="ct-swap" onClick={() => onPick(p.id)}>
            <SeatAvatar seat={seats[p.id]} size={36} />
            <span className="grow">{p.name}</span>
            <b>{p.cards} card{p.cards === 1 ? '' : 's'}</b>
          </button>
        ))}
      </div>
      {onCancel && <button className="btn small ghost" onClick={onCancel}>Cancel</button>}
    </div>
  );
}

/** The feed: log lines once their play has been shown. */
function Feed({ log, doneSeq, colors }: { log: CardsLogEntry[]; doneSeq: number; colors: Record<string, string> }) {
  const shown = log.filter(e => !e.play || e.play <= doneSeq);
  const lines = shown.slice(-60);
  const ref = useMemo(() => ({ el: null as HTMLDivElement | null }), []);
  useEffect(() => { if (ref.el) ref.el.scrollTop = ref.el.scrollHeight; }, [lines.length, ref]);
  return (
    <div className="ct-feed" ref={el => { ref.el = el; }} aria-live="polite">
      {lines.map((e, i) => (
        <div key={`${e.t}-${i}`} className={`ct-line ${e.reason ?? ''}`} style={{ borderColor: e.who ? colors[e.who] ?? 'transparent' : 'transparent' }}>
          {e.text}
        </div>
      ))}
    </div>
  );
}

/** Final order: winner, then score, then fewest points left in hand. */
function standings(v: CardsView): CardsPlayerView[] {
  const last = v.history.at(-1);
  const held = (id: string) => last?.hands[id] ?? 0;
  return [...v.players].sort((a, b) =>
    Number(b.id === v.winner) - Number(a.id === v.winner) || Number(!!a.left) - Number(!!b.left)
    || b.score - a.score || held(a.id) - held(b.id));
}

function RoundOver({ view, skew }: { view: CardsView; skew: number }) {
  useTicker(true, 250);
  const r = view.history.at(-1);
  if (!r) return null;
  const left = view.nextRoundAt ? Math.max(0, Math.ceil((view.nextRoundAt - Date.now() - skew) / 1000)) : 0;
  const name = (id: string) => view.players.find(p => p.id === id)?.name ?? '?';
  return (
    <div className="ct-prompt ct-round" role="dialog" aria-label="Round over">
      <h3>{name(r.winner)} {r.blocked ? 'takes' : 'wins'} round {r.round}!</h3>
      <p className="muted">+{r.points} points{r.blocked ? ' (blocked round: fewest points in hand)' : ''}</p>
      <table className="ct-scores">
        <thead><tr><th>Player</th><th>In hand</th><th>Score</th></tr></thead>
        <tbody>
          {[...view.players].sort((a, b) => b.score - a.score).map(p => (
            <tr key={p.id} className={p.id === r.winner ? 'win' : ''}>
              <td>{p.name}</td><td>{p.id === r.winner ? '—' : r.hands[p.id] ?? 0}</td><td><b>{p.score}</b> / {view.rules.targetScore}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ct-next">Next deal in <b>{left}</b>…</p>
    </div>
  );
}

function MatchOver({ room, view, me, isHost }: { room: CardsRoomView; view: CardsView | null; me: string; isHost: boolean }) {
  const nav = useNavigate();
  const order = view ? standings(view) : [];
  const seats = Object.fromEntries(room.seats.map(s => [s.id, s]));
  const podium = [order[1], order[0], order[2]].filter(Boolean) as CardsPlayerView[];
  const ended = !view || view.phase !== 'over';
  const last = view?.history.at(-1);
  return (
    <div className="ct-over" role="dialog" aria-label="Match over">
      <div className="ct-over-card panel">
        <h2>{ended ? 'The match was ended' : `🏆 ${order[0]?.name} wins!`}</h2>
        {!ended && (
          <div className="ct-podium">
            {podium.map(p => {
              const place = order.indexOf(p);
              return (
                <div key={p.id} className={`ct-step place-${place + 1}`}>
                  <SeatAvatar seat={seats[p.id]} size={place === 0 ? 72 : 54} />
                  <b>{p.name}{p.id === me && <em className="ct-tag">you</em>}</b>
                  <span className="ct-step-block">{place + 1}</span>
                  <small>{view!.rules.match === 'points' ? `${p.score} pts` : place === 0 ? 'went out first' : `${last?.hands[p.id] ?? 0} pts in hand`}</small>
                </div>
              );
            })}
          </div>
        )}
        {order.length > 3 && (
          <ol className="ct-rest" start={4}>
            {order.slice(3).map(p => <li key={p.id}>{p.name} <span className="muted">{view!.rules.match === 'points' ? `${p.score} pts` : `${last?.hands[p.id] ?? 0} in hand`}</span></li>)}
          </ol>
        )}
        <p className="muted small">{view ? `${view.round} round${view.round === 1 ? '' : 's'} · ${matchLabel(view.rules)}` : ''}</p>
        <div className="row wrap ct-over-actions">
          {isHost && <button className="btn primary" onClick={() => cardsCall('cards:rematch').catch(toastError)}>Rematch</button>}
          {!isHost && <span className="muted small">Waiting for the host to start a rematch…</span>}
          <button className="btn ghost" onClick={() => { void cardsCall('cards:leave').catch(() => {}); nav('/cards'); }}>Back to {CARDS_GAME_NAME}</button>
        </div>
      </div>
    </div>
  );
}

function RulesModal({ view, onClose }: { view: CardsView; onClose: () => void }) {
  const r = view.rules;
  return (
    <Modal onClose={onClose} label="Table rules" className="ct-rules-modal">
      <CloseX onClick={onClose} />
      <h2>How to play</h2>
      <ul className="ct-howto">
        <li>Match the top card by <b>colour</b>, <b>number</b> or <b>symbol</b>. Wilds go on anything and name the next colour.</li>
        <li>Can't play? Draw a card. If it fits you may play it at once{r.forcedPlay ? ' (at this table you must)' : ''}.</li>
        <li><b>Skip</b> hops the next player, <b>Reverse</b> turns play round, <b>Draw Two</b> and <b>Wild Draw Four</b> make the next player draw and miss their turn.</li>
        <li>Down to one card? Hit <b>{LAST_CARD_CALL}</b>, or anyone can <b>Catch!</b> you before the next player moves: draw 2.</li>
        {!r.noBluff && <li>A Wild Draw Four is only legal without the colour in play. Think it was a bluff? <b>Challenge</b> it.</li>}
        <li>First out of cards wins the round and scores everyone else's cards (numbers face value, action cards 20, Wilds 50).</li>
      </ul>
      <h3>This table</h3>
      <p>{matchLabel(r)} · {r.turnSeconds ? `${r.turnSeconds} s turns` : 'no turn timer'}</p>
      <ul className="ct-howto">
        {CARDS_HOUSE_RULES.filter(h => r[h.key]).map(h => <li key={h.key}><b>{h.label}:</b> {h.help}</li>)}
        {!CARDS_HOUSE_RULES.some(h => r[h.key]) && <li className="muted">No house rules: the standard game.</li>}
      </ul>
    </Modal>
  );
}

export default function CardsTable({ room, me, chat, skew, fromLobby }: {
  room: CardsRoomView; me: string; chat: ChatMsg[]; skew: number; fromLobby: boolean;
}) {
  const view = room.game!;
  const nav = useNavigate();
  const { profile, config } = useAuth();
  const compact = useCompact();
  const { frame } = useCardsSequence(view, fromLobby);
  const you = view.you;
  const myId = you?.id ?? null;
  const isHost = room.hostId === me || (!!profile?.isAdmin && !room.seats.some(s => s.id === me));
  const seats = useMemo(() => Object.fromEntries(room.seats.map(s => [s.id, s])), [room.seats]);
  const names = useMemo(() => Object.fromEntries(view.players.map(p => [p.id, p.name])), [view.players]);
  const colors = useMemo(() => Object.fromEntries(room.seats.map(s => [s.id, s.color])), [room.seats]);
  const layout = useMemo(() => seatLayout(view.players, myId, compact), [view.players, myId, compact]);
  const piles = PILE[compact ? 'compact' : 'wide'];
  const [pendingWild, setPendingWild] = useState<Card | null>(null);
  const [pendingSeven, setPendingSeven] = useState<Card | null>(null);
  const [panel, setPanel] = useState<'feed' | 'chat'>('feed');
  const [sideOpen, setSideOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const live = view.phase !== 'over' && view.phase !== 'roundOver' && room.status === 'playing';
  useTicker(live || view.phase === 'roundOver', 400);
  const now = Date.now() + skew;

  // The 3D table and what it needs from the DOM: our hand (cards fly from
  // and to it), the chips pinned over the figures, the effects layer.
  const three = useMemo(hasWebGL, []);
  const reduced = useReducedMotion();
  const [quality, nextQuality] = useQuality();
  const [cinematic] = useCinematicPref();
  const handRects = useMemo(() => new Map<number, DOMRect>(), []);
  const chipEls = useMemo(() => new Map<string, HTMLElement>(), []);
  const pins = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const pinFor = useCallback((id: string) => {
    let f = pins.current.get(id);
    if (!f) {
      f = (el: HTMLElement | null) => { if (el) chipEls.set(id, el); else chipEls.delete(id); };
      pins.current.set(id, f);
    }
    return f;
  }, [chipEls]);
  const handRef = useRef<HTMLDivElement | null>(null);
  const fxRef = useRef<HTMLDivElement | null>(null);
  const qualityInfo = QUALITY_LEVELS.find(q => q.id === quality)!;
  const cycleQuality = () => {
    const i = (QUALITY_LEVELS.findIndex(q => q.id === quality) + 1) % QUALITY_LEVELS.length;
    toast(`${QUALITY_LEVELS[i].icon} ${QUALITY_LEVELS[i].label} — ${QUALITY_LEVELS[i].hint}`);
    nextQuality();
  };
  // The Chog lounge's tune and room tone, with the same switches as the board (MusicPlayer).
  useMusicScene(CHOG_ROOM);
  useAmbience(CHOG_ROOM);
  // The match won: the winner dances on the table before the results show (the scene says when; a timer backs it up).
  const [podiumDone, setPodiumDone] = useState(false);
  const winner = view.phase === 'over' ? view.winner : null;
  const podium = three && !reduced && room.status === 'finished' && !!winner && !podiumDone && !!frame && !frame.busy ? winner : null;
  useEffect(() => {
    if (!podium) return;
    const t = setTimeout(() => setPodiumDone(true), CARDS_PODIUM_MS + 1500);
    return () => clearTimeout(t);
  }, [podium]);
  const myTurnFree = !!you && view.current === you.id && live && !!frame && !frame.busy;
  useCardsSounds(frame, myId, myTurnFree);

  // A pick in progress goes stale when the table moves on.
  useEffect(() => { setPendingWild(null); setPendingSeven(null); }, [view.turn, view.round]);

  if (!frame) return null;
  const myTurn = !!you && view.current === you.id && live;
  const held = frame.busy;
  const hand = frame.hand ?? you?.hand ?? [];
  const alive = view.players.filter(p => !p.left).length;
  const meSeat = myId ? seats[myId] : undefined;
  const meP = view.players.find(p => p.id === myId);
  const myOne = view.oneCard.find(o => o.player === myId);
  const catchable = new Set(you && live ? view.oneCard.filter(o => o.player !== you.id && o.catchable && now >= o.catchFrom).map(o => o.player) : []);
  const showLast = !!you && live && !held && you.canCallLastCard
    && (you.hand.length === 1 || (you.hand.length === 2 && you.playable.length > 0 && (myTurn || view.rules.jumpIn)));
  const away = !!you && !!meP && !meP.left && (meP.afk || !!meSeat?.autopilot);

  const act = async (a: CardsAction) => {
    if (sending) return;
    setSending(true);
    try { await cardsAct(a); } catch (e) { toastError(e); } finally { setSending(false); }
  };
  const playCard = (c: Card) => {
    if (!you) return;
    if (isWild(c)) { setPendingSeven(null); setPendingWild(c); return; }
    if (view.rules.sevenZero && c.kind === 'number' && c.value === 7 && alive > 2) { setPendingWild(null); setPendingSeven(c); return; }
    void act({ type: 'play', card: c.id });
  };

  const pd = view.pendingDraw;
  let prompt: ReactNode = null;
  if (you && live && !held) {
    if (pendingWild) {
      prompt = <ColorPicker title={`${cardName(pendingWild)}: pick the colour`} onCancel={() => setPendingWild(null)}
        onPick={color => { const c = pendingWild; setPendingWild(null); void act({ type: 'play', card: c.id, color }); }} />;
    } else if (pendingSeven) {
      prompt = <SwapPicker view={view} seats={seats} onCancel={() => setPendingSeven(null)}
        onPick={target => { const c = pendingSeven; setPendingSeven(null); void act({ type: 'play', card: c.id, target }); }} />;
    } else if (myTurn && view.phase === 'color') {
      prompt = <ColorPicker title={view.top && isWild(view.top) && !view.history.length && view.turn <= 2 ? 'Pick the colour to start' : 'Pick the colour'}
        onPick={color => void act({ type: 'chooseColor', color })} />;
    } else if (myTurn && view.phase === 'swap') {
      prompt = <SwapPicker view={view} seats={seats} onPick={target => void act({ type: 'swap', target })} />;
    } else if (myTurn && view.phase === 'play' && pd) {
      prompt = (
        <div className="ct-prompt ct-penalty" role="dialog" aria-label="Draw penalty">
          <h3>{names[pd.from]} hit you with {pd.kind === 'wild4' ? 'a Wild Draw Four' : 'a Draw Two'}{pd.amount > (pd.kind === 'wild4' ? 4 : 2) ? ` — stacked to ${pd.amount}` : ''}!</h3>
          {pd.challengeable && <p className="small">Think they held {pd.prevColor ? COLOR_LABEL[pd.prevColor] : 'the colour in play'}? Challenge: if it was a bluff they draw 4; if not, you draw 6.</p>}
          {view.rules.stacking && you.playable.length > 0 && <p className="small">…or stack a Draw card on it to pass it on.</p>}
          <div className="row wrap">
            {you.canChallenge && <button className="btn gold" onClick={() => void act({ type: 'challenge' })}>Challenge!</button>}
            <button className="btn danger" onClick={() => void act({ type: 'draw' })}>Draw {pd.amount}</button>
          </div>
        </div>
      );
    } else if (myTurn && view.phase === 'drawn' && you.drawn !== null) {
      const c = you.hand.find(h => h.id === you.drawn);
      prompt = c ? (
        <div className="ct-prompt ct-drawn" role="dialog" aria-label="You drew a playable card">
          <h3>You drew a card you can play</h3>
          <div className="ct-drawn-card"><CardFace card={c} /></div>
          <div className="row wrap">
            <button className="btn primary" onClick={() => playCard(c)}>Play it</button>
            {you.canPass && <button className="btn ghost" onClick={() => void act({ type: 'pass' })}>Keep it</button>}
          </div>
        </div>
      ) : null;
    }
  }

  const discardTop = frame.top;
  const color = frame.color;
  const turnName = names[view.current];
  const status = !live ? '' : held ? '' : myTurn
    ? (view.phase === 'play' && !pd ? (you!.playable.length ? 'Your turn — play a card or draw' : 'Your turn — nothing fits, draw a card') : 'Your turn')
    : `${turnName}'s turn`;
  const myTimer = myTurn && view.turnEndsAt && view.rules.turnSeconds ? Math.max(0, Math.ceil((view.turnEndsAt - now) / 1000)) : null;
  const sideBody = (
    <>
      <div className="tabs ct-tabs" role="tablist">
        <button role="tab" aria-selected={panel === 'feed'} className={panel === 'feed' ? 'on' : ''} onClick={() => setPanel('feed')}>Feed</button>
        {config.features.chat && <button role="tab" aria-selected={panel === 'chat'} className={panel === 'chat' ? 'on' : ''} onClick={() => setPanel('chat')}>Chat{chat.length ? ` (${chat.length})` : ''}</button>}
      </div>
      <div className="ct-side-body">
        {panel === 'feed' || !config.features.chat
          ? <Feed log={view.log} doneSeq={frame.doneSeq} colors={colors} />
          : <Chat chat={chat} me={me} send={text => cardsChat(text)} quick={false} />}
      </div>
    </>
  );

  return (
    <div className={`ct ${compact ? 'compact' : 'wide'} ${three ? 'three' : 'flat'} ${myTurn && !held ? 'my-turn' : ''}`} data-phase={view.phase} data-busy={held ? '1' : '0'}
      data-current={view.current} data-order={view.players.map(p => p.id).join(',')} data-round={view.round}>
      <header className="ct-top">
        <div className="ct-top-l">
          <span className="ct-logo">{CARDS_GAME_NAME}</span>
          <span className="ct-code mono" title="Table code">{room.code}</span>
          <span className="ct-meta">Round {view.round} · {matchLabel(view.rules)}{room.spectators ? ` · ${room.spectators} watching` : ''}</span>
        </div>
        <div className="ct-top-r">
          <MusicPlayer />
          {three && (
            <button className="btn tiny ghost" onClick={cycleQuality} aria-label={`${qualityInfo.label}. Change`}
              title={`${qualityInfo.label} — ${qualityInfo.hint}. Click for the next setting`}>
              {qualityInfo.icon}{compact ? '' : ' Graphics'}
            </button>
          )}
          <button className="btn tiny ghost" onClick={() => setRulesOpen(true)} aria-label="Rules">{compact ? '❓' : '❓ Rules'}</button>
          {isHost && live && (
            <button className="btn tiny ghost" onClick={() => cardsCall('cards:pause', { paused: !view.paused }).catch(toastError)}>
              {view.paused ? (compact ? '▶' : '▶ Resume') : (compact ? '⏸' : '⏸ Pause')}
            </button>
          )}
          {compact && <button className="btn tiny ghost" onClick={() => setSideOpen(o => !o)} aria-expanded={sideOpen} aria-label="Feed and chat">💬</button>}
          <button className="btn tiny danger" onClick={async () => {
            if (room.status === 'playing' && you && !meP?.left && !(await askConfirm({ title: 'Leave the table?', body: 'You will be out of this match.', confirm: 'Leave', danger: true }))) return;
            await cardsCall('cards:leave').catch(() => {});
            nav('/cards');
          }}>Leave</button>
        </div>
      </header>

      <div className="ct-main">
        <div className="ct-stage">
          {three ? (
            <Suspense fallback={<div className="ct-felt" aria-hidden />}>
              <CardsScene view={view} frame={frame} seats={seats} me={myId} myTurn={myTurn && !held} compact={compact} quality={quality}
                reduced={reduced} cinematic={cinematic} canDraw={myTurn && !held && !!you?.canDraw} onDraw={() => void act({ type: 'draw' })}
                podium={podium} onPodiumDone={() => setPodiumDone(true)} handEl={handRef} handRects={handRects} chipEls={chipEls} fxEl={fxRef} />
            </Suspense>
          ) : <div className="ct-felt" aria-hidden />}
          {view.players.filter(p => p.id !== myId).map(p => (
            <SeatChip key={p.id} p={p} seat={seats[p.id]} at={layout[p.id]} view={view} frame={frame} skew={skew} now={now}
              canCatch={catchable.has(p.id) && !held} compact={compact} pin={three && !compact ? pinFor(p.id) : undefined} />
          ))}

          {!three && (
            <div className={`ct-dir ${frame.direction === 1 ? 'cw' : 'ccw'}`} style={{ '--cc': color ? CARD_HEX[color].base : '#9aa7ff' } as CSSProperties} aria-label={`Play goes ${frame.direction === 1 ? 'clockwise' : 'anticlockwise'}`}>
              <svg viewBox="0 0 200 200" aria-hidden>
                <circle cx="100" cy="100" r="90" className="ct-dir-track" />
                {[0, 120, 240].map(a => (
                  <g key={a} transform={`rotate(${a} 100 100)`}>
                    <path d="M 100 10 A 90 90 0 0 1 170 43" className="ct-dir-arc" />
                    <path d={frame.direction === 1 ? 'M 160 28 L 174 46 L 152 49' : 'M 110 0 L 96 10 L 110 22'} className="ct-dir-head" />
                  </g>
                ))}
              </svg>
            </div>
          )}

          {!three && (
            <button className={`ct-pile ${myTurn && !held && you?.canDraw ? 'can' : ''}`} style={pos(piles.pile)}
              disabled={!(myTurn && !held && you?.canDraw)} onClick={() => void act({ type: 'draw' })}
              aria-label={`Draw pile, ${view.drawCount} cards${myTurn && you?.canDraw ? ': draw' : ''}`}>
              <span className="ct-pile-stack" aria-hidden><CardBack /><CardBack /><CardBack /></span>
              <span className="ct-pile-n">{view.drawCount}</span>
            </button>
          )}
          {three ? (
            <span className={`ct-color-chip pinned ${color ?? 'none'} ${podium ? 'hide' : ''}`} ref={pinFor('colour')} aria-live="polite">
              {color ? COLOR_LABEL[color] : 'Colour?'}<small>{view.drawCount} in the pile</small>
            </span>
          ) : (
            <div className="ct-discard" style={{ ...pos(piles.discard), '--cc': color ? CARD_HEX[color].base : 'transparent' } as CSSProperties}>
              <div className="ct-discard-glow" aria-hidden />
              {discardTop ? <CardFace card={discardTop} key={discardTop.id} /> : <div className="ct-empty" />}
              <span className={`ct-color-chip ${color ?? 'none'}`} aria-live="polite">{color ? COLOR_LABEL[color] : 'Colour?'}</span>
            </div>
          )}

          <Effects frame={frame} layout={layout} piles={piles} names={names} me={myId} three={three} fxRef={fxRef} />

          {pd && !held && live && !(myTurn && prompt) && (
            <div className="ct-pending">+{pd.amount} waiting on {names[view.current]}</div>
          )}
          {prompt && <div className="ct-prompt-wrap">{prompt}</div>}
          {view.phase === 'roundOver' && !held && <div className="ct-prompt-wrap"><RoundOver view={view} skew={skew} /></div>}
          {view.paused && (
            <div className="ct-paused">⏸ Paused by {view.paused.by}{isHost && <button className="btn small primary" onClick={() => cardsCall('cards:pause', { paused: false }).catch(toastError)}>Resume</button>}</div>
          )}
        </div>

        {!compact && <aside className="ct-side panel">{sideBody}</aside>}
        {compact && sideOpen && (
          <div className="ct-drawer panel">
            <div className="row between"><b>Table</b><button className="btn tiny ghost" onClick={() => setSideOpen(false)} aria-label="Close">✕</button></div>
            {sideBody}
          </div>
        )}
      </div>

      {you && meP && (
        <footer className={`ct-me ${myTurn && !held ? 'turn' : ''}`} style={{ '--seat': meSeat?.color ?? '#888' } as CSSProperties}>
          <div className="ct-me-bar">
            <div className="ct-me-who">
              <div className="ct-ava">
                {frame.current === myId && live && <TurnRing endsAt={held ? null : view.turnEndsAt} total={view.rules.turnSeconds * 1000} skew={skew} />}
                <SeatAvatar seat={meSeat} size={compact ? 36 : 44} />
              </div>
              <div className="ct-me-text">
                <b>{meP.name}{view.rules.match === 'points' && <span className="muted small"> · {meP.score} pts</span>}</b>
                <span className={`ct-status ${myTurn && !held ? 'mine' : ''}`} role="status">
                  {meP.left ? 'You left this match' : status}{myTimer !== null && !held ? ` · ${myTimer}s` : ''}
                </span>
              </div>
            </div>
            <div className="ct-me-actions">
              {myOne && myOne.calledAt !== null && hand.length === 1 && <span className="ct-badge-last inline">{LAST_CARD_CALL}</span>}
              {you.preCalled && <span className="ct-badge-last inline">Called!</span>}
              {showLast && (
                <button className="btn gold ct-last" onClick={() => void act({ type: 'callLastCard' })}>{LAST_CARD_CALL}</button>
              )}
              {myTurn && !held && view.phase === 'play' && !pd && (
                <button className="btn" onClick={() => void act({ type: 'draw' })} disabled={!you.canDraw}>Draw</button>
              )}
              {myTurn && !held && view.phase === 'drawn' && you.canPass && (
                <button className="btn ghost" onClick={() => void act({ type: 'pass' })}>Keep & pass</button>
              )}
            </div>
          </div>
          {away && (
            <div className="ct-away" role="status">
              <span>Auto-play is on for you.</span>
              <button className="btn small primary" onClick={() => cardsCall('cards:back').catch(toastError)}>I'm back!</button>
            </div>
          )}
          {frame.hand !== null && hand.length > 0 && (
            <Hand cards={hand} view={view} frame={frame} compact={compact} onPlay={playCard} rects={three ? handRects : undefined} handRef={handRef} />
          )}
        </footer>
      )}
      {!you && <div className="ct-watching">You're watching this match.</div>}

      {room.status === 'finished' && !held && !podium && <MatchOver room={room} view={view} me={me} isHost={isHost} />}
      {rulesOpen && <RulesModal view={view} onClose={() => setRulesOpen(false)} />}
    </div>
  );
}
