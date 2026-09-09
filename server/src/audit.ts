// Operator audit trail: who played, from where, and whether any pair of
// players is behaving like the same person or a team.
//
// Held in memory for speed, persisted to the data volume (saveAudit /
// loadAudit) so restarts and deploys don't wipe the operator's history.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CardT } from '../../shared/types.ts';
import { reportFlaggedHands } from './discord.ts';
import { CAT, categoryOf, evaluate7 } from './engine/evaluator.ts';
import type { Table } from './engine/table.ts';
import { countryOf } from './geo.ts';
import { isInfraPeer } from './net.ts';
import { DATA_DIR } from './paths.ts';

export interface PlayerRecord {
  id: string;
  name: string;
  avatar: string;
  discordId: string | null;
  discordTag: string | null;
  firstSeen: number;
  lastSeen: number;
  ips: Map<string, number>; // ip -> last seen
  handsPlayed: number;
  gamesJoined: Set<string>;
}

const players = new Map<string, PlayerRecord>();

export function noteSeen(
  p: { id: string; name: string; avatar: string; discord?: { id: string; username: string } | null },
  ip: string | null,
) {
  const now = Date.now();
  let rec = players.get(p.id);
  if (!rec) {
    rec = {
      id: p.id, name: p.name, avatar: p.avatar,
      discordId: p.discord?.id ?? null,
      discordTag: p.discord?.username ?? null,
      firstSeen: now, lastSeen: now,
      ips: new Map(), handsPlayed: 0, gamesJoined: new Set(),
    };
    players.set(p.id, rec);
  }
  rec.name = p.name;
  rec.avatar = p.avatar;
  if (p.discord) { rec.discordId = p.discord.id; rec.discordTag = p.discord.username; }
  rec.lastSeen = now;
  if (ip) rec.ips.set(ip, now);
}

export function noteGame(playerId: string, gameId: string) {
  players.get(playerId)?.gamesJoined.add(gameId);
}

// ---- per-hand action log, used for the collusion review ----
export interface HandAction {
  ts: number;
  tableId: string;
  tableName: string;
  handNumber: number;
  playerId: string;
  playerName: string;
  action: string;
  amount: number;
  pot: number;
}

const actions: HandAction[] = [];
const MAX_ACTIONS = 20_000;

export function noteAction(a: HandAction) {
  actions.push(a);
  if (actions.length > MAX_ACTIONS) actions.shift();
  const rec = players.get(a.playerId);
  if (rec) rec.gamesJoined.add(a.tableId);
}

// Chips moved between a pair of players when they were the only two left in a
// hand — the shape chip dumping takes.
export interface PairStat {
  a: string; aName: string;
  b: string; bName: string;
  handsTogether: number;
  headsUpPots: number;
  netAtoB: number; // positive: a lost this much to b
  sharedIps: string[];
  sameIpOnly: boolean; // every session for both came from one shared address
  dumpHands: number;   // hands one of them lost with an unjustifiable holding
  dumpChips: number;   // chips moved in exactly those hands
}

// ---- move-quality analysis ----
// Chip dumping does not just look like "chips moved"; it looks like chips
// moved for BAD REASONS. These signals judge the decision, not the outcome,
// so a player who loses a big pot with aces is never flagged while one who
// shoves 7-2 into the same friend four times is.
//
// Everything here is ADVISORY. Nothing is ever auto-punished — a flag is an
// invitation for the operator to look at the hand, and normal bad play will
// occasionally trip one. Judgement stays human.

// Chen-style preflop strength, roughly 0 (72o) to 20 (AA).
export function preflopStrength(cards: CardT[]): number {
  if (cards.length < 2) return 0;
  const [a, b] = [...cards].sort((x, y) => y.r - x.r);
  const HIGH: Record<number, number> = { 14: 10, 13: 8, 12: 7, 11: 6 };
  let score = HIGH[a.r] ?? a.r / 2;
  if (a.r === b.r) score = Math.max(5, score * 2); // pairs
  if (a.s === b.s) score += 2;                     // suited
  const gap = a.r - b.r;
  if (a.r !== b.r) {
    if (gap === 2) score -= 1;
    else if (gap === 3) score -= 2;
    else if (gap === 4) score -= 4;
    else if (gap >= 5) score -= 5;
    if (gap <= 2 && a.r < 12) score += 1; // connected low cards make straights
  }
  return Math.max(0, Math.round(score));
}

