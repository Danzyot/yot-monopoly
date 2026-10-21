// A few cards drifting behind the Cards home and the lobby panels. Its own
// module so the Cards home (/cards) can show it without importing the lobby,
// which brings the Chog picker and the 318 KB trait table (shared/chogs/traits.ts).
import type { Card } from '../../../shared/cards/deck.ts';
import { CardBack, CardFace } from './CardFace.tsx';

const DECOR: Card[] = [
  { id: 1, kind: 'number', color: 'red', value: 7 },
  { id: 2, kind: 'wild', color: null },
  { id: 3, kind: 'skip', color: 'green' },
  { id: 4, kind: 'number', color: 'blue', value: 4 },
  { id: 5, kind: 'draw2', color: 'yellow' },
  { id: 6, kind: 'wild4', color: null },
  { id: 7, kind: 'reverse', color: 'red' },
];

export function CardsBackdrop() {
  return (
    <div className="cl-bg" aria-hidden>
      {DECOR.map((c, i) => (
        <div key={c.id} className={`cl-float f${i}`}>{i === 3 ? <CardBack /> : <CardFace card={c} />}</div>
      ))}
    </div>
  );
}
