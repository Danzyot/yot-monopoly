// A player's shareable card: one 1200×630 PNG (GET /api/players/:id/card.png)
// with their name, picture, headline numbers per game, best badges and the
// Chog Games mark, in the season's purple, pink and cream. Profile pages point
// their Open Graph and Twitter image at it (seo.ts), so a profile link shared
// on X or Discord shows the card.
//
// Drawn as SVG and rasterised by resvg (a small Rust library with prebuilt
// binaries: no browser, no system fonts). The fonts are the site's own, as TTF
// (assets/fonts); the badge faces are Twemoji (assets/badges, CC-BY 4.0);
// pictures go in as data URIs: the player's own NFT Chog when they last played
// as one, else their Discord picture, else the base Chog.
//
// Like the profile it comes from: public only while the leaderboard switch is
// on, nothing but finished results (and the yes/no of a linked wallet), and
// nobody banned from the site gets a card.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { type Achievement } from '../../shared/achievements.ts';
import { CHOG_SEASON } from '../../shared/season.ts';
import { isChogTokenId } from '../../shared/chogs/traits.ts';
import type { CardsProfile, PublicProfile } from '../../shared/types.ts';
import type { TournamentResult } from '../../shared/tournaments.ts';
import { SITE_NAME, profileIdOf, type RouteMeta } from '../../shared/seo.ts';
import { computeAchievements } from './achievements.ts';
import { isBanned } from './bans.ts';
import { allCardsResults, buildCardsProfile } from './cards/stats.ts';
import { isOn } from './features.ts';
import { dataUri, sniff, webpToPng } from './images.ts';
import { buildProfile, validPlayerId } from './profiles.ts';
import { allResults } from './stats.ts';
import { walletsOf } from './wallet/store.ts';

const __dir = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dir, '../assets');
const PUBLIC = join(__dir, '../../client/public');

export const CARD_SIZE = { width: 1200, height: 630 } as const;
/** How long a rendered card is reused (here, and by browsers and link previews). */
export const CARD_TTL_MS = 5 * 60_000;

// ---- whose card ------------------------------------------------------------------------

let tournamentsOf: (id: string) => readonly TournamentResult[] = () => [];

/** Finished tournaments come from the live manager (index.ts wires it up). */
export function configurePlayerCards(o: { tournamentsOf: (id: string) => readonly TournamentResult[] }): void {
  tournamentsOf = o.tournamentsOf;
}

/** Discord accounts are `dc_<discord id>`, and a ban may name either. */
export function playerBanned(id: string): boolean {
  return isBanned({ id, discordId: id.startsWith('dc_') ? id.slice(3) : null });
}

/** Every badge for a player (the profile's grid, the toast, the card). */
export function achievementsOf(id: string): Achievement[] {
  const links = walletsOf(id);
  return computeAchievements(id, {
    monopoly: allResults(),
    cards: allCardsResults(),
    tournaments: tournamentsOf(id),
    walletLinkedAt: links.length ? Math.min(...links.map(l => l.linkedAt)) : null,
  });
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  /** Emoji or https picture URL, from their latest game. */
  avatar: string;
  /** The NFT Chog they last played as, if any. */
  chogToken: number | null;
  monopoly: PublicProfile | null;
  cards: CardsProfile | null;
  achievements: Achievement[];
  firstGameAt: number;
  /** Games of both kinds; bumps the card's address so previews refetch once it changes. */
  games: number;
}

/** The latest NFT Chog this human played as, from both results stores. */
function latestChog(id: string): number | null {
  let best: { at: number; token: number } | null = null;
  const look = (endedAt: number, p: { id: string; isBot: boolean; chogToken?: number }) => {
    if (p.id === id && !p.isBot && isChogTokenId(p.chogToken) && (!best || endedAt >= best.at)) best = { at: endedAt, token: p.chogToken };
  };
  for (const r of allResults()) for (const p of r.places) look(r.endedAt, p);
  for (const r of allCardsResults()) for (const p of r.places) look(r.endedAt, p);
  return (best as { token: number } | null)?.token ?? null;
}

/**
 * What a public card or profile preview may show of a player, or null: profiles
 * switched off, not a player id, no finished games, or banned from the site.
 */
