// The camera: a gentle view across the table from our seat, pushed in a
// touch on our turn, and a brief dramatic cut for a Draw Four challenge and
// the round win (the cutscene overlay from three/cinematics: letterbox, title
// card, tap or Esc to skip). When the match is won the camera circles the
// table while the winner dances in the middle (the podium), then the results
// show. With prefers-reduced-motion there are no cuts and moves are instant.

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, type RefObject } from 'react';
import { Vector3, type PerspectiveCamera } from 'three';
import { CARDS_PODIUM_MS } from '../../../../shared/cards/pacing.ts';
import { matchLabel } from '../../../../shared/cards/room.ts';
import { askSkip, overlayLeaving, setOverlay, takeSkip } from '../../three/cinematics/store.ts';
import { WIN_MS } from '../../three/characters/moves.ts';
import { CENTRE, DISCARD, FELT_Y, ROW_ARC, SEAT_R, seatPos } from './layout.ts';
import { easeOut, smooth, type SceneState } from './state.ts';
import { celebrate } from './TableFx.tsx';

interface Cut {
  start: number;
  dur: number;
  /** Our own figure is in shot. */
  me: boolean;
  /** Jump straight to the first frame (a cut), then dolly. */
  fresh: boolean;
  pos(t: number, out: Vector3): void;
  target(t: number, out: Vector3): void;
}

const pos = new Vector3(), tgt = new Vector3();
let overlaySeq = 0;

function card(kind: 'winner' | 'bankrupt', title: string, subtitle: string, color: string, dur: number) {
  setOverlay({ seq: ++overlaySeq, kind, title, subtitle, color, titleAt: 80, titleMs: Math.max(600, dur - 300), sirenUntil: 0, beats: [], dur, leaving: false });
}

/** Bars away, then the card gone: unless a newer card took its place meanwhile, which stays. */
function dropOverlay() {
  overlayLeaving();
  const seq = overlaySeq;
  window.setTimeout(() => { if (overlaySeq === seq) setOverlay(null); }, 520);
}

/** The resting view: across the table from our seat; portrait screens see it from higher up. */
function base(aspect: number, compact: boolean, myTurn: boolean, outPos: Vector3, outTarget: Vector3): number {
  let fov: number;
  if (compact || aspect < 1) {
    // Phones: the row of opponents along the far arc and both piles, edge to
    // edge across the width (which is what runs out on a portrait screen).
    fov = 50;
    outTarget.set(0, -0.2, -2.0);
    const halfW = SEAT_R * Math.sin(ROW_ARC) + 1.1;
    const tanH = Math.tan((fov * Math.PI) / 360) * aspect;
    const d = Math.min(30, Math.max(9, halfW / tanH));
    outPos.set(0, 1.05, 1).normalize().multiplyScalar(d).add(outTarget);
  } else {
    outPos.set(0, 6.3, 10.4);
    outTarget.set(0, -0.6, -1.9);
    fov = 38;
    // Panels at the side eat the width: back off a little when the view is narrow.
    if (aspect < 1.45) outPos.multiplyScalar(1 + (1.45 - aspect) * 0.5);
  }
  if (myTurn) {
    outPos.multiplyScalar(0.93);
    outTarget.lerp(DISCARD, 0.25);
  }
  return fov;
}

