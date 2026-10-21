// The 3D card table: the room's setting (one of Monopoly's light-baked sets
// with its lights and reflections, as the board uses them; the host's pick
// from shared/cards/tables.ts), the modelled table with a felt in the
// setting's colours, the players' characters at the rim, every card in one
// instanced draw (Cards3D), the direction ring and colour glow (TableFx), the
// fire round anyone on their last card (LastCardFire), the camera and its
// cuts (CardsCamera). The React side (CardsTable) hands over
// the view and staged frame through one mutable state object; the HUD stays
// in the DOM and is pinned over the figures from here.
//
// Quality follows three/quality.ts like the board: Auto starts sharp and
// backs off (1× pixels, paused shadows) when the frame rate sags; Low never
// casts live shadows; High never backs off. Shaders compile before they are
// drawn (three/shaderGate.tsx), so the first play never stutters.

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Vector3, type DirectionalLight } from 'three';
import { resolveTheme } from '../../../../shared/themes.ts';
import type { CardsView } from '../../../../shared/cards/types.ts';
import type { CardsSeatView } from '../../../../shared/cards/room.ts';
import { getCardsTable, type CardsTableId } from '../../../../shared/cards/tables.ts';
import type { CardsFrame } from '../sequence.ts';
import { Environment, envLook, reflectionsFor } from '../../three/environments/index.tsx';
import { SceneEnv } from '../../three/SceneEnv.tsx';
import { ShaderGate, setupRenderer } from '../../three/shaderGate.tsx';
import { ModelTable, WithModel, preloadModels } from '../../three/models.tsx';
import { liteAssets, noteGpu, strongDevice, weakDevice, type Quality } from '../../three/quality.ts';
import { CutsceneOverlay } from '../../three/cinematics/Overlay.tsx';
import { loadCardAtlas, type CardAtlas } from './cardAtlas.ts';
import { CardsLayer } from './Cards3D.tsx';
import { Seats } from './Seats3D.tsx';
import { ColourGlow, DirectionRing, Felt, TableConfetti } from './TableFx.tsx';
import { LastCardFire } from './LastCardFire.tsx';
import { CardsCamera } from './CardsCamera.tsx';
import { DISCARD, FAN_R, FELT_Y, PILE, TABLE_TOP, seatAngles, seatPos } from './layout.ts';
import type { SceneState } from './state.ts';

preloadModels(false);

export interface CardsSceneProps {
  view: CardsView;
  /** Where the table is played: the room's setting. */
  table: CardsTableId;
  frame: CardsFrame;
  seats: Record<string, CardsSeatView>;
  me: string | null;
  myTurn: boolean;
  compact: boolean;
  quality: Quality;
  reduced: boolean;
  cinematic: boolean;
  canDraw: boolean;
  onDraw: () => void;
  /** The match winner, while the podium plays. */
  podium: string | null;
  onPodiumDone: () => void;
  handEl: RefObject<HTMLElement | null>;
  handRects: Map<number, DOMRect>;
  chipEls: Map<string, HTMLElement>;
  fxEl: RefObject<HTMLElement | null>;
}

/** The atlas, once it is built (started by the lobby; a few hundred ms otherwise). */
function useCardAtlas(): CardAtlas | null {
  const [atlas, setAtlas] = useState<CardAtlas | null>(null);
  useEffect(() => {
    let live = true;
    loadCardAtlas().then(a => { if (live) setAtlas(a); }).catch(e => console.warn('card atlas', e));
    return () => { live = false; };
  }, []);
  return atlas;
}

