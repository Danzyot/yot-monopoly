// Operator renames from the dashboard's Content tab: space names, card text,
// look names and currency, character and mini-game names. The server keeps
// them (server/src/content.ts) and every client fetches them at start-up
// (GET /api/content); shared/content.ts applies them. This file only holds
// the current set, so themes.ts can read it without an import cycle.

import type { DeckId } from './cards.ts';

export type EditionField = 'name' | 'tagline' | 'centerTitle' | 'currency' | 'chance' | 'chest';
export type CharacterField = 'name' | 'blurb';
export type MinigameField = 'title' | 'blurb';

export interface ContentOverrides {
  /** `themeId:mapId` → space index → name. */
  spaces: Record<string, Record<string, string>>;
  /** `themeId:mapId` → `chance:3` → card text (placeholders like {39} allowed). */
  cards: Record<string, Record<string, string>>;
  editions: Record<string, Partial<Record<EditionField, string>>>;
  characters: Record<string, Partial<Record<CharacterField, string>>>;
  minigames: Record<string, Partial<Record<MinigameField, string>>>;
}

/** One editable thing, as the dashboard addresses it. */
export type ContentItem =
  | { kind: 'space'; theme: string; map: string; index: number }
  | { kind: 'card'; theme: string; map: string; deck: DeckId; index: number }
  | { kind: 'edition'; id: string; field: EditionField }
  | { kind: 'character'; id: string; field: CharacterField }
  | { kind: 'minigame'; id: string; field: MinigameField };

export type ContentKind = ContentItem['kind'];
export const CONTENT_KINDS: ContentKind[] = ['space', 'card', 'edition', 'character', 'minigame'];

export function emptyContent(): ContentOverrides {
  return { spaces: {}, cards: {}, editions: {}, characters: {}, minigames: {} };
}

let current: ContentOverrides = emptyContent();
let version = 0;

/** Bumped on every apply, so caches built from the old names know to rebuild. */
export function contentVersion(): number {
  return version;
}

export function currentContent(): ContentOverrides {
  return current;
}

/** Only shared/content.ts calls this (it also patches the catalogues). */
export function storeContent(o: ContentOverrides): void {
  current = o;
  version++;
}

export const boardKey = (themeId: string, mapId: string) => `${themeId}:${mapId}`;
export const cardKey = (deck: DeckId, index: number) => `${deck}:${index}`;

export function spaceRename(themeId: string, mapId: string, index: number): string | undefined {
  return current.spaces[boardKey(themeId, mapId)]?.[index];
}

export function cardRewrite(themeId: string, mapId: string, deck: DeckId, index: number): string | undefined {
  return current.cards[boardKey(themeId, mapId)]?.[cardKey(deck, index)];
}

/** The override stored for an item, if any. */
export function overrideFor(o: ContentOverrides, item: ContentItem): string | undefined {
  switch (item.kind) {
    case 'space': return o.spaces[boardKey(item.theme, item.map)]?.[item.index];
    case 'card': return o.cards[boardKey(item.theme, item.map)]?.[cardKey(item.deck, item.index)];
    case 'edition': return o.editions[item.id]?.[item.field];
    case 'character': return o.characters[item.id]?.[item.field];
    case 'minigame': return o.minigames[item.id]?.[item.field];
  }
}

/** A copy of `o` with one item set (string) or cleared (null). Empty groups are dropped. */
export function withOverride(o: ContentOverrides, item: ContentItem, text: string | null): ContentOverrides {
  const next: ContentOverrides = JSON.parse(JSON.stringify(o)) as ContentOverrides;
  const put = <T extends Record<string, Record<string, string>>>(table: T, outer: string, inner: string) => {
    const row = { ...(table[outer] ?? {}) };
    if (text === null) delete row[inner];
    else row[inner] = text;
    if (Object.keys(row).length) (table as Record<string, Record<string, string>>)[outer] = row;
    else delete table[outer];
  };
  switch (item.kind) {
    case 'space': put(next.spaces, boardKey(item.theme, item.map), String(item.index)); break;
    case 'card': put(next.cards, boardKey(item.theme, item.map), cardKey(item.deck, item.index)); break;
    case 'edition': put(next.editions as Record<string, Record<string, string>>, item.id, item.field); break;
    case 'character': put(next.characters as Record<string, Record<string, string>>, item.id, item.field); break;
    case 'minigame': put(next.minigames as Record<string, Record<string, string>>, item.id, item.field); break;
  }
  return next;
}

/** How many overrides are set, in total or for one kind. */
export function countOverrides(o: ContentOverrides, kind?: ContentKind): number {
  const n = (t: Record<string, Record<string, string>>) => Object.values(t).reduce((a, r) => a + Object.keys(r).length, 0);
  const by: Record<ContentKind, number> = {
    space: n(o.spaces),
    card: n(o.cards),
    edition: n(o.editions as Record<string, Record<string, string>>),
    character: n(o.characters as Record<string, Record<string, string>>),
    minigame: n(o.minigames as Record<string, Record<string, string>>),
  };
  return kind ? by[kind] : Object.values(by).reduce((a, b) => a + b, 0);
}
