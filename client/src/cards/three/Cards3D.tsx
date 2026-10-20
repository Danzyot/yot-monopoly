// Every card on the 3D table in one instanced draw: the draw pile's top card
// (over a block of card edges that shrinks as the deck runs down), the
// discard pile (the last few plays, each landed where it fell), each
// opponent's hand fanned in front of them, and the cards in flight. Flights
// are read straight off the staged play (cards/sequence.ts) on the clock, so
// a card leaves our hand the moment the step starts and lands as it ends,
// when the pose (the top card, the counts) moves on; nothing here is state
// that could drift from the table.

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import {
  CylinderGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Vector3, type Mesh,
} from 'three';
import { CARDS_DEAL_FLY_MS, CARDS_DRAW_GAP_MS, CARDS_DRAW_MS } from '../../../../shared/cards/pacing.ts';
import type { Card } from '../../../../shared/cards/deck.ts';
import type { CardsStep } from '../../../../shared/cards/types.ts';
import type { StagedPlay, StagedStep } from '../sequence.ts';
import { cardGeometry, cardMaterial, type CardAtlas, type UvRect } from './cardAtlas.ts';
import { CARD_STEP, DISCARD, FAN_SCALE, FELT_Y, FLIGHT_ARC, PILE, fanCard, flatQuat, hash01, screenToTable } from './layout.ts';
import { easeOut, seg, smooth, type SceneState } from './state.ts';

const CAP = 256;
/** Plays kept on the discard pile. */
const MAX_STACK = 7;
/** Cards shown in a fan (the chip shows the true count). */
const MAX_FAN = 10;
/** The pile's block never shows more than this many cards' worth of edges. */
const PILE_SHOW = 36;

interface Landed { card: Card; yaw: number; dx: number; dz: number }

const m4 = new Matrix4();
const pos = new Vector3(), from = new Vector3(), to = new Vector3(), scl = new Vector3(1, 1, 1);
const q = new Quaternion(), qFrom = new Quaternion(), qTo = new Quaternion(), qDown = new Quaternion();
flatQuat(0, false, qDown);

function landYaw(card: Card, seq: number) { return (hash01(card.id * 131 + seq) - 0.5) * 0.7; }
function landDx(card: Card, seq: number) { return (hash01(card.id * 17 + seq * 3 + 1) - 0.5) * 0.18; }
function landDz(card: Card, seq: number) { return (hash01(card.id * 29 + seq * 7 + 2) - 0.5) * 0.18; }

/** Draw the discard pile's cards as they landed, the newest on top. */
function discardTop(stackSize: number, out = pos) {
  return out.copy(DISCARD).setY(FELT_Y + 0.004 + (stackSize + 1) * CARD_STEP);
}

export function pileHeight(drawCount: number) {
  return Math.max(0, Math.min(PILE_SHOW, drawCount)) * CARD_STEP;
}

/** A fan slot's pose, `k` of `n` (capped at the fan's size). */
function fanSlot(angle: number, k: number, n: number, outPos: Vector3, outQ: Quaternion) {
  const shown = Math.min(n, MAX_FAN);
  fanCard(angle, Math.min(k, shown - 1), shown, outPos, outQ);
}

