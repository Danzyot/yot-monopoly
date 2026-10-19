// What the 3D table reads each frame, handed over from the React side in one
// mutable object (a ref), so the scene's frame loops never re-render for a
// new view: the latest view and staged frame (cards/sequence.ts), where each
// player sits, the DOM our own hand lives in (cards fly to and from it), and
// the HUD elements pinned over the figures.

import type { RefObject } from 'react';
import type { Object3D } from 'three';
import type { CardsView } from '../../../../shared/cards/types.ts';
import type { CardsSeatView } from '../../../../shared/cards/room.ts';
import type { CardsFrame } from '../sequence.ts';

export interface SceneState {
  view: CardsView;
  frame: CardsFrame;
  seats: Record<string, CardsSeatView>;
  me: string | null;
  /** Each player's angle round the table (layout.ts). */
  angles: Map<string, number>;
  myTurn: boolean;
  /** The match is over and the winner is on the table; the results wait. */
  podium: string | null;
  /** prefers-reduced-motion: no camera cuts, no flights. */
  reduced: boolean;
  /** The player's cinematic-camera switch. */
  cinematic: boolean;
  /** The viewer may draw by tapping the pile. */
  canDraw: boolean;
  onDraw: () => void;
  onPodiumDone: () => void;
  /** Our hand's DOM (the cards fly from and to it) and where each card in it was last drawn. */
  handEl: RefObject<HTMLElement | null>;
  handRects: Map<number, DOMRect>;
  /** HUD elements pinned over the scene: seat chips by player id, 'colour' for the colour chip. Empty on phones (the chips sit in a row). */
  chipEls: Map<string, HTMLElement>;
  /** The effects layer: flashes with data-at="<player id | pile | discard>" are placed over the scene. */
  fxEl: RefObject<HTMLElement | null>;
  /** Scene objects to pin HUD elements to, registered by the seats and piles. */
  anchors: Map<string, Object3D>;
  /** Our own figure is drawn (the podium, a cut about us); otherwise the camera is our eyes. */
  showMe: boolean;
}

/** Step `index` of play `seq`, as a key for "seen once" bookkeeping. */
export const stepKey = (seq: number, index: number) => seq * 64 + index;

/** 0 before `a`, 1 after `b`, linear between. */
export const seg = (t: number, a: number, b: number) => (t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a));
export const easeOut = (k: number) => 1 - (1 - k) ** 3;
export const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
export const smooth = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