export function playerSnapshot(id: string): PlayerSnapshot | null {
  if (!isOn('leaderboard') || !validPlayerId(id) || playerBanned(id)) return null;
  const monopoly = buildProfile(id, allResults());
  const cards = buildCardsProfile(id);
  if (!monopoly && !cards) return null;
  // The newest name and picture, whichever game they came from.
  const latestMono = monopoly?.recent[0]?.endedAt ?? 0;
  const hero = monopoly && (!cards || latestMono >= cards.lastGameAt) ? monopoly : cards!;
  return {
    id, name: hero.name, avatar: hero.avatar, chogToken: latestChog(id), monopoly, cards,
    achievements: achievementsOf(id),
    firstGameAt: Math.min(...[monopoly?.firstGameAt, cards?.firstGameAt].filter((t): t is number => !!t)),
    games: (monopoly?.games ?? 0) + (cards?.games ?? 0),
  };
}

/** The card's address for share tags: versioned by games played, so a new game means a fresh preview. */
export function cardPath(s: Pick<PlayerSnapshot, 'id' | 'games'>): string {
  return `/api/players/${encodeURIComponent(s.id)}/card.png?v=${s.games.toString(36)}`;
}

/** One line for link previews: "12 wins in 30 games · 7 badges". */
export function snapshotLine(s: PlayerSnapshot): string {
  const parts: string[] = [];
  const wins = (s.monopoly?.wins ?? 0) + (s.cards?.wins ?? 0);
  parts.push(`${wins} ${wins === 1 ? 'win' : 'wins'} in ${s.games} ${s.games === 1 ? 'game' : 'games'}`);
  if (s.monopoly) parts.push(`Monopoly ${s.monopoly.wins}/${s.monopoly.games}`);
  if (s.cards) parts.push(`Cards ${s.cards.wins}/${s.cards.games}`);
  const badges = s.achievements.filter(a => a.earned).length;
  if (badges) parts.push(`${badges} ${badges === 1 ? 'badge' : 'badges'}`);
  return parts.join(' · ');
}

/**
 * A profile page's link preview (seo.ts): the player's name, their numbers and
 * their card as the share image. Any other page, or a player with no card,
 * keeps the meta it had.
 */
export function profileMeta(meta: RouteMeta): RouteMeta {
  const id = meta.status === 200 ? profileIdOf(meta.path) : null;
  const s = id ? playerSnapshot(id) : null;
  if (!s) return meta;
  const name = printable(s.name);
  return {
    ...meta,
    title: `${name} · ${SITE_NAME}`,
    description: `${snapshotLine(s)}. See ${name}'s games and badges on ${SITE_NAME}.`,
    image: { path: cardPath(s), ...CARD_SIZE, alt: `${name}'s ${SITE_NAME} player card` },
  };
}

// ---- pictures --------------------------------------------------------------------------

const fileCache = new Map<string, string>();

/** A badge's Twemoji face as a data URI (cached); null when there is no file for it. */
function badgeFace(id: string): string | null {
  const key = `badge:${id}`;
  if (!fileCache.has(key)) {
    const file = join(ASSETS, 'badges', `${id}.svg`);
    fileCache.set(key, existsSync(file) ? dataUri('image/svg+xml', readFileSync(file)) : '');
  }
  return fileCache.get(key) || null;
}

/** A WebP from client/public as a PNG data URI (cached: the base Chog and the mark). */
async function publicWebp(rel: string, cache = true): Promise<string | null> {
  const key = `public:${rel}`;
  const hit = fileCache.get(key);
  if (hit) return hit;
  const file = join(PUBLIC, rel);
  if (!existsSync(file)) return null;
  const uri = dataUri('image/png', await webpToPng(readFileSync(file)));
  if (cache) fileCache.set(key, uri);
  return uri;
}

const DISCORD_CDN = /^https:\/\/cdn\.discordapp\.com\/(avatars|embed\/avatars)\//;
const MAX_PICTURE_BYTES = 1_000_000;

/** A Discord picture, fetched briefly; null on any trouble (the base Chog stands in). */
async function remotePicture(url: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (!DISCORD_CDN.test(url)) return null;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(2_500), redirect: 'error' });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_PICTURE_BYTES) return null;
    const kind = sniff(buf);
    if (kind === 'image/webp') return dataUri('image/png', await webpToPng(buf));
    return kind ? dataUri(kind, buf) : null;
  } catch {
    return null;
  }
}

export interface CardPictures {
  /** The big picture (data URI). */
  avatar: string | null;
  /** The Chog Games mark (data URI). */
  mark: string | null;
}