export function CardsLayer({ atlas, state, castShadow }: { atlas: CardAtlas; state: RefObject<SceneState | null>; castShadow: boolean }) {
  const { camera, gl } = useThree();
  const mesh = useRef<InstancedMesh>(null);
  const block = useRef<Mesh>(null);
  const halo = useRef<Mesh>(null);
  const { geo, faces } = useMemo(() => cardGeometry(CAP), []);
  const mat = useMemo(() => cardMaterial(atlas), [atlas]);
  const blockMat = useMemo(() => new MeshStandardMaterial({ color: '#d9ccb2', roughness: 0.95 }), []);
  const haloMat = useMemo(() => new MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0, depthWrite: false }), []);
  const blockGeo = useMemo(() => new CylinderGeometry(0.72, 0.72, 1, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 1.5 / 1.0), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); blockMat.dispose(); haloMat.dispose(); blockGeo.dispose(); }, [geo, mat, blockMat, haloMat, blockGeo]);

  // The discard pile as it fell.
  const stack = useRef<Landed[]>([]);
  const seen = useRef<{ seq: number; done: Set<number> }>({ seq: -1, done: new Set() });

  useFrame(({ clock }) => {
    const im = mesh.current;
    const st = state.current;
    if (!im || !st) return;
    const now = performance.now();
    const { frame, view, me, angles, reduced } = st;
    const play = frame.play;
    const stk = stack.current;
    const push = (card: Card, seq: number) => {
      stk.push({ card, yaw: landYaw(card, seq), dx: landDx(card, seq), dz: landDz(card, seq) });
      if (stk.length > MAX_STACK) stk.shift();
    };

    // ---- what has landed on the discard pile ----
    if (play) {
      const s = seen.current;
      if (s.seq !== play.seq) {
        s.seq = play.seq;
        s.done.clear();
        // Start from the table as it was before this play (joined mid-game, a dropped queue).
        const b = play.before.top;
        if (!b) stk.length = 0;
        else if (stk.at(-1)?.card.id !== b.id) { stk.length = 0; push(b, 0); }
      }
      for (const step of play.steps) {
        if (step.end > now || s.done.has(step.index)) continue;
        s.done.add(step.index);
        const t = step.step;
        if (t.type === 'deal') stk.length = 0;
        else if (t.type === 'flip') { if (!t.back) push(t.card, play.seq); }
        else if (t.type === 'play') push(t.card, play.seq);
        else if (t.type === 'purge') for (const c of t.cards) push(c, play.seq);
        else if (t.type === 'reshuffle') stk.splice(0, Math.max(0, stk.length - 1));
      }
    } else {
      const top = frame.top;
      if (!top) stk.length = 0;
      else if (stk.at(-1)?.card.id !== top.id) { stk.length = 0; push(top, view.seq); }
    }

    let n = 0;
    const put = (rect: UvRect) => {
      if (n >= CAP) return;
      m4.compose(pos, q, scl);
      im.setMatrixAt(n, m4);
      faces.setXYZW(n, rect.x, rect.y, rect.w, rect.h);
      n++;
    };
    scl.set(1, 1, 1);

    // ---- the draw pile: a block of edges and the top card, face down ----
    const h = pileHeight(view.drawCount);
    const bl = block.current;
    if (bl) {
      bl.visible = h > 0;
      bl.scale.y = Math.max(0.001, h);
      bl.position.set(PILE.x, FELT_Y + h / 2, PILE.z);
    }
    if (view.drawCount > 0) {
      pos.copy(PILE).setY(FELT_Y + h + 0.004);
      q.copy(qDown);
      put(atlas.back);
    }
    const hl = halo.current;
    if (hl) {
      const want = st.canDraw && !frame.busy ? 0.55 + Math.sin(clock.elapsedTime * 5) * 0.25 : 0;
      haloMat.opacity += (want - haloMat.opacity) * 0.2;
      hl.visible = haloMat.opacity > 0.02;
      hl.position.set(PILE.x, FELT_Y + 0.002, PILE.z);
      const k = 1 + ((clock.elapsedTime * 0.8) % 1) * 0.12;
      hl.scale.set(k, k, 1);
    }

    // ---- the discard pile ----
    stk.forEach((l, i) => {
      pos.set(DISCARD.x + l.dx, FELT_Y + 0.004 + (i + 1) * CARD_STEP, DISCARD.z + l.dz);
      flatQuat(l.yaw, true, q);
      put(atlas.rect(l.card));
    });

    // ---- each opponent's hand, fanned ----
    const fans: { id: string; count: number }[] = [];
    for (const p of view.players) {
      if (p.id === me || p.left) continue;
      const count = frame.counts[p.id] ?? p.cards;
      if (count > 0 && st.podium !== p.id) fans.push({ id: p.id, count });
    }

    // ---- cards in flight ----
    if (play && !reduced) {
      for (const s of play.steps) {
        if (s.at > now || now >= s.end) continue;
        flyStep(s, play, st, now, put, atlas, camera, gl.domElement, stk.length, fans);
      }
    }
    scl.set(FAN_SCALE, FAN_SCALE, 1);
    for (const f of fans) {
      const angle = angles.get(f.id) ?? 0;
      const shown = Math.min(f.count, MAX_FAN);
      for (let k = 0; k < shown; k++) {
        fanCard(angle, k, shown, pos, q);
        put(atlas.back);
      }
    }
    scl.set(1, 1, 1);

    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    faces.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={mesh} args={[geo, mat, CAP]} count={0} frustumCulled={false} castShadow={castShadow} receiveShadow />
      <mesh ref={block} geometry={blockGeo} material={blockMat} castShadow={castShadow} receiveShadow
        onClick={e => { e.stopPropagation(); const s = state.current; if (s?.canDraw && !s.frame.busy) s.onDraw(); }}
        onPointerOver={() => { if (state.current?.canDraw) document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = ''; }} />
      <mesh ref={halo} material={haloMat} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.85, 1.05, 48]} />
      </mesh>
    </>
  );
}

