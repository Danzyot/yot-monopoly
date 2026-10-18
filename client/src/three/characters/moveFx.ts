// What a move shows and sounds like beyond the body: the prop in the hand (a
// cash wad, a SOLD sign, a hammer and hard hat, a white flag…), the bits it
// throws off (bills, confetti, coins) and its foley, cued to the frame.
//
// Props are cheap low-poly meshes built once from primitives, each merged into
// one geometry with vertex colours, so a visible prop is one draw call (the
// sign's lettering is a second) and a hidden one is none. Every figure shares
// the same geometries and materials; each gets its own handful of Mesh
// objects. Particles are one InstancedMesh per figure, laid out analytically
// from the move's clock (no simulation state, nothing allocated per frame).

import {
  BoxGeometry, BufferAttribute, CanvasTexture, Color, ConeGeometry, CylinderGeometry, DoubleSide, Euler, Group,
  InstancedMesh, LatheGeometry, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry,
  Quaternion, SRGBColorSpace, SphereGeometry, TorusGeometry, Vector2, Vector3, type BufferGeometry, type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CharacterId } from '../../../../shared/characters.ts';
import * as S from '../../sound.ts';
import type { Rig } from './Figure.tsx';
import { LOOKS } from './looks.tsx';
import { EMOTE_OUT, IDLE_EMOTES, WIN_MS, type EmoteKind, type FxKind, type PropKind } from './moves.ts';

const TAU = Math.PI * 2;
const PI = Math.PI;

/**
 * Characters that already hold something in the right hand only (a staff, a
 * hook…) do their prop work with the left instead.
 */
export function propHandMirrored(id: CharacterId): boolean {
  const l = LOOKS[id];
  return !!l?.right && !l.left;
}

// ---- prop geometry ------------------------------------------------------------

type V3 = readonly [number, number, number];
const _m = new Matrix4(), _q = new Quaternion(), _e = new Euler(), _p = new Vector3(), _s = new Vector3(), _c = new Color();

/** Place a primitive and paint it one colour (as vertex colours, so parts merge into one draw). */
function part(g: BufferGeometry, color: string, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], s: V3 | number = 1): BufferGeometry {
  const sc = typeof s === 'number' ? [s, s, s] : s;
  g.applyMatrix4(_m.compose(_p.set(p[0], p[1], p[2]), _q.setFromEuler(_e.set(r[0], r[1], r[2])), _s.set(sc[0], sc[1], sc[2])));
  _c.set(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new BufferAttribute(col, 3));
  return g;
}
function merged(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  if (!g) throw new Error('prop parts do not merge');
  return g;
}

const C = {
  green: '#5fae5a', cream: '#f2ead0', tan: '#c89b5e', gold: '#f4c542', wood: '#8a5a32', red: '#d23a2e', white: '#f7f7f2',
  steel: '#b9c0c8', ink: '#22262e', screen: '#62d4ff', yellow: '#f9c623', line: '#9b927c', pink: '#e84d8a', blue: '#4ac0ff',
};
const SHINY: ReadonlySet<PropKind> = new Set(['coin', 'cup', 'trophy']);

interface Assets {
  geo: Record<PropKind, BufferGeometry>;
  label: BufferGeometry;
  cloth: BufferGeometry;
  hat: BufferGeometry;
  bit: BufferGeometry;
  plain: Material;
  shiny: Material;
  labelMat: Material;
  bitMat: Material;
}
let assets: Assets | null = null;

