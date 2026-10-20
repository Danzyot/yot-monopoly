// Chog Cards art: every face and the back, drawn as self-contained SVG (each
// <svg> carries its own <defs>), so the same component renders in the 2D
// table and can be serialised to an image for 3D textures later
// (cardSvgMarkup). Original design: a dark rim, a rich two-tone colour panel
// with a fine stripe, the value in a big rounded cream badge, and its own icons
// for Skip (a hop over a player), Reverse (two chasing arrows), Draw Two (a
// pair of cards), and a four-petal pinwheel for the Wilds.

import { memo } from 'react';
import type { Card, CardColor } from '../../../shared/cards/deck.ts';
import { cardName } from '../../../shared/cards/deck.ts';

/** The four colours: base, deep and light tones. */
export const CARD_HEX: Record<CardColor, { base: string; deep: string; light: string; ink: string }> = {
  red: { base: '#e5383b', deep: '#9e1620', light: '#ff7a6e', ink: '#b3141f' },
  yellow: { base: '#f7b500', deep: '#b97700', light: '#ffe066', ink: '#a86400' },
  green: { base: '#22b16b', deep: '#0d6b3f', light: '#6ee7a8', ink: '#0b7a45' },
  blue: { base: '#2a78f0', deep: '#123f9e', light: '#79b0ff', ink: '#1450b8' },
};
const WILD = { base: '#2b1f4d', deep: '#120b26', light: '#4c3a85' };
const RIM = '#141a2e';
const CREAM = '#fff8ea';
const FONT = "'Lilita One', 'Titan One', 'Nunito', system-ui, sans-serif";
/** Card proportions: the viewBox every face and the back share. */
export const CARD_W = 120;
export const CARD_H = 180;

