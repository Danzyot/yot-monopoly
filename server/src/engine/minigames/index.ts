// Registry of arcade mini-games. Adding one: write a MinigameDef module, add
// its kind and view body to shared/minigames.ts, list it here, and give it a
// panel in client/src/components/MinigamePanel.tsx.

import type { MinigameKind } from '../../../../shared/minigames.ts';
import { diceDuel } from './diceDuel.ts';
import { highLow } from './highLow.ts';
import { quickMath } from './quickMath.ts';
import { reaction } from './reaction.ts';
import type { MinigameDef } from './types.ts';
import { wheel } from './wheel.ts';

// Each module has its own state type; the Game stores the state opaquely next
// to the kind and only ever hands it back to the matching module.
export const MINIGAMES: Record<MinigameKind, MinigameDef<any>> = {
  diceDuel, highLow, reaction, quickMath, wheel,
};

export { MinigameError, hash } from './types.ts';