function soldTexture(): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 128;
  const g = cv.getContext('2d');
  if (g) {
    g.fillStyle = C.red;
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#ffffff';
    g.font = '900 96px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('SOLD', 128, 70, 236);
  }
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function buildAssets(): Assets {
  const cone = (r: number, y: number) => r * (y - 0.0075) / 0.075;
  const geo: Record<PropKind, BufferGeometry> = {
    wad: merged([
      part(new BoxGeometry(0.075, 0.036, 0.022), C.green, [0, 0.012, 0.03]),
      part(new BoxGeometry(0.02, 0.038, 0.024), C.cream, [0, 0.012, 0.03]),
    ]),
    // Held by the neck; the sack hangs below the hand.
    bag: merged([
      part(new SphereGeometry(1, 12, 10), C.tan, [0, -0.06, 0.01], [0, 0, 0], [0.05, 0.055, 0.047]),
      part(new CylinderGeometry(0.013, 0.022, 0.026, 10), C.tan, [0, -0.012, 0.01]),
      part(new ConeGeometry(0.02, 0.018, 8), C.tan, [0, 0.008, 0.01], [PI, 0, 0]),
      part(new TorusGeometry(0.016, 0.0045, 6, 12), C.gold, [0, -0.012, 0.01], [PI / 2, 0, 0]),
      part(new CylinderGeometry(0.017, 0.017, 0.004, 14), C.gold, [0, -0.058, 0.057], [PI / 2, 0, 0]),
      part(new BoxGeometry(0.004, 0.022, 0.002), C.green, [0, -0.058, 0.0595]),
    ]),
    coin: merged([part(new CylinderGeometry(0.018, 0.018, 0.005, 16), C.gold, [0, 0, 0], [PI / 2, 0, 0])]),
    sign: merged([
      part(new CylinderGeometry(0.007, 0.007, 0.25, 6), C.wood, [0, 0.06, 0.015]),
      part(new BoxGeometry(0.18, 0.11, 0.01), C.white, [0, 0.22, 0.015]),
      part(new BoxGeometry(0.166, 0.096, 0.011), C.red, [0, 0.22, 0.015]),
    ]),
    phone: merged([
      part(new BoxGeometry(0.03, 0.058, 0.008), C.ink, [0, 0.02, 0.015]),
      part(new BoxGeometry(0.025, 0.046, 0.002), C.screen, [0, 0.022, 0.0195]),
    ]),
    contract: merged([
      part(new BoxGeometry(0.08, 0.1, 0.003), C.cream, [0, 0.045, 0.02]),
      ...[0, 1, 2, 3, 4].map(k => part(new BoxGeometry(k === 4 ? 0.03 : 0.056, 0.004, 0.001), C.line,
        [k === 4 ? -0.018 : -0.005, 0.078 - k * 0.013, 0.0218])),
      part(new CylinderGeometry(0.011, 0.011, 0.003, 12), C.red, [0.024, 0.01, 0.0215], [PI / 2, 0, 0]),
    ]),
    hammer: merged([
      part(new CylinderGeometry(0.006, 0.007, 0.12, 6), C.wood, [0, 0.035, 0]),
      part(new BoxGeometry(0.022, 0.022, 0.065), C.steel, [0, 0.095, 0.005]),
    ]),
    // Tip in the hand, mouth up: confetti fires out of the top.
    popper: merged([
      part(new ConeGeometry(0.024, 0.075, 12), C.pink, [0, 0.045, 0], [PI, 0, 0]),
      part(new TorusGeometry(cone(0.024, 0.035), 0.003, 4, 12), C.yellow, [0, 0.035, 0], [PI / 2, 0, 0]),
      part(new TorusGeometry(cone(0.024, 0.06), 0.003, 4, 12), C.blue, [0, 0.06, 0], [PI / 2, 0, 0]),
      part(new CylinderGeometry(0.023, 0.023, 0.003, 12), C.gold, [0, 0.083, 0]),
      part(new BoxGeometry(0.002, 0.03, 0.002), C.white, [0, -0.008, 0]),
    ]),
    flag: merged([
      part(new CylinderGeometry(0.005, 0.005, 0.3, 6), C.wood, [0, 0.1, 0]),
      part(new SphereGeometry(0.009, 8, 6), C.gold, [0, 0.255, 0]),
    ]),
    cup: merged([
      part(new CylinderGeometry(0.022, 0.018, 0.04, 14, 1, true), C.steel, [0, 0.03, 0.025]),
      part(new CylinderGeometry(0.018, 0.018, 0.003, 14), C.steel, [0, 0.0115, 0.025]),
      part(new TorusGeometry(0.022, 0.002, 4, 16), '#d9dee4', [0, 0.05, 0.025], [PI / 2, 0, 0]),
      part(new TorusGeometry(0.011, 0.0025, 4, 10, PI), C.steel, [0, 0.03, 0.004], [0, -PI / 2, PI / 2]),
    ]),
    trophy: merged([
      part(new LatheGeometry([
        [0.018, 0.012], [0.012, 0.02], [0.006, 0.03], [0.006, 0.05], [0.012, 0.058], [0.028, 0.072],
        [0.036, 0.095], [0.038, 0.115], [0.034, 0.116],
      ].map(([x, y]) => new Vector2(x, y)), 14), C.gold, [0, 0.02, 0]),
      part(new TorusGeometry(0.015, 0.003, 4, 10, PI), C.gold, [0.036, 0.11, 0], [0, 0, -PI / 2]),
      part(new TorusGeometry(0.015, 0.003, 4, 10, PI), C.gold, [-0.036, 0.11, 0], [0, 0, PI / 2]),
      part(new BoxGeometry(0.05, 0.016, 0.05), '#3a2a1e', [0, 0.024, 0]),
    ]),
  };
  // Read from across the board: the popper and the hammer go up a size.
  geo.popper.scale(1.35, 1.35, 1.35);
  geo.hammer.scale(1.5, 1.5, 1.5);
  geo.coin.scale(1.4, 1.4, 1.4);
  geo.cup.scale(1.35, 1.35, 1.35);
  geo.contract.scale(1.25, 1.25, 1.25);
  return {
    geo,
    label: part(new PlaneGeometry(0.15, 0.075), C.white, [0, 0.22, 0.0211]),
    cloth: part(new BoxGeometry(0.11, 0.07, 0.003), C.white, [-0.058, 0, 0]),
    hat: merged([
      part(new SphereGeometry(0.08, 16, 8, 0, TAU, 0, PI / 2), C.yellow),
      part(new CylinderGeometry(0.095, 0.095, 0.006, 20), C.yellow, [0, 0.002, 0.012]),
      part(new TorusGeometry(0.08, 0.006, 4, 14, PI), '#e8b417', [0, 0, 0], [0, PI / 2, 0]),
    ]),
    bit: new PlaneGeometry(1, 1),
    plain: new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 }),
    shiny: new MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.85, side: DoubleSide }),
    labelMat: new MeshStandardMaterial({ map: soldTexture(), roughness: 0.6 }),
    // Unlit, like the GO confetti: paper bits read the same from either side.
    bitMat: new MeshBasicMaterial({ side: DoubleSide }),
  };
}