export function CardsCamera({ state, compact }: { state: RefObject<SceneState | null>; compact: boolean }) {
  const { camera, size } = useThree() as unknown as { camera: PerspectiveCamera; size: { width: number; height: number } };
  const cut = useRef<Cut | null>(null);
  const look = useRef<Vector3 | null>(null);
  const seen = useRef<{ seq: number; done: Set<number> }>({ seq: -1, done: new Set() });
  /** `cutIn`: the podium's first frame, which cuts straight to its orbit (a new shot, not a drift). */
  const podium = useRef<{ start: number; done: boolean; confetti: number; cutIn: boolean } | null>(null);
  const fov = useRef(40);

  // Esc skips a cut or the podium, like the Monopoly cutscenes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') askSkip(); };
    window.addEventListener('keydown', onKey);
    // Leaving the table: a card still on its way out is cleared now, and its timer must not clear anyone else's.
    return () => { window.removeEventListener('keydown', onKey); overlaySeq++; setOverlay(null); };
  }, []);

  useFrame((_, delta) => {
    const st = state.current;
    if (!st) return;
    const now = performance.now();
    const dt = Math.min(delta, 0.1);
    const { frame, view, me, reduced, cinematic } = st;
    /** A portrait or phone frame: cuts stand further back to keep figures whole. */
    const narrow = compact || size.width / Math.max(1, size.height) < 1;
    const name = (id: string) => view.players.find(p => p.id === id)?.name ?? '?';
    const colour = (id: string) => st.seats[id]?.color ?? '#ffd23f';
    const angle = (id: string) => st.angles.get(id) ?? Math.PI * 1.5;

    // ---- cuts, from the steps of the play staging now ----
    const play = frame.play;
    if (play && cinematic && !reduced && !st.podium) {
      const s = seen.current;
      if (s.seq !== play.seq) { s.seq = play.seq; s.done.clear(); }
      for (const step of play.steps) {
        if (step.at > now || now >= step.end || s.done.has(step.index)) continue;
        s.done.add(step.index);
        const t = step.step;
        const dur = step.end - step.at;
        if (t.type === 'challenge') {
          // Low behind the challenger's shoulder, across the table at the accused.
          const from = seatPos(angle(t.target), undefined, new Vector3());
          const at = seatPos(angle(t.player), undefined, new Vector3());
          const outward = from.clone().sub(CENTRE).setY(0).normalize();
          cut.current = {
            start: now, dur, fresh: true, me: t.player === me || t.target === me,
            pos: (k, o) => o.copy(from).addScaledVector(outward, (1.4 - 1.6 * easeOut(k)) * (narrow ? 1.6 : 1) + (narrow ? 1.8 : 0))
              .setY(FELT_Y + (narrow ? 2.9 : 2.1) - 0.4 * k),
            target: (_k, o) => o.copy(at).setY(FELT_Y + 1.1),
          };
          card('bankrupt', 'Challenge!', t.bluff ? `A bluff — ${name(t.player)} draws 4` : `It was legal — ${name(t.target)} draws 6`, colour(t.target), dur);
        } else if (t.type === 'mercy' && t.player !== me) {
          // No mercy: a quick push in on the knocked-out player as they grey.
          const at = seatPos(angle(t.player), undefined, new Vector3());
          const dir = at.clone().sub(CENTRE).setY(0).normalize();
          const far = narrow ? 1.75 : 1;
          cut.current = {
            start: now, dur, fresh: true, me: false,
            pos: (k, o) => o.copy(at).addScaledVector(dir, -(4.6 - 1.4 * smooth(k)) * far).setY(FELT_Y + 2.2 * Math.sqrt(far) + 0.3 * k),
            target: (_k, o) => o.copy(at).setY(FELT_Y + 1.0),
          };
          card('bankrupt', 'No mercy!', `${name(t.player)} hit ${t.count} cards — out of the round`, colour(t.player), dur);
        } else if (t.type === 'roundEnd') {
          // From the middle of the table, up at the winner, dollying in; a narrow
          // (portrait) frame stands further back so the whole figure stays in shot.
          const at = seatPos(angle(t.winner), undefined, new Vector3());
          const dir = at.clone().sub(CENTRE).setY(0).normalize();
          const far = narrow ? 1.75 : 1;
          cut.current = {
            start: now, dur, fresh: true, me: t.winner === me,
            pos: (k, o) => o.copy(at).addScaledVector(dir, -(4.1 - 1.2 * smooth(k)) * far).setY(FELT_Y + 2.6 * Math.sqrt(far) - 0.5 * k),
            target: (_k, o) => o.copy(at).setY(FELT_Y + 1.2),
          };
          // The match's last round: they went out, and the podium (its own title) follows.
          card('winner', t.matchOver ? `${name(t.winner)} is out!` : `${name(t.winner)} ${t.blocked ? 'takes' : 'wins'} the round!`,
            `+${t.points} points`, colour(t.winner), dur);
          celebrate(now + 100);
        }
      }
    }

    // ---- the podium ----
    if (st.podium) {
      let p = podium.current;
      if (!p) {
        p = podium.current = { start: now, done: false, confetti: 0, cutIn: true };
        cut.current = null;
        const w = st.podium;
        const r = view.history.at(-1);
        card('winner', `${name(w)} wins!`, view.rules.match === 'points' ? `${view.players.find(x => x.id === w)?.score ?? 0} points · ${matchLabel(view.rules)}` : r ? `+${r.points} points` : matchLabel(view.rules), colour(w), CARDS_PODIUM_MS);
      }
      if (now - p.confetti > WIN_MS) { p.confetti = now; celebrate(now); }
      if (!p.done && (now - p.start >= CARDS_PODIUM_MS || takeSkip())) {
        p.done = true;
        dropOverlay();
        st.onPodiumDone();
      }
    } else if (podium.current) {
      podium.current = null;
    }

    // ---- skipping and ending a cut ----
    const c = cut.current;
    if (c && (now >= c.start + c.dur || takeSkip())) {
      cut.current = null;
      dropOverlay();
    }
    if (!c && !st.podium) takeSkip();

    // ---- where the camera wants to be ----
    let want: number;
    const live = cut.current;
    if (live) {
      const k = Math.min(1, (now - live.start) / Math.max(1, live.dur));
      live.pos(k, pos);
      live.target(k, tgt);
      want = 38;
      if (live.fresh) {
        live.fresh = false;
        camera.position.copy(pos);
        (look.current ??= new Vector3()).copy(tgt);
      }
    } else if (st.podium && !reduced) {
      const k = (now - (podium.current?.start ?? now)) / 1000;
      const th = k * 0.22;
      // A slow circle round the dancing winner; wider (and higher) for a portrait frame.
      const r = narrow ? 12.5 : 8.2;
      pos.set(Math.sin(th) * r, FELT_Y + (narrow ? 5.2 : 3.6), Math.cos(th) * r + 0.3);
      tgt.set(CENTRE.x, FELT_Y + (narrow ? 1.3 : 1.0), CENTRE.z + 0.3);
      want = narrow ? 46 : 42;
      const p = podium.current;
      if (p?.cutIn) {
        p.cutIn = false;
        camera.position.copy(pos);
        (look.current ??= new Vector3()).copy(tgt);
        camera.fov = want;
        camera.updateProjectionMatrix();
      }
    } else {
      want = base(size.width / Math.max(1, size.height), compact, st.myTurn && !frame.busy, pos, tgt);
    }
    st.showMe = !!live?.me || !!st.podium;

    const f = reduced ? 1 : 1 - Math.exp(-(live ? 5 : 2.4) * dt);
    if (!look.current) {
      look.current = tgt.clone();
      camera.position.copy(pos);
    } else {
      camera.position.lerp(pos, f);
      look.current.lerp(tgt, f);
    }
    camera.lookAt(look.current);
    if (Math.abs(camera.fov - want) > 0.05) {
      camera.fov += (want - camera.fov) * (reduced ? 1 : Math.min(1, 3 * dt));
      camera.updateProjectionMatrix();
    }
    fov.current = want;
  });
  return null;
}