// ---- flights --------------------------------------------------------------------
// Each kind of step that moves cards, drawn at `now`. A flight eases out of its
// start, arcs up, and lands with a slap: a touch of overshoot in scale that
// settles in the last fifth of the trip.

type Put = (rect: UvRect) => void;

const handRect = { x: 0, y: 0 };

/** Where our hand is on screen (its middle, a little below its top edge), in viewport pixels. */
function ourHand(st: SceneState, canvas: HTMLElement) {
  const r = st.handEl.current?.getBoundingClientRect();
  if (r && r.width > 0) { handRect.x = r.left + r.width / 2; handRect.y = r.top + Math.min(60, r.height * 0.4); return handRect; }
  const c = canvas.getBoundingClientRect();
  handRect.x = c.left + c.width / 2;
  handRect.y = c.bottom + 40;
  return handRect;
}

/** The arc from `from` to `to` at eased progress `e`, written to `pos`. */
function arc(e: number, lift: number) {
  pos.lerpVectors(from, to, e);
  pos.y += Math.sin(Math.PI * e) * lift;
}

/** Slap: the card grows a touch as it comes down and snaps back as it lands. */
function slap(t: number) {
  const k = seg(t, 0.72, 1);
  const s = k < 0.6 ? 1 + 0.16 * Math.sin((Math.PI * k) / 0.6) : 1 - 0.05 * Math.sin((Math.PI * (k - 0.6)) / 0.4);
  scl.set(s, s, 1);
}

