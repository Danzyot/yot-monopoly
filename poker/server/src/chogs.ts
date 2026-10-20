// Chog seat avatars. A player who holds Chog Genesis NFTs (wallets linked on
// the Chog Games hub) picks one, and its art becomes their avatar at the
// table, in chat, in the lobby and in results, ringed in its Aura colour.
//
// The pick is stored here (chogpicks.json on the data volume). Whether they
// still hold it is the hub's to say: GET <HUB_URL>/api/hosting/chogs, signed
// with the shared secret (hubLink.ts). The answer carries each Chog's aura
// colour and legendary flag, so this room keeps no copy of the trait data.
//
// Nothing here ever waits in the path of play. Views read a cache:
//   - an answer is kept for CHOG_TTL_MS, then re-asked in the background
//     (the previous answer stands until the new one lands);
//   - a hub that does not answer counts as "unknown" for CHOG_RETRY_MS: no
//     Chog is shown, the pick is kept, and it comes back with the hub;
//   - a complete answer without the picked Chog means it was sold or moved:
//     the pick is dropped.
// When what a player shows changes, onChogChange listeners re-push the views.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChogBadge } from '../../shared/types.ts';
import { hubGet, hubLinkConfigured } from './hubLink.ts';
import { DATA_DIR } from './paths.ts';

export const CHOG_TTL_MS = 10 * 60_000;
export const CHOG_RETRY_MS = 60_000;
/** How often a player may make the picker re-ask the hub. */
export const CHOG_REFRESH_COOLDOWN_MS = 30_000;
const CHOG_SUPPLY = 1969;
const MAX_CACHED = 20_000;

export interface HeldChogs {
  /** False when the hub could not be asked or did not answer. */
  ok: boolean;
  /** False when the hub could not read one of the wallets just now. */
  complete: boolean;
  chogs: ChogBadge[];
  at: number;
}

type Fetcher = (playerId: string) => Promise<{ chogs: ChogBadge[]; complete: boolean } | null>;

let clock = () => Date.now();
let fetcher: Fetcher = fetchFromHub;
let enabled: () => boolean = hubLinkConfigured;
const picks = new Map<string, number>();
let picksLoaded = false;
const held = new Map<string, HeldChogs>();
const inflight = new Map<string, Promise<HeldChogs>>();
const lastRefresh = new Map<string, number>();
const listeners = new Set<(playerId: string) => void>();

const PICKS_FILE = () => join(DATA_DIR, 'chogpicks.json');

/** Test hook: a fake hub, a fake clock, and a clean slate. */
export function configureChogs(o: { fetch?: Fetcher; now?: () => number; enabled?: () => boolean; reset?: boolean }): void {
  if (o.fetch) fetcher = o.fetch;
  if (o.now) clock = o.now;
  if (o.enabled) enabled = o.enabled;
  if (o.reset) {
    picks.clear(); held.clear(); inflight.clear(); lastRefresh.clear();
    picksLoaded = true;
  }
}

export function chogsEnabled(): boolean {
  return enabled();
}

// ---- the hub ------------------------------------------------------------------

const isToken = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= CHOG_SUPPLY;

/** Only what is expected gets through: the aura ends up in a CSS colour. */
export function cleanHubChogs(raw: unknown): { chogs: ChogBadge[]; complete: boolean } | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { chogs?: unknown }).chogs)) return null;
  const chogs: ChogBadge[] = [];
  for (const c of (raw as { chogs: unknown[] }).chogs) {
    if (!c || typeof c !== 'object') continue;
    const { chogToken, aura, legendary } = c as Record<string, unknown>;
    if (!isToken(chogToken) || chogs.some(x => x.chogToken === chogToken)) continue;
    chogs.push({
      chogToken,
      aura: typeof aura === 'string' && /^#[0-9a-fA-F]{6}$/.test(aura) ? aura.toLowerCase() : null,
      legendary: legendary === true,
    });
    if (chogs.length >= 500) break;
  }
  return { chogs, complete: (raw as { complete?: unknown }).complete !== false };
}

async function fetchFromHub(playerId: string) {
  return cleanHubChogs(await hubGet('/api/hosting/chogs', playerId));
}

const fresh = (h: HeldChogs) => clock() - h.at < (h.ok ? CHOG_TTL_MS : CHOG_RETRY_MS);

