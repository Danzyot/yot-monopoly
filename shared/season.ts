// Chog season: for a few days the whole site is Chog. Only the Chog character
// (and holders' own NFT Chogs) can be picked, every table uses the Chog look,
// and the other characters and looks are hidden, not deleted. Flip CHOG_SEASON
// to false to bring everything back; nothing else needs to change.

import { CHARACTER_DEFS, type CharacterDef, type CharacterId } from './characters.ts';

export const CHOG_SEASON = true;

/** The one look every table uses during the season (shared/themes.ts id). */
export const SEASON_THEME_ID = 'chog';

/** Characters players and bots may pick right now. */
export const SEASON_CHARACTERS: CharacterId[] = CHOG_SEASON ? ['chog'] : CHARACTER_DEFS.map(c => c.id);

export function characterAvailable(id: CharacterId): boolean {
  return SEASON_CHARACTERS.includes(id);
}

/**
 * Whether several players may play the same character: during the season
 * there are more seats than characters, so they share it and are told apart
 * by their colour (a base Chog wears it on its onesie) or their own NFT Chog.
 */
export function characterShared(id: CharacterId): boolean {
  return CHOG_SEASON && characterAvailable(id);
}

/** The picker's list: the catalogue filtered to what the season allows. */
export function availableCharacters(): CharacterDef[] {
  return CHARACTER_DEFS.filter(c => SEASON_CHARACTERS.includes(c.id));
}

/**
 * A board's picture (client/public): in the season, the board in the Chog look
 * (home/chog-*.webp), so the home page and the lobby show the table players get.
 */
export function mapThumbUrl(mapId: string): string {
  return CHOG_SEASON ? `/home/chog-${mapId}.webp` : `/maps/${mapId}.webp`;
}

/** Looks (editions) a host may choose right now. */
export function themeAvailable(themeId: string): boolean {
  return !CHOG_SEASON || themeId === SEASON_THEME_ID;
}

/** Bot names: Chog-flavoured during the season, the classic set otherwise. */
export const SEASON_BOT_NAMES = CHOG_SEASON
  ? ['Chogzilla', 'Lil Chog', 'Chogfather', 'Monad Mike', 'Chogsworth', 'Purple Pete', 'Spike', 'Chogette']
  : ['Rich Uncle', 'Tycoon', 'Landlord', 'Baron', 'Mogul', 'Magnate', 'Banker', 'Heiress'];
