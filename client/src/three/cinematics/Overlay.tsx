// The cutscene's picture frame, drawn over the 3D scene (under the HUD):
// letterbox bars, the title card, comic sound words, the siren wash, and a
// skip hint. A tap anywhere on the picture skips (Esc too, see Cutscenes.tsx).
// Timings come from the cutscene and run as CSS animations, so this renders
// only when a cutscene starts, starts leaving, and ends.

import type { CSSProperties } from 'react';
import { askSkip, useCutsceneOverlay } from './store.ts';

export function CutsceneOverlay() {
  const o = useCutsceneOverlay();
  if (!o) return null;
  const vars = {
    '--cine-accent': o.color,
    '--cine-title-at': `${o.titleAt}ms`,
    '--cine-title-ms': `${o.titleMs}ms`,
    '--cine-siren-until': `${o.sirenUntil}ms`,
  } as CSSProperties;
  return (
    <div key={o.seq} className={`cine cine-${o.kind}${o.leaving ? ' leaving' : ''}`} style={vars}
      onPointerDown={e => { e.stopPropagation(); askSkip(); }} aria-live="polite">
      {o.sirenUntil > 0 && <div className="cine-siren" aria-hidden />}
      <div className="cine-vignette" aria-hidden />
      <div className="cine-bar top" aria-hidden />
      <div className="cine-bar bottom">
        <span className="cine-skip">Tap or Esc to skip</span>
      </div>
      <div className="cine-title" role="status">
        <div className="cine-title-main">{o.title}</div>
        <div className="cine-title-sub">{o.subtitle}</div>
      </div>
      {o.beats.map((b, i) => (
        <div key={i} className="cine-beat" style={{ animationDelay: `${b.at}ms` }} aria-hidden>{b.text}</div>
      ))}
    </div>
  );
}
