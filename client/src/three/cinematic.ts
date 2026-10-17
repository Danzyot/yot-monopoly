// The player's "cinematic camera" preference (on by default), remembered per browser.
import { useCallback, useState } from 'react';

const KEY = 'yot:cinematic';

function read(): boolean {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
}

export function useCinematicPref(): [boolean, () => void] {
  const [on, setOn] = useState(read);
  const toggle = useCallback(() => {
    setOn(v => {
      try { localStorage.setItem(KEY, v ? '0' : '1'); } catch { /* private mode */ }
      return !v;
    });
  }, []);
  return [on, toggle];
}