/** Asks the hub (one request per player at a time) and applies the answer. */
export function refreshHeld(playerId: string): Promise<HeldChogs> {
  let p = inflight.get(playerId);
  if (p) return p;
  p = (async () => {
    const before = badgeKey(playerId);
    let answer: { chogs: ChogBadge[]; complete: boolean } | null = null;
    try {
      answer = enabled() ? await fetcher(playerId) : null;
    } catch (e) {
      console.warn('Chog check failed:', e instanceof Error ? e.message : String(e));
    }
    const row: HeldChogs = answer
      ? { ok: true, complete: answer.complete, chogs: answer.chogs, at: clock() }
      : { ok: false, complete: false, chogs: [], at: clock() };
    if (held.size >= MAX_CACHED && !held.has(playerId)) held.clear();
    held.set(playerId, row);
    // Sold or moved: a complete answer that no longer has it. Anything less
    // (hub down, a wallet the chain did not answer for) keeps the pick.
    const pick = pickOf(playerId);
    if (pick !== null && row.ok && row.complete && !row.chogs.some(c => c.chogToken === pick)) {
      setPick(playerId, null);
    }
    if (badgeKey(playerId) !== before) notify(playerId);
    return row;
  })().finally(() => inflight.delete(playerId));
  inflight.set(playerId, p);
  return p;
}

/** The player's held Chogs: cached when fresh, else asked for now. */
export async function heldChogs(playerId: string, force = false): Promise<HeldChogs> {
  const h = held.get(playerId);
  if (h && !force && fresh(h)) return h;
  return refreshHeld(playerId);
}

// ---- picks --------------------------------------------------------------------

function loadPicks(): void {
  if (picksLoaded) return;
  picksLoaded = true;
  try {
    if (!existsSync(PICKS_FILE())) return;
    const raw = JSON.parse(readFileSync(PICKS_FILE(), 'utf8')) as Record<string, unknown>;
    for (const [id, t] of Object.entries(raw ?? {})) if (isToken(t)) picks.set(id, t);
  } catch (e) {
    console.error('Could not load Chog picks:', e);
  }
}

function savePicks(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${PICKS_FILE()}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(picks)));
    renameSync(tmp, PICKS_FILE());
  } catch (e) {
    console.error('Could not save Chog picks:', e);
  }
}

export function pickOf(playerId: string): number | null {
  loadPicks();
  return picks.get(playerId) ?? null;
}

function setPick(playerId: string, token: number | null): void {
  loadPicks();
  if (token === null) picks.delete(playerId);
  else picks.set(playerId, token);
  savePicks();
}

// ---- what views show ----------------------------------------------------------

/**
 * The Chog this player shows, or null. Synchronous and cache-only, so it can
 * sit in every view builder: an expired answer starts a re-check in the
 * background and stands until it lands.
 */
export function chogBadge(playerId: string): ChogBadge | null {
  const pick = pickOf(playerId);
  if (pick === null) return null;
  const h = held.get(playerId);
  if (!h || !fresh(h)) void refreshHeld(playerId);
  if (!h || !h.ok) return null;
  return h.chogs.find(c => c.chogToken === pick) ?? null;
}

/** `{ chog }` to spread into a view row, or nothing at all. */
export function chogField(playerId: string): { chog?: ChogBadge } {
  const b = chogBadge(playerId);
  return b ? { chog: b } : {};
}

export function withChog<T extends { id: string }>(p: T): T & { chog?: ChogBadge } {
  const b = chogBadge(p.id);
  return b ? { ...p, chog: b } : p;
}

function badgeKey(playerId: string): string {
  const pick = pickOf(playerId);
  const h = held.get(playerId);
  const b = pick !== null && h?.ok ? h.chogs.find(c => c.chogToken === pick) : undefined;
  return b ? `${b.chogToken}` : '';
}

/** Called with a player id whenever the Chog they show changes. */
export function onChogChange(fn: (playerId: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(playerId: string): void {
  for (const fn of listeners) {
    try { fn(playerId); } catch (e) { console.error('Chog change listener failed:', e); }
  }
}

/** Start a check for a player who just connected, so their seat is ready. */
export function warmChog(playerId: string): void {
  chogBadge(playerId);
}

/** Whether this player may make the picker re-ask the hub now; records it when they may. */
export function takeChogRefresh(playerId: string): boolean {
  const last = lastRefresh.get(playerId) ?? 0;
  if (clock() - last < CHOG_REFRESH_COOLDOWN_MS) return false;
  if (lastRefresh.size >= MAX_CACHED) lastRefresh.clear();
  lastRefresh.set(playerId, clock());
  return true;
}

/** Sets or clears a pick the caller has already checked, telling listeners when it changed. */
export function choosePick(playerId: string, token: number | null): void {
  const changed = pickOf(playerId) !== token;
  setPick(playerId, token);
  if (changed) notify(playerId);
}

export { isToken as isChogToken };
