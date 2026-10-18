// Per-map surroundings. A map names its environment (shared/maps.ts); the
// edition's palette tints it. BoardScene asks `envLook` for the background,
// fog and key light, and renders <Environment> for everything else.

import type { EnvironmentId } from '../../../../shared/maps.ts';
import type { Theme } from '../../../../shared/themes.ts';
import { FLOOR, mix } from './common.tsx';
import { Lounge } from './Lounge.tsx';
import { BakedScene, ClassicRoom, WithModel } from '../models.tsx';
import { ASSETS } from '../assets.gen.ts';
import { NightSky, Skyline } from './Skyline.tsx';
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
    case 'lounge':
    default:
      return { background: mix(sky, '#1d130c', 0.5), fogNear: 34, fogFar: 80, keyColor: '#fff2df', keyIntensity: 2.0 };
  }
}

export function Environment({ kind, theme }: { kind: EnvironmentId; theme: Theme }) {
  switch (kind) {
    case 'speedway':
      // A modelled, light-baked race track for every edition; the drawn one
      // shows while it loads (and stays if it cannot).
      return (
        <WithModel fallback={<Speedway theme={theme} />}>
          <BakedScene asset={ASSETS.speedwaySet} />
          <SpeedwayLights />
        </WithModel>
      );
    case 'skyline':
      // Every edition gets the modelled, light-baked penthouse roof; the drawn
      // roof stands in while it loads (and for good if it cannot).
      return (
        <WithModel fallback={<Skyline theme={theme} />}>
          <BakedScene asset={ASSETS.skylineSet} />
          <NightSky horizon={skylineHaze(theme)} />
          <SkylineLights />
        </WithModel>
      );
    case 'lounge':
    default:
      // Classic, Takeprofit TV and Chog each have their own modelled,
      // light-baked room; any other edition keeps the drawn lounge in its
      // palette until it gets one.
      if (theme.id === 'classic') {
        return (
          <WithModel fallback={<Lounge theme={theme} />}>
            <ClassicRoom />
            <RoomLights />
          </WithModel>
        );
      }
      // Takeprofit TV: its broadcast studio (tools/blender/tptv_room.py).
      if (theme.id === 'tptv') {
        return (
          <WithModel fallback={<Lounge theme={theme} />}>
            <BakedScene asset={ASSETS.tptvRoom} />
            <TptvRoomLights />
          </WithModel>
        );
      }
      // Chog Poker: its purple lounge (tools/blender/chog_room.py).
      if (theme.id === 'chog') {
        return (
          <WithModel fallback={<Lounge theme={theme} />}>
            <BakedScene asset={ASSETS.chogRoom} />
            <ChogRoomLights />
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
      <pointLight position={[-18, FLOOR + 2, 0]} color="#ff7a2e" intensity={220} decay={2} />
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
      <pointLight position={[0, FLOOR + 10, -15]} color="#c4d2ff" intensity={160} decay={2} />
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
      <pointLight position={[0, FLOOR + 13, -15]} color="#ff5fae" intensity={160} decay={2} />
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
      <pointLight position={[-12, FLOOR + 3, -12]} color="#ff8a3a" intensity={160} decay={2} />
      <pointLight position={[0, FLOOR + 7, -17]} color="#ff4fb0" intensity={150} decay={2} />
      <pointLight position={[14, FLOOR + 9, -10]} color="#ffd29a" intensity={70} decay={2} />
    </>
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
