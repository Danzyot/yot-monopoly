import { useState } from 'react';
import type { TableReaction } from '../../../shared/types';
import { getSocket } from '../socket';
import { primeAudio } from '../sound';

// Full-motion reactions: the operator's own animated set, keyed off their
// white backgrounds into real transparency and stored as animated WebP under
// /reactions. Anything missing here — or any file that fails to load — falls
// back to the plain text emoji, so the wheel never shows a broken image.
const ANIMATED: Record<string, string> = {
  '😡': 'enraged',
  '😭': 'sob',
  '🤯': 'mindblown',
  '😱': 'scream',
  '🥳': 'party',
  '😎': 'cool',
  '💀': 'skull',
  '👍': 'thumbsup',
  '👌': 'ok',
  '🥺': 'pleading',
  '😈': 'devil',
  '🤢': 'nauseated',
  '😝': 'tongue',
  '😒': 'unamused',
  '🤪': 'zany',
};

const WHEEL = [
  '😡', '😭', '🤯', '😱', '🥳', '😎', '💀', '👍',
  '👌', '🥺', '😈', '🤢', '😝', '😒', '🤪',
];

// An emoji that animates when we have the file for it. onError flips to the
// text glyph, so a missing or still-downloading file never shows a broken
// image at the table.
export function AnimatedEmoji({ emoji, size }: { emoji: string; size: number }) {
  const [broken, setBroken] = useState(false);
  const code = ANIMATED[emoji];
  if (!code || broken) {
    return <span style={{ fontSize: size * 0.82, lineHeight: 1 }}>{emoji}</span>;
  }
  return (
    <img
      className="animated-emoji"
      src={`/reactions/${code}.webp`}
      width={size}
      height={size}
      alt={emoji}
      draggable={false}
      onError={() => setBroken(true)}
    />
  );
}

// Emoji reactions: a wheel that opens next to the hand, and the floating
// emoji everyone at the table sees when someone reacts.
export function ReactionWheel({ tableId }: { tableId: string }) {
  const [open, setOpen] = useState(false);
  const send = (emoji: string) => {
    primeAudio();
    getSocket().emit('table:react', { tableId, emoji });
    setOpen(false);
  };
  return (
    <div className={`react-wheel${open ? ' open' : ''}`}>
      {open && (
        <div className="react-options" onMouseLeave={() => setOpen(false)}>
          {WHEEL.map(e => (
            <button key={e} className="react-opt" onClick={() => send(e)} aria-label={`React ${e}`}>
              <AnimatedEmoji emoji={e} size={30} />
            </button>
          ))}
        </div>
      )}
      <button
        className="btn btn-ghost btn-sm react-toggle"
        title="Send a reaction"
        onClick={() => setOpen(o => !o)}
      >
        😀
      </button>
    </div>
  );
}

// Floating emoji over the felt. Reactions from a seated player rise from
// their seat; a spectator's rises from the rail.
export default function Reactions({
  reactions, positionOf,
}: {
  reactions: TableReaction[];
  positionOf: (seat: number | null) => { x: number; y: number };
}) {
  return (
    <>
      {reactions.map(r => {
        const pos = positionOf(r.seat);
        return (
          <div
            key={r.id}
            className="float-react"
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            title={r.name}
          >
            <AnimatedEmoji emoji={r.emoji} size={84} />
            {/* The name rides with the emoji. During the first live event,
                spectators' reactions launched from the bottom rail and read
                as a phantom player in the empty hero seat — a label beats any
                amount of anchor tuning, because it answers "who?" outright. */}
            <span className="float-react-name">{r.name}</span>
          </div>
        );
      })}
    </>
  );
}
