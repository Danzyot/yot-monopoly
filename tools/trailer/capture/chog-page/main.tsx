// Trailer frames of the game's own 3D token Chogs, stepped deterministically:
//   ?mode=run&w=1920&h=1080                     four Chogs running at the camera
//   ?mode=turn&token=824&w=1080&h=1080          one Chog hopping, waving and turning (transparent)
// window.ready resolves once the models are in and the first frame is drawn;
// window.draw(t) poses everything for time t (seconds) and renders one frame
// synchronously (R3F frameloop "never" + advance(t): no real-time clock).
import './seed.ts';
import { createRoot } from 'react-dom/client';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, advance, useThree, type RootState } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import {
  AdditiveBlending, Box3, CanvasTexture, Color, CustomBlending, Fog, Matrix4, Mesh, OneFactor, OneMinusSrcAlphaFactor,
  PerspectiveCamera, Points, PointsMaterial, RepeatWrapping, SRGBColorSpace, SkinnedMesh, SrcAlphaFactor, Vector3,
  HalfFloatType, LinearFilter, ShaderMaterial, WebGLRenderTarget, Vector2,
  type Group, type Object3D,
} from 'three';
import { CharacterFigure, chogTraitsUrl, characterUrl, newRig, poseRig, useCharacterMaterials, type Rig } from '../../src/three/characters/Figure.tsx';
import { SceneEnv } from '../../src/three/SceneEnv.tsx';

const q = new URLSearchParams(location.search);
const MODE = (q.get('mode') ?? 'run') as 'run' | 'turn';
const W = Number(q.get('w') ?? (MODE === 'run' ? 1920 : 1080));
const H = Number(q.get('h') ?? (MODE === 'run' ? 1080 : 1080));
const MODELS = [characterUrl('chog', false), chogTraitsUrl(false)];

interface Actor { token: number; rig: Rig; root: Group | null; yaw: Group | null; phase: number; x: number; z: number }
const actors: Actor[] = [];
let three: RootState | null = null;
let floor: Mesh | null = null;
let fit = { cy: 0.25, h: 0.5, bottom: 0 };

