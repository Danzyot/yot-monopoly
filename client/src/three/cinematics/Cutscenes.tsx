// The cutscene director. Watches the game for the moments that get a
// cutscene (shared/cutscenes.ts: the same cue the server waits for), lines
// one up for after the dice and the walk, then plays it: letterbox, title
// card, a scripted multi-shot camera and its cast (scenes.tsx). While it is
// lined up and playing it owns the camera (CameraDirector stands down), holds
// the HUD (sequence.ts holdUntil) and stands in for the player's piece with a
// double (Pieces hides the real one). At the end the camera glides back to
// where it was and the real piece reappears exactly where the game has it.
// A tap or Esc skips; the 🎬 toggle turns it all off.

import { useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Vector3, type PerspectiveCamera } from 'three';
import type { GameView, PlayerState } from '../../../../shared/types.ts';
import type { CharacterId } from '../../../../shared/characters.ts';
import { CUTSCENE_MS, cutsceneSnap, pickCutscenes, type CutsceneCue, type CutsceneKind, type CutsceneSnap } from '../../../../shared/cutscenes.ts';
import { CARD_MS, diceSettleAt, holdUntil, stageView } from '../sequence.ts';
import { pieceObjects, setDirectorActive } from '../camera.ts';
import { routeBetween } from '../layout.ts';
import { shapeOf } from '../../../../shared/maps.ts';
import { walk } from '../../../../shared/route.ts';
import { poseRig } from '../characters/Figure.tsx';
import {
  askSkip, holdPiece, jailDoor, overlayLeaving, releasePiece, setCutsceneOwnsCamera, setOverlay, takeSkip, type OverlayBeat,
} from './store.ts';
import { CastLoader, CastWarmup, PieceDouble, castReady, newDouble, preloadCast, restPose } from './actors.tsx';
import { BankruptScene, JackpotScene, JailScene, WinnerScene, type LostProp, type Run, type SceneCtx, type SceneUpdate, type Shot } from './scenes.tsx';
import { easeInOut, seg, yawOf } from './util.ts';

interface Spec {
  title: string;
  subtitle: (run: Run) => string;
  /** Low graphics start this far in (the opening shot is skipped). */
  lowOffset: number;
  titleAt: number;
  titleMs: number;
  siren: number;
  beats: OverlayBeat[];
  /** The piece is taken over as soon as the cue arrives (it would otherwise visibly teleport or fall over first). */
  early: boolean;
  /** Needs cops.glb. */
  cast: boolean;
}

const SPECS: Record<CutsceneKind, Spec> = {
  jail: {
    title: 'BUSTED!', subtitle: r => `${r.player.name} is going to jail`, lowOffset: 1700, titleAt: 250, titleMs: 1900,
    siren: 3600, beats: [{ at: 4700, text: 'CLANG!' }], early: true, cast: true,
  },
  bankrupt: {
    title: 'BANKRUPT!', subtitle: r => `${r.player.name} is out of the game`, lowOffset: 1900, titleAt: 200, titleMs: 2100,
    siren: 0, beats: [{ at: 2550, text: 'HONK!' }], early: true, cast: true,
  },
  winner: {
    title: 'WINNER!', subtitle: r => `${r.player.name} takes the game`, lowOffset: 0, titleAt: 900, titleMs: 3400,
    siren: 0, beats: [], early: false, cast: true,
  },
  jackpot: {
    title: 'JACKPOT!', subtitle: r => `${r.player.name} scoops ${r.currency}${(r.cue.amount ?? 0).toLocaleString()}`, lowOffset: 0,
    titleAt: 200, titleMs: 2300, siren: 0, beats: [{ at: 450, text: 'KA-CHING!' }], early: false, cast: false,
  },
};

/** The glide home at the end, and after a skip. */
const OUT_MS = 650;
const SKIP_MS = 380;
/** Never wait longer than this past the planned start for cops.glb to arrive. */
const CAST_WAIT_MS = 2500;
/** The HUD is held this far ahead, renewed every frame, so a skip frees it at once. */
const HOLD_AHEAD_MS = 400;
const HOP_MS = 190;

