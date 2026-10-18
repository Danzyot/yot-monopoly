// Emoji reactions and pokes in the HUD. Reactions are plain Unicode emoji
// drawn by the system font: nothing to download or license. A seated
// player's reaction pops over their 3D character and their row in the player
// list; a spectator's floats up the side of the screen with their name.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { POKE_AFTER_MS, REACTION_EMOJI, type GameView, type PokeMsg, type ReactionMsg, type RoomView } from '../../../shared/types.ts';
import { primeAudio } from '../sound.ts';
import { recentReactions, sendPoke, sendReaction } from '../social.ts';
import { toastError } from '../toast.tsx';

/** The key that fires each emoji while the picker is open: 1–9, then 0 for the tenth. */
export const REACTION_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

/** Is the key press going into a text field? Then it is not ours. */
function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el?.tagName && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

/**
 * Reaction bar: the dock button opens a grid of big emoji with a row of the
 * three used most recently on top. Number keys send while it is open; Esc or
 * a tap elsewhere closes it. `sentSeq` changes when the server echoes one of
 * ours, and the button bursts to say it went.
 */
export function ReactionPicker({ disabled, sentSeq = 0 }: { disabled?: boolean; sentSeq?: number }) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => recentReactions());
  const [pressed, setPressed] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const firstOpt = useRef<HTMLButtonElement>(null);

  // The button pops when our reaction lands (skip the initial 0).
  useEffect(() => { if (sentSeq) setBurst(b => b + 1); }, [sentSeq]);
  useEffect(() => {
    if (!burst) return;
    const t = setTimeout(() => setBurst(0), 700);
    return () => clearTimeout(t);
  }, [burst]);

  const send = (emoji: string) => {
    primeAudio();
    sendReaction(emoji).catch(toastError);
    setRecent(recentReactions());
    // The option itself pops too, then the picker folds away.
    setPressed(emoji);
    setTimeout(() => { setPressed(null); setOpen(false); }, 160);
  };

  // Close when tapping anywhere else (phones have no mouse-leave); keys while open.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      const i = REACTION_KEYS.indexOf(e.key);
      if (i >= 0 && i < REACTION_EMOJI.length) { e.preventDefault(); send(REACTION_EMOJI[i]); }
    };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', keys);
    firstOpt.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', keys);
    };
  }, [open]);

  return (
    <div className="react-picker" ref={ref}>
      {open && (
        <div className="react-pop" role="menu" aria-label="Reactions">
          {recent.length > 0 && (
            <div className="react-recent" aria-label="Recent">
              <span className="react-recent-label">Recent</span>
              {recent.map(e => (
                <button key={e} className={`react-opt small ${pressed === e ? 'sent' : ''}`} onClick={() => send(e)} aria-label={`React ${e}`} title={`React ${e}`}>{e}</button>
              ))}
            </div>
          )}
          <div className="react-grid">
            {REACTION_EMOJI.map((e, i) => (
              <button key={e} ref={i === 0 ? firstOpt : undefined} className={`react-opt ${pressed === e ? 'sent' : ''}`}
                onClick={() => send(e)} aria-label={`React ${e}`} title={`React ${e} (${REACTION_KEYS[i]})`}>
                {e}
                <kbd className="react-key" aria-hidden>{REACTION_KEYS[i]}</kbd>
              </button>
            ))}
          </div>
          <div className="react-hint muted">1–9, 0 to send · Esc closes</div>
        </div>
      )}
      <button className={`dock-btn react-btn ${open ? 'on' : ''} ${burst ? 'burst' : ''}`} disabled={disabled} onClick={() => setOpen(o => !o)}
        title={disabled ? 'Reactions are switched off' : 'Send a reaction'} aria-label="Send a reaction" aria-expanded={open} aria-haspopup="menu">
        😀
        {burst > 0 && (
          <span key={burst} className="react-burst" aria-hidden>
            {[0, 1, 2, 3, 4, 5].map(i => <i key={i} style={{ '--i': i } as CSSProperties} />)}
          </span>
        )}
      </button>
    </div>
  );
}