export interface FlaggedHand {
  ts: number;
  tableName: string;
  handNumber: number;
  playerId: string;
  playerName: string;
  toId: string | null;   // who received the chips
  toName: string | null;
  chips: number;         // how much they lost on the hand
  stackPct: number;      // share of their stack put in
  reason: string;        // plain-English explanation for the operator
  cards: CardT[];
}

const flagged: FlaggedHand[] = [];
const MAX_FLAGGED = 400;

// A hand is worth the operator's attention when a player put a big share of
// their stack in and the holding simply did not justify it.
// Below this many big blinds, getting the rest of the chips in is not a
// decision anybody makes — it is the only move the structure leaves. Flagging
// it produced a list that was almost entirely short stacks doing the correct
// thing: of 356 flags in one event, nearly every line read "100% of stack",
// including players all-in for 100 chips at a table where the average was six
// figures. That is not a detector, it is a census of tournament poker.
const SHORT_STACK_BB = 12;

function judgeHand(e: {
  contenders: {
    id: string; name: string; net: number; cards: CardT[];
    committed: number; startStack: number; allIn: boolean; wentToShowdown: boolean;
  }[];
  board: CardT[];
  tableName: string;
  handNumber: number;
  bb: number;
}) {
  const winner = [...e.contenders].sort((a, b) => b.net - a.net)[0];
  if (!winner || winner.net <= 0) return;
  const raised: string[] = [];
  const bb = Math.max(1, e.bb);

  for (const c of e.contenders) {
    if (c.id === winner.id || c.net >= 0) continue;
    const stackPct = c.startStack > 0 ? c.committed / c.startStack : 0;
    const depth = c.startStack / bb;
    // Only a real commitment, from a stack deep enough to have had a choice,
    // in a pot worth having.
    if (stackPct < 0.35) continue;
    if (depth < SHORT_STACK_BB) continue;
    if (c.committed < bb * 10) continue;

    const pre = preflopStrength(c.cards);
    const isPair = c.cards.length === 2 && c.cards[0].r === c.cards[1].r;
    const hasAce = c.cards.some(x => x.r === 14);
    // The Chen score this uses is a fine relative ranking and a terrible
    // absolute one: it puts pocket fives (5) level with seven-deuce-ish junk,
    // and it has no opinion at all about ace-king, which is why the old list
    // flagged AK and AQ for "giving up with no pair". A pair or an ace is a
    // standard holding to get chips in with — never, on its own, evidence.
    const junk = pre <= 4 && !isPair && !hasAce;
    const depthText = `${Math.round(depth)} BB deep`;
    const reasons: string[] = [];

    if (c.allIn && e.board.length === 0 && junk) {
      reasons.push(`all-in preflop ${depthText} with junk (strength ${pre}/20)`);
    } else if (c.cards.length === 2 && e.board.length >= 3) {
      const cat = categoryOf(evaluate7([...c.cards, ...e.board]));
      // Missing with a good hand is a lost race, not a mistake, so the
      // holding has to be bad on its own terms before the result counts.
      if (cat === CAT.HIGH && stackPct >= 0.6 && junk) {
        reasons.push(`put in ${Math.round(stackPct * 100)}% of a ${depthText} stack with junk `
          + `(strength ${pre}/20) and never made a pair`);
      } else if (cat <= CAT.PAIR && stackPct >= 0.85 && junk) {
        reasons.push(`committed ${Math.round(stackPct * 100)}% of a ${depthText} stack `
          + `holding junk (strength ${pre}/20) for at most one pair`);
      }
    }
    if (reasons.length === 0) continue;

    flagged.push({
      ts: Date.now(),
      tableName: e.tableName,
      handNumber: e.handNumber,
      playerId: c.id, playerName: c.name,
      toId: winner.id, toName: winner.name,
      chips: -c.net,
      stackPct: Math.round(stackPct * 100),
      reason: reasons.join('; '),
      cards: c.cards,
    });
    if (flagged.length > MAX_FLAGGED) flagged.shift();
    raised.push(
      `**${c.name}** ${cardsText(c.cards)} lost **${-c.net}** (${Math.round(stackPct * 100)}% of stack) `
      + `to **${winner.name}** — ${reasons.join('; ')} · ${e.tableName} #${e.handNumber}`,
    );

    // Count it against the pair as a directed donation — but only if these
    // two have actually played a pot against each other. Creating a pair
    // record here invented one for every flagged hand, which is how the chip
    // flow panel ended up 450 rows of "0 pots, net 0" with the three pairs
    // that mattered buried underneath. The heads-up pot for this very hand is
    // recorded before judging, so a blatant first-hand dump still lands.
    const cur = pairs.get(pairKey(c.id, winner.id));
    if (cur) {
      cur.dumpHands += 1;
      cur.dumpChips += -c.net;
      cur.names[c.id] = c.name;
      cur.names[winner.id] = winner.name;
    }
  }
  // Ping the operator's private channel so a dump is caught while it happens,
  // not whenever someone next opens the Audit page.
  reportFlaggedHands(raised);
}

