// Finished games and the all-time leaderboard.
import { debouncedWriter, readJson } from './jsonstore.ts';

export interface GameRecord {
  code: string;
  mapId: string;
  themeId: string;
  startedAt: number;
  endedAt: number;
  turns: number;
  /** Final order: winner first, then by bankruptcy order (last out = 2nd). */
  places: { id: string; name: string; isBot: boolean; netWorth: number }[];
}

export interface LeaderRow {
  id: string;
  name: string;
  games: number;
  wins: number;
  points: number;
}

const FILE = 'results.json';
let records: GameRecord[] = [];
const save = debouncedWriter(FILE, () => records, 500);

export function loadResults(): void {
  records = readJson<GameRecord[]>(FILE, []);
}

export function recordResult(r: GameRecord): void {
  records.push(r);
  if (records.length > 5_000) records.splice(0, records.length - 5_000);
  save();
}

export function recentResults(limit = 50): GameRecord[] {
  return records.slice(-limit).reverse();
}

export function leaderboard(limit = 100): LeaderRow[] {
  const by = new Map<string, LeaderRow>();
  for (const r of records) {
    const humans = r.places.filter(p => !p.isBot);
    if (humans.length < 2) continue; // games against bots only do not count
    r.places.forEach((p, i) => {
      if (p.isBot) return;
      const row = by.get(p.id) ?? { id: p.id, name: p.name, games: 0, wins: 0, points: 0 };
      row.name = p.name;
      row.games++;
      if (i === 0) row.wins++;
      // Points reward beating more people: last place scores 0.
      row.points += r.places.length - 1 - i;
      by.set(p.id, row);
    });
  }
  return [...by.values()].sort((a, b) => b.points - a.points || b.wins - a.wins).slice(0, limit);
}