interface Live {
  run: Run;
  stage: 'pending' | 'playing' | 'skipping';
  /** The double stands in for the piece from the cue (SPECS early), not just once it plays. */
  early: boolean;
  notBefore: number;
  startAt: number;
  skipAt: number;
  leaving: boolean;
  /** How far ahead the HUD is held (renewed as it plays). */
  heldTo: number;
  homePos: Vector3;
  homeTarget: Vector3;
  outPos: Vector3;
  outTarget: Vector3;
}

interface Stage { run: Run; playing: boolean }

let seqCounter = 0;
/** ?perf: play a cutscene on demand (window.__yotCutscene). */
let force: ((kind: CutsceneKind, id?: string) => void) | null = null;
let debug: (() => unknown) | null = null;
if (typeof window !== 'undefined' && location.search.includes('perf')) {
  Object.assign(window, { __yotCutscene: (kind: CutsceneKind, id?: string) => force?.(kind, id), __yotCine: () => debug?.() });
}

/** Where a piece sent to jail was caught: the space its roll landed on (Go To Jail, a card), or where it stood. */
function arrestTile(before: GameView, after: GameView, was: PlayerState, n: number): number {
  if (after.rollSeq === before.rollSeq || !after.dice) return was.position;
  const [a, b] = after.dice;
  // Third doubles in a row: arrested on the spot, no move.
  if (a === b && before.doublesCount >= 2) return was.position;
  const extra = typeof after.speed === 'number' ? after.speed : 0;
  // Round the loop, and on a board with a lane the way the points sent it.
  return walk(shapeOf(n), was.position, a + b + extra, after.points === 'lane').at(-1) ?? was.position;
}

/**
 * A move that sends `id` to jail after a card was drawn on the way ("Go to
 * Jail", or "go back 3" onto Go To Jail): when the card has been turned over
 * and read and the arrest can start (the jail leg's planned start,
 * three/sequence.ts), and the square the piece is caught on. Null for any
 * other arrest.
 */
function cardArrest(before: GameView, after: GameView, id: string): { at: number; tile: number } | null {
  if (!after.lastMove || after.lastMove.seq === before.lastMove?.seq) return null;
  const plan = stageView(after);
  if (!plan || plan.initial || plan.player !== id) return null;
  const i = plan.legs.findIndex(l => l.kind === 'jail');
  const drawn = plan.legs.slice(0, Math.max(0, i)).filter(l => l.cardAt !== undefined).at(-1);
  if (i <= 0 || !drawn) return null;
  return { at: Math.max(drawn.cardAt! + CARD_MS, plan.legs[i].t0), tile: plan.legs[i - 1].to };
}

/** A bankrupt player's houses, hotels and deeds just before they went (what the tow truck takes). */
function lostProps(before: GameView, id: string): LostProp[] {
  const out: LostProp[] = [];
  const owned = Object.values(before.owned).filter(o => o.owner === id);
  for (const o of owned) if (o.houses === 5) out.push('hotel');
  for (const o of owned) for (let k = 0; k < o.houses && o.houses < 5; k++) out.push('house');
  for (let k = 0; k < owned.length; k++) out.push('deed');
  while (out.length < 2) out.push('deed');
  return out.slice(0, 4);
}

