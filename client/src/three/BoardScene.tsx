import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, PerformanceMonitor } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MeshStandardMaterial, Vector3, type Group, type Mesh } from 'three';
import { resolveTheme, type Theme } from '../../../shared/themes.ts';
import { getMap } from '../../../shared/maps.ts';
import type { GameView } from '../../../shared/types.ts';
import { cleanAssetUrl, getTablePreset, type TableStyle } from '../../../shared/tableStyles.ts';
import { boardTexture } from './boardTexture.ts';
import { C, W, buildingSpots, tile, tileAt, tileWidth } from './layout.ts';
import { Pieces, type PieceReaction } from './characters/Pieces.tsx';
import { Environment, FLOOR, TABLE_R, envLook } from './environments/index.tsx';
import { Dice } from './Dice.tsx';
import { CameraDirector } from './CameraDirector.tsx';
import { MoneyFX } from './MoneyFX.tsx';
import { SceneEnv } from './SceneEnv.tsx';
import { isDirectorActive, pieceObjects, type CameraMode } from './camera.ts';
import { ASSETS } from './assets.gen.ts';
import { ModelBuildings, ModelTable, WithModel, preloadModels, type BuildingSpot } from './models.tsx';

preloadModels();

const THICK = 0.28;

function Board({ theme, customLogo, onPick, onHover }: {
  theme: Theme;
  /** A room's own centre logo; wins over the edition's artwork. */
  customLogo?: string | null;
  onPick?: (i: number | null) => void;
  onHover?: (i: number | null) => void;
}) {
  // Redraw once web fonts are ready so the board text uses them.
  const [fontsReady, setFontsReady] = useState(0);
  useEffect(() => { document.fonts?.ready.then(() => setFontsReady(n => n + 1)); }, []);
  // The board's own face may not be used anywhere in the page yet: ask for it
  // outright, then repaint once it is in.
  const boardFace = theme.ui?.boardFont ?? theme.ui?.font;
  useEffect(() => {
    if (!boardFace || !document.fonts) return;
    let cancelled = false;
    Promise.all([document.fonts.load(`700 40px ${boardFace}`), document.fonts.load(`600 40px ${boardFace}`)])
      .then(() => { if (!cancelled) setFontsReady(n => n + 1); }).catch(() => {});
    return () => { cancelled = true; };
  }, [boardFace]);
  // Editions with artwork: load it, then redraw the board with it in place.
  // A room's custom logo takes the edition artwork's place. It is painted into
  // a WebGL texture, so it must load with CORS: an https image whose host does
  // not allow that fails here, and the edition's own artwork is used instead.
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    setLogo(null);
    const urls = [customLogo, theme.logoUrl].filter((u): u is string => !!u);
    let cancelled = false;
    const load = (i: number) => {
      if (i >= urls.length) return;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { if (!cancelled) setLogo(img); };
      img.onerror = () => { if (!cancelled) load(i + 1); };
      img.src = urls[i];
    };
    load(0);
    return () => { cancelled = true; };
  }, [theme.logoUrl, customLogo]);
  const tex = useMemo(() => boardTexture(theme, logo), [theme, fontsReady, logo]);
  useEffect(() => () => tex.dispose(), [tex]);

  const materials = useMemo(() => {
    const side = new MeshStandardMaterial({ color: theme.palette.boardLine, roughness: 0.6 });
    const top = new MeshStandardMaterial({ map: tex, roughness: 0.75 });
    return [side, side, top, side, side, side];
  }, [tex, theme]);
  useEffect(() => () => { materials[0].dispose(); materials[2].dispose(); }, [materials]);

  const pick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onPick?.(tileAt(e.point.x, e.point.z, theme.spaces.length));
  };
  const hover = (e: ThreeEvent<PointerEvent>) => onHover?.(tileAt(e.point.x, e.point.z, theme.spaces.length));

  return (
    <mesh receiveShadow material={materials} position={[0, -THICK / 2, 0]}
      onClick={pick} onPointerMove={hover} onPointerOut={() => onHover?.(null)}>
      <boxGeometry args={[W, THICK, W]} />
    </mesh>
  );
}