/** Spectators have no character: their reactions float up the side, with a name. */
export function SpectatorReactions({ reactions }: { reactions: ReactionMsg[] }) {
  const shown = reactions.filter(r => r.spectator);
  if (!shown.length) return null;
  return (
    <div className="spec-reacts" aria-live="polite">
      {shown.map((r, i) => (
        <div key={r.seq} className="spec-react" style={{ left: `${(r.seq * 37 + i * 11) % 44}px` }}>
          <span className="spec-react-emoji">{r.emoji}</span>
          <span className="spec-react-name" title={`${r.name} (watching)`}><span className="spec-react-eye" aria-hidden>👁</span> {r.name}</span>
        </div>
      ))}
    </div>
  );
}

/** The newest reaction by this player, if one is still showing. */
export function latestReaction(reactions: ReactionMsg[], id: string): ReactionMsg | undefined {
  for (let i = reactions.length - 1; i >= 0; i--) if (reactions[i].id === id && !reactions[i].spectator) return reactions[i];
  return undefined;
}

/**
 * Why the poke button is unavailable right now (null = it can be pressed),
 * mirroring the server's checks so the button is honest. `wait` is in ms.
 */
export function pokeState(room: RoomView, game: GameView, me: string, now: number): { ok: boolean; wait: number; why: string } {
  const target = game.players.find(p => p.id === game.current);
  if (!game.players.some(p => p.id === me)) return { ok: false, wait: 0, why: '' };
  if (!target || target.id === me || target.isBot || game.phase === 'over') return { ok: false, wait: 0, why: '' };
  if (!['roll', 'buy', 'done'].includes(game.phase)) return { ok: false, wait: 0, why: '' };
  const info = room.poke;
  if (!info) return { ok: false, wait: 0, why: '' };
  if (info.pokedBy.includes(me)) return { ok: false, wait: 0, why: `You poked ${target.name} this turn` };
  const wait = POKE_AFTER_MS - (now - info.since);
  if (wait > 0) return { ok: false, wait, why: `You can poke ${target.name} in ${Math.ceil(wait / 1000)}s` };
  return { ok: true, wait: 0, why: `Poke ${target.name} — it's their turn` };
}

/**
 * Poke the current player. While their turn is still young the button sits
 * dimmed with a ring filling up around it; once the ring closes it lights up.
 * After a poke it stays, spent, until the turn passes.
 */
export function PokeButton({ room, game, me, skew, disabled }: {
  room: RoomView; game: GameView; me: string; skew: number; disabled?: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  const [sending, setSending] = useState(false);
  const st = pokeState(room, game, me, now + skew);
  // Tick smoothly while the ring fills.
  const counting = !st.ok && st.wait > 0;
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [counting, room.poke?.since]);
  if (disabled || (!st.ok && !st.why)) return null;
  const target = game.players.find(p => p.id === game.current)!;
  const spent = !st.ok && !counting;
  const progress = counting ? 1 - st.wait / POKE_AFTER_MS : 1;
  const poke = () => {
    if (!st.ok || sending) return;
    primeAudio();
    setSending(true);
    sendPoke().catch(toastError).finally(() => setSending(false));
  };
  return (
    <button className={`dock-btn poke-btn ${st.ok ? 'ready' : counting ? 'cooling' : 'spent'}`}
      style={{ '--p': progress } as CSSProperties}
      onClick={poke} disabled={!st.ok || sending} aria-disabled={!st.ok} title={st.why}
      aria-label={st.ok ? `Poke ${target.name}` : st.why}>
      <span className="poke-ring" aria-hidden />
      <span className="poke-face">
        {spent ? '✓' : '👉'} <span className="poke-label">{spent ? 'Poked' : counting ? `${Math.ceil(st.wait / 1000)}s` : `Poke ${target.name}`}</span>
      </span>
    </button>
  );
}

/** The nudge a poke causes: loud for its target, a quiet note for everyone else. */
export function PokeNotice({ poke, game, me }: { poke: PokeMsg | null; game: GameView; me: string }) {
  if (!poke) return null;
  const to = game.players.find(p => p.id === poke.to);
  if (poke.to === me) {
    return (
      <div key={poke.seq} className="poke-nudge" role="alert">
        <span className="poke-hand">👉</span>
        <div><b>{poke.fromName}</b> poked you<br /><span className="small">It's your turn — everyone's waiting!</span></div>
      </div>
    );
  }
  return <div key={poke.seq} className="poke-note">👉 {poke.fromName} poked {to?.name ?? 'someone'}</div>;
}