const frac = (x: number) => x - Math.floor(x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ---- the run cycle ------------------------------------------------------------
// The game's rig only has a hop-step walk (poseRig's `walk`), so the run is
// built here on the same rig: each foot plants and slides back at exactly the
// floor's speed, then swings forward high; the body bounces twice a cycle,
// leans in, rolls over the planted foot; the arms pump against the legs.

/** Cycle (s), stance share per foot, stride half-length, foot lift, bounce, lean. */
const T = 0.4, STANCE = 0.32, A = 0.042, LIFT = 0.05, BOUNCE = 0.02, LEAN = 0.17;
/** Floor speed (units/s) that keeps the planted foot still on it. */
export const RUN_V = (2 * A) / (STANCE * T);
const FOOT_X = 0.044, FOOT_Z = 0.012;
const inv = new Matrix4();
const want = new Vector3();

function runPose(a: Actor, t: number) {
  const { rig } = a;
  const c = t / T + a.phase;
  // Half-cycle phase: lowest at mid-stance, highest mid-flight.
  const h = frac(2 * c);
  const low = 0.5 * (1 + Math.cos(2 * Math.PI * (h - STANCE)));
  const bounce = BOUNCE * (1 - low);
  const squash = 1 - 0.05 * low + 0.025 * (1 - low);
  poseRig(rig, { time: t, phase: a.phase * 7, slump: 0, lie: 0, handsUp: 0, squash });
  const { pose, head, handL, handR, footL, footR } = rig;
  if (!pose || !head || !handL || !handR || !footL || !footR) return;
  const legs = Math.cos(2 * Math.PI * (c + 0.09)); // +1: left foot forward
  pose.position.set(0, bounce, 0);
  const lean = LEAN + 0.03 * low;
  pose.rotation.set(lean, 0.09 * legs, 0.045 * Math.sin(2 * Math.PI * (c + 0.09)));
  pose.updateMatrix();
  inv.copy(pose.matrix).invert();
  // Head: looks ahead (against the lean), bobs a little behind the body.
  head.rotation.x += -lean * 0.65 + 0.05 * low;
  head.rotation.y -= 0.09 * legs * 0.7;
  // Arms pump against the legs, elbows bent (hands carried high).
  for (const [hand, side] of [[handL, 1], [handR, -1]] as const) {
    const fwd = side === 1 ? -legs : legs;
    hand.position.set(side * (0.098 - 0.012 * Math.max(0, fwd)), 0.135 + 0.03 * Math.max(0, fwd) - 0.008 * Math.max(0, -fwd), 0.025 + 0.055 * fwd);
    hand.rotation.set(-0.5 * fwd, 0, side * 0.25);
  }
  // Feet: stance slides back with the floor, swing kicks up behind and reaches forward.
  for (const [foot, side, off] of [[footL, 1, 0], [footR, -1, 0.5]] as const) {
    const u = frac(c + off);
    let y: number, z: number, pitch: number;
    if (u < STANCE) {
      const s = u / STANCE;
      z = A - 2 * A * s;
      y = 0;
      pitch = s < 0.15 ? lerp(-0.25, 0, s / 0.15) : lerp(0, 0.45, Math.pow((s - 0.15) / 0.85, 3));
    } else {
      const s = (u - STANCE) / (1 - STANCE);
      z = -A + 2 * A * ease(s);
      y = LIFT * Math.sin(Math.PI * Math.pow(s, 0.7));
      pitch = s < 0.6 ? lerp(0.6, 0, s / 0.6) : lerp(0, -0.3, (s - 0.6) / 0.4);
    }
    want.set(side * FOOT_X, y, z + FOOT_Z).applyMatrix4(inv);
    foot.position.copy(want);
    foot.rotation.set(pitch - lean, 0, 0);
  }
}

// ---- the turn: a happy hop, then a wave, while turning to camera ---------------

function turnPose(a: Actor, t: number) {
  const { rig } = a;
  // Crouch 0–0.28, airborne 0.28–0.62, land/settle 0.62–0.9, wave from 0.85.
  const crouch = t < 0.28 ? Math.sin((Math.PI / 2) * (t / 0.28)) : t < 0.36 ? 1 - (t - 0.28) / 0.08 : 0;
  const airS = (t - 0.28) / 0.34;
  const air = airS > 0 && airS < 1 ? Math.sin(Math.PI * airS) : 0;
  const landS = (t - 0.62) / 0.28;
  const land = landS > 0 && landS < 1 ? Math.sin(Math.PI * landS) * (1 - landS * 0.5) : 0;
  const handsUp = Math.max(air, airS > 0 && airS < 1.4 ? smooth(1 - (airS - 1) / 0.4) * (airS > 1 ? 1 : air) : 0);
  const wave = smooth((t - 0.85) / 0.3) * (1 - smooth((t - 1.85) / 0.25) * 0.15);
  const squash = 1 + air * 0.06 - land * 0.12 - crouch * 0.05;
  poseRig(rig, {
    time: t + 0.3, phase: 0.6, slump: 0, lie: 0, handsUp: handsUp * (1 - wave), squash, crouch,
    wave, cheer: air > 0 ? airS * 0.5 : 0,
  });
  if (rig.pose) rig.pose.position.y = air * 0.055;
  if (rig.head) rig.head.rotation.z += 0.12 * wave * Math.sin(t * 5);
  // Turn ~41° to face the camera.
  if (a.yaw) a.yaw.rotation.y = lerp(0.72, 0.0, ease((t - 0.05) / 1.55));
}

// ---- floor reflection ----------------------------------------------------------
// The scene seen from the camera mirrored in the floor, at half size, then added
// over the near-black floor with a soft blur and a fade with distance: a glossy
// floor that stays dark (drei's reflector multiplies by the floor's colour).

let mirrorMesh: Mesh | null = null;
const mirrorRT = new WebGLRenderTarget(960, 540, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter });
const mirrorCam = new PerspectiveCamera();
const mirrorTexMatrix = new Matrix4();
const mirrorMat = new ShaderMaterial({
  uniforms: {
    tex: { value: mirrorRT.texture }, texMatrix: { value: mirrorTexMatrix }, strength: { value: Number(q.get('refl') ?? 0.2) },
    texel: { value: new Vector2(1 / 960, 1 / 540) }, camPos: { value: new Vector3() },
  },
  vertexShader: `
    uniform mat4 texMatrix; varying vec4 vUv; varying vec3 vWorld;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz; vUv = texMatrix * w;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: `
    uniform sampler2D tex; uniform float strength; uniform vec2 texel; uniform vec3 camPos;
    varying vec4 vUv; varying vec3 vWorld;
    void main() {
      vec2 uv = vUv.xy / vUv.w;
      // Blur grows with the distance from the contact (height in the mirror image is not known: use depth).
      float d = length(vWorld - camPos);
      float r = 2.5 + 3.0 * smoothstep(1.2, 4.0, d);
      vec3 c = vec3(0.0); float wsum = 0.0;
      for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) {
        float w = exp(-float(i * i + j * j) / 4.0);
        c += texture2D(tex, uv + vec2(float(i), float(j)) * texel * r).rgb * w; wsum += w;
      }
      c /= wsum;
      float fade = 1.0 - smoothstep(2.0, 6.5, d);
      gl_FragColor = vec4(c * strength * fade, 1.0);
      #include <colorspace_fragment>
    }`,
  transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
});

const _mt = new Vector3(), _md = new Vector3();
function renderMirror(state: RootState) {
  if (!floor || !mirrorMesh) return;
  const { gl, scene } = state;
  const cam = state.camera as PerspectiveCamera;
  // Reflect the camera in the plane y = 0.
  mirrorCam.copy(cam);
  mirrorCam.position.set(cam.position.x, -cam.position.y, cam.position.z);
  cam.getWorldDirection(_md);
  _mt.copy(cam.position).add(_md);
  mirrorCam.up.set(cam.up.x, -cam.up.y, cam.up.z);
  mirrorCam.lookAt(_mt.x, -_mt.y, _mt.z);
  mirrorCam.updateMatrixWorld();
  mirrorCam.projectionMatrix.copy(cam.projectionMatrix);
  mirrorTexMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  mirrorTexMatrix.multiply(mirrorCam.projectionMatrix).multiply(mirrorCam.matrixWorldInverse);
  (mirrorMat.uniforms.camPos.value as Vector3).copy(cam.position);
  // Render everything but the floor, upside down.
  floor.visible = false; mirrorMesh.visible = false;
  const fog = scene.fog; scene.fog = null;
  const prev = gl.getRenderTarget();
  gl.setRenderTarget(mirrorRT);
  gl.clear();
  gl.render(scene, mirrorCam);
  gl.setRenderTarget(prev);
  scene.fog = fog; floor.visible = true; mirrorMesh.visible = true;
}

// ---- draw ---------------------------------------------------------------------

const camTarget = new Vector3();

function draw(t: number) {
  if (!three) throw new Error('not ready');
  const cam = three.camera as PerspectiveCamera;
  if (MODE === 'run') {
    for (const a of actors) runPose(a, t);
    // The floor slides back under them at the stride speed (tile 0.5: loops every tile).
    if (floor) floor.position.z = -((RUN_V * t) % 0.5);
    // The camera dollies back at their pace (fixed relative to them), low, with a gentle sway.
    const w = (2 * Math.PI * t) / 4;
    cam.position.set(0.07 * Math.sin(w), 0.2 + 0.015 * Math.sin(2 * w + 0.6), 1.76 + 0.03 * Math.sin(w + 1.1));
    camTarget.set(0.025 * Math.sin(w + 0.3), 0.235, 0);
    cam.up.set(Math.sin(0.012 * Math.sin(w + 0.4)), 1, 0).normalize();
    cam.lookAt(camTarget);
    if (q.get('cam') === 'side') { cam.position.set(1.05, 0.09, -0.06); cam.up.set(0, 1, 0); cam.lookAt(0.48, 0.09, -0.06); }
  } else {
    for (const a of actors) turnPose(a, t);
    // Standing height = 75% of the frame, feet 7% up from the bottom (head room for the hop).
    const v = fit.h / 0.75;
    const d = v / 2 / Math.tan((cam.fov * Math.PI) / 360);
    const cy = fit.bottom + v * 0.43;
    cam.position.set(0, cy + d * 0.07, d);
    cam.lookAt(0, cy, 0);
  }
  cam.updateMatrixWorld();
  if (MODE === 'run') { for (const a of actors) a.root?.updateMatrixWorld(true); renderMirror(three); }
  advance(t);
}

// ---- scene ----------------------------------------------------------------------

function Chog({ token, color, phase = 0, x = 0, z = 0 }: { token: number; color: string; phase?: number; x?: number; z?: number }) {
  const rig = useMemo(newRig, []);
  const mats = useCharacterMaterials('chog', color, token);
  const a = useRef<Actor>({ token, rig, root: null, yaw: null, phase, x, z });
  useEffect(() => {
    actors.push(a.current);
    return () => { actors.splice(actors.indexOf(a.current), 1); };
  }, []);
  return (
    <group ref={g => { a.current.root = g; }} position={[x, 0, z]}>
      <group ref={g => { a.current.yaw = g; }}>
        <CharacterFigure id="chog" mats={mats} rig={rig} chogToken={token} lite={false} />
      </group>
    </group>
  );
}

function floorTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0a0612';
  g.fillRect(0, 0, 512, 512);
  // Faint seams between big tiles, and a soft speck in each: just enough to read the motion.
  g.strokeStyle = 'rgba(150,95,240,0.3)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(150,95,240,0.1)';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(256, 0); g.lineTo(256, 512); g.moveTo(0, 256); g.lineTo(512, 256); g.stroke();
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d')!;
  // Plane 12 x 6 units centred 0.9 up: the floor line (y = 0) is canvas row 333.
  const r = g.createRadialGradient(512, 290, 0, 512, 290, 470);
  r.addColorStop(0, 'rgba(66,24,124,1)');
  r.addColorStop(0.22, 'rgba(41,16,79,0.9)');
  r.addColorStop(0.55, 'rgba(22,8,44,0.5)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 1024, 512);
  // Fade out toward the floor line so the floor melts into the dark, no horizon edge.
  const m = g.createLinearGradient(0, 230, 0, 345);
  m.addColorStop(0, 'rgba(0,0,0,1)');
  m.addColorStop(0.75, 'rgba(0,0,0,0.3)');
  m.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = m;
  g.fillRect(0, 0, 1024, 512);
  g.globalCompositeOperation = 'source-over';
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function RunSet() {
  const tex = useMemo(floorTexture, []);
  tex.repeat.set(60, 60);
  const glow = useMemo(glowTexture, []);
  const { scene } = useThree();
  useEffect(() => {
    scene.background = new Color('#040208');
    scene.fog = new Fog('#040208', 2.2, 6.2);
  }, [scene]);
  return (
    <>
      <mesh ref={m => { floor = m; }} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshLambertMaterial map={tex} />
      </mesh>
      {/* The gloss: a blurred planar reflection added over the floor (mirror.ts-style pass in draw()). */}
      <mesh ref={m => { mirrorMesh = m; }} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0004, -4]} material={mirrorMat} renderOrder={1}>
        <planeGeometry args={[30, 30]} />
      </mesh>
      {/* The purple glow behind them (it travels with the camera, like the runners). */}
      <mesh position={[0, 0.9, -6]}>
        <planeGeometry args={[12, 6]} />
        <meshBasicMaterial map={glow} transparent depthWrite={false} fog={false} toneMapped={false} />
      </mesh>
      <hemisphereLight args={['#b9a6ff', '#140a22', 0.35]} />
      <directionalLight castShadow position={[-1.6, 1.9, 2.2]} intensity={2.6} color="#fff3ea"
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.01}
        shadow-camera-left={-1.2} shadow-camera-right={1.2} shadow-camera-top={1.2} shadow-camera-bottom={-1.2} shadow-camera-near={0.5} shadow-camera-far={6} />
      <directionalLight position={[1.4, 1.1, -2]} intensity={4.2} color="#ff4fd2" />
      <directionalLight position={[-1.6, 0.9, -1.8]} intensity={3.2} color="#8a4dff" />
      <pointLight position={[0, 0.5, -1.2]} intensity={0.9} distance={3} color="#7a3cff" />
      {/* Front row middle: the Legendary 1:1. */}
      <Chog token={824} color="#3cb4ff" x={-0.47} z={-0.07} phase={0.13} />
      <Chog token={1798} color="#ffd23f" x={-0.155} z={0.1} phase={0.0} />
      <Chog token={285} color="#ff5fa2" x={0.165} z={0.03} phase={0.61} />
      <Chog token={1699} color="#b15cff" x={0.48} z={-0.06} phase={0.38} />
    </>
  );
}

const TURN_COLORS: Record<number, string> = { 824: '#3cb4ff', 1798: '#ffd23f', 285: '#ff5fa2', 1699: '#b15cff' };

function TurnSet() {
  const token = Number(q.get('token') ?? 824);
  return (
    <>
      <hemisphereLight args={['#ffffff', '#2a1640', 0.55]} />
      <directionalLight position={[-1.5, 1.7, 2.1]} intensity={2.6} color="#fff3ea" />
      <directionalLight position={[1.6, 0.7, 1.4]} intensity={0.55} color="#c8d4ff" />
      <directionalLight position={[1.4, 1.1, -2]} intensity={3.4} color="#ff4fd2" />
      <directionalLight position={[-1.6, 0.9, -1.8]} intensity={2.6} color="#8a4dff" />
      <Chog token={token} color={TURN_COLORS[token] ?? '#b15cff'} />
    </>
  );
}

/** Loads the two model files with the same key the figures use, so nothing suspends after this. */
function Models({ children }: { children: React.ReactNode }) {
  useGLTF(MODELS);
  return <>{children}</>;
}

let resolveReady: () => void;
(window as any).ready = new Promise<void>(r => { resolveReady = r; });
(window as any).draw = (t: number) => { draw(t); return true; };
(window as any).dbg = { actors, floorZ: () => floor?.position.z ?? 0 };

function Ready() {
  const state = useThree();
  useEffect(() => {
    three = state;
    // Let the figures' effects and refs settle, then prepare the scene.
    let tries = 0;
    const tick = () => {
      const skinned: SkinnedMesh[] = [];
      state.scene.traverse((o: Object3D) => { if ((o as SkinnedMesh).isSkinnedMesh) skinned.push(o as SkinnedMesh); });
      const posed = actors.length > 0 && actors.every(a => a.rig.pose && a.rig.footL && a.root);
      if ((!posed || skinned.length < actors.length) && tries++ < 400) { setTimeout(tick, 25); return; }
      prepare(state);
      resolveReady();
    };
    tick();
  }, [state]);
  return null;
}

function prepare(state: RootState) {
  const { scene, gl } = state;
  scene.traverse((o: Object3D) => {
    const m = o as Mesh;
    // The ring under a token Chog (its plinth) belongs on the board, not here.
    if (m.isMesh && m.geometry?.type === 'RingGeometry') m.visible = false;
    // Additive aura sprites: light adds to colour, coverage composites "over" in alpha,
    // so they survive on a transparent background (premultiplied canvas).
    const p = o as Points;
    if (p.isPoints) {
      const mat = p.material as PointsMaterial;
      if (mat.blending === AdditiveBlending) {
        mat.blending = CustomBlending;
        mat.blendSrc = SrcAlphaFactor; mat.blendDst = OneFactor;
        mat.blendSrcAlpha = OneFactor; mat.blendDstAlpha = OneMinusSrcAlphaFactor;
        mat.needsUpdate = true;
      }
    }
  });
  gl.shadowMap.needsUpdate = true;
  if (MODE === 'turn') {
    // Frame the figure: its standing height fills 75% of the frame.
    for (const a of actors) { poseRig(a.rig, { time: 0, phase: 0, slump: 0, lie: 0, handsUp: 0, squash: 1 }); if (a.yaw) a.yaw.rotation.y = 0; }
    scene.updateMatrixWorld(true);
    const box = new Box3();
    scene.traverse((o: Object3D) => {
      const m = o as SkinnedMesh;
      if (m.isMesh && m.visible && !(o as unknown as Points).isPoints) {
        if (m.isSkinnedMesh) { m.skeleton.update(); m.computeBoundingBox(); box.union(m.boundingBox!.clone().applyMatrix4(m.matrixWorld)); }
        else if (m.geometry) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld)); }
      }
    });
    const hh = box.max.y - Math.min(0, box.min.y);
    fit = { cy: (box.max.y + Math.min(0, box.min.y)) / 2, h: hh, bottom: Math.min(0, box.min.y) };
    (window as any).fit = { ...fit, min: box.min.toArray(), max: box.max.toArray() };
  }
  draw(0);
}

function App() {
  return (
    <div style={{ width: W, height: H }}>
      <Canvas frameloop="never" dpr={1} shadows={MODE === 'run' ? 'soft' : false}
        gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: true }}
        camera={{ position: [0, 0.3, 1.6], fov: MODE === 'run' ? 30 : 26, near: 0.05, far: 40 }}
        onCreated={({ gl }) => { gl.setClearColor(0x000000, 0); }}>
        <Suspense fallback={null}>
          <SceneEnv intensity={MODE === 'run' ? 0.35 : 0.6} />
          <Models>
            {MODE === 'run' ? <RunSet /> : <TurnSet />}
            <Ready />
          </Models>
        </Suspense>
      </Canvas>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
