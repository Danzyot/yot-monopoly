// What the cutscene system shares with the rest of the scene and the page,
// outside React: which pieces a cutscene is standing in for (Pieces hides
// them), whether a cutscene owns the camera (CameraDirector stands down), the
// jail door's angle while a cutscene slams it (JailCell), and the overlay's
// letterbox, title card and skip button (Overlay.tsx).

import { useSyncExternalStore } from 'react';
import type { CutsceneKind } from '../../../../shared/cutscenes.ts';

// ---- pieces ----------------------------------------------------------------

const held = new Set<string>();

/** A cutscene is drawing this player's piece itself: Pieces keeps its own out of sight. */
export const isPieceHeld = (id: string) => held.has(id);
export const holdPiece = (id: string) => { held.add(id); };
export const releasePiece = (id: string) => { held.delete(id); };

// ---- camera ----------------------------------------------------------------

let owning = false;

/** True from the moment a cutscene is lined up until it has handed the camera back. */
export const cutsceneOwnsCamera = () => owning;
export const setCutsceneOwnsCamera = (v: boolean) => { owning = v; };

// ---- props the board already has --------------------------------------------

/** The jail door's swing (radians, JailCell's), while a cutscene is working it; null: JailCell's own. */
export const jailDoor: { angle: number | null } = { angle: null };

// ---- skipping --------------------------------------------------------------

let skipAsked = false;
export const askSkip = () => { skipAsked = true; };
/** Was a skip asked for since the last look? */
export const takeSkip = () => { const s = skipAsked; skipAsked = false; return s; };

// ---- overlay ---------------------------------------------------------------

export interface OverlayBeat { at: number; text: string }

export interface CutsceneOverlay {
  /** Bumps per cutscene, so the overlay restarts its animations. */
  seq: number;
  kind: CutsceneKind;
  title: string;
  subtitle: string;
  /** The player's colour, for the title card's accent. */
  color: string;
  /** When the title card stamps in, and how long it stays (ms from the start). */
  titleAt: number;
  titleMs: number;
  /** Red-and-blue siren wash over the picture until this many ms in (0: none). */
  sirenUntil: number;
  /** Comic sound words popping up at moments (ms from the start). */
  beats: OverlayBeat[];
  /** Full length (ms); the bars pull away for the last stretch. */
  dur: number;
  /** Bars pulling away: the cutscene is ending (or was skipped). */
  leaving: boolean;
}

let overlay: CutsceneOverlay | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

export function setOverlay(o: CutsceneOverlay | null) {
  overlay = o;
  emit();
}

export function overlayLeaving() {
  if (!overlay || overlay.leaving) return;
  overlay = { ...overlay, leaving: true };
  emit();
}

export function useCutsceneOverlay(): CutsceneOverlay | null {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => overlay,
  );
}