export function Cutscenes({ game, n, enabled, low, currency, houseColor, hotelColor, jailCell }: {
  game: GameView; n: number;
  /** The 🎬 cinematic toggle. */
  enabled: boolean;
  /** Low graphics: shorter cuts, fewer actors. */
  low: boolean;
  currency: string; houseColor: string; hotelColor: string;
  jailCell: boolean;
}) {
  const { camera, controls } = useThree() as unknown as {
    camera: PerspectiveCamera;
    controls: { target: Vector3; enabled: boolean } | null;
  };
  const [stage, setStage] = useState<Stage | null>(null);
  // One double for the whole game, re-dressed for each cutscene (and hidden between them).
  const dbl = useMemo(newDouble, []);
  const [look, setLook] = useState<{ character: CharacterId; color: string; chogToken?: number } | null>(null);
  const live = useRef<Live | null>(null);
  /** Cutscenes to play once this one is over (a game-ending bankruptcy: the winner's, after it). */
  const queued = useRef<{ cue: CutsceneCue; game: GameView }[]>([]);
  const prev = useRef<{ snap: CutsceneSnap; game: GameView } | null>(null);
  const update = useRef<SceneUpdate | null>(null);
  const cam = useMemo<Shot>(() => ({ pos: new Vector3(), target: new Vector3(), shake: 0 }), []);
  const ctx = useMemo<SceneCtx | null>(() => (stage?.playing ? { run: stage.run, cam, update } : null), [stage, cam]);
  const props = useRef({ n, low, currency, houseColor, hotelColor, jailCell });
  props.current = { n, low, currency, houseColor, hotelColor, jailCell };

  const begin = (cue: CutsceneCue, before: GameView, after: GameView) => {
    const p = after.players.find(x => x.id === cue.player);
    if (!p || live.current) return;
    const was = before.players.find(x => x.id === p.id) ?? p;
    const spec = SPECS[cue.kind];
    const { n, low, currency, houseColor, hotelColor, jailCell } = props.current;
    const now = performance.now();
    const rolled = after.rollSeq !== before.rollSeq;
    const settle = rolled ? Math.max(now, diceSettleAt()) : now;
    // Arrested by a card: the piece walks to it and the card is read first, then the arrest, there.
    const byCard = cue.kind === 'jail' ? cardArrest(before, after, p.id) : null;
    const early = spec.early && !byCard;
    // Taken over early (jail, bankrupt): no walk to wait for. Otherwise let it walk there first.
    const steps = routeBetween(was.position, p.position, n).length;
    const walk = early || steps === 0 ? 0 : steps <= 12 ? steps * HOP_MS + 350 : 900;
    const real = pieceObjects.get(p.id);
    const offset = low ? spec.lowOffset : 0;
    const run: Run = {
      seq: ++seqCounter, cue, n, low, offset, dur: CUTSCENE_MS[cue.kind] - offset,
      player: { id: p.id, character: p.character, color: p.color, name: p.name },
      tile: byCard ? byCard.tile : cue.kind === 'jail' ? arrestTile(before, after, was, n) : p.position,
      from: new Vector3(real?.position.x ?? 0, 0, real?.position.z ?? 0),
      scale: real?.children[0]?.scale.x || 1.7,
      items: cue.kind === 'bankrupt' ? lostProps(before, p.id) : [],
      jailCell, houseColor, hotelColor, currency, dbl,
    };
    if (look?.character !== p.character || look.color !== p.color || look.chogToken !== p.chogToken) {
      setLook({ character: p.character, color: p.color, chogToken: p.chogToken });
    }
    dbl.tinter?.set(0, 1);
    live.current = {
      run, stage: 'pending', early, notBefore: byCard ? Math.max(settle, byCard.at) : settle + walk, startAt: 0, skipAt: 0, leaving: false, heldTo: now + HOLD_AHEAD_MS,
      homePos: new Vector3(), homeTarget: new Vector3(), outPos: new Vector3(), outTarget: new Vector3(),
    };
    takeSkip(); // a stale tap from the last one does not skip this one
    if (spec.cast) preloadCast();
    if (early) holdPiece(p.id);
    // Waiting on a walk and a card: the camera follows them as usual until the arrest.
    if (!byCard) setCutsceneOwnsCamera(true);
    holdUntil(now + HOLD_AHEAD_MS);
    setStage({ run, playing: false });
  };

  // Spot the moment in each new state.
  useEffect(() => {
    const snap = cutsceneSnap(game);
    const was = prev.current;
    prev.current = { snap, game };
    if (!was || !enabled) { queued.current = []; return; }
    const [cue, ...then] = pickCutscenes(was.snap, snap);
    if (!cue) return;
    if (live.current) {
      // Busy with another: the winner's still plays after it (the game is over, nothing else
      // comes next); anything else would run late against the turn clock, so it is let go.
      const win = [cue, ...then].find(c => c.kind === 'winner');
      if (win && !queued.current.some(q => q.cue.kind === 'winner')) queued.current.push({ cue: win, game });
      return;
    }
    queued.current = then.map(c => ({ cue: c, game }));
    begin(cue, was.game, game);
  }, [game, enabled]);

  useEffect(() => {
    force = (kind, id) => {
      const g = prev.current?.game;
      const who = g?.players.find(p => p.id === (id ?? g.current));
      if (g && who && !live.current) begin({ kind, player: who.id, amount: 500 }, g, g);
    };
    debug = () => ({
      stage: live.current?.stage, t: live.current?.stage === 'playing' ? performance.now() - live.current.startAt : null,
      camera: camera.position.toArray(), target: controls?.target.toArray(), shot: [cam.pos.toArray(), cam.target.toArray()],
    });
    return () => { force = null; debug = null; };
  });

  // Esc skips (a tap on the overlay does too, see Overlay.tsx).
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && live.current) askSkip(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const finish = () => {
    const L = live.current;
    if (!L) return;
    live.current = null;
    update.current = null;
    releasePiece(L.run.player.id);
    jailDoor.angle = null;
    setOverlay(null);
    setCutsceneOwnsCamera(false);
    if (L.stage !== 'pending' && controls) {
      camera.position.copy(L.homePos);
      controls.target.copy(L.homeTarget);
      camera.lookAt(controls.target);
      setDirectorActive(false);
    }
    setStage(null);
    // Next in line (the winner's, after a game-ending bankruptcy), straight away.
    const next = queued.current.shift();
    if (next && enabled) begin(next.cue, next.game, next.game);
  };

  const skip = (L: Live, now: number) => {
    if (L.stage === 'pending') { finish(); return; }
    L.stage = 'skipping';
    L.skipAt = now;
    L.outPos.copy(camera.position);
    if (controls) L.outTarget.copy(controls.target);
    update.current = null;
    releasePiece(L.run.player.id);
    jailDoor.angle = null;
    overlayLeaving();
    setStage(null);
  };

  // Leaving the game mid-cutscene: let go of everything.
  useEffect(() => () => {
    const L = live.current;
    if (!L) return;
    releasePiece(L.run.player.id);
    jailDoor.angle = null;
    setOverlay(null);
    setCutsceneOwnsCamera(false);
    if (L.stage !== 'pending') setDirectorActive(false);
    live.current = null;
  }, []);

  useFrame((state, delta) => {
    const L = live.current;
    // The double shows while it stands in for the piece: from the cue for jail and bankrupt, else from the start.
    if (dbl.root) dbl.root.visible = !!L && L.stage !== 'skipping' && (L.stage === 'playing' || L.early);
    if (!L || !controls) return;
    const now = performance.now();
    const dt = Math.min(delta, 0.1);
    const r = L.run;
    const spec = SPECS[r.cue.kind];
    if ((!enabled || takeSkip()) && L.stage !== 'skipping') skip(L, now);
    if (!live.current) return;
    if (L.stage !== 'skipping' && now + HOLD_AHEAD_MS / 2 > L.heldTo) {
      L.heldTo = now + HOLD_AHEAD_MS;
      holdUntil(L.heldTo);
    }

    if (L.stage === 'pending') {
      // Standing in for the piece where it is, until the dice and the walk are done.
      if (L.early) idle(r, camera, state.clock.elapsedTime, dt);
      const ready = !spec.cast || castReady() || now > L.notBefore + CAST_WAIT_MS;
      if (now < L.notBefore || !ready) return;
      L.stage = 'playing';
      L.startAt = now;
      L.homePos.copy(camera.position);
      L.homeTarget.copy(controls.target);
      setCutsceneOwnsCamera(true);
      if (!L.early) {
        const real = pieceObjects.get(r.player.id);
        if (real) { r.from.set(real.position.x, 0, real.position.z); r.scale = real.children[0]?.scale.x || r.scale; }
      }
      cam.pos.copy(camera.position);
      cam.target.copy(controls.target);
      cam.shake = 0;
      controls.enabled = false;
      setDirectorActive(true);
      holdPiece(r.player.id);
      const beats = spec.beats.map(b => ({ at: b.at - r.offset, text: b.text })).filter(b => b.at >= 0);
      setOverlay({
        seq: r.seq, kind: r.cue.kind, title: spec.title, subtitle: spec.subtitle(r), color: r.player.color,
        titleAt: Math.max(0, spec.titleAt - r.offset), titleMs: spec.titleMs,
        sirenUntil: r.low ? 0 : Math.max(0, spec.siren - r.offset), beats, dur: r.dur, leaving: false,
      });
      setStage({ run: r, playing: true });
      return;
    }

    if (L.stage === 'skipping') {
      const k = easeInOut(seg(now - L.skipAt, 0, SKIP_MS));
      camera.position.lerpVectors(L.outPos, L.homePos, k);
      controls.target.lerpVectors(L.outTarget, L.homeTarget, k);
      camera.lookAt(controls.target);
      if (k >= 1) finish();
      return;
    }

    const t = now - L.startAt;
    if (t >= r.dur) { finish(); return; }
    // Kept claimed every frame: a camera shot cut short in the same frame may have let go of it.
    setDirectorActive(true);
    controls.enabled = false;
    // The scene mounts a frame after the start: hold the camera still until it has posed.
    if (!update.current) return;
    update.current(t + r.offset, dt, state.clock.elapsedTime);
    const k = easeInOut(seg(t, r.dur - OUT_MS, r.dur));
    if (k > 0 && !L.leaving) { L.leaving = true; overlayLeaving(); }
    camera.position.lerpVectors(cam.pos, L.homePos, k);
    controls.target.lerpVectors(cam.target, L.homeTarget, k);
    if (cam.shake > 0) {
      const s = cam.shake * (1 - k);
      camera.position.x += (Math.random() - 0.5) * s;
      camera.position.y += (Math.random() - 0.5) * s;
    }
    // No controls.update(): it would clamp the close shots to the table view's limits.
    camera.lookAt(controls.target);
  });

  const run = stage?.run;
  const spec = run ? SPECS[run.cue.kind] : null;
  return (
    <>
      <CastWarmup currency={currency} />
      {run && spec?.cast && <Suspense fallback={null}><CastLoader /></Suspense>}
      {look && <PieceDouble key={look.chogToken ?? 0} d={dbl} character={look.character} color={look.color} chogToken={look.chogToken} />}
      {ctx && ctx.run.cue.kind === 'jail' && <JailScene key={ctx.run.seq} ctx={ctx} />}
      {ctx && ctx.run.cue.kind === 'bankrupt' && <BankruptScene key={ctx.run.seq} ctx={ctx} />}
      {ctx && ctx.run.cue.kind === 'winner' && <WinnerScene key={ctx.run.seq} ctx={ctx} />}
      {ctx && ctx.run.cue.kind === 'jackpot' && <JackpotScene key={ctx.run.seq} ctx={ctx} />}
    </>
  );
}

/** The double, standing where the hidden piece is, breathing and facing the camera, until the cutscene starts. */
function idle(r: Run, camera: PerspectiveCamera, time: number, dt: number) {
  const d = r.dbl;
  if (!d.root || !d.yaw || !d.lean || !d.scale) return;
  const real = pieceObjects.get(r.player.id);
  if (real) d.root.position.set(real.position.x, 0, real.position.z);
  d.yaw.rotation.y = yawOf(camera.position.x - d.root.position.x, camera.position.z - d.root.position.z);
  d.lean.rotation.x = 0;
  d.scale.scale.setScalar(r.scale);
  restPose(d.pose, time, dt);
  poseRig(d.rig, d.pose);
}
