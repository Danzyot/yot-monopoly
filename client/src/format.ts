import { getTheme } from '../../shared/themes.ts';
import { getCharacter } from '../../shared/characters.ts';

export function money(themeId: string, n: number): string {
  return `${getTheme(themeId).currency}${n.toLocaleString()}`;
}

/** 2D badge for a character (player lists, lobby seats). */
export function characterEmoji(id: string): string {
  return getCharacter(id).emoji;
}
