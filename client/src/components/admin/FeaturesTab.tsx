// Site-wide switches. The server refuses what is off, so these are real
// switches, not just hidden buttons.
import { useState } from 'react';
import { api } from '../../api.ts';
import { toast, toastError } from '../../toast.tsx';
import type { Features } from '../../../../shared/types.ts';
import { usePoll } from './adminApi.ts';

// Record<keyof Features, …> makes a new switch a compile error until it is explained here.
const EXPLAIN: Record<keyof Features, [string, string]> = {
  publicRooms: ['Anyone can create rooms', 'Off: only operators can open new rooms (existing rooms keep going).'],
  chat: ['Chat', 'Room chat for players and spectators. Off hides it and the server refuses messages.'],
  music: ['Music', 'Background music in lobbies and games.'],
  minigames: ['Mini-games', 'Arcade spaces start a mini-game when landed on.'],
  bots: ['Bots', 'Hosts may fill seats with computer players (operators always can).'],
  leaderboard: ['Leaderboard', 'The public all-time leaderboard page and its link in the header.'],
  announceResults: ['Announce results on Discord', 'Post every finished game to DISCORD_ANNOUNCE_CHANNEL_ID.'],
};

export default function FeaturesTab() {
  const { data, error } = usePoll<Features>('/api/admin/features');
  const [local, setLocal] = useState<Features | null>(null);
  const [busy, setBusy] = useState<keyof Features | null>(null);
  const f = local ?? data;
  if (error && !f) return <p className="warn">{error}</p>;
  if (!f) return <p className="muted">Loading…</p>;

  const flip = async (k: keyof Features, on: boolean) => {
    setBusy(k);
    try {
      // The server answers with what it actually stored; show that, not our guess.
      const next = await api<Features>('/api/admin/features', { method: 'PUT', json: { [k]: on } });
      setLocal(next);
      toast(`${EXPLAIN[k][0]}: ${next[k] ? 'on' : 'off'}`);
    } catch (e) { toastError(e); }
    setBusy(null);
  };

  return (
    <div className="adm-card">
      <ul className="adm-rows">
        {(Object.keys(EXPLAIN) as (keyof Features)[]).map(k => (
          <li key={k}>
            <label className="adm-switch-row">
              <span className="grow">
                <b>{EXPLAIN[k][0]}</b>
                <br /><span className="muted small">{EXPLAIN[k][1]}</span>
              </span>
              <input type="checkbox" className="adm-switch" checked={f[k]} disabled={busy === k}
                onChange={e => void flip(k, e.target.checked)} />
            </label>
          </li>
        ))}
      </ul>
      <p className="muted small">Players pick up changes the next time they load the site.</p>
    </div>
  );
}
