// Last card, on fire: a Chog down to one card burns. Tongues of flame lick up
// round the figure, white-hot at the root, orange, then red as they rise and
// thin; embers flick up off the top, and a hot-seat glow spreads on the felt
// under them. Once they have called "Last card!" the fire burns taller and
// brighter, with a Monad-purple heart. The match's winner, about to dance, is
// spared.
//
// Two instanced meshes for the whole table, whatever the number of fires:
// the flames (upright teardrop sprites turned to the camera, nudged toward it
// so the figure does not hide them) and the glows (the hot seat lying on the
// felt, and the embers). Both add their light to the scene; no real light
// (a light would cost every material a recompile). Low quality burns fewer
// tongues; reduced motion keeps the glow and a still fire, nothing rising.

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import {
  AdditiveBlending, Color, InstancedBufferAttribute, InstancedMesh, MeshBasicMaterial, Object3D, PlaneGeometry, Quaternion,
  Vector3, type Texture,
} from 'three';
import { useCanvasTexture } from '../../three/environments/common.tsx';
import { FELT_Y, hash01, seatPos } from './layout.ts';
import type { SceneState } from './state.ts';

const MAX_SEATS = 10;
const EMBERS = 6;
const HOT = new Color('#fff6d8');
const YELLOW = new Color('#ffc21a');
const ORANGE = new Color('#ff6a0d');
const RED = new Color('#c8141c');
const MONAD = new Color('#8f6bff');
const GLOW = new Color('#ff5a0a');
const GOLD = new Color('#ffd23f');

const dummy = new Object3D();
const base = new Vector3();
const toCam = new Vector3();
const flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
const col = new Color();

/** Fire's colour `t` of the way up a tongue: white-hot, yellow, orange, then red. */
function flameColor(t: number, out: Color): Color {
  if (t < 0.15) return out.copy(HOT).lerp(YELLOW, t / 0.15);
  if (t < 0.45) return out.copy(YELLOW).lerp(ORANGE, (t - 0.15) / 0.3);
  return out.copy(ORANGE).lerp(RED, Math.min(1, (t - 0.45) / 0.45));
}

/** An instanced mesh of additive sprites, its colours allocated up front (the shader gate compiles it hidden, as it will draw). */
function sprites(map: Texture, cap: number, order: number): InstancedMesh {
  const mat = new MeshBasicMaterial({ map, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false });
  const im = new InstancedMesh(new PlaneGeometry(1, 1), mat, cap);
  im.instanceColor = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  im.count = 0;
  im.frustumCulled = false;
  im.renderOrder = order;
  im.visible = false;
  return im;
}

function dispose(im: InstancedMesh) {
  im.geometry.dispose();
  (im.material as MeshBasicMaterial).dispose();
  im.dispose();
}

