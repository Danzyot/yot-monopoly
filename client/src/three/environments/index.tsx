// Per-map surroundings. A map names its environment (shared/maps.ts); the
// edition's palette tints it. BoardScene asks `envLook` for the background,
// fog and key light, and renders <Environment> for everything else.

import type { EnvironmentId } from '../../../../shared/maps.ts';
import type { Theme } from '../../../../shared/themes.ts';
import { FLOOR, LiveLight, mix } from './common.tsx';
import { Lounge } from './Lounge.tsx';
import { BakedScene, ClassicRoom, WithModel, lightmapFor, type BakedAsset } from '../models.tsx';
import { liteAssets } from '../quality.ts';
import { useGLTF, useTexture } from '@react-three/drei';
import { ASSETS } from '../assets.gen.ts';
import { NightSky, Skyline } from './Skyline.tsx';
import { preloadPanorama } from '../SceneEnv.tsx';
import { Speedway } from './Speedway.tsx';

export { FLOOR, TABLE_R } from './common.tsx';

export interface EnvLook {
  /** Clear colour; the fog fades into the same colour. */
  background: string;
  /** Fog distances for the default camera; CameraFit scales them with zoom. */
  fogNear: number;
  fogFar: number;
  /** The shadow-casting light over the board. */
  keyColor: string;
  keyIntensity: number;
}

export function envLook(kind: EnvironmentId, theme: Theme): EnvLook {
  const { sky } = theme.palette;
  switch (kind) {
    case 'speedway':
      // The baked track at dusk: fog fades the far hills into the hazy horizon of its sky.
      return { background: '#cfa59c', fogNear: 60, fogFar: 340, keyColor: '#ffd9b5', keyIntensity: 2.0 };
    case 'skyline':
      // The haze the far towers fade into; the night sky's dome starts from the same colour.
      return { background: skylineHaze(theme), fogNear: 70, fogFar: 620, keyColor: '#ffeeda', keyIntensity: 1.8 };
    case 'arcade':
      // The dark hall the machines glow in; the fog only softens the far wall.
      return { background: '#0b0918', fogNear: 46, fogFar: 110, keyColor: '#ffe9f4', keyIntensity: 1.9 };
    case 'garden':
      // Summer afternoon: the pale haze on the horizon the hills fade into, bright sun.
      return { background: '#cfe2ef', fogNear: 80, fogFar: 430, keyColor: '#fff1dc', keyIntensity: 2.5 };
    case 'lounge':
    default:
      return { background: mix(sky, '#1d130c', 0.5), fogNear: 34, fogFar: 80, keyColor: '#fff2df', keyIntensity: 2.0 };
  }
}

/** `lite`: the half-size lightmaps (Low graphics, or Auto on a weak device). */
export function Environment({ kind, theme, lite = false }: { kind: EnvironmentId; theme: Theme; lite?: boolean }) {
  switch (kind) {
    case 'speedway':
      // A modelled, light-baked race track for every edition; the drawn one
      // shows while it loads (and stays if it cannot).
      return (
        <WithModel fallback={<Speedway theme={theme} ownLights={false} />} failed={<Speedway theme={theme} />} lights={<SpeedwayLights />}>
          <BakedScene asset={ASSETS.speedwaySet} lite={lite} />
        </WithModel>
      );
    case 'skyline':
      // Every edition gets the modelled, light-baked penthouse roof; the drawn
      // roof stands in while it loads (and for good if it cannot).
      return (
        <WithModel fallback={<Skyline theme={theme} ownLights={false} />} failed={<Skyline theme={theme} />} lights={<SkylineLights />}>
          <BakedScene asset={ASSETS.skylineSet} lite={lite} />
          <NightSky horizon={skylineHaze(theme)} />
        </WithModel>
      );
    case 'arcade':
      // Blitz: the arcade hall (tools/blender/arcade_set.py) for every edition;
      // the drawn lounge in the edition's palette stands in while it loads.
      return (
        <WithModel fallback={<Lounge theme={theme} ownLights={false} />} failed={<Lounge theme={theme} />} lights={<ArcadeLights />}>
          <BakedScene asset={ASSETS.arcadeSet} lite={lite} />
        </WithModel>
      );
    case 'garden':
      // Crossroads: the walled garden (tools/blender/garden_set.py) for every
      // edition; a plain lawn under the sky stands in while it loads.
      return (
        <WithModel fallback={<Lawn />} lights={<GardenLights />}>
          <BakedScene asset={ASSETS.gardenSet} lite={lite} />
        </WithModel>
      );
    case 'lounge':
    default:
      // Classic, Takeprofit TV and Chog each have their own modelled,
      // light-baked room; any other edition keeps the drawn lounge in its
      // palette until it gets one.
      if (theme.id === 'classic') {
        return (
          <WithModel fallback={<Lounge theme={theme} ownLights={false} />} failed={<Lounge theme={theme} />} lights={<RoomLights />}>
            <ClassicRoom lite={lite} />
          </WithModel>
        );
      }
      // Takeprofit TV: its broadcast studio (tools/blender/tptv_room.py).
      if (theme.id === 'tptv') {
        return (
          <WithModel fallback={<Lounge theme={theme} ownLights={false} />} failed={<Lounge theme={theme} />} lights={<TptvRoomLights />}>
            <BakedScene asset={ASSETS.tptvRoom} lite={lite} />
          </WithModel>
        );
      }
      // Chog Poker: its purple lounge (tools/blender/chog_room.py).
      if (theme.id === 'chog') {
        return (
          <WithModel fallback={<Lounge theme={theme} ownLights={false} />} failed={<Lounge theme={theme} />} lights={<ChogRoomLights />}>
            <BakedScene asset={ASSETS.chogRoom} lite={lite} />
          </WithModel>
        );
      }
      return <Lounge theme={theme} />;
  }
}

