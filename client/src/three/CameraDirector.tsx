// Cinematic shots for the moments that matter. Most of the game is watched
// from the table view; when something big happens the camera swoops down to
// it, holds a beat, and glides back:
//   - you buy a property            -> a close look at your new deed's tile
//   - you build a house or a hotel  -> down on the street as it goes up
//   - anyone is sent to jail        -> the cell
//   - anyone gets out of jail       -> the door and the leap over the bars
//   - anyone lands on a big rent bill -> the street that's charging it
//   - anyone goes bankrupt          -> their piece falling over
//   - the game is won               -> a slow circle round the winner's victory dance
//   - the game begins               -> one slow turn round the table
// Shots wait for the dice and the walk to finish, never stack up, and give
// way the moment the player grabs the camera. They can be switched off.
//
// Every shot belongs to the throw and move it came with (its epoch). A newer
// throw or move makes it stale: a queued one is dropped and a playing one
// glides home at once, so the camera is never off at some other tile while
// the next player's dice are in the air. Other players' builds get no shot:
// the camera reacts to the move being played and to the viewer's own doings.
//
// However a shot ends, the camera rig gets the camera back: unmounting mid-shot
// (Rematch or Leave during the winner's circle) hands it back, and no shot
// outlives MAX_SHOT_MS.

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Vector3 } from 'three';
import type { GameView } from '../../../shared/types.ts';
import { tile } from './layout.ts';
import { useSceneBusy } from './sequence.ts';
import { cameraDebug, pieceObjects, setDirectorActive, type LiveMode } from './camera.ts';
import { cutsceneOwnsCamera } from './cinematics/store.ts';

interface Shot {
  pos: Vector3; target: Vector3; hold: number;
  /** Circle the target at this many radians a second while holding. */
  orbit?: number;
  /** The throw and move it came with (see epochOf); stale once they are not the latest. */
  epoch?: string;
  /** What it is of, for ?perf logs. */
  label?: string;
}

/** A view's throw and move: shots belong to the one they came with. */
const epochOf = (g: GameView) => `${g.rollSeq}:${g.lastMove?.seq ?? 0}`;

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
  /** How long the glide home takes (shorter when the shot went stale). */
  outMs: number;
}

const drift = new Vector3();
const UP = new Vector3(0, 1, 0);

const IN_MS = 900;
const OUT_MS = 800;
/** A shot gone stale mid-play heads home this quickly. */
const STALE_OUT_MS = 420;
const GAP_MS = 2500;
/** A shot that has waited this long for the scene to be still is history: dropped. */
const MAX_WAIT_MS = 15_000;
/** No shot plays longer than this, whatever its hold (the winner's circle is the longest, ~16 s). */
const MAX_SHOT_MS = 20_000;

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

