// The player's graphics quality, remembered per browser. Auto (the default)
// starts sharp and backs off when the frame rate sags; Low keeps a phone cool
// from the first frame; High never backs off.
import { useCallback, useState } from 'react';

export type Quality = 'auto' | 'low' | 'high';

export const QUALITY_LEVELS: { id: Quality; icon: string; label: string; hint: string }[] = [
  { id: 'auto', icon: '⚙️', label: 'Auto graphics', hint: 'Sharp when the device keeps up, lighter when it does not' },
  { id: 'low', icon: '🔋', label: 'Low graphics', hint: 'No live shadows, 1× pixels: cool and smooth on phones' },
  { id: 'high', icon: '💎', label: 'High graphics', hint: 'Full resolution and shadows, whatever the frame rate' },
];

const KEY = 'yot:quality';

/** The stored setting (Auto when none). */
export function readQuality(): Quality {
  return read();
}

/**
 * A device that should start light under Auto rather than wait for the frame
 * rate to sag: few CPU cores, little memory (Chrome's deviceMemory, rounded,
 * capped at 8), or the browser's data saver on. Checked once per page.
 */
let weak: boolean | null = null;
export function weakDevice(): boolean {
  if (weak !== null) return weak;
  try {
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    const cores = nav.hardwareConcurrency || 8;
    const memory = nav.deviceMemory ?? 8;
    weak = cores <= 4 || memory <= 4 || nav.connection?.saveData === true;
  } catch {
    weak = false;
  }
  return weak;
}

/** Low, or Auto on a weak device: download and hold the half-size lightmaps. */
export function liteAssets(q: Quality = read()): boolean {
  return q === 'low' || (q === 'auto' && weakDevice());
}

function read(): Quality {
  try {
    const v = localStorage.getItem(KEY);
    return QUALITY_LEVELS.some(q => q.id === v) ? (v as Quality) : 'auto';
  } catch {
    return 'auto';
  }
}

export function useQuality(): [Quality, () => void] {
  const [q, setQ] = useState<Quality>(read);
  const next = useCallback(() => {
    setQ(cur => {
      const n = QUALITY_LEVELS[(QUALITY_LEVELS.findIndex(x => x.id === cur) + 1) % QUALITY_LEVELS.length].id;
      try { localStorage.setItem(KEY, n); } catch { /* private mode */ }
      return n;
    });
  }, []);
  return [q, next];
}
