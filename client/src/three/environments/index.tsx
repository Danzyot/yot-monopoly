// Per-map surroundings. A map names its environment (shared/maps.ts); the
// edition's palette tints it. BoardScene asks `envLook` for the background,
// fog and key light, and renders <Environment> for everything else.

import type { EnvironmentId } from '../../../../shared/maps.ts';
import type { Theme } from '../../../../shared/themes.ts';
import { FLOOR, mix } from './common.tsx';
import { Lounge } from './Lounge.tsx';
import { BakedScene, ClassicRoom, WithModel } from '../models.tsx';
import { ASSETS } from '../assets.gen.ts';
import { Skyline } from './Skyline.tsx';
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
      return { background: mix(sky, '#060b1c', 0.45), fogNear: 40, fogFar: 170, keyColor: '#e6ebff', keyIntensity: 1.9 };
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
    case 'skyline': return <Skyline theme={theme} />;
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
