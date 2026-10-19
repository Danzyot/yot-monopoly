// Applying operator content overrides (see contentOverrides.ts) to the shared
// catalogues. Space names and card text are read by resolveTheme on demand;
// look names, currency, deck names, characters and mini-games are patched in
// place on THEMES, CHARACTER_DEFS and MINIGAME_INFO, so every screen that
// reads those (lobby, home, deeds, the server's log lines) shows the new words
// without knowing overrides exist. The built-in values are snapshotted here
// first, so a reset always has something to go back to.

import type { CardEffect } from './cards.ts';
import { CHARACTER_DEFS } from './characters.ts';
import {
  emptyContent, overrideFor, storeContent, type CharacterField, type ContentItem, type ContentOverrides,
  type EditionField, type MinigameField,
} from './contentOverrides.ts';
import { getMap, MAPS } from './maps.ts';
import { MINIGAME_INFO, MINIGAME_KINDS } from './minigames.ts';
import { THEMES, baseSpaceName, getTheme } from './themes.ts';

export const EDITION_FIELDS: EditionField[] = ['name', 'tagline', 'centerTitle', 'currency', 'chance', 'chest'];
export const CHARACTER_FIELDS: CharacterField[] = ['name', 'blurb'];
export const MINIGAME_FIELDS: MinigameField[] = ['title', 'blurb'];

/** Longest text each kind of item may hold (characters, after cleaning). */
export const CONTENT_LIMITS = {
  space: 32,
  card: 160,
  edition: { name: 32, tagline: 160, centerTitle: 16, currency: 4, chance: 24, chest: 24 } as Record<EditionField, number>,
  character: { name: 24, blurb: 160 } as Record<CharacterField, number>,
  minigame: { title: 32, blurb: 300 } as Record<MinigameField, number>,
};

export function contentLimit(item: ContentItem): number {
  switch (item.kind) {
    case 'space': return CONTENT_LIMITS.space;
    case 'card': return CONTENT_LIMITS.card;
    case 'edition': return CONTENT_LIMITS.edition[item.field];
    case 'character': return CONTENT_LIMITS.character[item.field];
    case 'minigame': return CONTENT_LIMITS.minigame[item.field];
  }
}

// ---- built-in values ---------------------------------------------------------

type EditionText = Record<EditionField, string>;
const DEFAULT_EDITIONS = new Map<string, EditionText>(THEMES.map(e => [e.id, {
  name: e.name, tagline: e.tagline, centerTitle: e.centerTitle, currency: e.currency,
  chance: e.deckNames.chance, chest: e.deckNames.chest,
}]));
const DEFAULT_CHARACTERS = new Map(CHARACTER_DEFS.map(c => [c.id as string, { name: c.name, blurb: c.blurb }]));
const DEFAULT_MINIGAMES = new Map(MINIGAME_KINDS.map(k => [k as string, { title: MINIGAME_INFO[k].title, blurb: MINIGAME_INFO[k].blurb }]));

/**
 * Throws unless the item names something that exists (a real look, board,
 * space, card, character, mini-game and field). Returns the item rebuilt from
 * its known fields only.
 */
export function checkContentItem(raw: unknown): ContentItem {
  const x = (raw ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof x[k] === 'string' ? x[k] as string : '');
  const int = (k: string) => (typeof x[k] === 'number' && Number.isInteger(x[k]) ? x[k] as number : -1);
  switch (x.kind) {
    case 'space':
    case 'card': {
      const theme = str('theme');
      const map = str('map');
      if (!THEMES.some(t => t.id === theme)) throw new Error('Unknown look');
      if (!MAPS.some(m => m.id === map)) throw new Error('Unknown board');
      const m = getMap(map);
      const index = int('index');
      if (x.kind === 'space') {
        if (index < 0 || index >= m.spaces.length) throw new Error('No such space on that board');
        return { kind: 'space', theme, map, index };
      }
      const deck = str('deck');
      if (deck !== 'chance' && deck !== 'chest') throw new Error('Unknown deck');
      if (index < 0 || index >= m[deck].length) throw new Error('No such card in that deck');
      return { kind: 'card', theme, map, deck, index };
    }
    case 'edition': {
      const id = str('id');
      const field = str('field') as EditionField;
      if (!DEFAULT_EDITIONS.has(id)) throw new Error('Unknown look');
      if (!EDITION_FIELDS.includes(field)) throw new Error('Unknown field');
      return { kind: 'edition', id, field };
    }
    case 'character': {
      const id = str('id');
      const field = str('field') as CharacterField;
      if (!DEFAULT_CHARACTERS.has(id)) throw new Error('Unknown character');
      if (!CHARACTER_FIELDS.includes(field)) throw new Error('Unknown field');
      return { kind: 'character', id, field };
    }
    case 'minigame': {
      const id = str('id');
      const field = str('field') as MinigameField;
      if (!DEFAULT_MINIGAMES.has(id)) throw new Error('Unknown mini-game');
      if (!MINIGAME_FIELDS.includes(field)) throw new Error('Unknown field');
      return { kind: 'minigame', id, field };
    }
    default:
      throw new Error('Unknown kind of content');
  }
}