function flyStep(
  s: StagedStep, play: StagedPlay, st: SceneState, now: number, put: Put, atlas: CardAtlas,
  camera: import('three').Camera, canvas: HTMLElement, stackSize: number, fans: { id: string; count: number }[],
) {
  const step: CardsStep = s.step;
  const dur = Math.max(1, s.end - s.at);
  const t = (now - s.at) / dur;
  const { me, angles } = st;
  const angleOf = (id: string) => angles.get(id) ?? Math.PI * 1.5;
  switch (step.type) {
    case 'play': {
      const mine = step.player === me;
      if (mine) {
        const r = st.handRects.get(step.card.id);
        const h = ourHand(st, canvas);
        screenToTable(r ? r.left + r.width / 2 : h.x, r ? r.top + r.height / 2 : h.y, canvas, camera, FELT_Y + 1.3, from);
        qFrom.copy(camera.quaternion);
      } else {
        const a = angleOf(step.player);
        const fan = fans.find(f => f.id === step.player);
        const shown = Math.min((fan?.count ?? 0) + 1, MAX_FAN);
        fanCard(a, Math.floor(shown / 2), shown, from, qFrom, 0.1);
      }
      discardTop(stackSize, to);
      to.x += landDx(step.card, play.seq);
      to.z += landDz(step.card, play.seq);
      flatQuat(landYaw(step.card, play.seq), true, qTo);
      const e = easeOut(t);
      arc(e, mine ? 0.9 : FLIGHT_ARC * 0.8);
      q.slerpQuaternions(qFrom, qTo, smooth(t * 1.15));
      slap(t);
      if (!mine) { const g = FAN_SCALE + (1 - FAN_SCALE) * Math.min(1, t * 2); scl.x *= g; scl.y *= g; }
      put(atlas.rect(step.card));
      scl.set(1, 1, 1);
      return;
    }
    case 'flip': {
      // Up off the pile, over, and down on the discard (a Wild Draw Four goes back).
      from.copy(PILE).setY(FELT_Y + pileHeight(st.view.drawCount) + 0.02);
      discardTop(stackSize, to);
      const back = !!step.back;
      const e = back ? Math.sin(Math.PI * t) : easeOut(t);
      arc(e, 1.2);
      flatQuat(back ? 0 : landYaw(step.card, play.seq), true, qTo);
      q.slerpQuaternions(qDown, qTo, back ? Math.sin(Math.PI * t) : smooth(t * 1.2));
      if (!back) slap(t);
      put(atlas.rect(step.card));
      scl.set(1, 1, 1);
      return;
    }
    case 'draw': {
      const n = Math.min(step.count, 8);
      const fly = Math.min(CARDS_DRAW_MS, dur);
      const gap = n > 1 ? Math.min(CARDS_DRAW_GAP_MS, (dur - fly) / (n - 1)) : 0;
      const mine = step.player === me;
      const a = angleOf(step.player);
      const fan = fans.find(f => f.id === step.player);
      const n0 = fan?.count ?? 0;
      for (let k = 0; k < n; k++) {
        const tk = (now - (s.at + k * gap)) / fly;
        if (tk < 0) continue;
        if (tk >= 1 && mine) continue;
        from.copy(PILE).setY(FELT_Y + pileHeight(st.view.drawCount) + 0.03);
        if (mine) {
          const h = ourHand(st, canvas);
          screenToTable(h.x + (k - (n - 1) / 2) * 30, h.y, canvas, camera, FELT_Y + 1.5, to);
          qTo.copy(camera.quaternion);
        } else {
          fanSlot(a, n0 + k, n0 + n, to, qTo);
        }
        const tt = Math.min(1, tk);
        arc(easeOut(tt), mine ? 0.7 : FLIGHT_ARC * 0.6);
        q.slerpQuaternions(qDown, qTo, smooth(tt));
        if (!mine) { const g = 1 + (FAN_SCALE - 1) * tt; scl.set(g, g, 1); }
        const card = mine ? step.cards?.[k] : undefined;
        put(card ? atlas.rect(card) : atlas.back);
        scl.set(1, 1, 1);
      }
      return;
    }
    case 'deal': {
      const per = step.count;
      const seats = step.order.length;
      const n = seats * per;
      const fly = Math.min(CARDS_DEAL_FLY_MS, dur);
      const gap = n > 1 ? Math.max(8, (dur - fly) / n) : 0;
      for (let k = 0; k < n; k++) {
        const tk = (now - (s.at + k * gap)) / fly;
        if (tk < 0) break;
        const id = step.order[k % seats];
        const j = Math.floor(k / seats);
        const mine = id === me;
        if (tk >= 1 && mine) continue;
        from.copy(PILE).setY(FELT_Y + pileHeight(st.view.drawCount) + 0.03);
        if (mine) {
          const h = ourHand(st, canvas);
          screenToTable(h.x + (j - (per - 1) / 2) * 22, h.y, canvas, camera, FELT_Y + 1.5, to);
          qTo.copy(camera.quaternion);
        } else {
          fanSlot(angleOf(id), j, per, to, qTo);
        }
        const tt = Math.min(1, tk);
        arc(easeOut(tt), mine ? 0.6 : FLIGHT_ARC * 0.55);
        q.slerpQuaternions(qDown, qTo, smooth(tt));
        if (!mine) { const g = 1 + (FAN_SCALE - 1) * tt; scl.set(g, g, 1); }
        put(atlas.back);
        scl.set(1, 1, 1);
      }
      return;
    }
    case 'purge': {
      // The cleared colour pours out of the hand onto the discard, one after another, face up.
      const mine = step.player === me;
      const n = Math.min(step.cards.length, 8);
      const fly = Math.min(520, dur);
      const gap = n > 1 ? (dur - fly) / (n - 1) : 0;
      const fan = fans.find(f => f.id === step.player);
      for (let k = 0; k < n; k++) {
        const card = step.cards[k];
        const tk = (now - (s.at + k * gap)) / fly;
        if (tk < 0 || tk >= 1) continue;
        if (mine) {
          const r = st.handRects.get(card.id);
          const h = ourHand(st, canvas);
          screenToTable(r ? r.left + r.width / 2 : h.x, r ? r.top + r.height / 2 : h.y, canvas, camera, FELT_Y + 1.3, from);
          qFrom.copy(camera.quaternion);
        } else {
          const shown = Math.min((fan?.count ?? 0) + n, MAX_FAN);
          fanCard(angleOf(step.player), Math.min(k, shown - 1), shown, from, qFrom, 0.1);
        }
        discardTop(stackSize + k, to);
        to.x += landDx(card, play.seq);
        to.z += landDz(card, play.seq);
        flatQuat(landYaw(card, play.seq) + (k - n / 2) * 0.35, true, qTo);
        arc(easeOut(tk), mine ? 0.8 : FLIGHT_ARC * 0.7);
        q.slerpQuaternions(qFrom, qTo, smooth(tk * 1.15));
        slap(tk);
        if (!mine) { const g = FAN_SCALE + (1 - FAN_SCALE) * Math.min(1, tk * 2); scl.x *= g; scl.y *= g; }
        put(atlas.rect(card));
        scl.set(1, 1, 1);
      }
      return;
    }
    case 'mercy': {
      // Knocked out: the hand goes back, face down, under the draw pile.
      const n = Math.min(step.count, 10);
      const mine = step.player === me;
      for (let k = 0; k < n; k++) {
        const tk = seg(t, k * 0.05, k * 0.05 + 0.45);
        if (tk <= 0 || tk >= 1) continue;
        if (mine) { const h = ourHand(st, canvas); screenToTable(h.x + (k - n / 2) * 24, h.y, canvas, camera, FELT_Y + 1.4, from); qFrom.copy(camera.quaternion); }
        else fanSlot(angleOf(step.player), k, n, from, qFrom);
        to.copy(PILE).setY(FELT_Y + 0.02);
        arc(easeOut(tk), FLIGHT_ARC * 0.9);
        q.slerpQuaternions(qFrom, qDown, smooth(tk));
        const g = mine ? 1 : FAN_SCALE + (1 - FAN_SCALE) * tk;
        scl.set(g, g, 1);
        put(atlas.back);
        scl.set(1, 1, 1);
      }
      return;
    }
    case 'reshuffle': {
      // The discard pile (bar its top card) sweeps back into the draw pile.
      const n = 6;
      for (let k = 0; k < n; k++) {
        const tk = seg(t, k * 0.08, k * 0.08 + 0.55);
        if (tk >= 1) continue;
        from.copy(DISCARD).setY(FELT_Y + 0.02 + k * CARD_STEP);
        to.copy(PILE).setY(FELT_Y + pileHeight(st.view.drawCount) + 0.05 + k * CARD_STEP);
        arc(easeOut(tk), 0.8 + k * 0.08);
        flatQuat((k - 3) * 0.2, false, qTo);
        q.slerpQuaternions(qDown, qTo, tk);
        put(atlas.back);
      }
      return;
    }
    case 'swap':
    case 'rotate': {
      // A few backs cross between the seats involved.
      const pairs: [string, string][] = [];
      if (step.type === 'swap') pairs.push([step.player, step.target], [step.target, step.player]);
      else {
        const alive = st.view.players.filter(p => !p.left).map(p => p.id);
        const m = alive.length;
        alive.forEach((id, i) => pairs.push([id, alive[((i + step.direction) % m + m) % m]]));
      }
      for (const [a, b] of pairs) {
        for (let k = 0; k < 3; k++) {
          const tk = seg(t, 0.1 + k * 0.1, 0.75 + k * 0.08);
          if (tk <= 0 || tk >= 1) continue;
          const fa = angleOf(a), fb = angleOf(b);
          if (a === me) { const h = ourHand(st, canvas); screenToTable(h.x, h.y, canvas, camera, FELT_Y + 1.4, from); qFrom.copy(camera.quaternion); }
          else fanSlot(fa, k, 3, from, qFrom);
          if (b === me) { const h = ourHand(st, canvas); screenToTable(h.x, h.y, canvas, camera, FELT_Y + 1.4, to); qTo.copy(camera.quaternion); }
          else fanSlot(fb, k, 3, to, qTo);
          arc(smooth(tk), FLIGHT_ARC + k * 0.2);
          q.slerpQuaternions(qFrom, qTo, tk);
          scl.set(FAN_SCALE, FAN_SCALE, 1);
          put(atlas.back);
          scl.set(1, 1, 1);
        }
      }
      return;
    }
    default:
      return;
  }
}