// ---- particles ----------------------------------------------------------------

const MAX_BITS = 14;
/** Fixed per-particle randomness (0–1), so a move throws the same way every time. */
const SEED = Array.from({ length: MAX_BITS * 3 }, (_, i) => (Math.sin(i * 91.7 + 3.1) * 43758.5) % 1).map(v => Math.abs(v));
const CONFETTI = ['#e53935', '#fdd835', '#43a047', '#1e88e5', '#fb8c00', '#ec407a', '#ffffff'];
const dummy = new Object3D();

// ---- sound cues -----------------------------------------------------------------

type Play = (at: number, v: number) => void;
/** [ms into the move, sound, volume, only for other players' pieces (your own already has the game's money sound)] */
type Cue = readonly [number, Play, number, boolean];
const q = (ms: number, play: Play, vol = 1, othersOnly = false): Cue => [ms, play, vol, othersOnly];

const CUES: Record<EmoteKind, readonly Cue[]> = {
  cheer: [q(200, S.playYay), q(230, S.playWhoosh), q(640, S.playStep), q(660, S.playCoins, 0.8, true), q(1010, S.playStep, 0.6)],
  pump: [q(330, S.playTing, 0.5), q(700, S.playTing), q(860, S.playSwish, 0.7), q(1100, S.playStep, 0.7)],
  taunt: [q(420, S.playRiffle), q(450, S.playCoins, 0.7, true), q(875, S.playFlutter), q(1175, S.playFlutter), q(1475, S.playFlutter)],
  pay: [
    q(480, S.playRiffle, 0.8), q(640, S.playFlutter), q(660, S.playCoins, 0.7, true), q(800, S.playFlutter), q(960, S.playFlutter),
    q(1120, S.playFlutter), q(1300, S.playSigh, 0.8),
  ],
  sad: [q(300, S.playSwish, 0.6), q(760, S.playTing, 0.6), q(900, S.playTing, 0.4), q(1000, S.playWomp)],
  stomp: [q(380, S.playThud), q(720, S.playThud), q(1040, S.playThud), q(1280, S.playHuff)],
  rattle: [q(600, S.playRake), q(850, S.playRake), q(1100, S.playRake), q(1350, S.playRake), q(1720, S.playClank), q(2050, S.playSigh, 0.6)],
  sold: [q(290, S.playSwish), q(440, S.playKnock), q(560, S.playStep, 0.7)],
  popper: [q(340, S.playPop), q(380, S.playSparkle), q(560, S.playYay, 0.8), q(860, S.playStep, 0.7)],
  phone: [q(250, S.playDial), q(950, S.playMurmur), q(1350, S.playMurmur), q(1750, S.playMurmur)],
  deal: [q(180, S.playFlutter, 0.6), q(820, S.playStamp), q(1160, S.playSwish, 0.7), q(1400, S.playStep, 0.7)],
  build: [q(120, S.playKnock, 0.5), q(520, S.playTink), q(900, S.playTink), q(1280, S.playTink), q(1600, S.playSigh, 0.5)],
  surrender: [q(600, S.playFlap), q(1020, S.playFlap), q(1440, S.playFlap), q(1500, S.playSlide)],
  wave: [q(430, S.playHey)],
  look: [q(1100, S.playHmm, 0.7)],
  shrug: [q(380, S.playHuh)],
  stretch: [q(650, S.playYawn), q(1900, S.playStep, 0.4)],
  fidget: [q(860, S.playStep, 0.35), q(1860, S.playStep, 0.35), q(2800, S.playStep, 0.3)],
};
/** The victory dance's cues per bar, and for how many bars they play (then the dance goes quiet). */
const WIN_CUES: readonly (readonly [number, Play, number, number])[] = [
  [100, S.playShimmer, 1, 1], [270, S.playWhoosh, 0.5, 3], [780, S.playStep, 0.7, 6],
];

