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
      return { background: mix(sky, '#1e2a45', 0.55), fogNear: 30, fogFar: 85, keyColor: '#ffffff', keyIntensity: 2.1 };
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
    case 'speedway': return <Speedway theme={theme} />;
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
      // The Classic edition has its own modelled, light-baked room; other
      // editions keep the drawn lounge in their palette until they get one.
      if (theme.id === 'classic') {
        return (
          <WithModel fallback={<Lounge theme={theme} />}>
            <ClassicRoom />
            <RoomLights />
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
