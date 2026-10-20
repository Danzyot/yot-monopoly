import { useState } from 'react';
import type { ChogBadge } from '../../../shared/types';
import { useAuth } from '../auth';
import { chogArtUrl } from '../chog';

// Player avatar: either an emoji string or an image URL (Discord pfp). A
// player showing a Chog (the server only sends `chog` once the hub has
// confirmed they hold it) gets its art instead, ringed in its Aura colour,
// with a star for the ten Legendary 1:1s.
export default function Avatar({ value, size = 20, chog }: { value: string; size?: number; chog?: ChogBadge | null }) {
  const { hubUrl } = useAuth();
  const [chogBroken, setChogBroken] = useState<number | null>(null);
  if (chog && hubUrl && chogBroken !== chog.chogToken) {
    return <ChogArt chog={chog} base={hubUrl} size={size} onError={() => setChogBroken(chog.chogToken)} />;
  }
  if (value.startsWith('http')) {
    return (
      <img
        className="avatar-img"
        src={value}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }
  return <span className="avatar" style={{ fontSize: size * 0.8 }}>{value}</span>;
}

export function ChogArt({ chog, base, size, onError }: {
  chog: ChogBadge; base: string; size: number; onError?: () => void;
}) {
  const cls = [
    'chog-av',
    chog.aura ? 'has-aura' : '',
    chog.legendary ? 'legendary' : '',
    size < 24 ? 'tiny' : '',
  ].filter(Boolean).join(' ');
  return (
    <span
      className={cls}
      style={{ width: size, height: size, ['--aura' as string]: chog.aura ?? undefined }}
      title={`Chog #${chog.chogToken}${chog.legendary ? ' · Legendary 1:1' : ''}`}
    >
      <img
        src={chogArtUrl(base, chog.chogToken)}
        alt={`Chog #${chog.chogToken}`}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={onError}
      />
      {chog.legendary && <span className="chog-legend" aria-label="Legendary">★</span>}
    </span>
  );
}