/** Footfall on each hop landing (board walks and the gallery). */
export function stepSound(v = 1) { S.playStep(0, v); }
/** Take-off of a long flight or a leap out of jail. */
export function flightSound(v = 1) { S.playWhoosh(0, v, 0.55); }

// ---- per figure -----------------------------------------------------------------

/** One figure's props, particles and sound cues. */
export class MoveFX {
  /** Add inside the figure's turning group: the particles are drawn here. */
  readonly fx = new Group();
  private holder = new Group();
  private hatHolder = new Group();
  private props = {} as Record<PropKind, Group>;
  private coin: Object3D;
  private cloth: Object3D;
  private bits: InstancedMesh;
  private bitsKind: FxKind | null = null;
  private shown: PropKind | null = null;
  private cueKind: EmoteKind | 'win' | null = null;
  private cueMs = -1;

  constructor() {
    assets ??= buildAssets();
    const A = assets;
    for (const k of Object.keys(A.geo) as PropKind[]) {
      const g = new Group();
      g.add(new Mesh(A.geo[k], SHINY.has(k) ? A.shiny : A.plain));
      g.visible = false;
      this.holder.add(g);
      this.props[k] = g;
    }
    this.props.sign.add(new Mesh(A.label, A.labelMat));
    const cloth = new Group();
    cloth.position.set(0, 0.21, 0);
    cloth.add(new Mesh(A.cloth, A.plain));
    this.props.flag.add(cloth);
    this.cloth = cloth;
    this.coin = this.props.coin.children[0];
    this.hatHolder.add(new Mesh(A.hat, A.plain));
    this.hatHolder.position.set(0, 0.075, 0);
    this.hatHolder.visible = false;
    this.holder.visible = false;
    this.bits = new InstancedMesh(A.bit, A.bitMat, MAX_BITS);
    this.bits.frustumCulled = false;
    this.bits.count = 0;
    for (let i = 0; i < MAX_BITS; i++) this.bits.setColorAt(i, _c.set('#ffffff'));
    this.fx.add(this.bits);
  }

  /**
   * Show what EMOTE_OUT asks for (call after emotePose / clearMove and
   * poseRig). `ground`: the board's height in the fx group's space, so thrown
   * bits land on it even while the figure is in the air.
   */
  update(rig: Rig, mirror = false, ground = 0) {
    const O = EMOTE_OUT;
    const k = O.propS > 0.01 ? O.prop : null;
    if (k !== this.shown) {
      if (this.shown) this.props[this.shown].visible = false;
      if (k) this.props[k].visible = true;
      this.shown = k;
    }
    const hand = mirror ? rig.handL : rig.handR;
    if (k && hand && this.holder.parent !== hand) hand.add(this.holder);
    this.holder.visible = !!k;
    if (k) {
      this.holder.scale.setScalar(O.propS);
      if (k === 'coin') {
        const t = O.propT;
        this.coin.position.set(0, 0.03 + 0.22 * 4 * t * (1 - t), 0.035);
        this.coin.rotation.x = t * TAU * 3;
      } else if (k === 'flag') {
        this.cloth.rotation.y = Math.sin(O.propT * 7) * 0.35;
        this.cloth.rotation.z = Math.sin(O.propT * 5.3) * 0.08;
      }
    }
    const hat = O.hat > 0.01;
    if (hat && rig.head && this.hatHolder.parent !== rig.head) rig.head.add(this.hatHolder);
    this.hatHolder.visible = hat;
    if (hat) this.hatHolder.scale.setScalar(O.hat);
    this.layoutBits(mirror, ground);
  }

