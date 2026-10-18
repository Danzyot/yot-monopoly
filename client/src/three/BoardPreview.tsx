// A small picture of a board face (theme × map), painted by the same code as
// the 3D board's texture, for the lobby's pickers. Previews are painted one
// at a time, a frame apart, at 512 px (1 MB while painting, ~40 KB kept as a
// WebP), and cached for the session, so flicking between choices is free.

import { useEffect, useState } from 'react';
import { resolveTheme } from '../../../shared/themes.ts';
import { drawBoard } from './boardTexture.ts';

const cache = new Map<string, string>();
let queue: Promise<unknown> = Promise.resolve();

function loadImage(url: string | undefined): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function paint(themeId: string, mapId: string): Promise<string> {
  const key = `${themeId}:${mapId}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const job = queue.then(async () => {
    const again = cache.get(key);
    if (again) return again;
    const theme = resolveTheme(themeId, mapId);
    const face = theme.ui?.boardFont ?? theme.ui?.font ?? 'Oswald';
    await Promise.all([
      document.fonts?.load(`700 40px ${face}`).catch(() => {}),
      document.fonts?.load(`400 40px "Lilita One"`).catch(() => {}),
    ]);
    const logo = await loadImage(theme.logoUrl);
    await new Promise(r => requestAnimationFrame(r));
    const cv = drawBoard(theme, logo, 512);
    const url = cv.toDataURL('image/webp', 0.86);
    cv.width = cv.height = 0;
    cache.set(key, url);
    return url;
  });
  queue = job.catch(() => {});
  return job;
}

/** The face of `themeId` on `mapId`, tilted like a board on a table, GO towards the viewer. */
export default function BoardPreview({ themeId, mapId, className = '' }: { themeId: string; mapId: string; className?: string }) {
  const key = `${themeId}:${mapId}`;
  const [url, setUrl] = useState(() => cache.get(key) ?? null);
  useEffect(() => {
    let live = true;
    setUrl(cache.get(key) ?? null);
    paint(themeId, mapId).then(u => { if (live) setUrl(u); }).catch(() => {});
    return () => { live = false; };
  }, [key, themeId, mapId]);
  return (
    <span className={`board-preview ${url ? 'ready' : ''} ${className}`} aria-hidden>
      {url && <img src={url} alt="" draggable={false} />}
    </span>
  );
}
