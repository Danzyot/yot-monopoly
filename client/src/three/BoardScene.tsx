import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MeshStandardMaterial, type Group, type Mesh } from 'three';
import { getTheme, type Theme } from '../../../shared/themes.ts';
import type { GameView } from '../../../shared/types.ts';
import { boardTexture } from './boardTexture.ts';
import { C, T, W, buildingSpots, tile, tileAt } from './layout.ts';
import { Tokens } from './Tokens.tsx';
import { Dice } from './Dice.tsx';

const THICK = 0.28;

function Board({ theme, onPick, onHover }: {
  theme: Theme;
  onPick?: (i: number | null) => void;
  onHover?: (i: number | null) => void;
}) {
  // Redraw once web fonts are ready so the board text uses them.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => { document.fonts?.ready.then(() => setFontsReady(true)); }, []);
  const tex = useMemo(() => boardTexture(theme), [theme, fontsReady]);
  useEffect(() => () => tex.dispose(), [tex]);

  const materials = useMemo(() => {
    const side = new MeshStandardMaterial({ color: theme.palette.boardLine, roughness: 0.6 });
    const top = new MeshStandardMaterial({ map: tex, roughness: 0.75 });
    return [side, side, top, side, side, side];
  }, [tex, theme]);

  const pick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onPick?.(tileAt(e.point.x, e.point.z));
  };
  const hover = (e: ThreeEvent<PointerEvent>) => onHover?.(tileAt(e.point.x, e.point.z));

  return (
    <mesh receiveShadow material={materials} position={[0, -THICK / 2, 0]}
      onClick={pick} onPointerMove={hover} onPointerOut={() => onHover?.(null)}>
      <boxGeometry args={[W, THICK, W]} />
    </mesh>
  );
}

function Table({ theme }: { theme: Theme }) {
  return (
    <group>
      <mesh receiveShadow position={[0, -THICK - 0.25, 0]}>
        <cylinderGeometry args={[11, 11.3, 0.5, 96]} />
        <meshStandardMaterial color={theme.palette.table} roughness={0.85} />
      </mesh>
      <mesh position={[0, -THICK - 3.5, 0]}>
        <cylinderGeometry args={[1.2, 2.2, 6, 32]} />
        <meshStandardMaterial color={theme.palette.table} roughness={0.9} />
      </mesh>
    </group>
  );
}

/** Tile outline glow for hover / selection. */
function TileHighlight({ index, color, pulse }: { index: number | null; color: string; pulse?: boolean }) {
  const ref = useRef<Mesh>(null);
  useFrame(() => {
    if (ref.current && pulse) {
      const m = ref.current.material as MeshStandardMaterial;
      m.opacity = 0.35 + Math.sin(performance.now() / 200) * 0.15;
    }
  });
  if (index === null) return null;
  const g = tile(index);
  const along = g.corner ? C : T;
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
  return (
    <group>
      {Object.entries(game.owned).map(([k, o]) => {
        const i = Number(k);
        const g = tile(i);
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
        const g = tile(Number(k));
        const horiz = g.out[0] === 0;
        return (
          <mesh key={`m${k}`} position={[g.x, 0.006, g.z]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={horiz ? [T, C] : [C, T]} />
            <meshBasicMaterial color="#000" transparent opacity={0.45} depthWrite={false} />
          </mesh>
        );
      })}
      <Buildings game={game} />
    </group>
  );
}

function Buildings({ game }: { game: GameView }) {
  return (
    <group>
      {Object.entries(game.owned).flatMap(([k, o]) => {
        const i = Number(k);
        if (!o.houses) return [];
        const g = tile(i);
        const rotY = g.out[0] === 0 ? 0 : Math.PI / 2;
        return buildingSpots(i, o.houses).map(([x, z], n) =>
          o.houses === 5 ? (
            <group key={`${i}-h`} position={[x, 0, z]} rotation={[0, rotY, 0]}>
              <mesh castShadow position={[0, 0.1, 0]}><boxGeometry args={[0.36, 0.2, 0.2]} /><meshStandardMaterial color="#d2202f" roughness={0.4} /></mesh>
              <mesh castShadow position={[0, 0.24, 0]} rotation={[0, 0, Math.PI / 4]} scale={[1, 1, 1]}><boxGeometry args={[0.12, 0.12, 0.2]} /><meshStandardMaterial color="#a8141f" /></mesh>
            </group>
          ) : (
            <group key={`${i}-${n}`} position={[x, 0, z]} rotation={[0, rotY, 0]}>
              <mesh castShadow position={[0, 0.06, 0]}><boxGeometry args={[0.13, 0.12, 0.15]} /><meshStandardMaterial color="#1f9d49" roughness={0.4} /></mesh>
              <mesh castShadow position={[0, 0.15, 0]} rotation={[0, 0, Math.PI / 4]}><boxGeometry args={[0.1, 0.1, 0.15]} /><meshStandardMaterial color="#17803a" /></mesh>
            </group>
          ),
        );
      })}
    </group>
  );
}

/** Pull the camera back on narrow screens so the whole board stays in view. */
function CameraFit({ hud }: { hud: boolean }) {
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
      scene.fog.near = 22 * k;
      scene.fog.far = 40 * k;
    }
  }, [camera, scene, size.width, size.height, hud]);
  return null;
}