export function CameraDirector({ game, me, n, enabled, mode }: { game: GameView; me?: string; n: number; enabled: boolean; mode: LiveMode }) {
  const { camera, controls, gl } = useThree() as unknown as {
    camera: import('three').PerspectiveCamera;
    gl: import('three').WebGLRenderer;
    controls: { target: Vector3; enabled: boolean; update: () => void; addEventListener: (e: string, f: () => void) => void; removeEventListener: (e: string, f: () => void) => void } | null;
  };
  const busy = useSceneBusy();
  const prev = useRef<GameView | null>(null);
  const queue = useRef<(Shot & { at: number })[]>([]);
  // The latest throw and move: shots from older ones are stale.
  const epoch = useRef(epochOf(game));
  epoch.current = epochOf(game);
  const playing = useRef<Playing | null>(null);
  const lastEnd = useRef(0);
  const ctl = useRef(controls);
  ctl.current = controls;
  // Views that steer themselves (follow, overhead) take the camera back from
  // wherever the shot ends; the others glide home to where the player left it.
  const selfSteering = mode === 'follow' || mode === 'close' || mode === 'top' || mode === 'dice';
  const steer = useRef(selfSteering);
  steer.current = selfSteering;

  // Spot what changed since the last state and line up a shot for it.
  useEffect(() => {
    const before = prev.current;
    prev.current = game;
    if (!before) {
      // A game about to start: one slow turn round the table before the first roll.
      if (enabled && game.rollSeq === 0 && game.turnNumber <= 1 && game.phase === 'roll') {
        queue.current = [{ pos: new Vector3(0, 7, 13), target: new Vector3(0, 0.3, 0), hold: 5200, orbit: 2 * Math.PI / 5.2, epoch: epochOf(game), label: 'intro', at: performance.now() }];
      }
      return;
    }
    if (!enabled) return;
    const shots: Shot[] = [];
    for (const [k, o] of Object.entries(game.owned)) {
      const i = Number(k);
      const was = before.owned[i];
      if (!was && o.owner === me) shots.push({ ...tileShot(i, n), label: `bought ${i}` });
      // Only the viewer's own builds: another player's would pull the camera off the move being played.
      if (was && o.houses > was.houses && o.owner === me) {
        const hotel = o.houses === 5;
        shots.push({ ...tileShot(i, n, { height: hotel ? 1.3 : 1.15, dist: 1.9, side: 0.6, hold: hotel ? 2200 : 1500 }), label: `built ${i}` });
      }
    }
    for (const p of game.players) {
      const was = before.players.find(x => x.id === p.id);
      if (!was) continue;
      if (p.inJail && !was.inJail) shots.push({ ...tileShot(p.position, n, { height: 1.4, dist: 2.1, side: -0.7, hold: 1800 }), label: 'jail' });
      // Out on a roll: the door swings and the piece leaps the bars.
      if (was.inJail && !p.inJail && !p.bankrupt && p.position !== was.position) {
        shots.push({ ...tileShot(n / 4, n, { height: 1.3, dist: 2.0, side: -0.9, hold: 1500 }), label: 'out of jail' });
      }
      // Landed on a street with three houses or more and paid up big: the ouch moment.
      const o = game.owned[p.position];
      if (o && o.owner !== p.id && o.houses >= 3 && was.cash - p.cash >= 400 && p.position !== was.position) {
        shots.push({ ...tileShot(p.position, n, { height: 1.2, dist: 1.9, side: 0.7, hold: 1700 }), label: `rent ${p.position}` });
      }
      if (p.bankrupt && !was.bankrupt) shots.push({ ...tileShot(p.position, n, { height: 1.8, dist: 2.6, side: 0.4, hold: 2200 }), label: 'bankrupt' });
    }
    if (game.winner && !before.winner) {
      const w = game.players.find(p => p.id === game.winner);
      const piece = pieceObjects.get(game.winner);
      if (w) {
        const shot = tileShot(w.position, n, { height: 1.25, dist: 1.9, side: 0.5, hold: 14000 });
        if (piece) {
          shot.pos.add(new Vector3(piece.position.x, 0, piece.position.z).sub(shot.target.clone().setY(0)));
          shot.target.set(piece.position.x, 0.3, piece.position.z);
        }
        shot.orbit = 0.32;
        // The game is over: no throw will come to make it stale.
        shots.push({ ...shot, label: 'winner' });
      }
    }
    // Several at once (an auction win + a build): the last is the one worth seeing.
    if (shots.length) queue.current = [{ ...shots[shots.length - 1], epoch: epochOf(game), at: performance.now() }];
  }, [game, me, n, enabled]);

  // Leaving mid-shot (Rematch or Leave during the winner's circle): give the
  // camera back, or the rig would sit out every frame of the next game.
  useEffect(() => () => {
    if (!playing.current) return;
    playing.current = null;
    setDirectorActive(false);
    if (ctl.current) ctl.current.enabled = true;
  }, []);

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

  const goOut = (p: Playing, now: number, outMs = OUT_MS) => {
    p.stage = 'out';
    p.stageAt = now;
    p.outMs = outMs;
    p.outPos.copy(camera.position);
    if (ctl.current) p.outTarget.copy(ctl.current.target);
  };

  useEffect(() => {
    if (!enabled) queue.current = [];
  }, [enabled]);

  useFrame(() => {
    const now = performance.now();
    // A shot past its hard limit (or with no controls left to drive) ends here, wherever it stands.
    const over = playing.current;
    if (over && (!controls || now - over.t0 > MAX_SHOT_MS)) {
      if (controls && !steer.current) { camera.position.copy(over.homePos); controls.target.copy(over.homeTarget); }
      playing.current = null;
      setDirectorActive(false);
      lastEnd.current = now;
      if (controls) controls.enabled = true;
    }
    if (!controls) return;
    cameraDebug.shot = playing.current ? `${playing.current.shot.label ?? 'shot'}:${playing.current.stage}` : null;
    cameraDebug.queued = queue.current.length;
    // A cutscene (three/cinematics) has the camera: drop any shot, and put a running one back home first.
    if (cutsceneOwnsCamera()) {
      queue.current = [];
      const cut = playing.current;
      if (cut) {
        if (!steer.current) { camera.position.copy(cut.homePos); controls.target.copy(cut.homeTarget); }
        playing.current = null;
        setDirectorActive(false);
        lastEnd.current = now;
      }
      return;
    }
    // Lined up for a throw or move that is no longer the latest (or waited too long): let it go.
    if (queue.current.length) queue.current = queue.current.filter(s => s.epoch === epoch.current && now - s.at < MAX_WAIT_MS);
    let p = playing.current;
    if (p && p.stage !== 'out' && p.shot.epoch !== epoch.current) {
      // A new throw came in mid-shot: the camera belongs to the dice and the mover now.
      if (steer.current) {
        playing.current = null;
        setDirectorActive(false);
        lastEnd.current = now;
        return;
      }
      goOut(p, now, STALE_OUT_MS);
    }
    if (!p) {
      const next = queue.current[0];
      if (!next || busy || now - lastEnd.current < GAP_MS) return;
      queue.current.shift();
      p = playing.current = {
        shot: next, t0: now, homePos: camera.position.clone(), homeTarget: controls.target.clone(),
        stage: 'in', stageAt: now, outPos: new Vector3(), outTarget: new Vector3(), outMs: OUT_MS,
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
      if (p.shot.orbit) {
        // Swing round the target, easing in so the cut from the glide is seamless.
        const a = p.shot.orbit * (t / 1000) * Math.min(1, t / 1500);
        drift.subVectors(p.shot.pos, p.shot.target).applyAxisAngle(UP, a);
        camera.position.copy(p.shot.target).add(drift);
      } else {
        camera.position.copy(p.shot.pos).add(drift.set(Math.sin(d) * 0.25, d * 0.15, 0));
      }
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
      const k = ease(Math.min(1, t / p.outMs));
      camera.position.lerpVectors(p.outPos, p.homePos, k);
      controls.target.lerpVectors(p.outTarget, p.homeTarget, k);
      if (t >= p.outMs) {
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