async function picturesFor(s: PlayerSnapshot, fetchImpl?: typeof fetch): Promise<CardPictures> {
  const mark = await publicWebp('brand/chog-mark-128.webp').catch(() => null);
  let avatar: string | null = null;
  if (s.chogToken !== null) avatar = await publicWebp(`chogs/${s.chogToken}.webp`, false).catch(() => null);
  if (!avatar && /^https:\/\//.test(s.avatar)) avatar = await remotePicture(s.avatar, fetchImpl);
  return { avatar: avatar ?? mark, mark };
}

// ---- drawing ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * The card's fonts carry Latin only: anything else (other scripts, emoji)
 * would come out blank, so it is dropped, and a name with nothing left reads "Player".
 */
export function printable(name: string): string {
  // eslint-disable-next-line no-control-regex
  const kept = name.replace(/[^ -~ -ſ‘-”…]/g, '').replace(/\s+/g, ' ').trim();
  return kept || 'Player';
}

/** Roughly how wide `text` sets in Titan One / Nunito Black, in ems. */
export function textEms(text: string): number {
  let w = 0;
  for (const c of text) {
    if (c === ' ') w += 0.28;
    else if (/[iljIt.,:;!'|]/.test(c)) w += 0.32;
    else if (/[mwMW@]/.test(c)) w += 0.92;
    else if (/[A-Z0-9#%&]/.test(c)) w += 0.68;
    else w += 0.58;
  }
  return w;
}

/** The biggest size from `max` down to `min` at which `text` fits `width`; cut with … if even `min` does not. */
export function fitText(text: string, width: number, max: number, min: number): { text: string; size: number } {
  for (let size = max; size >= min; size -= 2) {
    if (textEms(text) * size <= width) return { text, size };
  }
  let t = text;
  while (t.length > 1 && textEms(`${t}…`) * min > width) t = t.slice(0, -1);
  return { text: t === text ? t : `${t.trimEnd()}…`, size: min };
}

const pct = (r: number) => `${Math.round(r * 100)}%`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthYear = (t: number) => { const d = new Date(t); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

const TIER_RING: Record<number, { ring: string; fill: string }> = {
  1: { ring: '#b9a3f2', fill: '#43209a' },
  2: { ring: '#ff8ec2', fill: '#7a1f55' },
  3: { ring: '#fdf6cd', fill: '#8a5a12' },
};

/** The best few earned badges for the card: rarest first, then newest. */
export function topBadges(list: readonly Achievement[], n = 5): Achievement[] {
  return list.filter(a => a.earned).sort((a, b) => b.tier - a.tier || (b.earnedAt ?? 0) - (a.earnedAt ?? 0)).slice(0, n);
}

/** One game's panel: a title and three or four big numbers. */
function panel(x: number, y: number, w: number, h: number, title: string, icon: string | null, stats: [string, string][]): string {
  const col = w / stats.length;
  return `
  <g>
    <rect x="${x}" y="${y + 8}" width="${w}" height="${h}" rx="24" fill="#0e0526"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="24" fill="url(#panel)" stroke="#0e0526" stroke-width="5"/>
    <rect x="${x + 6}" y="${y + 6}" width="${w - 12}" height="${h - 12}" rx="19" fill="none" stroke="#7a52e0" stroke-width="2" opacity="0.8"/>
    ${icon ? `<image href="${icon}" x="${x + 22}" y="${y + 16}" width="30" height="30"/>` : ''}
    <text x="${x + (icon ? 60 : 24)}" y="${y + 41}" font-family="Titan One" font-size="24" fill="#fdf6cd" letter-spacing="1">${esc(title)}</text>
    ${stats.map(([value, label], i) => `
    <text x="${x + col * i + col / 2}" y="${y + h - 38}" text-anchor="middle" font-family="Titan One" font-size="${col < 120 ? 40 : 44}" fill="#ffffff" stroke="#0e0526" stroke-width="6" paint-order="stroke" stroke-linejoin="round">${esc(value)}</text>
    <text x="${x + col * i + col / 2}" y="${y + h - 16}" text-anchor="middle" font-family="Nunito" font-weight="900" font-size="15" fill="#cbbcf0" letter-spacing="1.5">${esc(label)}</text>`).join('')}
  </g>`;
}

/** The card as SVG. Pure: the pictures come in as data URIs, so tests can read it as text. */
export function cardSvg(s: PlayerSnapshot, pics: CardPictures): string {
  const { width: W, height: H } = CARD_SIZE;
  const name = fitText(printable(s.name), 650, 76, 40);
  const earned = s.achievements.filter(a => a.earned).length;
  const sub = [
    Number.isFinite(s.firstGameAt) ? `Playing since ${monthYear(s.firstGameAt)}` : '',
    `${earned} of ${s.achievements.length} badges`,
  ].filter(Boolean).join('  ·  ');

  // Panels: two side by side, or one wide one with points too.
  const px = 420, pw = 720, py = 236, ph = 150;
  const monoStats = (p: PublicProfile, wide: boolean): [string, string][] =>
    [[String(p.games), 'GAMES'], [String(p.wins), 'WINS'], [pct(p.winRate), 'WIN RATE'], ...(wide ? [[String(p.points), 'POINTS'] as [string, string]] : [])];
  const cardsStats = (c: CardsProfile, wide: boolean): [string, string][] =>
    [[String(c.games), 'MATCHES'], [String(c.wins), 'WINS'], [pct(c.winRate), 'WIN RATE'], ...(wide ? [[String(c.points), 'POINTS'] as [string, string]] : [])];
  const panels = s.monopoly && s.cards
    ? panel(px, py, (pw - 24) / 2, ph, 'MONOPOLY', badgeFace('mono-first-win'), monoStats(s.monopoly, false))
      + panel(px + (pw + 24) / 2, py, (pw - 24) / 2, ph, 'CARDS', badgeFace('cards-first-win'), cardsStats(s.cards, false))
    : s.monopoly
      ? panel(px, py, pw, ph, 'MONOPOLY', badgeFace('mono-first-win'), monoStats(s.monopoly, true))
      : panel(px, py, pw, ph, 'CARDS', badgeFace('cards-first-win'), cardsStats(s.cards!, true));

  const top = topBadges(s.achievements);
  const bw = pw / 5;
  const badges = top.length
    ? top.map((a, i) => {
      const cx = px + bw * i + bw / 2, cy = 470;
      const t = TIER_RING[a.tier];
      const face = badgeFace(a.id);
      const label = fitText(a.name, bw - 8, 16, 12);
      return `
    <g>
      <circle cx="${cx}" cy="${cy + 6}" r="44" fill="#0e0526"/>
      <circle cx="${cx}" cy="${cy}" r="44" fill="${t.fill}" stroke="#0e0526" stroke-width="5"/>
      <circle cx="${cx}" cy="${cy}" r="37" fill="none" stroke="${t.ring}" stroke-width="5"/>
      ${face ? `<image href="${face}" x="${cx - 24}" y="${cy - 24}" width="48" height="48"/>` : ''}
      <text x="${cx}" y="${cy + 72}" text-anchor="middle" font-family="Nunito" font-weight="900" font-size="${label.size}" fill="#ffffff">${esc(label.text)}</text>
    </g>`;
    }).join('')
    : `<text x="${px}" y="480" font-family="Nunito" font-weight="900" font-size="24" fill="#cbbcf0">No badges yet: the first one is a game away.</text>`;

  const chip = s.chogToken !== null ? `Chog #${s.chogToken}` : 'Chog Games player';
  const chipW = Math.round(textEms(chip) * 22 + 44);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="0%" r="110%">
      <stop offset="0" stop-color="#7a4fe0"/>
      <stop offset="0.45" stop-color="#43209a"/>
      <stop offset="1" stop-color="#1a0d3d"/>
    </radialGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3d2190"/>
      <stop offset="1" stop-color="#2b1764"/>
    </linearGradient>
    <linearGradient id="pink" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff8ec2"/>
      <stop offset="0.5" stop-color="#e9508f"/>
      <stop offset="1" stop-color="#9e1d55"/>
    </linearGradient>
    <linearGradient id="cream" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fffdf2"/>
      <stop offset="1" stop-color="#f3d9a6"/>
    </linearGradient>
    <clipPath id="mark"><rect x="60" y="40" width="56" height="56" rx="16"/></clipPath>
    <clipPath id="pic"><rect x="76" y="166" width="268" height="268" rx="30"/></clipPath>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <g fill="#ffffff" opacity="0.05">
    <circle cx="1120" cy="70" r="150"/><circle cx="60" cy="600" r="120"/><circle cx="980" cy="610" r="70"/>
  </g>
  <rect width="${W}" height="10" fill="#d53f7c"/>

  ${pics.mark ? `<image href="${pics.mark}" x="60" y="40" width="56" height="56" clip-path="url(#mark)"/>` : ''}
  <text x="${pics.mark ? 128 : 60}" y="82" font-family="Titan One" font-size="34" fill="#ffffff" stroke="#0e0526" stroke-width="6" paint-order="stroke" stroke-linejoin="round">CHOG GAMES</text>
  ${CHOG_SEASON ? `
  <rect x="${W - 260}" y="46" width="200" height="44" rx="22" fill="url(#pink)" stroke="#0e0526" stroke-width="4"/>
  <text x="${W - 160}" y="76" text-anchor="middle" font-family="Titan One" font-size="20" fill="#ffffff">CHOG SEASON</text>` : ''}

  <rect x="60" y="160" width="300" height="300" rx="40" fill="#0e0526"/>
  <rect x="60" y="150" width="300" height="300" rx="40" fill="url(#cream)" stroke="#0e0526" stroke-width="6"/>
  <rect x="76" y="166" width="268" height="268" rx="30" fill="#2b1764"/>
  ${pics.avatar ? `<image href="${pics.avatar}" x="76" y="166" width="268" height="268" preserveAspectRatio="xMidYMid slice" clip-path="url(#pic)"/>` : ''}
  <rect x="${210 - chipW / 2}" y="480" width="${chipW}" height="46" rx="23" fill="url(#cream)" stroke="#0e0526" stroke-width="4"/>
  <text x="210" y="511" text-anchor="middle" font-family="Titan One" font-size="22" fill="#7a1747">${esc(chip)}</text>

  <text x="${px}" y="${178 - (76 - name.size) / 3}" font-family="Titan One" font-size="${name.size}" fill="#ffffff" stroke="#0e0526" stroke-width="10" paint-order="stroke" stroke-linejoin="round">${esc(name.text)}</text>
  <text x="${px}" y="216" font-family="Nunito" font-weight="900" font-size="22" fill="#cbbcf0">${esc(sub)}</text>

  ${panels}
  ${badges}

  <rect y="${H - 46}" width="${W}" height="46" fill="#d53f7c"/>
  <rect y="${H - 46}" width="${W}" height="4" fill="#9e1d55"/>
  <text x="60" y="${H - 15}" font-family="Nunito" font-weight="900" font-size="20" fill="#ffffff">Monopoly · Cards · Poker with the Chog crew</text>
  <text x="${W - 60}" y="${H - 15}" text-anchor="end" font-family="Titan One" font-size="22" fill="#fdf6cd">choggames.com</text>
</svg>`;
}

// ---- rendering and the cache -----------------------------------------------------------

const FONT_FILES = ['titan-one-400.ttf', 'nunito-800.ttf', 'nunito-900.ttf'].map(f => join(ASSETS, 'fonts', f));

export function renderSvg(svg: string): Buffer {
  const r = new Resvg(svg, {
    fitTo: { mode: 'original' },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Nunito' },
  });
  return r.render().asPng();
}

const MAX_CACHED = 500;
const cache = new Map<string, { png: Buffer; at: number }>();
const inFlight = new Map<string, Promise<Buffer>>();

export function clearCardCache(): void {
  cache.clear();
}

/** A card drawn within CARD_TTL_MS, if there is one (checked before working out the snapshot again). */
export function cachedCard(id: string, now = Date.now()): Buffer | null {
  const hit = cache.get(id);
  return hit && now - hit.at < CARD_TTL_MS ? hit.png : null;
}

/**
 * The card PNG for a snapshot, reused for CARD_TTL_MS per player. Requests for
 * the same player while one is drawing share it.
 */
export async function cardPng(s: PlayerSnapshot, opts: { now?: number; fetchImpl?: typeof fetch } = {}): Promise<Buffer> {
  const now = opts.now ?? Date.now();
  const hit = cachedCard(s.id, now);
  if (hit) return hit;
  const running = inFlight.get(s.id);
  if (running) return running;
  const job = (async () => {
    const png = renderSvg(cardSvg(s, await picturesFor(s, opts.fetchImpl)));
    cache.delete(s.id);
    cache.set(s.id, { png, at: now });
    // Oldest first out: a Map keeps insertion order.
    while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
    return png;
  })();
  inFlight.set(s.id, job);
  try { return await job; } finally { inFlight.delete(s.id); }
}