function Table({ theme, presetId }: { theme: Theme; presetId?: string }) {
  // The room's table preset, or the edition's own colour for 'edition'.
  const preset = getTablePreset(presetId);
  const color = preset.color ?? theme.palette.table;
  return (
    <WithModel fallback={<DrawnTable color={color} roughness={preset.roughness} metalness={preset.metalness} />}>
      <ModelTable color={color} roughness={preset.roughness} metalness={preset.metalness} />
    </WithModel>
  );
}

/** The code-drawn table: shown while the modelled one loads (or if it cannot). */
function DrawnTable({ color, roughness, metalness }: { color: string; roughness: number; metalness: number }) {
  const preset = { roughness, metalness };
  // Pedestal from under the top down to the environment's floor.
  const legTop = -THICK - 0.5;
  const leg = legTop - FLOOR;
  return (
    <group>
      <mesh receiveShadow position={[0, -THICK - 0.25, 0]}>
        <cylinderGeometry args={[TABLE_R, TABLE_R + 0.3, 0.5, 96]} />
        <meshStandardMaterial color={color} roughness={preset.roughness} metalness={preset.metalness} />
      </mesh>
      <mesh position={[0, legTop - leg / 2, 0]}>
        <cylinderGeometry args={[1.2, 2.2, leg, 32]} />
        <meshStandardMaterial color={color} roughness={Math.min(1, preset.roughness + 0.05)} metalness={preset.metalness} />
      </mesh>
      <mesh position={[0, FLOOR + 0.15, 0]}>
        <cylinderGeometry args={[3, 3.2, 0.3, 32]} />
        <meshStandardMaterial color={color} roughness={Math.min(1, preset.roughness + 0.05)} metalness={preset.metalness} />
      </mesh>
    </group>
  );
}

