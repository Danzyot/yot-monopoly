import { getTheme } from '../../shared/themes.ts';

export function money(themeId: string, n: number): string {
  return `${getTheme(themeId).currency}${n.toLocaleString()}`;
}

export const TOKEN_LABEL: Record<string, string> = {
  car: 'Racecar', hat: 'Top Hat', dog: 'Dog', ship: 'Ship', boot: 'Boot', iron: 'Iron', cat: 'Cat', duck: 'Duck',
};

export const TOKEN_EMOJI: Record<string, string> = {
  car: '🏎️', hat: '🎩', dog: '🐕', ship: '🚢', boot: '👢', iron: '⚙️', cat: '🐈', duck: '🦆',
};