const RANK_CH: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const SUIT_CH = ['\u2660', '\u2665', '\u2666', '\u2663'];
function cardsText(cards: CardT[]): string {
  return `[${cards.map(c => `${RANK_CH[c.r] ?? c.r}${SUIT_CH[c.s] ?? ''}`).join(' ')}]`;
}

export function recordHandResult(
  table: Table,
  contenders: { id: string; name: string; net: number }[],
  detail?: {
    contenders: {
      id: string; name: string; net: number; cards: CardT[];
      committed: number; startStack: number; allIn: boolean; wentToShowdown: boolean;
    }[];
    board: CardT[]; tableName: string; handNumber: number;
  },
) {
  for (const c of contenders) {
    const rec = players.get(c.id);
    if (rec) rec.handsPlayed += 1;
  }

  // Chip flow between exactly two players reaching the end: the classic
  // dumping shape, tracked separately from the quality signals below. This
  // runs BEFORE judging so that a donation on the pair's very first hand
  // still has a pair record to attach itself to.
  const shown = contenders.filter(c => c.net !== 0);
  if (shown.length === 2) {
    const [x, y] = shown;
    const key = pairKey(x.id, y.id);
    const cur = pairs.get(key)
      ?? { handsTogether: 0, headsUpPots: 0, netAtoB: 0, first: x.id, dumpHands: 0, dumpChips: 0, names: {} };
    cur.handsTogether += 1;
    cur.headsUpPots += 1;
    cur.names[x.id] = x.name;
    cur.names[y.id] = y.name;
    // Normalise direction against whichever id we stored first.
    const delta = cur.first === x.id ? -x.net : -y.net;
    cur.netAtoB += delta;
    pairs.set(key, cur);
  }

  // Judged last, and told the big blind: without it there is no way to tell a
  // reckless shove from a short stack with no other move.
  if (detail) judgeHand({ ...detail, bb: table.bb });
}

export function flaggedHands(limit = 100): FlaggedHand[] {
  return flagged.slice(-limit).reverse();
}

interface PairState {
  handsTogether: number; headsUpPots: number; netAtoB: number; first: string;
  dumpHands: number; dumpChips: number;
  // Names captured at play time: evidence must not disappear just because a
  // player record is missing (fresh boot, partial restore, pruned history).
  names: Record<string, string>;
}
const pairs = new Map<string, PairState>();

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ---- reporting ----
export interface PlayerRow {
  id: string;
  name: string;
  avatar: string;
  discordTag: string | null;
  discordVerifiedId: string | null;
  firstSeen: number;
  lastSeen: number;
  ips: string[];
  // Countries for those addresses, same order. A player whose addresses sit
  // in two countries at once is worth a second look.
  countries: (string | null)[];
  handsPlayed: number;
  games: number;
}

export function playerRows(): PlayerRow[] {
  return [...players.values()]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .map(p => ({
      id: p.id, name: p.name, avatar: p.avatar,
      discordTag: p.discordTag, discordVerifiedId: p.discordId,
      firstSeen: p.firstSeen, lastSeen: p.lastSeen,
      ips: [...p.ips.keys()],
      countries: [...p.ips.keys()].map(countryOf),
      handsPlayed: p.handsPlayed,
      games: p.gamesJoined.size,
    }));
}

// Accounts sharing an IP — the cheapest alt-account signal there is.
export interface AltGroup {
  // Stable identity for the group: its addresses, sorted and joined. The panel
  // is keyed on this rather than on a single address, because a group is a set
  // of people, not a set of routers.
  key: string;
  addresses: { ip: string; country: string | null }[];
  score: number;      // 0-100, higher = more worth a look
  reasons: string[];
  playedTogether: number; // pairs in this group who shared at least one game
  players: { id: string; name: string; discordTag: string | null; lastSeen: number }[];
}

