// Chog's mark, in two shapes.
//
// `ChogBadge` is drawn rather than loaded: a violet tile, a pink ring and a
// cream spade, all in the palette's own values. Drawing it matters more here
// than on the sibling sites, because the badge is also what sits on the back
// of every face-down card — nine seats' worth on screen at once, at 24px and
// at 200px in the same session. Vector artwork is sharp at both, weighs
// nothing, and needs no CSS filter to be the right colour, so retuning the
// palette retunes the cards with it.
//
// `ChogLogo` prefers a supplied logo file and falls back to the badge. Drop
// artwork at `client/public/chog-logo.png` (or `.webp`) and it takes over
// everywhere the lockup appears — header, landing page, table corner — with
// no code change. Until then the room is complete without it.
import { useId, useState } from 'react';
import { BRAND } from '../../../shared/brand';

// Tried in order. The first that loads wins; if none do, the badge is drawn.
const CANDIDATES = ['/chog-logo.png', '/chog-logo.webp', '/chog-logo.svg'];

// How far the walk got, remembered for the rest of the page's life. Without
// this every mount starts at candidate 0 again — and the header, the landing
// page and the table's corner mark all mount this, so a site with no logo
// file would fire three 404s per mount, forever. Once one candidate is known
// to work the others are never asked for at all.
let resolved = 0;

export function ChogBadge({ size = 28, className }: { size?: number; className?: string }) {
  // Gradient ids are document-wide, and a table paints a dozen of these at
  // once. Without a unique suffix every badge after the first would reference
  // whichever one mounted first — same artwork today, a silent trap the first
  // time two variants exist.
  const uid = useId().replace(/:/g, '');
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label={BRAND.org}
    >
      <defs>
        <linearGradient id={`cg-ground-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a2a9e" />
          <stop offset="1" stopColor="#2b1764" />
        </linearGradient>
        <linearGradient id={`cg-spade-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fdf6cd" />
          <stop offset="1" stopColor="#dd9974" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="94" height="94" rx="27"
        fill={`url(#cg-ground-${uid})`} stroke="#d53f7c" strokeWidth="5" />
      <path
        d="M50 21 C38.5 36.5 26.5 44.5 26.5 56.2 c0 8.4 6.5 14.4 14.2 14.4 3 0 5.6-.8 7.6-2.3
           -.9 6.3-3.2 10.2-7.5 13.7 v3.6 h18.4 v-3.6 c-4.3-3.5-6.6-7.4-7.5-13.7 2 1.5 4.6 2.3 7.6 2.3
           C67 70.6 73.5 64.6 73.5 56.2 73.5 44.5 61.5 36.5 50 21 Z"
        fill={`url(#cg-spade-${uid})`}
      />
    </svg>
  );
}

export default function ChogLogo(
  { height = 30, className, word = false }:
  { height?: number; className?: string; word?: boolean },
) {
  const [tried, setTried] = useState(resolved);
  if (tried >= CANDIDATES.length) {
    // Supplied artwork carries the name inside it; the drawn badge does not,
    // so where the lockup stands in for the site's name — the header — the
    // word comes with it. Everywhere the name is already on the page, the
    // badge stands alone.
    if (!word) return <ChogBadge size={height} className={className} />;
    return (
      <>
        <ChogBadge size={height} className={className} />
        <span className="logo-word">{BRAND.org}</span>
      </>
    );
  }
  return (
    <img
      className={className}
      src={CANDIDATES[tried]}
      alt={BRAND.org}
      height={height}
      draggable={false}
      // Each miss steps to the next candidate; running off the end draws the
      // badge instead. A 404 on a logo must never leave an empty frame where
      // the site's name should be.
      onError={() => setTried(t => { resolved = t + 1; return t + 1; })}
    />
  );
}
