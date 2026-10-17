// Shared camera state for the board scene: the player's chosen view, where
// each piece is right now (for the follow view), and whether a cinematic shot
// owns the camera at the moment.

import { useCallback, useState } from 'react';
import type { Object3D } from 'three';

export type CameraMode = 'table' | 'follow' | 'close' | 'top' | 'free';

export const CAMERA_MODES: { id: CameraMode; icon: string; label: string; hint: string }[] = [
  { id: 'table', icon: '🎲', label: 'Table', hint: 'The whole table, from your seat' },
  { id: 'follow', icon: '🏃', label: 'Follow', hint: 'Follows whoever is playing, around the board' },
  { id: 'close', icon: '🎥', label: 'Close-up', hint: 'Down at board level, just behind whoever is playing' },
  { id: 'top', icon: '🗺️', label: 'Overhead', hint: 'Straight down over the board' },
  { id: 'free', icon: '🕹️', label: 'Free', hint: 'Drag to orbit, pinch or scroll to zoom, right-drag to pan' },
];

const KEY = 'yot:camera';

function read(): CameraMode {
  try {
    const v = localStorage.getItem(KEY);
    return CAMERA_MODES.some(m => m.id === v) ? (v as CameraMode) : 'table';
  } catch {
    return 'table';
  }
}

export function useCameraMode(): [CameraMode, (m: CameraMode) => void, () => void] {
  const [mode, setMode] = useState<CameraMode>(read);
  const set = useCallback((m: CameraMode) => {
    setMode(m);
    try { localStorage.setItem(KEY, m); } catch { /* private mode */ }
  }, []);
  const next = useCallback(() => {
    setMode(m => {
      const n = CAMERA_MODES[(CAMERA_MODES.findIndex(x => x.id === m) + 1) % CAMERA_MODES.length].id;
      try { localStorage.setItem(KEY, n); } catch { /* private mode */ }
      return n;
    });
  }, []);
  return [mode, set, next];
}

/** Each piece's root object, by player id (Pieces registers them). */
export const pieceObjects = new Map<string, Object3D>();

/** True while a cinematic shot is flying the camera; the camera rig keeps its hands off. */
let directorActive = false;
export const setDirectorActive = (v: boolean) => { directorActive = v; };
export const isDirectorActive = () => directorActive;
