// Per-map surroundings. A map names its environment (shared/maps.ts); the
// edition's palette tints it. BoardScene asks `envLook` for the background,
// fog and key light, and renders <Environment> for everything else.

import type { EnvironmentId } from '../../../../shared/maps.ts';
import type { Theme } from '../../../../shared/themes.ts';
import { mix } from './common.tsx';
import { Lounge } from './Lounge.tsx';
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
      return { background: mix(sky, '#1e2a45', 0.55), fogNear: 30, fogFar: 85, keyColor: '#ffffff', keyIntensity: 2.1 };
    case 'skyline':
      return { background: mix(sky, '#060b1c', 0.45), fogNear: 40, fogFar: 170, keyColor: '#e6ebff', keyIntensity: 1.9 };
    case 'lounge':
    default:
      return { background: mix(sky, '#1d130c', 0.5), fogNear: 34, fogFar: 80, keyColor: '#fff2df', keyIntensity: 2.0 };
  }
}

export function Environment({ kind, theme }: { kind: EnvironmentId; theme: Theme }) {
  switch (kind) {
    case 'speedway': return <Speedway theme={theme} />;
    case 'skyline': return <Skyline theme={theme} />;
    case 'lounge':
    default: return <Lounge theme={theme} />;
  }
}
