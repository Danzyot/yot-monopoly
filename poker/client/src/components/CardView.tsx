import type { CardT } from '../../../shared/types';

import { ChogBadge } from './ChogLogo';

const RANKS: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

// Four-color deck: spades slate-black, hearts red, diamonds blue, clubs green.
const SUIT_COLORS = ['#232c3a', '#c92a33', '#1d5fc4', '#1b7d43'];

const SUIT_PATHS = [
  // spade
  'M50 12 C38 30 24 40 24 54 c0 10 8 17 17 17 3 0 6-1 9-3 -1 7-4 12-9 16 v4 h18 v-4 c-5-4-8-9-9-16 3 2 6 3 9 3 9 0 17-7 17-17 C76 40 62 30 50 12 Z',
  // heart
  'M50 88 C30 68 18 56 18 41 c0-11 8-19 18-19 6 0 11 3 14 8 3-5 8-8 14-8 10 0 18 8 18 19 0 15-12 27-32 47 Z',
  // diamond
  'M50 10 L78 50 L50 90 L22 50 Z',
  // club
  'M50 14 c-8 0-14 6-14 14 0 3 1 6 3 8 -2-1-4-2-7-2 -8 0-14 6-14 14 s6 14 14 14 c5 0 9-2 12-6 -1 8-4 14-9 18 v4 h30 v-4 c-5-4-8-10-9-18 3 4 7 6 12 6 8 0 14-6 14-14 s-6-14-14-14 c-3 0-5 1-7 2 2-2 3-5 3-8 0-8-6-14-14-14 Z',
];

interface Props {
  card: CardT | null;
  small?: boolean;
  // Showdown board treatment: 'hot' = part of the winning hand, 'dim' = not.
  highlight?: 'hot' | 'dim';
}

export default function CardView({ card, small, highlight }: Props) {
  const cls = `cardv${small ? ' sm' : ''}${highlight ? ` ${highlight}` : ''}`;

  // The back is the card you see most of — every opponent holds two, on every
  // street — so it is the single best place to put the brand. It carries
  // Chog's own badge inside a pink frame rather than a generic pip.
  //
  // The badge is drawn in the palette's own values, so it needs no CSS tint
  // and stays correct if the brand's pink is ever retuned in one place.
  if (!card) {
    return (
      <div className={`${cls} back`} aria-label="face-down card">
        <svg viewBox="0 0 100 140" className="card-svg">
          <rect x="7" y="7" width="86" height="126" rx="6" fill="none"
            stroke="rgba(213, 63, 124, 0.45)" strokeWidth="2.5" />
        </svg>
        <ChogBadge size={40} className="card-back-mark" />
      </div>
    );
  }

  const color = SUIT_COLORS[card.s];
  const rank = RANKS[card.r];

  return (
    <div className={cls} aria-label={`${rank} of suit ${card.s}`}>
      <svg viewBox="0 0 100 140" className="card-svg">
        {/* corner index — top left */}
        <text x="10" y="30" fontSize="30" fontWeight="800" fill={color}
          fontFamily="'Inter', system-ui, sans-serif">{rank}</text>
        <g transform="translate(10 36) scale(0.24)">
          <path d={SUIT_PATHS[card.s]} fill={color} />
        </g>
        {/* corner index — bottom right, rotated */}
        <g transform="rotate(180 50 70)">
          <text x="10" y="30" fontSize="30" fontWeight="800" fill={color}
            fontFamily="'Inter', system-ui, sans-serif">{rank}</text>
          <g transform="translate(10 36) scale(0.24)">
            <path d={SUIT_PATHS[card.s]} fill={color} />
          </g>
        </g>
        {/* center pip */}
        <g transform="translate(32 52) scale(0.52)" opacity="0.92">
          <path d={SUIT_PATHS[card.s]} fill={color} />
        </g>
      </svg>
    </div>
  );
}
