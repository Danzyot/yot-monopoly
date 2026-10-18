// Screen-space labels pinned to points in the scene (money amounts, reaction
// emoji): the job drei's <Html> does, without its cost. Every <Html> is its
// own React root and re-projects itself every frame whether it shows anything
// or not, so a table of eight pieces plus the money labels kept sixteen of
// them busy all game. Here a label is a plain DOM element that exists only
// while it is shown, and the per-frame work stops when nothing is.
//
// The element is laid out exactly like a centred drei <Html>: an absolutely
// positioned box translated to the projected point, its content centred on
// it, stacked by distance within a z-index range, hidden behind the camera.

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Vector3, type Camera, type Object3D } from 'three';

interface Pin {
  el: HTMLDivElement;
  /** A fixed point, or an object to follow (its world position). */
  at: Vector3 | Object3D;
  zRange: [number, number];
  x: number; y: number; z: number; shown: boolean;
}

const v = new Vector3();
const camPos = new Vector3();
const camDir = new Vector3();
const rel = new Vector3();

function place(p: Pin, camera: Camera & { near: number; far: number }, w: number, h: number) {
  if ((p.at as Object3D).isObject3D) {
    const o = p.at as Object3D;
    o.updateWorldMatrix(true, false);
    v.setFromMatrixPosition(o.matrixWorld);
  } else {
    v.copy(p.at as Vector3);
  }
  camPos.setFromMatrixPosition(camera.matrixWorld);
  camera.getWorldDirection(camDir);
  const dist = v.distanceTo(camPos);
  const shown = rel.subVectors(v, camPos).dot(camDir) > 0;
  v.project(camera);
  const x = v.x * (w / 2) + w / 2;
  const y = -(v.y * (h / 2)) + h / 2;
  if (shown !== p.shown) {
    p.el.style.display = shown ? 'block' : 'none';
    p.shown = shown;
  }
  // (Written as "not close" so the first placement, from NaN, always lands.)
  if (!(Math.abs(x - p.x) <= 0.001 && Math.abs(y - p.y) <= 0.001)) {
    p.el.style.transform = `translate3d(${x}px,${y}px,0) scale(1)`;
    p.x = x;
    p.y = y;
  }
  const [z0, z1] = p.zRange;
  const a = (z1 - z0) / (camera.far - camera.near);
  const z = Math.round(a * dist + (z1 - a * camera.far));
  if (z !== p.z) {
    p.el.style.zIndex = String(z);
    p.z = z;
  }
}

export interface Pins {
  /** Show `content` pinned at `at`; it stays until removed. */
  add(content: HTMLElement, at: Vector3 | Object3D, zRange: [number, number]): Pin;
  remove(pin: Pin): void;
}

/** Labels for one component: all removed when it unmounts. */
export function usePins(): Pins {
  const { gl, events } = useThree();
  const host = (events.connected as HTMLElement | undefined) ?? (gl.domElement.parentNode as HTMLElement | null);
  const pins = useRef(new Set<Pin>());
  useEffect(() => () => {
    for (const p of pins.current) p.el.remove();
    pins.current.clear();
  }, []);
  useFrame(({ camera, size }) => {
    if (!pins.current.size) return;
    camera.updateMatrixWorld();
    for (const p of pins.current) place(p, camera as Camera & { near: number; far: number }, size.width, size.height);
  });
  return useMemo<Pins>(() => ({
    add(content, at, zRange) {
      const el = document.createElement('div');
      // Hidden until the next frame has worked out where it goes.
      el.style.cssText = 'position:absolute;top:0;left:0;transform-origin:0 0;pointer-events:none;display:none;';
      const inner = document.createElement('div');
      inner.style.cssText = 'position:absolute;transform:translate3d(-50%,-50%,0);';
      inner.appendChild(content);
      el.appendChild(inner);
      const pin: Pin = { el, at, zRange, x: NaN, y: NaN, z: NaN, shown: false };
      host?.appendChild(el);
      pins.current.add(pin);
      return pin;
    },
    remove(pin) {
      pin.el.remove();
      pins.current.delete(pin);
    },
  }), [host]);
}