// One account, and everyone the addresses connect it to.
//
// The shared-address panel is organised the wrong way round for this
// question. It lists addresses, so a person with three accounts across two
// addresses appears in two unrelated-looking rows, and answering "does this
// player have alts" means reading the whole page and joining it up by eye.
// This starts from the player instead and walks outwards.
//
// It walks more than one step: if A and B share an address, and B and C share
// a different one, C is worth seeing on A's card — that is exactly the shape
// somebody takes when they are trying not to be obvious. But it refuses to
// expand through a crowded address, because a mobile carrier or a VPN exit
// puts hundreds of strangers behind one, and hopping through those would
// eventually connect the entire site to itself and prove nothing at all.
const CROWD_LIMIT = 8;

export interface LinkedAccount {
  id: string;
  name: string;
  avatar: string;
  discordTag: string | null;
  discordVerifiedId: string | null;
  // Addresses this account holds in common with the subject. Empty when the
  // link is indirect — the path is named in `via` instead.
  sharedIps: string[];
  // 1 = shares an address with the subject directly. 2+ = reached through
  // that many links, so weigh it accordingly.
  hops: number;
  via: string | null; // name of the account that bridges an indirect link
  // How many accounts sit on the busiest address behind this link. Two is a
  // household; forty is a carrier and means close to nothing.
  crowd: number;
  playedTogether: number; // games this account and the subject were both in
  handsPlayed: number;
  firstSeen: number;
  lastSeen: number;
}

export interface PlayerConnections {
  subject: PlayerRow;
  // The subject's own addresses, with how many accounts each one carries.
  addresses: { ip: string; country: string | null; accounts: number }[];
  linked: LinkedAccount[];
  // Plain-language summary of what the numbers above add up to.
  verdict: string;
}