/** The code-drawn table while the modelled one loads (or if it cannot). */
function DrawnTable({ color }: { color: string }) {
  return (
    <group>
      <mesh receiveShadow position={[0, TABLE_TOP - 0.25, 0]}>
        <cylinderGeometry args={[8.6, 8.9, 0.5, 96]} />
        <meshStandardMaterial color={color} roughness={0.55} metalness={0.05} />
      </mesh>
      <mesh position={[0, -2.6, 0]}>
        <cylinderGeometry args={[1.2, 2.2, 4, 32]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
    </group>
  );
}

const v = new Vector3();

/**
 * Pins the DOM HUD to the scene: each seat's chip over its figure, the
 * colour chip under the discard pile, and the staged flashes ("Skipped!",
 * "+4", "Caught!") over whoever they are about. Runs after the frame has
 * rendered (priority 2), so the matrices are this frame's.
 */
function Pinner({ state }: { state: RefObject<SceneState | null> }) {
  const { camera, size } = useThree();
  useFrame(() => {
    const st = state.current;
    if (!st) return;
    /** `above`: the element stands on the point (a seat chip), so keep its full height inside the stage. */
    const place = (el: HTMLElement, above = 0) => {
      v.project(camera);
      el.style.left = `${((v.x + 1) / 2) * size.width}px`;
      el.style.top = `${Math.max(above, ((1 - v.y) / 2) * size.height)}px`;
    };
    for (const [id, obj] of st.anchors) {
      const el = st.chipEls.get(id);
      if (!el) continue;
      v.setFromMatrixPosition(obj.matrixWorld);
      place(el, el.offsetHeight + 6);
    }
    const colour = st.chipEls.get('colour');
    if (colour) { v.set(DISCARD.x, FELT_Y + 0.05, DISCARD.z + 1.4); place(colour); }
    const fx = st.fxEl.current;
    if (fx && st.frame.active.length) {
      for (const el of fx.querySelectorAll<HTMLElement>('[data-at]')) {
        const at = el.dataset.at!;
        if (at === 'pile') v.set(PILE.x, FELT_Y + 0.6, PILE.z);
        else if (at === 'discard') v.set(DISCARD.x, FELT_Y + 0.6, DISCARD.z);
        else {
          // Over the player's fan, in front of them on the felt: clear of their chip.
          const a = st.angles.get(at);
          if (a === undefined) continue;
          if (at === st.me && !st.showMe) v.set(0, FELT_Y + 0.4, 3.4);
          else seatPos(a, FAN_R - 1.1, v).setY(FELT_Y + 1.1);
        }
        place(el);
      }
    }
  }, 2);
  return null;
}

/** Live shadows paused without taking them off the light (see BoardScene): no shader relink mid-game. */
function useShadowPause(light: RefObject<DirectionalLight | null>, paused: boolean) {
  useEffect(() => {
    const l = light.current;
    if (!l) return;
    if (paused) l.shadow.camera.layers.disableAll();
    else l.shadow.camera.layers.set(0);
    l.shadow.autoUpdate = !paused;
    l.shadow.needsUpdate = true;
  }, [light, paused]);
}

function CardsScene(props: CardsSceneProps) {
  const { view, table, frame, seats, me, myTurn, compact, quality, reduced, cinematic, canDraw, onDraw, podium, onPodiumDone, handEl, handRects, chipEls, fxEl } = props;
  // The setting's room, in the edition whose room it is; the felt and table finish in its colours.
  const setting = getCardsTable(table);
  const theme = useMemo(() => resolveTheme(setting.themeId, 'classic'), [setting.themeId]);
  const look = useMemo(() => envLook(setting.environment, theme), [setting.environment, theme]);
  const reflect = useMemo(() => reflectionsFor(setting.environment, setting.themeId), [setting.environment, setting.themeId]);
  const angles = useMemo(() => seatAngles(view.players, me, compact), [view.players, me, compact]);
  const state = useRef<SceneState | null>(null);
  // Written during render, so this very frame reads the newest view.
  state.current = {
    view, frame, seats, me, angles, myTurn, podium, reduced, cinematic, canDraw, onDraw, onPodiumDone, handEl, handRects, chipEls, fxEl,
    anchors: state.current?.anchors ?? new Map(),
    showMe: state.current?.showMe ?? false,
  };
  const atlas = useCardAtlas();

  const [autoDpr, setDpr] = useState(() => (weakDevice() ? 1 : Math.min(1.5, window.devicePixelRatio || 1)));
  const [autoLow, setLowPower] = useState(weakDevice);
  const [lite] = useState(() => liteAssets(quality));
  const [strong, setStrong] = useState(strongDevice);
  const dpr = quality === 'low' ? 1 : quality === 'high' ? Math.min(strong ? 2 : 1.5, window.devicePixelRatio || 1) : autoDpr;
  const lowPower = quality === 'low' ? true : quality === 'high' ? false : autoLow;
  const castShadow = quality === 'low' ? false : quality === 'high' ? true : !weakDevice();
  const keyLight = useRef<DirectionalLight>(null);
  useShadowPause(keyLight, lowPower);
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  return (
    <>
      <Canvas shadows dpr={dpr} frameloop={hidden ? 'never' : 'always'} camera={{ position: [0, 7.6, 11.4], fov: 40, near: 0.1, far: 120 }}
        className="ct-canvas" data-no-edit
        onCreated={({ gl, scene }) => {
          setupRenderer(gl);
          noteGpu(gl.getContext());
          setStrong(strongDevice());
          if (location.search.includes('perf')) Object.assign(window, { __yotGl: gl, __yotScene: scene, __yotCards: state });
        }}>
        <color attach="background" args={[look.background]} />
        <fog attach="fog" args={[look.background, look.fogNear, look.fogFar]} />
        <Environment kind={setting.environment} theme={theme} lite={lite} />
        <SceneEnv {...reflect} />
        <directionalLight ref={keyLight} castShadow={castShadow} position={[5, 12, 6]} intensity={look.keyIntensity} color={look.keyColor}
          shadow-mapSize={quality === 'high' ? [2048, 2048] : [1024, 1024]} shadow-camera-left={-9} shadow-camera-right={9}
          shadow-camera-top={9} shadow-camera-bottom={-9} shadow-bias={-0.0004} />
        <WithModel fallback={<DrawnTable color={setting.look.wood} />}>
          <ModelTable color={setting.look.wood} roughness={0.5} metalness={0.08} />
        </WithModel>
        <Felt look={setting.look} />
        <DirectionRing state={state} />
        <ColourGlow state={state} />
        {atlas && <CardsLayer atlas={atlas} state={state} castShadow={castShadow && !lowPower} />}
        <Seats players={view.players} seats={seats} state={state} lite={lite} />
        <LastCardFire state={state} lite={lite} />
        <TableConfetti />
        <CardsCamera state={state} compact={compact} />
        <Pinner state={state} />
        <PerformanceMonitor ms={250} iterations={6} bounds={hz => (hz > 100 ? [60, 100] : [42, 60])}
          onDecline={() => { setDpr(1); setLowPower(true); }}
          onIncline={() => setDpr(Math.min(1.5, window.devicePixelRatio || 1))}
          flipflops={3} onFallback={() => { setDpr(1); setLowPower(true); }} />
        <ShaderGate />
      </Canvas>
      <CutsceneOverlay />
    </>
  );
}

export default memo(CardsScene);
