import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, OrbitControls, PerformanceMonitor } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MeshStandardMaterial, type Group, type Mesh } from 'three';
import { resolveTheme, type Theme } from '../../../shared/themes.ts';
import { getMap } from '../../../shared/maps.ts';
import type { GameView } from '../../../shared/types.ts';
import { cleanAssetUrl, getTablePreset, type TableStyle } from '../../../shared/tableStyles.ts';
import { boardTexture } from './boardTexture.ts';
import { C, W, buildingSpots, tile, tileAt, tileWidth } from './layout.ts';
import { Pieces, type PieceReaction } from './characters/Pieces.tsx';
import { Environment, FLOOR, TABLE_R, envLook } from './environments/index.tsx';
import { Dice } from './Dice.tsx';

const THICK = 0.28;

function Board({ theme, customLogo, onPick, onHover }: {
  theme: Theme;
  /** A room's own centre logo; wins over the edition's artwork. */
  customLogo?: string | null;
  onPick?: (i: number | null) => void;
  onHover?: (i: number | null) => void;
}) {
  // Redraw once web fonts are ready so the board text uses them.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => { document.fonts?.ready.then(() => setFontsReady(true)); }, []);
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
  return (
    <group>
      {Object.entries(game.owned).flatMap(([k, o]) => {
        const i = Number(k);
        if (!o.houses) return [];
        const g = tile(i, theme.spaces.length);
        const rotY = g.out[0] === 0 ? 0 : Math.PI / 2;
        return buildingSpots(i, o.houses, theme.spaces.length).map(([x, z], n) =>
          o.houses === 5 ? (
            <group key={`${i}-h`} position={[x, 0, z]} rotation={[0, rotY, 0]}>
              <mesh castShadow position={[0, 0.1, 0]}><boxGeometry args={[0.36, 0.2, 0.2]} /><meshStandardMaterial color={hotel} roughness={0.4} /></mesh>
              <mesh castShadow position={[0, 0.24, 0]} rotation={[0, 0, Math.PI / 4]} scale={[1, 1, 1]}><boxGeometry args={[0.12, 0.12, 0.2]} /><meshStandardMaterial color={hotel} roughness={0.6} /></mesh>
            </group>
          ) : (
            <group key={`${i}-${n}`} position={[x, 0, z]} rotation={[0, rotY, 0]}>
              <mesh castShadow position={[0, 0.06, 0]}><boxGeometry args={[0.13, 0.12, 0.15]} /><meshStandardMaterial color={house} roughness={0.4} /></mesh>
              <mesh castShadow position={[0, 0.15, 0]} rotation={[0, 0, Math.PI / 4]}><boxGeometry args={[0.1, 0.1, 0.15]} /><meshStandardMaterial color={house} roughness={0.6} /></mesh>
            </group>
          ),
        );
      })}
    </group>
  );
}

/** Pull the camera back on narrow screens so the whole board stays in view. */
function CameraFit({ hud, fogNear, fogFar }: { hud: boolean; fogNear: number; fogFar: number }) {
  const { camera, size, scene } = useThree();
  useEffect(() => {
    const aspect = size.width / size.height;
    // HUD panels eat the sides on desktop, so frame a little wider there.
    const need = hud && size.width > 760 ? 1.45 : 1.1;
    const k = Math.max(1, need / aspect) * (hud ? 1.05 : 1);
    // Portrait screens look down more steeply so the board fills the height.
    if (aspect < 1) camera.position.set(0, 15.5 * k, 5 * k);
    else camera.position.set(0, 13 * k, 11.5 * k);
    camera.lookAt(0, 0, 0);
    // Keep the fog behind the board however far back the camera sits.
    if (scene.fog && 'near' in scene.fog) {
      scene.fog.near = fogNear * k;
      scene.fog.far = fogFar * k;
    }
  }, [camera, scene, size.width, size.height, hud, fogNear, fogFar]);
  return null;
}

function Spinner({ children, spin }: { children: React.ReactNode; spin?: boolean }) {
  const ref = useRef<Group>(null);
  useFrame((_, dt) => { if (spin && ref.current) ref.current.rotation.y += dt * 0.08; });
  return <group ref={ref}>{children}</group>;
}

export default function BoardScene({ themeId, mapId, game, selected, onSelect, spin, tableStyle, reactions }: {
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

  useEffect(() => {
    document.body.style.cursor = hover !== null && onSelect ? 'pointer' : '';
    return () => { document.body.style.cursor = ''; };
  }, [hover, onSelect]);

  return (
    <Canvas shadows dpr={dpr} camera={{ position: [0, 11.5, 10.5], fov: 45 }}
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
      <directionalLight castShadow position={[6, 12, 5]} intensity={look.keyIntensity} color={look.keyColor}
        shadow-mapSize={[2048, 2048]} shadow-camera-left={-8} shadow-camera-right={8}
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
            <Dice dice={game.dice} seq={game.rollSeq} body={theme.palette.die} pip={theme.palette.pip} />
          </>
        )}
        {!game && <Dice dice={[6, 6]} seq={0} body={theme.palette.die} pip={theme.palette.pip} />}
      </Spinner>
      <ContactShadows position={[0, 0.001, 0]} scale={W} opacity={0.35} blur={2.2} far={1} />

      <PerformanceMonitor
        onDecline={() => setDpr(1)}
        onIncline={() => setDpr(Math.min(1.5, window.devicePixelRatio || 1))}
        flipflops={3} onFallback={() => setDpr(1)} />
      <CameraFit hud={!!game} fogNear={look.fogNear} fogFar={look.fogFar} />
      <OrbitControls makeDefault enablePan={false} enabled={!spin}
        minDistance={6} maxDistance={60} minPolarAngle={0.05} maxPolarAngle={Math.PI / 2.4}
        target={[0, 0, 0]} />
    </Canvas>
  );
}