function Defs({ id, base, deep, light }: { id: string; base: string; deep: string; light: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={light} />
        <stop offset="0.45" stopColor={base} />
        <stop offset="1" stopColor={deep} />
      </linearGradient>
      <pattern id={`${id}-p`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
        <rect width="10" height="10" fill="transparent" />
        <rect width="3" height="10" fill="#ffffff" opacity="0.07" />
      </pattern>
      <radialGradient id={`${id}-s`} cx="0.5" cy="0.35" r="0.75">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="1" stopColor="#f3e6cc" />
      </radialGradient>
    </defs>
  );
}

/** The rim and the colour panel every face sits on. */
function Body({ id }: { id: string }) {
  return (
    <>
      <rect x="0" y="0" width={CARD_W} height={CARD_H} rx="16" fill={RIM} />
      <rect x="5" y="5" width={CARD_W - 10} height={CARD_H - 10} rx="12" fill={`url(#${id}-g)`} />
      <rect x="5" y="5" width={CARD_W - 10} height={CARD_H - 10} rx="12" fill={`url(#${id}-p)`} />
      <rect x="9" y="9" width={CARD_W - 18} height={CARD_H - 18} rx="9" fill="none" stroke="#ffffff" strokeOpacity="0.28" strokeWidth="1.5" />
    </>
  );
}

/** The centre badge: a cream rounded square, tilted a touch. */
function Badge({ ink, children, wide = false }: { ink: string; children: React.ReactNode; wide?: boolean }) {
  const w = wide ? 84 : 76;
  return (
    <g transform={`translate(${CARD_W / 2} ${CARD_H / 2}) rotate(-6)`}>
      <rect x={-w / 2} y={-40} width={w} height={80} rx="24" fill={RIM} opacity="0.35" transform="translate(2 4)" />
      <rect x={-w / 2} y={-40} width={w} height={80} rx="24" fill={CREAM} stroke={ink} strokeWidth="3" />
      <g fill={ink} stroke={ink}>{children}</g>
    </g>
  );
}

/** Small index in two corners (the second upside down). */
function Corners({ label, icon }: { label?: string; icon?: React.ReactNode }) {
  const one = (
    <g>
      <rect x="10" y="10" width="30" height="26" rx="10" fill={RIM} opacity="0.55" />
      {label !== undefined
        ? <text x="25" y="30" textAnchor="middle" fontFamily={FONT} fontSize="19" fill={CREAM}>{label}</text>
        : <g transform="translate(25 23) scale(0.17)" fill={CREAM} stroke={CREAM}>{icon}</g>}
      {(label === '6' || label === '9') && <rect x="19" y="32" width="12" height="2.5" rx="1.2" fill={CREAM} />}
    </g>
  );
  return (
    <>
      {one}
      <g transform={`rotate(180 ${CARD_W / 2} ${CARD_H / 2})`}>{one}</g>
    </>
  );
}

// Icons, drawn in a box centred on 0,0 about 100 across.
const SkipIcon = ({ c }: { c: string }) => (
  <g fill="none" stroke={c} strokeWidth="11" strokeLinecap="round" strokeLinejoin="round">
    <path d="M -38 26 Q 0 -52 38 18" />
    <path d="M 22 8 L 40 22 L 46 0" />
    <circle cx="0" cy="30" r="12" stroke="none" fill={c} />
  </g>
);
const ReverseIcon = ({ c }: { c: string }) => (
  <g fill="none" stroke={c} strokeWidth="11" strokeLinecap="round" strokeLinejoin="round">
    <path d="M -34 -6 A 34 34 0 0 1 26 -22" />
    <path d="M 14 -38 L 30 -20 L 10 -10" />
    <path d="M 34 6 A 34 34 0 0 1 -26 22" />
    <path d="M -14 38 L -30 20 L -10 10" />
  </g>
);
const PairIcon = ({ ink }: { ink: string }) => (
  <g strokeWidth="5" stroke={ink}>
    <rect x="-30" y="-36" width="34" height="50" rx="8" transform="rotate(-14)" fill={CREAM} />
    <rect x="-6" y="-30" width="34" height="50" rx="8" transform="rotate(10)" fill={ink} />
  </g>
);
function Pinwheel({ r = 30 }: { r?: number }) {
  const cols: CardColor[] = ['red', 'yellow', 'green', 'blue'];
  return (
    <g stroke="none">
      {cols.map((c, i) => (
        <path key={c} transform={`rotate(${i * 90 + 20})`}
          d={`M 0 0 C ${r * 0.15} ${-r * 0.55}, ${r * 0.85} ${-r * 1.05}, ${r * 1.05} ${-r * 0.35} C ${r * 1.0} ${-r * 0.1}, ${r * 0.5} ${r * 0.05}, 0 0 Z`}
          fill={CARD_HEX[c].base} />
      ))}
      <circle r={r * 0.2} fill={CREAM} />
    </g>
  );
}

function faceId(c: Card): string {
  return `cc-${c.color ?? 'wild'}`;
}

/** One card face. Width comes from CSS (the SVG keeps its 2:3 shape). */
export const CardFace = memo(function CardFace({ card, className = '', title }: { card: Card; className?: string; title?: string }) {
  const id = faceId(card);
  const hex = card.color ? CARD_HEX[card.color] : null;
  const ink = hex?.ink ?? RIM;
  const tones = hex ?? WILD;
  let center: React.ReactNode;
  let corner: { label?: string; icon?: React.ReactNode };
  switch (card.kind) {
    case 'number': {
      const v = String(card.value);
      center = (
        <Badge ink={ink}>
          <text x="0" y="22" textAnchor="middle" fontFamily={FONT} fontSize="64" stroke="none">{v}</text>
          {(card.value === 6 || card.value === 9) && <rect x="-14" y="28" width="28" height="5" rx="2.5" stroke="none" />}
        </Badge>
      );
      corner = { label: v };
      break;
    }
    case 'skip':
      center = <Badge ink={ink}><g transform="scale(0.62)"><SkipIcon c={ink} /></g></Badge>;
      corner = { icon: <SkipIcon c={CREAM} /> };
      break;
    case 'reverse':
      center = <Badge ink={ink}><g transform="scale(0.68)"><ReverseIcon c={ink} /></g></Badge>;
      corner = { icon: <ReverseIcon c={CREAM} /> };
      break;
    case 'draw2':
      center = (
        <Badge ink={ink} wide>
          <g transform="translate(-14 2) scale(0.62)"><PairIcon ink={ink} /></g>
          <text x="20" y="18" textAnchor="middle" fontFamily={FONT} fontSize="34" stroke="none">+2</text>
        </Badge>
      );
      corner = { label: '+2' };
      break;
    case 'wild':
      center = (
        <g transform={`translate(${CARD_W / 2} ${CARD_H / 2})`}>
          <circle r="44" fill={CREAM} opacity="0.1" />
          <Pinwheel r={40} />
        </g>
      );
      corner = { icon: <g transform="scale(2.2)"><Pinwheel r={20} /></g> };
      break;
    case 'wild4':
      center = (
        <g transform={`translate(${CARD_W / 2} ${CARD_H / 2})`}>
          <circle r="44" fill={CREAM} opacity="0.1" />
          <g transform="translate(0 -10)"><Pinwheel r={30} /></g>
          <rect x="-26" y="18" width="52" height="30" rx="12" fill={CREAM} />
          <text x="0" y="42" textAnchor="middle" fontFamily={FONT} fontSize="27" fill={RIM}>+4</text>
        </g>
      );
      corner = { label: '+4' };
      break;
  }
  return (
    <svg className={`card-svg ${className}`} viewBox={`0 0 ${CARD_W} ${CARD_H}`} role="img" aria-label={title ?? cardName(card)}>
      <Defs id={id} {...tones} />
      <Body id={id} />
      {center}
      <Corners {...corner} />
    </svg>
  );
});

/** The back: deep purple, the four colours in a ring, and the CHOG CARDS mark. */
export const CardBack = memo(function CardBack({ className = '' }: { className?: string }) {
  const id = 'cc-back';
  return (
    <svg className={`card-svg ${className}`} viewBox={`0 0 ${CARD_W} ${CARD_H}`} role="img" aria-label="Card back">
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b3fb0" />
          <stop offset="0.5" stopColor="#35206f" />
          <stop offset="1" stopColor="#170d36" />
        </linearGradient>
        <pattern id={`${id}-p`} width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="16" height="16" fill="transparent" />
          <circle cx="4" cy="4" r="1.6" fill="#ff7a6e" opacity="0.45" />
          <circle cx="12" cy="4" r="1.6" fill="#ffe066" opacity="0.45" />
          <circle cx="4" cy="12" r="1.6" fill="#6ee7a8" opacity="0.45" />
          <circle cx="12" cy="12" r="1.6" fill="#79b0ff" opacity="0.45" />
        </pattern>
      </defs>
      <rect x="0" y="0" width={CARD_W} height={CARD_H} rx="16" fill={RIM} />
      <rect x="5" y="5" width={CARD_W - 10} height={CARD_H - 10} rx="12" fill={`url(#${id}-g)`} />
      <rect x="5" y="5" width={CARD_W - 10} height={CARD_H - 10} rx="12" fill={`url(#${id}-p)`} />
      <rect x="10" y="10" width={CARD_W - 20} height={CARD_H - 20} rx="9" fill="none" stroke="#ffd23f" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="5 4" />
      <g transform={`translate(${CARD_W / 2} ${CARD_H / 2})`}>
        <g transform="rotate(-8)">
          <rect x="-48" y="-32" width="96" height="64" rx="20" fill={RIM} opacity="0.4" transform="translate(2 4)" />
          <rect x="-48" y="-32" width="96" height="64" rx="20" fill={CREAM} stroke="#ffd23f" strokeWidth="3" />
          <text x="0" y="4" textAnchor="middle" fontFamily={FONT} fontSize="30" fill="#35206f" letterSpacing="1">CHOG</text>
          <text x="0" y="22" textAnchor="middle" fontFamily={FONT} fontSize="13" fill="#e5383b" letterSpacing="3.5">CARDS</text>
        </g>
        {(['red', 'yellow', 'green', 'blue'] as CardColor[]).map((c, i) => (
          <circle key={c} cx={-21 + i * 14} cy="50" r="5" fill={CARD_HEX[c].base} stroke={RIM} strokeWidth="1.5" />
        ))}
        {(['red', 'yellow', 'green', 'blue'] as CardColor[]).map((c, i) => (
          <circle key={c} cx={-21 + i * 14} cy="-50" r="5" fill={CARD_HEX[c].base} stroke={RIM} strokeWidth="1.5" />
        ))}
      </g>
    </svg>
  );
});

/** A face, or the back for null. */
export function CardArt({ card, className }: { card: Card | null; className?: string }) {
  return card ? <CardFace card={card} className={className} /> : <CardBack className={className} />;
}

/**
 * A rendered card's SVG as a standalone document, for drawing to a canvas or
 * a 3D texture: load it into an Image as a data: URL, then drawImage.
 */
export function cardSvgMarkup(el: SVGSVGElement, scale = 4): string {
  const copy = el.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', String(CARD_W * scale));
  copy.setAttribute('height', String(CARD_H * scale));
  return new XMLSerializer().serializeToString(copy);
}
