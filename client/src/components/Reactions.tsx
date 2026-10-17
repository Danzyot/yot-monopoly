// Emoji reactions and pokes in the HUD. Reactions are plain Unicode emoji
// drawn by the system font: nothing to download or license. A seated
// player's reaction pops over their 3D character and their row in the player
// list; a spectator's floats up the side of the screen with their name.
import { useEffect, useRef, useState } from 'react';
import { POKE_AFTER_MS, REACTION_EMOJI, type GameView, type PokeMsg, type ReactionMsg, type RoomView } from '../../../shared/types.ts';
import { primeAudio } from '../sound.ts';
import { sendPoke, sendReaction } from '../social.ts';
import { toastError } from '../toast.tsx';

/** Reaction bar: a toggle that opens a row of emoji. */
export function ReactionPicker({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Close when tapping anywhere else (phones have no mouse-leave).
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  const send = (emoji: string) => {
    primeAudio();
    sendReaction(emoji).catch(toastError);
  };
  return (
    <div className="react-picker" ref={ref}>
      {open && (
        <div className="react-bar" role="menu" aria-label="Reactions">
          {REACTION_EMOJI.map(e => (
            <button key={e} className="react-opt" onClick={() => send(e)} aria-label={`React ${e}`} title={`React ${e}`}>{e}</button>
          ))}
        </div>
      )}
      <button className={`dock-btn ${open ? 'on' : ''}`} disabled={disabled} onClick={() => setOpen(o => !o)}
        title={disabled ? 'Reactions are switched off' : 'Send a reaction'} aria-label="Send a reaction" aria-expanded={open}>😀</button>
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
          <span className="spec-react-name">{r.name}</span>
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

/** Poke the current player; appears once their turn has dragged on. */
export function PokeButton({ room, game, me, skew, disabled }: {
  room: RoomView; game: GameView; me: string; skew: number; disabled?: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  const st = pokeState(room, game, me, now + skew);
  // Tick only while counting down to the moment it becomes available.
  const counting = !st.ok && st.wait > 0;
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [counting, room.poke?.since]);
  if (!st.ok || disabled) return null;
  const target = game.players.find(p => p.id === game.current)!;
  return (
    <button className="dock-btn poke-btn" onClick={() => { primeAudio(); sendPoke().catch(toastError); }} title={st.why} aria-label={`Poke ${target.name}`}>
      👉 <span className="poke-label">Poke {target.name}</span>
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
