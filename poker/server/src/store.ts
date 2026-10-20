// Durable storage for finished tournament results and the all-time leaderboard.
// A simple JSON file — atomic-ish writes, loaded once at boot. At hundreds of
// tournaments this stays tiny; swap for a database only if it ever matters.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CashRecord, LeaderboardEntry, TournamentRecord } from '../../shared/types.ts';
import { DATA_DIR } from './paths.ts';
import { chogField } from './chogs.ts';

const RESULTS_FILE = join(DATA_DIR, 'results.json');

let records: TournamentRecord[] = [];

export function loadResults(): void {
  try {
    if (existsSync(RESULTS_FILE)) {
      const parsed = JSON.parse(readFileSync(RESULTS_FILE, 'utf8'));
      if (Array.isArray(parsed)) records = parsed;
    }
  } catch (e) {
    console.error('Could not load results store:', e);
  }
}

export function saveResults(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${RESULTS_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(records));
    renameSync(tmp, RESULTS_FILE);
  } catch (e) {
    console.error('Could not save results store:', e);
  }
}

export function addRecord(record: TournamentRecord): void {
  records.push(record);
  if (records.length > 2000) records = records.slice(-2000);
  saveResults();
}

// A finished tournament's permanent record — what its link shows once the
// live game is gone (after a deploy, or any time later).
// Rebuild a finished tournament's finishing places from the elimination
// order. Written for the first live event, where the place counter drifted
// (late registrants did not grow it) and the record ends with duplicate,
// zero and negative places.
//
// The stamped numbers are wrong but their ORDER is not: every bust took the
// counter's current value and stepped it down, so sorting the stamps in
// descending order reproduces the elimination sequence exactly. The winner is
// the one row that never busted — finish() stamps them 1, which can collide
// with an eliminated player's drifted stamp, so the caller must name the
// winner and the repair refuses to guess.
export function repairTournamentPlaces(
  id: string, winnerId: string, commit: boolean,
): { ok: boolean; error?: string; before?: { name: string; place: number }[]; after?: { name: string; place: number }[] } {
  const rec = findRecord(id);
  if (!rec) return { ok: false, error: 'No record for that tournament' };
  const rows = rec.results;
  const winner = rows.find(r => r.playerId === winnerId);
  if (!winner) return { ok: false, error: 'winnerId is not in this record' };

  const before = rows.map(r => ({ name: r.name, place: r.place }));
  const losers = rows.filter(r => r.playerId !== winnerId);
  // Descending stamps = elimination order, first-out first. Ties can only
  // come from re-entries; keep their relative order stable and say so.
  const dup = losers.some((r, i) => losers.slice(i + 1).some(o => o.place === r.place));
  losers.sort((a, b) => b.place - a.place);
  const n = rows.length;
  losers.forEach((r, i) => { r.place = n - i; });
  winner.place = 1;
  rec.results = [winner, ...losers].sort((a, b) => a.place - b.place);
  const after = rec.results.map(r => ({ name: r.name, place: r.place }));
  if (commit) saveResults();
  return { ok: true, before, after, ...(dup ? { error: 'duplicate stamps found (re-entries?) — tied pairs kept in stored order, review before commit' } : {}) };
}

// A record whose places came out impossible can be repaired at boot, but the
// winner has to be named by a person (see above) — so the list below is a
// hand-written entry per broken event. This deployment has not run one yet.
// The upstream site's entry was deliberately not carried across: it names
// another room's tournament and another room's winner, and could only ever
// match by coincidence.
const KNOWN_WINNERS: { tourney: string; winner: string }[] = [];

// `winners` is a seam for the tests: the list is normally empty here, and a
// mechanism with nothing to act on cannot be tested by calling it. Production
// passes nothing and gets KNOWN_WINNERS.
export function repairKnownRecords(winners: { tourney: string; winner: string }[] = KNOWN_WINNERS): void {
  for (const k of winners) {
    const rec = records.find(r => r.name === k.tourney && r.results.some(x => x.place < 1));
    if (!rec) continue;
    const candidates = rec.results.filter(x => x.name === k.winner);
    if (candidates.length !== 1) {
      console.warn(`[repair] ${k.tourney}: ${candidates.length} rows named "${k.winner}" — leaving the record alone`);
      continue;
    }
    const out = repairTournamentPlaces(rec.id, candidates[0].playerId, true);
    console.log(`[repair] ${k.tourney}: ${out.ok ? `places rebuilt, winner ${k.winner}` : out.error}`);
  }
}

