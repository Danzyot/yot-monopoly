import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { ProfileLink } from '../community.tsx';

interface Row { id: string; name: string; games: number; wins: number; points: number }

export default function Leaderboard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<Row[]>('/api/leaderboard').then(setRows).catch(e => setErr(e.message)); }, []);
  return (
    <div className="page">
      <h1>Leaderboard</h1>
      <p className="muted">Points for every opponent you outlast. Games against bots only don't count.</p>
      {err && <p className="warn">{err}</p>}
      {rows && rows.length === 0 && <p className="muted">No finished games yet.</p>}
      {rows && rows.length > 0 && (
        <table className="table">
          <thead><tr><th>#</th><th>Player</th><th>Points</th><th>Wins</th><th>Games</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}><td>{i + 1}</td><td><ProfileLink id={r.id}>{r.name}</ProfileLink></td><td><b>{r.points}</b></td><td>{r.wins}</td><td>{r.games}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
