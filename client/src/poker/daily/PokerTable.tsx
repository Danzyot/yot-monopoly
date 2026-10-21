// One Poker Daily hand on the felt: the villain's seat and his bet, the board,
// the pot, and your two cards and stack. Drawn in poker's own look (purple
// felt, black rail, white cards).
import type { PokerSpot } from '../../../../shared/poker/daily.ts';

const SUITS: Record<string, { sym: string; red: boolean; name: string }> = {
  s: { sym: '♠', red: false, name: 'spades' },
  h: { sym: '♥', red: true, name: 'hearts' },
  d: { sym: '♦', red: true, name: 'diamonds' },
  c: { sym: '♣', red: false, name: 'clubs' },
};
const RANKS: Record<string, string> = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };
const RANK_NAMES: Record<string, string> = { T: 'ten', J: 'jack', Q: 'queen', K: 'king', A: 'ace' };

/** "As" → "ace of spades". */
export function cardName(code: string): string {
  return `${RANK_NAMES[code[0]] ?? code[0]} of ${SUITS[code[1]]?.name ?? ''}`;
}

/** "As" → "A♠". */
export function cardLabel(code: string): string {
  return `${RANKS[code[0]] ?? code[0]}${SUITS[code[1]]?.sym ?? ''}`;
}

export function PlayingCard({ code, size = 'md', back = false }: { code?: string; size?: 'sm' | 'md' | 'lg'; back?: boolean }) {
  if (back || !code) return <span className={`pd-card back ${size}`} aria-hidden />;
  const s = SUITS[code[1]];
  const r = RANKS[code[0]] ?? code[0];
  return (
    <span className={`pd-card ${size}${s?.red ? ' red' : ''}`} role="img" aria-label={cardName(code)}>
      <b>{r}</b><i>{s?.sym}</i>
    </span>
  );
}

const STREET_NAMES = { preflop: 'Before the flop', flop: 'Flop', turn: 'Turn', river: 'River' } as const;

export default function PokerTable({ spot }: { spot: PokerSpot }) {
  const slots = [0, 1, 2, 3, 4];
  return (
    <div className="pd-felt" aria-label={`${STREET_NAMES[spot.street]}. Pot ${spot.pot} big blinds.`}>
      <div className="pd-seat villain">
        <span className="pd-cards" aria-hidden><PlayingCard back size="sm" /><PlayingCard back size="sm" /></span>
        <span className="pd-who"><b>Villain</b><span className="pd-pos">{spot.villain.pos}</span></span>
        <span className="pd-stack">{spot.villain.stack > 0 ? `${spot.villain.stack} bb` : 'all-in'}</span>
      </div>
      <p className="pd-facing">{spot.facing}</p>
      <div className="pd-board" aria-label={spot.board.length ? `Board: ${spot.board.map(cardName).join(', ')}` : 'No cards on the board yet'}>
        {slots.map(i => (spot.board[i]
          ? <PlayingCard key={i} code={spot.board[i]} />
          : <span key={i} className="pd-slot" aria-hidden />))}
      </div>
      <p className="pd-pot"><span className="pd-chip" aria-hidden />Pot <b>{spot.pot}</b> bb</p>
      <div className="pd-seat hero">
        <span className="pd-cards">
          <PlayingCard code={spot.hole[0]} size="lg" />
          <PlayingCard code={spot.hole[1]} size="lg" />
        </span>
        <span className="pd-hero-meta">
          <span className="pd-who"><b>You</b><span className="pd-pos">{spot.you.pos}</span></span>
          <span className="pd-stack">{spot.you.stack} bb</span>
          {spot.street !== 'preflop' && <span className="pd-made">{spot.made}</span>}
        </span>
      </div>
    </div>
  );
}