export function findRecord(id: string): TournamentRecord | null {
  return records.find(r => r.id === id) ?? null;
}

export function recentRecords(limit = 20): TournamentRecord[] {
  return [...records].sort((a, b) => b.finishedAt - a.finishedAt).slice(0, limit);
}

export function recordCount(): number {
  return records.length;
}

// Deleting a record is what frees its name for reuse, so it is a real
// operation rather than a tidy-up: returns whether anything was removed.
export function removeRecord(id: string): boolean {
  const before = records.length;
  records = records.filter(r => r.id !== id);
  if (records.length === before) return false;
  saveResults();
  return true;
}

export function allRecords(): TournamentRecord[] {
  return [...records].sort((a, b) => b.finishedAt - a.finishedAt);
}

// ---------- finished cash sessions ----------
// Their own file: cash play has no bearing on the tournament leaderboard,
// and keeping them apart means neither can corrupt the other's load.
const CASH_FILE = join(DATA_DIR, 'cash-history.json');
let cashRecords: CashRecord[] = [];

export function loadCashRecords(): void {
  try {
    if (existsSync(CASH_FILE)) {
      const parsed = JSON.parse(readFileSync(CASH_FILE, 'utf8'));
      if (Array.isArray(parsed)) cashRecords = parsed;
    }
  } catch (e) {
    console.error('Could not load cash history:', e);
  }
}

function saveCashRecords(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${CASH_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(cashRecords));
    renameSync(tmp, CASH_FILE);
  } catch (e) {
    console.error('Could not save cash history:', e);
  }
}

export function addCashRecord(record: CashRecord): void {
  // A table can be closed twice (host click, then shutdown sweep) — keep one.
  if (cashRecords.some(r => r.id === record.id)) return;
  cashRecords.push(record);
  if (cashRecords.length > 2000) cashRecords = cashRecords.slice(-2000);
  saveCashRecords();
}

export function allCashRecords(): CashRecord[] {
  return [...cashRecords].sort((a, b) => b.closedAt - a.closedAt);
}

export function removeCashRecord(id: string): boolean {
  const before = cashRecords.length;
  cashRecords = cashRecords.filter(r => r.id !== id);
  if (cashRecords.length === before) return false;
  saveCashRecords();
  return true;
}

// Every name currently spoken for by a finished game. Creation checks this so
// two tournaments can never share a name — deleting the old record is what
// releases it.
export function archivedNames(): string[] {
  return [...records.map(r => r.name), ...cashRecords.map(r => r.name)];
}

// Points by finishing place — top-heavy, flat tail inside the top 15%.
function pointsFor(place: number, entrants: number): number {
  if (place === 1) return 100;
  if (place === 2) return 70;
  if (place === 3) return 50;
  if (place === 4) return 40;
  if (place === 5) return 32;
  if (place <= 9) return 22;
  if (place <= Math.max(10, Math.round(entrants * 0.15))) return 10;
  return 2; // participation
}

export function leaderboard(limit = 100): LeaderboardEntry[] {
  const byPlayer = new Map<string, LeaderboardEntry>();
  for (const rec of records) {
    for (const row of rec.results) {
      let e = byPlayer.get(row.playerId);
      if (!e) {
        e = {
          playerId: row.playerId, name: row.name, avatar: row.avatar,
          discordTag: row.discordTag, points: 0, wins: 0, cashes: 0,
          winnings: 0, tournaments: 0, bestFinish: row.place,
        };
        byPlayer.set(row.playerId, e);
      }
      // Keep the freshest identity details.
      e.name = row.name;
      e.avatar = row.avatar;
      if (row.discordTag) e.discordTag = row.discordTag;
      e.points += pointsFor(row.place, rec.totalEntries);
      e.tournaments += 1;
      if (row.place === 1) e.wins += 1;
      if (row.prize > 0) { e.cashes += 1; e.winnings += row.prize; }
      if (row.place < e.bestFinish) e.bestFinish = row.place;
    }
  }
  return [...byPlayer.values()]
    .sort((a, b) => b.points - a.points || b.winnings - a.winnings)
    .slice(0, limit)
    .map(e => ({ ...e, ...chogField(e.playerId) }));
}
