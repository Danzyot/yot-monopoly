// Cinematic shots for the moments that matter. Most of the game is watched
// from the table view; when something big happens the camera swoops down to
// it, holds a beat, and glides back:
//   - you buy a property            -> a close look at your new deed's tile
//   - you build a house or a hotel  -> down on the street as it goes up
//   - anyone builds a hotel         -> the same, for everyone
//   - anyone is sent to jail        -> the cell
//   - anyone goes bankrupt          -> their piece falling over
// Shots wait for the dice and the walk to finish, never stack up, and give
// way the moment the player grabs the camera. They can be switched off.

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Vector3 } from 'three';
import type { GameView } from '../../../shared/types.ts';
import { tile } from './layout.ts';
import { useSceneBusy } from './sequence.ts';
import { setDirectorActive, type CameraMode } from './camera.ts';

interface Shot { pos: Vector3; target: Vector3; hold: number }

interface Playing {
  shot: Shot;
  t0: number;
  homePos: Vector3;
  homeTarget: Vector3;
  /** 'in' -> 'hold' -> 'out'; time marks when the current stage began. */
  stage: 'in' | 'hold' | 'out';
  stageAt: number;
  /** Where the glide home starts (the camera wherever the shot was cut). */
  outPos: Vector3;
  outTarget: Vector3;
}

const drift = new Vector3();

const IN_MS = 900;
const OUT_MS = 800;
const GAP_MS = 2500;

/** Low over the board edge, looking back in at tile `i`. */
function tileShot(i: number, n: number, opts: { height?: number; dist?: number; side?: number; hold?: number } = {}): Shot {
  const g = tile(i, n);
  const { height = 1.55, dist = 2.4, side = 0.9, hold = 1700 } = opts;
  const target = new Vector3(g.x, 0.35, g.z);
  const pos = new Vector3(
    g.x + g.out[0] * dist + g.along[0] * side,
    height,
    g.z + g.out[1] * dist + g.along[1] * side,
  );
  return { pos, target, hold };
}

const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

export function CameraDirector({ game, me, n, enabled, mode }: { game: GameView; me?: string; n: number; enabled: boolean; mode: CameraMode }) {
  const { camera, controls, gl } = useThree() as unknown as {
    camera: import('three').PerspectiveCamera;
    gl: import('three').WebGLRenderer;
    controls: { target: Vector3; enabled: boolean; update: () => void; addEventListener: (e: string, f: () => void) => void; removeEventListener: (e: string, f: () => void) => void } | null;
  };
  const busy = useSceneBusy();
  const prev = useRef<GameView | null>(null);
  const queue = useRef<Shot[]>([]);
  const playing = useRef<Playing | null>(null);
  const lastEnd = useRef(0);
  const ctl = useRef(controls);
  ctl.current = controls;
  // Views that steer themselves (follow, overhead) take the camera back from
  // wherever the shot ends; the others glide home to where the player left it.
  const selfSteering = mode === 'follow' || mode === 'top';
  const steer = useRef(selfSteering);
  steer.current = selfSteering;

  // Spot what changed since the last state and line up a shot for it.
  useEffect(() => {
    const before = prev.current;
    prev.current = game;
    if (!before || !enabled) return;
    const shots: Shot[] = [];
    for (const [k, o] of Object.entries(game.owned)) {
      const i = Number(k);
      const was = before.owned[i];
      if (!was && o.owner === me) shots.push(tileShot(i, n));
      if (was && o.houses > was.houses) {
        const hotel = o.houses === 5;
        if (o.owner === me || hotel) shots.push(tileShot(i, n, { height: hotel ? 1.3 : 1.15, dist: 1.9, side: 0.6, hold: hotel ? 2200 : 1500 }));
      }
    }
    for (const p of game.players) {
      const was = before.players.find(x => x.id === p.id);
      if (!was) continue;
      if (p.inJail && !was.inJail) shots.push(tileShot(p.position, n, { height: 1.4, dist: 2.1, side: -0.7, hold: 1800 }));
      if (p.bankrupt && !was.bankrupt) shots.push(tileShot(p.position, n, { height: 1.8, dist: 2.6, side: 0.4, hold: 2200 }));
    }
    // Several at once (an auction win + a build): the last is the one worth seeing.
    if (shots.length) queue.current = [shots[shots.length - 1]];
  }, [game, me, n, enabled]);

  // Grabbing the camera (drag, pinch, wheel) cuts the shot short. The controls
  // are off during a shot, so listen on the canvas itself.
  useEffect(() => {
    const el = gl.domElement;
    const cut = () => {
      const p = playing.current;
      if (!p || p.stage === 'out') return;
      if (steer.current) {
        playing.current = null;
        setDirectorActive(false);
        lastEnd.current = performance.now();
      } else goOut(p, performance.now());
    };
    el.addEventListener('pointerdown', cut);
    el.addEventListener('wheel', cut, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', cut);
      el.removeEventListener('wheel', cut);
    };
  }, [gl]);

  const goOut = (p: Playing, now: number) => {
    p.stage = 'out';
    p.stageAt = now;
    p.outPos.copy(camera.position);
    if (ctl.current) p.outTarget.copy(ctl.current.target);
  };

  useEffect(() => {
    if (!enabled) queue.current = [];
  }, [enabled]);

  useFrame(() => {
    if (!controls) return;
    const now = performance.now();
    let p = playing.current;
    if (!p) {
      const next = queue.current[0];
      if (!next || busy || now - lastEnd.current < GAP_MS) return;
      queue.current.shift();
      p = playing.current = {
        shot: next, t0: now, homePos: camera.position.clone(), homeTarget: controls.target.clone(),
        stage: 'in', stageAt: now, outPos: new Vector3(), outTarget: new Vector3(),
      };
      controls.enabled = false;
      setDirectorActive(true);
    }
    const t = now - p.stageAt;
    if (p.stage === 'in') {
      const k = ease(Math.min(1, t / IN_MS));
      camera.position.lerpVectors(p.homePos, p.shot.pos, k);
      controls.target.lerpVectors(p.homeTarget, p.shot.target, k);
      if (t >= IN_MS) { p.stage = 'hold'; p.stageAt = now; }
    } else if (p.stage === 'hold') {
      // A slow drift keeps the hold alive.
      const d = (t / p.shot.hold) * 0.25;
      camera.position.copy(p.shot.pos).add(drift.set(Math.sin(d) * 0.25, d * 0.15, 0));
      controls.target.copy(p.shot.target);
      if (t >= p.shot.hold) {
        if (steer.current) {
          playing.current = null;
          setDirectorActive(false);
          lastEnd.current = now;
          return;
        }
        goOut(p, now);
      }
    } else {
      const k = ease(Math.min(1, t / OUT_MS));
      camera.position.lerpVectors(p.outPos, p.homePos, k);
      controls.target.lerpVectors(p.outTarget, p.homeTarget, k);
      if (t >= OUT_MS) {
        camera.position.copy(p.homePos);
        controls.target.copy(p.homeTarget);
        playing.current = null;
        setDirectorActive(false);
        lastEnd.current = now;
        controls.enabled = true;
      }
    }
    camera.lookAt(controls.target);
    controls.update();
  });

  return null;
}