// Find one account from whatever the operator has to hand: the site id, a bare
// Discord id, a Discord tag, or a name.
export function findPlayer(query: string): PlayerRecord | null {
  const q = String(query ?? '').trim();
  if (!q) return null;
  const bare = q.replace(/^@/, '');
  const direct = players.get(q) ?? players.get(`dc_${bare}`);
  if (direct) return direct;
  const lower = bare.toLowerCase();
  // Ids and Discord tags are unique; display names are not, and two people
  // called the same thing is exactly the situation somebody exploits. When a
  // name is all there is, answer with the account seen most recently and let
  // the operator follow it from there rather than picking one at random.
  const all = [...players.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  return all.find(p => p.discordId === bare)
    ?? all.find(p => (p.discordTag ?? '').toLowerCase() === lower)
    ?? all.find(p => p.name.toLowerCase() === lower)
    ?? all.find(p => p.name.toLowerCase().includes(lower))
    ?? null;
}

export function connectionsFor(query: string): PlayerConnections | null {
  const subject = findPlayer(query);
  if (!subject) return null;

  // Addresses -> accounts, our own plumbing left out. Recorded before the
  // proxy handling was fixed, those entries are all in infrastructure ranges
  // and would link everybody to everybody.
  const byIp = new Map<string, PlayerRecord[]>();
  for (const p of players.values()) {
    for (const ip of p.ips.keys()) {
      if (isInfraPeer(ip)) continue;
      const list = byIp.get(ip) ?? [];
      list.push(p);
      byIp.set(ip, list);
    }
  }
  const ipsOf = (p: PlayerRecord) => [...p.ips.keys()].filter(ip => !isInfraPeer(ip));
  const sharesGame = (a: PlayerRecord, b: PlayerRecord) => {
    let n = 0;
    for (const g of a.gamesJoined) if (b.gamesJoined.has(g)) n += 1;
    return n;
  };

  const found = new Map<string, LinkedAccount>();
  const seen = new Set<string>([subject.id]);
  let frontier: { rec: PlayerRecord; hops: number }[] = [{ rec: subject, hops: 0 }];

  while (frontier.length > 0 && found.size < 200) {
    const next: { rec: PlayerRecord; hops: number }[] = [];
    for (const { rec, hops } of frontier) {
      for (const ip of ipsOf(rec)) {
        const crowd = byIp.get(ip)?.length ?? 1;
        const crowded = crowd > CROWD_LIMIT;
        // A carrier-sized address is reported when the subject sits on it
        // directly — flagged by `crowd`, for the operator to weigh — but two
        // steps out it is only noise, so it is not even enumerated there.
        if (hops > 0 && crowded) continue;
        for (const other of byIp.get(ip) ?? []) {
          if (other.id === subject.id) continue;
          const existing = found.get(other.id);
          const direct = hops === 0;
          if (existing) {
            if (direct && !existing.sharedIps.includes(ip)) existing.sharedIps.push(ip);
            existing.crowd = Math.max(existing.crowd, crowd);
            continue;
          }
          found.set(other.id, {
            id: other.id, name: other.name, avatar: other.avatar,
            discordTag: other.discordTag, discordVerifiedId: other.discordId,
            sharedIps: direct ? [ip] : [],
            hops: hops + 1,
            via: direct ? null : rec.name,
            crowd,
            playedTogether: sharesGame(subject, other),
            handsPlayed: other.handsPlayed,
            firstSeen: other.firstSeen, lastSeen: other.lastSeen,
          });
          // And nobody reached ACROSS a crowd is walked onward from. Every
          // stranger on a mobile carrier would otherwise hand over their own
          // household, and the next round would hand over that household's
          // strangers, until the tool connects the entire site to itself and
          // means nothing. Only a small, household-sized address earns a step.
          if (!crowded && !seen.has(other.id)) {
            seen.add(other.id);
            next.push({ rec: other, hops: hops + 1 });
          }
        }
      }
    }
    frontier = next;
  }

  const linked = [...found.values()].sort((a, b) =>
    a.hops - b.hops
    || b.playedTogether - a.playedTogether
    || a.crowd - b.crowd
    || b.lastSeen - a.lastSeen);

  const addresses = ipsOf(subject).map(ip => ({
    ip, country: countryOf(ip), accounts: byIp.get(ip)?.length ?? 1,
  })).sort((a, b) => a.accounts - b.accounts);

  // The reading, in words, so nobody has to infer it from three numbers.
  const close = linked.filter(l => l.hops === 1 && l.crowd <= CROWD_LIMIT);
  const together = close.filter(l => l.playedTogether > 0);
  let verdict: string;
  if (linked.length === 0) {
    verdict = addresses.length === 0
      ? 'No addresses recorded for this account yet — nothing to compare.'
      : 'No other account has ever been seen from this player\'s addresses.';
  } else if (close.length === 0) {
    verdict = `Shares an address only with large groups (${linked.length} account(s)), `
      + 'which is what a mobile network or VPN looks like. No usable link.';
  } else if (together.length === 0) {
    verdict = `${close.length} other account(s) on a small shared address, but none of them `
      + 'has ever been in the same game. Consistent with a household or one person on two devices.';
  } else {
    verdict = `${together.length} of ${close.length} closely linked account(s) have played in the `
      + 'same game as this player — worth reading the hands before deciding anything.';
  }

  return { subject: rowFor(subject), addresses, linked, verdict };
}

// One PlayerRow, without rebuilding the whole table to get it.
function rowFor(p: PlayerRecord): PlayerRow {
  return {
    id: p.id, name: p.name, avatar: p.avatar,
    discordTag: p.discordTag, discordVerifiedId: p.discordId,
    firstSeen: p.firstSeen, lastSeen: p.lastSeen,
    ips: [...p.ips.keys()],
    countries: [...p.ips.keys()].map(countryOf),
    handsPlayed: p.handsPlayed,
    games: p.gamesJoined.size,
  };
}

// How many pairs in the group were ever in the same game.
function pairsSharingAGame(list: PlayerRecord[]): number {
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      for (const g of list[i].gamesJoined) {
        if (list[j].gamesJoined.has(g)) { n += 1; break; }
      }
    }
  }
  return n;
}

