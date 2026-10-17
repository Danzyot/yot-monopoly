// The player's "cinematic camera" preference, remembered per browser: on by
// default, off by default for anyone who has asked their system for less motion.
import { useCallback, useState } from 'react';

const KEY = 'yot:cinematic';

function read(): boolean {
  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? !calm : v !== '0';
  } catch {
    return !calm;
  }
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