/**
 * The built-in text for an item. A space's default follows the look's deck
 * names as they stand now (renaming "Chance" renames its squares); a card's
 * is its template, with {12}-style placeholders.
 */
export function contentDefault(item: ContentItem): string {
  switch (item.kind) {
    case 'space': return baseSpaceName(getTheme(item.theme), getMap(item.map), item.index);
    case 'card': return getMap(item.map)[item.deck][item.index].text;
    case 'edition': return DEFAULT_EDITIONS.get(item.id)![item.field];
    case 'character': return DEFAULT_CHARACTERS.get(item.id)![item.field];
    case 'minigame': return DEFAULT_MINIGAMES.get(item.id)![item.field];
  }
}

/** What an item reads as right now: its override, else its default. */
export function contentValue(o: ContentOverrides, item: ContentItem): string {
  return overrideFor(o, item) ?? contentDefault(item);
}

// ---- applying ----------------------------------------------------------------

/**
 * Make `o` the live set: patch the catalogues back to their defaults, then
 * apply every override. Call with the server's copy (client) or the stored
 * file (server). Unknown keys are ignored here; the server validates on save.
 */
export function applyContentOverrides(o: ContentOverrides | null | undefined): void {
  const next: ContentOverrides = { ...emptyContent(), ...(o ?? {}) };
  for (const ed of THEMES) {
    const d = DEFAULT_EDITIONS.get(ed.id)!;
    const v = next.editions[ed.id] ?? {};
    ed.name = v.name ?? d.name;
    ed.tagline = v.tagline ?? d.tagline;
    ed.centerTitle = v.centerTitle ?? d.centerTitle;
    ed.currency = v.currency ?? d.currency;
    ed.deckNames = { chance: v.chance ?? d.chance, chest: v.chest ?? d.chest };
  }
  for (const c of CHARACTER_DEFS) {
    const d = DEFAULT_CHARACTERS.get(c.id)!;
    const v = next.characters[c.id] ?? {};
    c.name = v.name ?? d.name;
    c.blurb = v.blurb ?? d.blurb;
  }
  for (const k of MINIGAME_KINDS) {
    const d = DEFAULT_MINIGAMES.get(k)!;
    const v = next.minigames[k] ?? {};
    MINIGAME_INFO[k] = { ...MINIGAME_INFO[k], title: v.title ?? d.title, blurb: v.blurb ?? d.blurb };
  }
  // Last: bumps the version, so resolveTheme rebuilds with the new deck names too.
  storeContent(next);
}

/** A card's effect in plain words, for the dashboard (read-only). */
export function describeEffect(e: CardEffect, spaceName: (i: number) => string, cur: string): string {
  switch (e.type) {
    case 'advance': return `Move to ${spaceName(e.to)} (#${e.to})`;
    case 'nearest': return `Move to the nearest ${e.kind}`;
    case 'back': return `Go back ${e.steps} spaces`;
    case 'jail': return 'Go to jail';
    case 'jailFree': return 'Get Out of Jail Free card';
    case 'collect': return `Collect ${cur}${e.amount}`;
    case 'pay': return `Pay ${cur}${e.amount}`;
    case 'payEach': return `Pay each player ${cur}${e.amount}`;
    case 'collectEach': return `Collect ${cur}${e.amount} from each player`;
    case 'repairs': return `Repairs: ${cur}${e.perHouse}/house, ${cur}${e.perHotel}/hotel`;
  }
}