export function altGroups(): AltGroup[] {
  const byIp = new Map<string, PlayerRecord[]>();
  for (const p of players.values()) {
    for (const ip of p.ips.keys()) {
      // Our own plumbing is not a player. Addresses recorded before the
      // proxy handling was fixed are all in these ranges, so leaving them
      // out is also what clears the historical rubbish out of the panel
      // without deleting anything from the record.
      if (isInfraPeer(ip)) continue;
      const list = byIp.get(ip) ?? [];
      list.push(p);
      byIp.set(ip, list);
    }
  }
  const shared = [...byIp.entries()].filter(([, list]) => list.length > 1);

  // A group is a set of people, not a set of routers.
  //
  // Listing one row per address meant a household on four addresses appeared
  // four times, each row identical apart from the number at the top, and the
  // operator had to notice by eye that it was the same two people over and
  // over. Addresses that share an account are folded together instead, so
  // those four rows become one that says "Nimbu and LOVÈ, from these four
  // addresses".
  //
  // Crowded addresses are never used to fold. A mobile carrier or a VPN exit
  // holds hundreds of unrelated strangers; merging through one would collapse
  // half the site into a single meaningless row.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    parent.set(x, parent.get(x) ?? x);
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  const union = (a: string, b: string) => {
    const ra = find(a); const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const seenBy = new Map<string, string[]>(); // player id -> their small addresses
  for (const [ip, list] of shared) {
    find(ip);
    if (list.length > CROWD_LIMIT) continue;
    for (const p of list) {
      const mine = seenBy.get(p.id) ?? [];
      mine.push(ip);
      seenBy.set(p.id, mine);
    }
  }
  for (const ips of seenBy.values()) {
    for (let i = 1; i < ips.length; i++) union(ips[0], ips[i]);
  }

  const groups = new Map<string, { ips: string[]; players: Map<string, PlayerRecord> }>();
  for (const [ip, list] of shared) {
    const root = find(ip);
    const g = groups.get(root)
      ?? { ips: [] as string[], players: new Map<string, PlayerRecord>() };
    g.ips.push(ip);
    for (const p of list) g.players.set(p.id, p);
    groups.set(root, g);
  }

  return [...groups.values()].map(g => {
    const list = [...g.players.values()];
    const size = list.length;
    const together = pairsSharingAGame(list);
    // Size counts against a group rather than recommending it.
    const sizeScore = size === 2 ? 45 : size <= 4 ? 30 : size <= 8 ? 12 : 3;
    const score = Math.min(100, sizeScore + (together > 0 ? 40 : 0));

    const ips = [...g.ips].sort();
    const reasons: string[] = [];
    if (size === 2) reasons.push('Only two accounts');
    else if (size > CROWD_LIMIT) reasons.push(`${size} accounts — typical of a mobile network or VPN, not a household`);
    else reasons.push(`${size} accounts`);
    if (ips.length > 1) {
      reasons.push(`Seen together on ${ips.length} addresses`);
    }
    reasons.push(together > 0
      ? `${together} pair${together === 1 ? '' : 's'} played in the same game`
      : 'Never played in the same game');

    return {
      key: ips.join(','),
      addresses: ips.map(ip => ({ ip, country: countryOf(ip) })),
      score,
      reasons,
      playedTogether: together,
      players: list
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .map(p => ({ id: p.id, name: p.name, discordTag: p.discordTag, lastSeen: p.lastSeen })),
    };
  })
    // Worth-a-look first; among equals, the smaller group is the sharper lead.
    .sort((a, b) => (b.score - a.score) || (a.players.length - b.players.length));
}

// Pairs worth a look: they meet heads-up often, and chips flow one way.
export function suspiciousPairs(minHands = 5): PairStat[] {
  const out: PairStat[] = [];
  for (const [key, v] of pairs) {
    // Two people who have never played a pot against each other are not a
    // pair, whatever else is true of them. Every row in the old panel that
    // read "0 pots, net 0" was one of these, and there were hundreds.
    if (v.headsUpPots === 0) continue;
    // Past that, qualify either by playing enough pots together OR by one
    // hand where the chips moved for no good reason — waiting for five
    // heads-up pots would miss a fast, blatant dump.
    if (v.headsUpPots < minHands && v.dumpHands === 0) continue;
    const [a, b] = key.split('|');
    const pa = players.get(a); const pb = players.get(b);
    // Missing directory entries must not hide a flagged pair — fall back to
    // the names recorded when the hands were actually played.
    const shared = pa && pb ? [...pa.ips.keys()].filter(ip => pb.ips.has(ip)) : [];
    out.push({
      a, aName: pa?.name ?? v.names?.[a] ?? a,
      b, bName: pb?.name ?? v.names?.[b] ?? b,
      handsTogether: v.handsTogether,
      headsUpPots: v.headsUpPots,
      // Report the flow relative to `a`, whichever way it was stored.
      netAtoB: v.first === a ? v.netAtoB : -v.netAtoB,
      sharedIps: shared,
      sameIpOnly: shared.length > 0 && !!pa && !!pb && pa.ips.size === 1 && pb.ips.size === 1,
      dumpHands: v.dumpHands ?? 0,
      dumpChips: v.dumpChips ?? 0,
    });
  }
  // Size of the one-way flow leads, because that is the thing that cannot be
  // explained away: chips moving one direction, repeatedly, between the same
  // two people. Sorting by flagged-hand count first put every one-off bad
  // beat above the two pairs in the last event that had moved a million
  // chips each. Donations break the tie.
  return out.sort((x, y) =>
    (Math.abs(y.netAtoB) - Math.abs(x.netAtoB)) || (y.dumpHands - x.dumpHands));
}

export function recentActions(limit = 300, playerId?: string): HandAction[] {
  const src = playerId ? actions.filter(a => a.playerId === playerId) : actions;
  return src.slice(-limit).reverse();
}

export function auditCounts() {
  return { players: players.size, actions: actions.length, pairs: pairs.size, flagged: flagged.length };
}

// Drop everything the audit holds about one player.
//
// This is for clearing out accounts that were never really players — test
// sign-ins, a demo run, someone who connected once by mistake — so the list
// shows the room rather than its history of setup. It is not a punishment and
// not a ban: a removed player who comes back is simply recorded again.
//
// What goes: their record, their moves, and any pairing they are half of.
// What stays: a flagged hand where they were only the one who *received* the
// chips. That flag is evidence about the other player, and the names on it
// were captured at play time, so it still reads correctly with this account
// gone. Removing it would delete somebody else's case.
export function forgetPlayer(id: string): {
  found: boolean; actions: number; pairs: number; flagged: number;
} {
  const found = players.delete(id);

  let removedActions = 0;
  for (let i = actions.length - 1; i >= 0; i--) {
    if (actions[i].playerId === id) { actions.splice(i, 1); removedActions++; }
  }

  let removedPairs = 0;
  for (const key of [...pairs.keys()]) {
    const [a, b] = key.split('|');
    if (a === id || b === id) { pairs.delete(key); removedPairs++; }
  }

  let removedFlags = 0;
  for (let i = flagged.length - 1; i >= 0; i--) {
    if (flagged[i].playerId === id) { flagged.splice(i, 1); removedFlags++; }
  }

  if (found || removedActions || removedPairs || removedFlags) saveAudit();
  return { found, actions: removedActions, pairs: removedPairs, flagged: removedFlags };
}

// ---- persistence ----
const AUDIT_FILE = join(DATA_DIR, 'audit.json');
// The action log is the bulky part; keep the persisted slice bounded so the
// file stays small and writes stay cheap.
const PERSIST_ACTIONS = 5_000;

export function saveAudit(): void {
  try {
    const payload = {
      v: 1,
      players: [...players.values()].map(p => ({
        ...p,
        ips: [...p.ips.entries()],
        gamesJoined: [...p.gamesJoined],
      })),
      actions: actions.slice(-PERSIST_ACTIONS),
      pairs: [...pairs.entries()],
      flagged: flagged.slice(-MAX_FLAGGED),
    };
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${AUDIT_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload));
    renameSync(tmp, AUDIT_FILE);
  } catch (e) {
    console.error('Audit save failed:', e);
  }
}

export function loadAudit(): void {
  try {
    if (!existsSync(AUDIT_FILE)) return;
    const raw = JSON.parse(readFileSync(AUDIT_FILE, 'utf8'));
    if (!raw || raw.v !== 1) return;
    for (const p of raw.players ?? []) {
      players.set(p.id, {
        ...p,
        ips: new Map(p.ips ?? []),
        gamesJoined: new Set(p.gamesJoined ?? []),
      });
    }
    for (const a of raw.actions ?? []) actions.push(a);
    for (const [k, v] of raw.pairs ?? []) {
      pairs.set(k, { dumpHands: 0, dumpChips: 0, names: {}, ...v });
    }
    for (const f of raw.flagged ?? []) flagged.push(f);
    console.log(`Audit history loaded: ${players.size} players, ${actions.length} actions`);
  } catch (e) {
    console.error('Audit load failed:', e);
  }
}
