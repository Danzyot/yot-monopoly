// A player's face on their colour: a holder's own Chog Genesis token as its
// art (loaded lazily) in a ring of the player's colour, anyone else's
// character emoji on a disc of it. Every player is a Chog this season, so the
// colour is what tells them apart; the art only adds who is who.
import { useState, type ReactNode } from 'react';
import { chogArtUrl, chogName } from '../../../shared/chogs/traits.ts';
import type { PlayerState } from '../../../shared/types.ts';
import { characterEmoji } from '../format.ts';

type Who = Pick<PlayerState, 'character' | 'color' | 'chogToken'>;

/** The token whose art to show, if the player has one with art. */
const artToken = (p: Who) => (p.chogToken && chogArtUrl(p.chogToken) ? p.chogToken : undefined);

/** Decorative (hidden from screen readers) unless it carries children, such as a reaction with its own label. */
export function PlayerBadge({ p, className = '', onClick, children }: {
  p: Who; className?: string; onClick?: () => void; children?: ReactNode;
}) {
  // Art that will not load (offline, a blocked host) falls back to the emoji.
  const [failed, setFailed] = useState<number | null>(null);
  const token = artToken(p) !== failed ? artToken(p) : undefined;
  return (
    <span className={`token-badge ${token ? 'pc-chog' : ''} ${className}`} style={{ background: p.color }} onClick={onClick}
      aria-hidden={children ? undefined : true}>
      {token
        ? <img className="chog-art" src={chogArtUrl(token, 96)} alt={chogName(token)} width={30} height={30} loading="lazy" draggable={false}
            onError={() => setFailed(token)} />
        : characterEmoji(p.character)}
      {children}
    </span>
  );
}