export function LastCardFire({ state, lite }: { state: RefObject<SceneState | null>; lite: boolean }) {
  const per = lite ? 14 : 28;
  // A tongue of flame: a teardrop, hot and solid at its round root, soft at its tip.
  const flameTex = useCanvasTexture(64, 128, g => {
    g.filter = 'blur(3px)';
    const grad = g.createRadialGradient(32, 94, 2, 32, 86, 40);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.75)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(32, 6);
    g.bezierCurveTo(40, 40, 58, 62, 56, 92);
    g.bezierCurveTo(54, 116, 10, 116, 8, 92);
    g.bezierCurveTo(6, 62, 24, 40, 32, 6);
    g.fill();
  }, []);
  const glowTex = useCanvasTexture(128, 128, g => {
    const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.6)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.12)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }, []);
  const flames = useMemo(() => sprites(flameTex, MAX_SEATS * per, 6), [flameTex, per]);
  const glows = useMemo(() => sprites(glowTex, MAX_SEATS * (EMBERS + 1), 5), [glowTex]);
  useEffect(() => () => { dispose(flames); dispose(glows); }, [flames, glows]);
  /** Each player's fire, 0 (out) to 1 (called), eased so it flares up and dies down. */
  const heat = useRef(new Map<string, number>());

  useFrame(({ camera, clock }, delta) => {
    const st = state.current;
    if (!st) return;
    const dt = Math.min(delta, 0.1);
    const time = clock.elapsedTime;
    const { view, frame, angles, reduced } = st;
    const live = view.phase !== 'over' && view.phase !== 'roundOver';
    let nf = 0, ng = 0;
    const putFlame = (c: Color) => {
      dummy.updateMatrix();
      flames.setMatrixAt(nf, dummy.matrix);
      flames.setColorAt(nf++, c);
    };
    const putGlow = (c: Color) => {
      dummy.updateMatrix();
      glows.setMatrixAt(ng, dummy.matrix);
      glows.setColorAt(ng++, c);
    };

    view.players.forEach((p, seat) => {
      const count = frame.counts[p.id] ?? p.cards;
      const oc = view.oneCard.find(o => o.player === p.id);
      const called = !!oc && oc.calledAt !== null;
      // Our own figure is the camera: it burns only when it is in shot.
      const shown = p.id !== st.me || st.showMe;
      const burning = live && shown && !p.left && !p.out && count === 1 && st.podium !== p.id;
      const want = burning ? (called ? 1 : 0.75) : 0;
      const was = heat.current.get(p.id) ?? 0;
      const h = was + (want - was) * (1 - Math.exp(-(want > was ? 5 : 3) * dt));
      heat.current.set(p.id, h);
      if (h < 0.02 || seat >= MAX_SEATS) return;
      seatPos(angles.get(p.id) ?? Math.PI * 1.5, undefined, base);
      // Toward the camera, on the level: the fire stands a little in front of the figure.
      toCam.set(camera.position.x - base.x, 0, camera.position.z - base.z).normalize();
      const yaw = Math.atan2(toCam.x, toCam.z);

      // The hot seat: a glow on the felt, breathing.
      const pulse = reduced ? 1 : 0.85 + Math.sin(time * 6 + seat) * 0.1 + Math.sin(time * 13.7 + seat * 2) * 0.05;
      dummy.position.set(base.x, FELT_Y + 0.02, base.z);
      dummy.quaternion.copy(flat);
      dummy.scale.set(4.2 * h, 4.2 * h, 1);
      putGlow(col.copy(GLOW).lerp(MONAD, called ? 0.3 : 0).multiplyScalar(0.9 * h * pulse));

      // Tongues of flame: each licks up from the feet, narrowing and cooling as it goes.
      const tall = 1.8 + 0.9 * h;
      for (let i = 0; i < per; i++) {
        const r1 = hash01(seat * 97 + i * 13), r2 = hash01(seat * 31 + i * 7 + 5);
        const t = reduced ? 0.1 + 0.55 * r2 : (time * (0.8 + 0.6 * r1) + r2) % 1;
        // Round the figure, more of them on the camera's side.
        const a = yaw + (r1 - 0.5) * Math.PI * 1.7 + (reduced ? 0 : Math.sin(time * 0.7 + i) * 0.2);
        const rad = (0.5 + 0.35 * r2) * (1 - 0.45 * t);
        const sway = reduced ? 0 : Math.sin(time * 8 + i * 1.7) * 0.08 * t;
        dummy.position.set(
          base.x + Math.sin(a) * rad + toCam.x * 0.25 + sway * toCam.z,
          FELT_Y + 0.05 + t * tall * (0.75 + 0.35 * r1),
          base.z + Math.cos(a) * rad + toCam.z * 0.25 - sway * toCam.x,
        );
        dummy.rotation.set(0, yaw, reduced ? 0 : Math.sin(time * 5 + i) * 0.12);
        const size = (1.25 - 0.85 * t) * (0.7 + 0.3 * h) * (0.8 + 0.4 * r1);
        dummy.scale.set(size * 0.6, size * 1.25, 1);
        flameColor(t, col);
        // Called: some tongues burn Monad purple at the root.
        if (called && i % 3 === 0 && t < 0.5) col.lerp(MONAD, 0.75 * (1 - t * 2));
        putFlame(col.multiplyScalar(1.5 * h * (1 - t) ** 1.1));
      }

      // Embers, flicking up off the top.
      if (!reduced) {
        for (let i = 0; i < EMBERS; i++) {
          const r = hash01(seat * 53 + i * 19 + 3);
          const t = (time * (0.45 + 0.3 * r) + r) % 1;
          const a = r * Math.PI * 2 + t * 2;
          dummy.position.set(base.x + Math.cos(a) * (0.3 + t * 0.6), FELT_Y + 1.0 + t * (tall + 1.3), base.z + Math.sin(a) * (0.3 + t * 0.6));
          dummy.quaternion.copy(camera.quaternion);
          dummy.scale.setScalar(0.13 + 0.07 * (1 - t));
          putGlow(col.copy(GOLD).multiplyScalar(1.4 * h * (1 - t)));
        }
      }
    });

    for (const [m, n] of [[flames, nf], [glows, ng]] as const) {
      m.count = n;
      if (n) {
        m.instanceMatrix.needsUpdate = true;
        m.instanceColor!.needsUpdate = true;
      }
      m.visible = n > 0;
    }
  });

  return (
    <>
      <primitive object={glows} />
      <primitive object={flames} />
    </>
  );
}