/** Tile outline glow for hover / selection. */
function TileHighlight({ index, color, pulse, n }: { index: number | null; color: string; pulse?: boolean; n: number }) {
  const ref = useRef<Mesh>(null);
  useFrame(() => {
    if (ref.current && pulse) {
      const m = ref.current.material as MeshStandardMaterial;
      m.opacity = 0.35 + Math.sin(performance.now() / 200) * 0.15;
    }
  });
  if (index === null) return null;
  const g = tile(index, n);
  const along = g.corner ? C : tileWidth(n);
  const w = g.out[0] !== 0 ? C : along;
  const d = g.out[0] !== 0 ? along : C;
  return (
    <mesh ref={ref} position={[g.x, 0.004, g.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[w, d]} />
      <meshStandardMaterial color={color} transparent opacity={0.35} emissive={color} emissiveIntensity={0.6} depthWrite={false} />
    </mesh>
  );
}

function Ownership({ game, theme }: { game: GameView; theme: Theme }) {
  const colorOf = useMemo(() => Object.fromEntries(game.players.map(p => [p.id, p.color])), [game.players]);
  const n = theme.spaces.length;
  const T = tileWidth(n);
  return (
    <group>
      {Object.entries(game.owned).map(([k, o]) => {
        const i = Number(k);
        const g = tile(i, n);
        // A strip along the tile's outer edge in the owner's colour.
        const inset = C / 2 - 0.06;
        const x = g.x + g.out[0] * inset, z = g.z + g.out[1] * inset;
        const horiz = g.out[0] === 0;
        return (
          <mesh key={i} position={[x, 0.02, z]}>
            <boxGeometry args={horiz ? [T * 0.86, 0.04, 0.08] : [0.08, 0.04, T * 0.86]} />
            <meshStandardMaterial color={o.mortgaged ? '#666' : colorOf[o.owner]} emissive={o.mortgaged ? '#000' : colorOf[o.owner]} emissiveIntensity={0.35} />
          </mesh>
        );
      })}
      {Object.entries(game.owned).filter(([, o]) => o.mortgaged).map(([k]) => {
        const g = tile(Number(k), n);
        const horiz = g.out[0] === 0;
        return (
          <mesh key={`m${k}`} position={[g.x, 0.006, g.z]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={horiz ? [T, C] : [C, T]} />
            <meshBasicMaterial color="#000" transparent opacity={0.45} depthWrite={false} />
          </mesh>
        );
      })}
      <Buildings game={game} theme={theme} />
    </group>
  );
}

function Buildings({ game, theme }: { game: GameView; theme: Theme }) {
  const house = theme.palette.house ?? '#1f9d49';
  const hotel = theme.palette.hotel ?? '#d2202f';
  const spots: BuildingSpot[] = Object.entries(game.owned).flatMap(([k, o]) => {
    const i = Number(k);
    if (!o.houses) return [];
    const g = tile(i, theme.spaces.length);
    const rotY = g.out[0] === 0 ? 0 : Math.PI / 2;
    return buildingSpots(i, o.houses, theme.spaces.length).map(([x, z], n) => ({
      key: o.houses === 5 ? `${i}-h` : `${i}-${n}`, x, z, rotY, hotel: o.houses === 5,
    }));
  });
  if (!spots.length) return null;
  return (
    <WithModel fallback={<DrawnBuildings spots={spots} house={house} hotel={hotel} />}>
      <ModelBuildings spots={spots} house={house} hotel={hotel} />
    </WithModel>
  );
}

function DrawnBuildings({ spots, house, hotel }: { spots: BuildingSpot[]; house: string; hotel: string }) {
  return (
    <group>
      {spots.map(({ key, x, z, rotY, hotel: big }) =>
        big ? (
          <group key={key} position={[x, 0, z]} rotation={[0, rotY, 0]}>
            <mesh castShadow position={[0, 0.1, 0]}><boxGeometry args={[0.36, 0.2, 0.2]} /><meshStandardMaterial color={hotel} roughness={0.4} /></mesh>
            <mesh castShadow position={[0, 0.24, 0]} rotation={[0, 0, Math.PI / 4]} scale={[1, 1, 1]}><boxGeometry args={[0.12, 0.12, 0.2]} /><meshStandardMaterial color={hotel} roughness={0.6} /></mesh>
          </group>
        ) : (
          <group key={key} position={[x, 0, z]} rotation={[0, rotY, 0]}>
            <mesh castShadow position={[0, 0.06, 0]}><boxGeometry args={[0.13, 0.12, 0.15]} /><meshStandardMaterial color={house} roughness={0.4} /></mesh>
            <mesh castShadow position={[0, 0.15, 0]} rotation={[0, 0, Math.PI / 4]}><boxGeometry args={[0.1, 0.1, 0.15]} /><meshStandardMaterial color={house} roughness={0.6} /></mesh>
          </group>
        ),
      )}
    </group>
  );
}

/**
 * The camera. "Table" frames the whole table from the player's side (pulled
 * back on narrow screens); "Follow" trails whoever is playing round the board;
 * "Overhead" looks straight down; "Free" leaves it all to the player. Changes
 * of view glide rather than cut, and a cinematic shot (CameraDirector) owns
 * the camera while it plays.
 */
function CameraRig({ hud, fogNear, fogFar, mode, followId }: {
  hud: boolean; fogNear: number; fogFar: number; mode: CameraMode; followId?: string;
}) {
  const { camera, size, scene, controls } = useThree() as unknown as {
    camera: import('three').PerspectiveCamera; size: { width: number; height: number }; scene: import('three').Scene;
    controls: { target: Vector3; enabled: boolean; enablePan: boolean; maxPolarAngle: number; minDistance: number; maxDistance: number; update: () => void } | null;
  };
  const aspect = size.width / size.height;
  // HUD panels eat the sides on desktop, so frame a little wider there.
  const need = hud && size.width > 760 ? 1.45 : 1.1;
  const k = Math.max(1, need / aspect) * (hud ? 1.05 : 1);
  const tablePos = useMemo(() => (aspect < 1 ? new Vector3(0, 15.5 * k, 5 * k) : new Vector3(0, 13 * k, 11.5 * k)), [aspect, k]);
  const glide = useRef<{ from: Vector3; fromT: Vector3; to: Vector3; toT: Vector3; t0: number } | null>(null);
  const first = useRef(true);

  useEffect(() => {
    // Keep the fog behind the board however far back the camera sits.
    if (scene.fog && 'near' in scene.fog) {
      scene.fog.near = fogNear * k * (mode === 'top' ? 1.4 : 1);
      scene.fog.far = fogFar * k * (mode === 'top' ? 1.4 : 1);
    }
  }, [scene, k, fogNear, fogFar, mode]);

  // Table/free: glide to the framed table view when chosen (or on resize); the first time, just be there.
  useEffect(() => {
    if (mode !== 'table' && mode !== 'free') return;
    if (first.current) {
      first.current = false;
      camera.position.copy(tablePos);
      camera.lookAt(0, 0, 0);
      return;
    }
    if (mode === 'free') return; // free keeps wherever the player left it
    glide.current = { from: camera.position.clone(), fromT: controls?.target.clone() ?? new Vector3(), to: tablePos.clone(), toT: new Vector3(), t0: performance.now() };
  }, [mode, tablePos, camera, controls]);

  useFrame((_, delta) => {
    if (!controls) return;
    const directing = isDirectorActive();
    controls.enablePan = mode === 'free';
    controls.maxPolarAngle = mode === 'free' ? Math.PI / 2.05 : Math.PI / 2.4;
    controls.minDistance = mode === 'free' ? 2.5 : 6;
    if (directing) return;
    controls.enabled = mode === 'table' || mode === 'free';
    const dt = Math.min(delta, 0.1);
    if (mode === 'follow' || mode === 'top') {
      glide.current = null;
      let pos: Vector3, target: Vector3;
      const piece = followId ? pieceObjects.get(followId) : undefined;
      if (mode === 'follow' && piece) {
        // Behind the piece, outside the board edge, looking past it into the board.
        const p = piece.position;
        const out = tmpOut.set(p.x, 0, p.z);
        if (out.lengthSq() < 0.01) out.set(0, 0, 1);
        out.normalize();
        // Close enough to see the character, high enough to keep the board ahead in view;
        // the target sits just past the piece so it lands mid-frame, clear of the HUD.
        pos = tmpPos.set(p.x + out.x * 3.4, 3.1 + p.y * 0.3, p.z + out.z * 3.4);
        target = tmpTarget.set(p.x * 0.72, 0.1, p.z * 0.72);
      } else {
        // Nearly straight down; the slight tilt keeps the board square to the screen (straight down has no 'up').
        pos = tmpPos.set(0, 17.5 * Math.max(1, 1 / aspect), 1.6);
        target = tmpTarget.set(0, 0, 0);
      }
      const f = 1 - Math.exp(-3.2 * dt);
      camera.position.lerp(pos, f);
      controls.target.lerp(target, f);
      camera.lookAt(controls.target);
      controls.update();
      return;
    }
    const g = glide.current;
    if (g) {
      const t = Math.min(1, (performance.now() - g.t0) / 900);
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      camera.position.lerpVectors(g.from, g.to, e);
      controls.target.lerpVectors(g.fromT, g.toT, e);
      camera.lookAt(controls.target);
      controls.update();
      if (t >= 1) glide.current = null;
    }
  });
  return null;
}

const tmpOut = new Vector3();
const tmpPos = new Vector3();
const tmpTarget = new Vector3();

function Spinner({ children, spin }: { children: React.ReactNode; spin?: boolean }) {
  const ref = useRef<Group>(null);
  useFrame((_, dt) => { if (spin && ref.current) ref.current.rotation.y += dt * 0.08; });
  return <group ref={ref}>{children}</group>;
}

export default function BoardScene({ themeId, mapId, game, selected, onSelect, spin, tableStyle, reactions, me, cinematic = false, cameraMode = 'table' }: {
  themeId: string;
  mapId: string;
  game: GameView | null;
  selected?: number | null;
  onSelect?: (i: number | null) => void;
  spin?: boolean;
  /** The room's table look (preset, centre logo, backdrop); absent = the edition's. */
  tableStyle?: TableStyle | null;
  /** Emoji reactions to pop over the characters, by player id. */
  reactions?: Record<string, PieceReaction>;
  /** The viewer (for shots of their own buys and builds). */
  me?: string;
  /** Swoop the camera down for the big moments (CameraDirector). */
  cinematic?: boolean;
  /** The viewer's chosen view (table, follow, overhead, free). */
  cameraMode?: CameraMode;
}) {
  const theme = resolveTheme(themeId, mapId);
  // Re-checked here as well as on the server: this string ends up in CSS.
  const backdrop = cleanAssetUrl(tableStyle?.backgroundUrl);
  const customLogo = cleanAssetUrl(tableStyle?.boardLogoUrl);
  const env = getMap(mapId).environment;
  const look = envLook(env, theme);
  const [hover, setHover] = useState<number | null>(null);
  // Adaptive resolution: start sharp, drop to 1× device pixels as soon as the
  // frame rate sags (phones, integrated GPUs), climb back when there is headroom.
  const [dpr, setDpr] = useState(() => Math.min(1.5, window.devicePixelRatio || 1));
  // Once a device has shown it struggles, keep the cheaper shadows for the session.
  const [lowPower, setLowPower] = useState(false);
  // Stop rendering entirely while the tab is in the background.
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  useEffect(() => {
    document.body.style.cursor = hover !== null && onSelect ? 'pointer' : '';
    return () => { document.body.style.cursor = ''; };
  }, [hover, onSelect]);

  return (
    <Canvas shadows dpr={dpr} frameloop={hidden ? 'never' : 'always'} camera={{ position: [0, 11.5, 10.5], fov: 45 }}
      onPointerMissed={() => onSelect?.(null)}
      // A custom backdrop replaces the map's 3D surroundings: it is painted
      // behind a transparent canvas, keeps its aspect ratio on any screen and
      // needs no CORS, so any https image works.
      style={backdrop ? { background: `${theme.palette.sky} url("${backdrop}") center / cover no-repeat` } : undefined}>
      {!backdrop && <color attach="background" args={[look.background]} />}
      {/* Fog fades the scene into the sky colour, which would look wrong against a picture. */}
      {!backdrop && <fog attach="fog" args={[look.background, look.fogNear, look.fogFar]} />}
      {backdrop
        ? <hemisphereLight args={['#ffffff', theme.palette.table, 0.9]} />
        : <Environment kind={env} theme={theme} />}
      {/* Reflections for everything lit live. The Classic room reflects itself
          (a Blender panorama, centred on the back wall; three's equirect is
          centred on +x, hence the quarter turn). */}
      {env === 'lounge' && theme.id === 'classic' && !backdrop
        ? <SceneEnv url={ASSETS.classicEnv.url} intensity={0.6} rotation={-Math.PI / 2} />
        : <SceneEnv intensity={0.45} />}
      <directionalLight castShadow position={[6, 12, 5]} intensity={look.keyIntensity} color={look.keyColor}
        shadow-mapSize={[lowPower ? 1024 : 2048, lowPower ? 1024 : 2048]} shadow-camera-left={-8} shadow-camera-right={8}
        shadow-camera-top={8} shadow-camera-bottom={-8} shadow-bias={-0.0004} />

      <Spinner spin={spin}>
        <Table theme={theme} presetId={tableStyle?.table} />
        <Board theme={theme} customLogo={customLogo} onPick={onSelect} onHover={onSelect ? setHover : undefined} />
        <TileHighlight index={hover} color="#ffffff" n={theme.spaces.length} />
        <TileHighlight index={selected ?? null} color={theme.palette.accent} pulse n={theme.spaces.length} />
        {game && (
          <>
            <Ownership game={game} theme={theme} />
            <Pieces game={game} n={theme.spaces.length} reactions={reactions} />
            <MoneyFX game={game} n={theme.spaces.length} currency={theme.currency} />
            <Dice dice={game.dice} seq={game.rollSeq} speed={game.speed ?? null} body={theme.palette.die} pip={theme.palette.pip} />
          </>
        )}
        {!game && <Dice dice={[6, 6]} seq={0} body={theme.palette.die} pip={theme.palette.pip} />}
      </Spinner>

      <PerformanceMonitor
        onDecline={() => { setDpr(1); setLowPower(true); }}
        onIncline={() => setDpr(Math.min(1.5, window.devicePixelRatio || 1))}
        flipflops={3} onFallback={() => { setDpr(1); setLowPower(true); }} />
      <CameraRig hud={!!game} fogNear={look.fogNear} fogFar={look.fogFar} mode={spin ? 'table' : cameraMode} followId={game?.current} />
      {game && !spin && <CameraDirector game={game} me={me} n={theme.spaces.length} enabled={cinematic} />}
      <OrbitControls makeDefault enablePan={false} enabled={!spin}
        minDistance={6} maxDistance={60} minPolarAngle={0.05} maxPolarAngle={Math.PI / 2.4}
        enableDamping dampingFactor={0.12}
        target={[0, 0, 0]} />
    </Canvas>
  );
}