  private layoutBits(mirror: boolean, ground: number) {
    const O = EMOTE_OUT, m = this.bits;
    if (!O.fx) { m.count = 0; this.bitsKind = null; return; }
    const confetti = O.fx === 'confetti';
    const n = Math.min(MAX_BITS, confetti ? MAX_BITS : O.fxAt.length);
    if (O.fx !== this.bitsKind) {
      for (let i = 0; i < n; i++) {
        m.setColorAt(i, _c.set(confetti ? CONFETTI[i % CONFETTI.length] : O.fx === 'coins' ? C.gold : i % 2 ? '#8fd47f' : '#74c266'));
      }
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      this.bitsKind = O.fx;
    }
    const sx = mirror ? -1 : 1;
    const fx = O.fxFrom[0] * sx, fy = O.fxFrom[1], fz = O.fxFrom[2];
    const floor = ground + 0.004;
    for (let i = 0; i < n; i++) {
      const a = SEED[i * 3], b = SEED[i * 3 + 1], c = SEED[i * 3 + 2];
      const t = (O.fxMs - O.fxAt[confetti ? 0 : i]) / 1000;
      const life = confetti ? 1.5 : 1.6;
      if (t < 0 || t > life) {
        dummy.scale.setScalar(0);
      } else {
        const fade = Math.min(1, (life - t) / 0.3, t / 0.04);
        let x: number, y: number, z: number;
        if (O.fx === 'bills') {
          // Tossed up and out, then see-sawing down like paper.
          x = fx + sx * (0.05 + a * 0.08) * t + Math.sin(t * 8 + i * 2) * 0.025;
          y = fy + (0.24 + b * 0.12) * t - 0.45 * t * t;
          z = fz + (0.12 + c * 0.12) * t;
          dummy.rotation.set(t * 6 + i, t * 3, Math.sin(t * 7 + i) * 0.9);
          dummy.scale.set(0.05 * fade, 0.026 * fade, 1);
        } else if (O.fx === 'confetti') {
          // Out of the popper's mouth, up and forward, fluttering down.
          const sp = Math.min(t, 0.35) + Math.max(0, t - 0.35) * 0.35;
          x = fx + (a - 0.5) * 0.5 * sp + Math.sin(t * 9 + i) * 0.02 * t;
          y = fy + (0.75 + b * 0.5) * sp - 0.55 * t * t;
          z = fz + (0.15 + c * 0.35) * sp;
          dummy.rotation.set(t * (8 + a * 6), t * 5, i);
          dummy.scale.set(0.018 * fade, 0.011 * fade, 1);
        } else {
          // Coins: dropped straight out of the bag, tumbling.
          x = fx + (a - 0.5) * 0.03;
          y = fy - 1.3 * t * t;
          z = fz + (c - 0.5) * 0.03;
          dummy.rotation.set(t * 22, a * 3, 0);
          dummy.scale.set(0.02 * fade, 0.02 * fade, 1);
        }
        if (y <= floor) {
          y = floor;
          dummy.rotation.set(-PI / 2, 0, i);
        }
        dummy.position.set(x, y, z);
      }
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  }

  /**
   * Play the cues of `kind` that fall between the last call and `ms` into it
   * (for 'win', ms since the dance began). `gain` scales them; `mine`: this is
   * the local player's piece (some money sounds are already played for it);
   * `idle`: whether idle fidgets make sounds at all.
   */
  cue(kind: EmoteKind | 'win' | null, ms: number, gain = 1, mine = true, idle = true) {
    if (kind !== this.cueKind || ms < this.cueMs) {
      this.cueKind = kind;
      // Starting fresh fires the cues from the top; arriving mid-move doesn't replay the past.
      this.cueMs = ms < 100 ? -1 : ms;
    }
    const from = this.cueMs;
    this.cueMs = ms;
    // A long gap (a hidden tab, a stalled frame) skips rather than firing a pile of sounds at once.
    if (!kind || gain <= 0 || ms - from > 1000) return;
    if (kind === 'win') {
      for (let i = 0; i < WIN_CUES.length; i++) {
        const cue = WIN_CUES[i];
        for (let b = 0; b < cue[3]; b++) {
          const at = b * WIN_MS + cue[0];
          if (at > from && at <= ms) cue[1](0, cue[2] * gain);
        }
      }
      return;
    }
    if (!idle && IDLE_EMOTES.has(kind)) return;
    const list = CUES[kind];
    for (let i = 0; i < list.length; i++) {
      const cue = list[i];
      if (cue[0] > from && cue[0] <= ms && !(cue[3] && mine)) cue[1](0, cue[2] * gain);
    }
  }

  dispose() {
    this.holder.removeFromParent();
    this.hatHolder.removeFromParent();
    this.bits.dispose();
  }
}