function Spinner({ children, spin }: { children: React.ReactNode; spin?: boolean }) {
  const ref = useRef<Group>(null);
  useFrame((_, dt) => { if (spin && ref.current) ref.current.rotation.y += dt * 0.08; });
  return <group ref={ref}>{children}</group>;
}

export default function BoardScene({ themeId, game, selected, onSelect, spin }: {
  themeId: string;
  game: GameView | null;
  selected?: number | null;
  onSelect?: (i: number | null) => void;
  spin?: boolean;
}) {
  const theme = getTheme(themeId);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    document.body.style.cursor = hover !== null && onSelect ? 'pointer' : '';
    return () => { document.body.style.cursor = ''; };
  }, [hover, onSelect]);

  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 11.5, 10.5], fov: 45 }}
      onPointerMissed={() => onSelect?.(null)}>
      <color attach="background" args={[theme.palette.sky]} />
      <fog attach="fog" args={[theme.palette.sky, 22, 40]} />
      <hemisphereLight args={['#ffffff', theme.palette.table, 0.7]} />
      <directionalLight castShadow position={[6, 12, 5]} intensity={2.2}
        shadow-mapSize={[2048, 2048]} shadow-camera-left={-8} shadow-camera-right={8}
        shadow-camera-top={8} shadow-camera-bottom={-8} shadow-bias={-0.0004} />
      <pointLight position={[-8, 5, -6]} intensity={30} color={theme.palette.accent} />

      <Spinner spin={spin}>
        <Table theme={theme} />
        <Board theme={theme} onPick={onSelect} onHover={onSelect ? setHover : undefined} />
        <TileHighlight index={hover} color="#ffffff" />
        <TileHighlight index={selected ?? null} color={theme.palette.accent} pulse />
        {game && (
          <>
            <Ownership game={game} theme={theme} />
            <Tokens players={game.players} current={game.current} />
            <Dice dice={game.dice} seq={game.rollSeq} />
          </>
        )}
        {!game && <Dice dice={[6, 6]} seq={0} />}
      </Spinner>
      <ContactShadows position={[0, 0.001, 0]} scale={W} opacity={0.35} blur={2.2} far={1} />

      <CameraFit hud={!!game} />
      <OrbitControls makeDefault enablePan={false} enabled={!spin}
        minDistance={6} maxDistance={60} minPolarAngle={0.05} maxPolarAngle={Math.PI / 2.4}
        target={[0, 0, 0]} />
    </Canvas>
  );
}
