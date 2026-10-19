// Shared camera state for the board scene: the player's chosen view (Auto picks
// one from what's happening), where
// each piece is right now (for the follow view), and whether a cinematic shot
// owns the camera at the moment.

import { useCallback, useState } from 'react';
import { Vector3, type Object3D } from 'three';

export type CameraMode = 'auto' | 'table' | 'follow' | 'close' | 'top' | 'free';
/**
 * What the camera is doing this moment: a chosen view, or (Auto only) 'dice',
 * a closer look at the dice while they tumble and the result is read.
 */
export type LiveMode = Exclude<CameraMode, 'auto'> | 'dice';

export const CAMERA_MODES: { id: CameraMode; icon: string; label: string; hint: string }[] = [
  { id: 'auto', icon: '✨', label: 'Auto', hint: 'Follows the action: trails whoever is moving, then pulls back to the table' },
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
    return CAMERA_MODES.some(m => m.id === v) ? (v as CameraMode) : 'auto';
  } catch {
    return 'auto';
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

/**
 * ?perf: what the camera is up to (window.__yotCam): the live view, who it
 * follows and the cinematic shot playing, if any. Written by the camera rig
 * and the director; read only by the debug hook.
 */
export const cameraDebug: { mode?: LiveMode; follow?: string | null; shot?: string | null; queued?: number } = {};

/** True while a cinematic shot is flying the camera; the camera rig keeps its hands off. */
let directorActive = false;
export const setDirectorActive = (v: boolean) => { directorActive = v; };
export const isDirectorActive = () => directorActive;

/**
 * Portrait framing: the distance from the board centre, along `dir`, at which
 * a square board of half-width `half` spans `fill` of the screen's width (and
 * still fits its height). On a phone held upright the width is what runs out,
 * so the board is framed edge to edge instead of being scaled by the aspect
 * ratio, which left it at three quarters of the width with specks for pieces.
 */
export function fitBoardDistance(dir: Vector3, aspect: number, fovDeg: number, half: number, fill = 0.96): number {
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * aspect;
  const f = dir.clone().normalize().negate();
  const r = new Vector3().crossVectors(f, new Vector3(0, 1, 0)).normalize();
  const u = new Vector3().crossVectors(r, f);
  const v = new Vector3();
  const fits = (d: number) => {
    for (const x of [-half, half]) {
      for (const z of [-half, half]) {
        // Corner relative to a camera at -f * d.
        v.set(x, 0, z).addScaledVector(f, d);
        const depth = v.dot(f);
        if (depth <= 0) return false;
        if (Math.abs(v.dot(r)) / depth > tanH * fill || Math.abs(v.dot(u)) / depth > tanV * fill) return false;
      }
    }
    return true;
  };
  let lo = half, hi = half * 40;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid; else lo = mid;
  }
  return hi;
}