/** Live light for what moves (board, pieces, dice) matching the baked room: warm lamp, fire on the left. */
function RoomLights() {
  return (
    <>
      <hemisphereLight args={['#ffe2bd', '#2a1a10', 0.6]} />
      <pointLight position={[13.6, FLOOR + 9.4, -10.5]} color="#ffb46b" intensity={260} decay={2} />
      <LiveLight position={[-18, FLOOR + 2, 0]} color="#ff7a2e" intensity={220} mode="flicker" amount={0.3} />
    </>
  );
}

/**
 * Live light matching the baked studio: a dim cool fill, the video wall
 * behind the anchor desk, the amber LEDs and ON AIR sign, the softboxes.
 */
function TptvRoomLights() {
  return (
    <>
      <hemisphereLight args={['#aab4e0', '#1a120a', 0.5]} />
      <LiveLight position={[0, FLOOR + 10, -15]} color="#c4d2ff" intensity={160} mode="flicker" amount={0.12} speed={0.6} />
      <pointLight position={[0, FLOOR + 1.5, -12]} color="#ff9e2c" intensity={90} decay={2} />
      <pointLight position={[-13, FLOOR + 8, -7]} color="#fff1dd" intensity={140} decay={2} />
      <pointLight position={[13, FLOOR + 8, -7]} color="#fff1dd" intensity={140} decay={2} />
    </>
  );
}

/**
 * Live light matching the baked Chog Poker lounge (tools/blender/chog_room.py):
 * a warm pool over the table, the pink CHOG neon and portrait on the back
 * wall, the bar's glowing shelves (back left) and the slots (back right).
 */
function ChogRoomLights() {
  return (
    <>
      <hemisphereLight args={['#e6c8ff', '#2a1046', 0.55]} />
      <LiveLight position={[0, FLOOR + 13, -15]} color="#ff5fae" intensity={160} mode="pulse" amount={0.18} speed={1.4} />
      <pointLight position={[-14, FLOOR + 9, -13]} color="#ff7ab8" intensity={110} decay={2} />
      <pointLight position={[14, FLOOR + 8, -13]} color="#ffb0d8" intensity={90} decay={2} />
      <pointLight position={[-14.6, FLOOR + 10.5, -1.8]} color="#ffcf9a" intensity={90} decay={2} />
      <pointLight position={[14.6, FLOOR + 10.5, -1.4]} color="#ffcf9a" intensity={90} decay={2} />
    </>
  );
}

/** The Metropolis night haze, a touch of the edition's sky in it. */
const skylineHaze = (theme: Theme) => mix(theme.palette.sky, '#222241', 0.88);

/**
 * Live light for what moves, matching the baked roof: moonlit sky above, the
 * warm festoon ring round the deck, the fire pit (back left) and the neon
 * sign over the back parapet.
 */
function SkylineLights() {
  return (
    <>
      <hemisphereLight args={['#8f9be0', '#2b1d22', 0.55]} />
      <pointLight position={[-12, FLOOR + 10, 9]} color="#ffc47e" intensity={140} decay={2} />
      <pointLight position={[12, FLOOR + 10, 9]} color="#ffc47e" intensity={140} decay={2} />
      <LiveLight position={[-12, FLOOR + 3, -12]} color="#ff8a3a" intensity={160} mode="flicker" amount={0.3} />
      <LiveLight position={[0, FLOOR + 7, -17]} color="#ff4fb0" intensity={150} mode="pulse" amount={0.15} speed={1.2} />
      <pointLight position={[14, FLOOR + 9, -10]} color="#ffd29a" intensity={70} decay={2} />
    </>
  );
}

/**
 * Live light matching the baked arcade (tools/blender/arcade_set.py): a violet
 * wash, the warm pool over the table, the BLITZ sign behind it and the
 * machines' screens down both sides.
 */
function ArcadeLights() {
  return (
    <>
      <hemisphereLight args={['#b9a6ff', '#1a1036', 0.5]} />
      <LiveLight position={[0, FLOOR + 12, -15]} color="#ff7ad8" intensity={150} mode="pulse" amount={0.2} speed={1.6} />
      <pointLight position={[-16, FLOOR + 6, -2]} color="#6fd8ff" intensity={120} decay={2} />
      <pointLight position={[16, FLOOR + 6, -2]} color="#c68cff" intensity={120} decay={2} />
      <pointLight position={[0, FLOOR + 14, 2]} color="#ffe2c8" intensity={110} decay={2} />
    </>
  );
}

/** Live light matching the baked garden: blue sky above, sunlit lawn below (the key light is the sun). */
function GardenLights() {
  return <hemisphereLight args={['#bcd8f4', '#6f9a4a', 0.75]} />;
}

/** The garden's stand-in while its model loads: a mown lawn to the horizon. */
function Lawn() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR, 0]} receiveShadow>
      <circleGeometry args={[200, 48]} />
      <meshStandardMaterial color="#6aa547" roughness={1} />
    </mesh>
  );
}

/** Live light matching the baked track: dusk sky above, grass below, the floodlights from behind. */
function SpeedwayLights() {
  return (
    <>
      <hemisphereLight args={['#c3c9ee', '#56683a', 0.55]} />
      <pointLight position={[-24, FLOOR + 19, -13]} color="#e6eeff" intensity={520} decay={2} />
      <pointLight position={[21, FLOOR + 19, -17.5]} color="#e6eeff" intensity={360} decay={2} />
    </>
  );
}

/** The procedural studio room: reflections for scenes without a panorama of their own. */
export const STUDIO = { url: undefined, intensity: 0.45, rotation: 0 };

/** Which baked panorama a scene reflects: the set's own when it has one (tools/blender/*_env.py). */
export function reflectionsFor(env: EnvironmentId, themeId: string): { url?: string; intensity: number; rotation: number } {
  // Each panorama is centred on the back of its set; three's equirect is centred on +x, hence the quarter turn.
  const baked = (url: string, intensity: number) => ({ url, intensity, rotation: -Math.PI / 2 });
  if (env === 'lounge' && themeId === 'classic') return baked(ASSETS.classicEnv.url, 0.6);
  if (env === 'lounge' && themeId === 'tptv') return baked(ASSETS.tptvEnv.url, 0.6);
  if (env === 'lounge' && themeId === 'chog') return baked(ASSETS.chogEnv.url, 0.6);
  if (env === 'skyline') return baked(ASSETS.skylineEnv.url, 0.7);
  if (env === 'speedway') return baked(ASSETS.speedwayEnv.url, 0.55);
  if (env === 'arcade') return baked(ASSETS.arcadeEnv.url, 0.65);
  if (env === 'garden') return baked(ASSETS.gardenEnv.url, 0.6);
  return STUDIO;
}

/** The baked set a scene shows, if it has one. */
function bakedFor(kind: EnvironmentId, themeId: string): BakedAsset | null {
  if (kind === 'speedway') return ASSETS.speedwaySet;
  if (kind === 'skyline') return ASSETS.skylineSet;
  if (kind === 'arcade') return ASSETS.arcadeSet;
  if (kind === 'garden') return ASSETS.gardenSet;
  if (themeId === 'classic') return ASSETS.classicRoom;
  if (themeId === 'tptv') return ASSETS.tptvRoom;
  if (themeId === 'chog') return ASSETS.chogRoom;
  return null;
}

/** Start downloading a scene's set before it is shown (the home page tour, the lobby's next pick). */
export function preloadEnvironment(kind: EnvironmentId, themeId: string): void {
  const { url } = reflectionsFor(kind, themeId);
  if (url) void preloadPanorama(url);
  const set = bakedFor(kind, themeId);
  if (!set) return;
  useGLTF.preload(set.url);
  useTexture.preload(lightmapFor(set, liteAssets()));
}
