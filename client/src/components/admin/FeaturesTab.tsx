// Site-wide switches, grouped, each with a one-line explanation. The server
// refuses what is off, so these are real switches, not just hidden buttons.
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
  reactions: ['Reactions & pokes', 'Emoji reactions at the table and poking a slow player. Also off while chat is off.'],
};

const GROUPS: { title: string; blurb: string; keys: (keyof Features)[] }[] = [
  { title: 'Rooms & play', blurb: 'Who can open a table and what happens at it.', keys: ['publicRooms', 'bots', 'minigames', 'music'] },
  { title: 'Social', blurb: 'Talking and reacting around the table.', keys: ['chat', 'reactions'] },
  { title: 'Site & Discord', blurb: 'Public pages and what the bot posts.', keys: ['leaderboard', 'announceResults'] },
];

export default function FeaturesTab() {
  const { data, error } = usePoll<Features>('/api/admin/features');
  const [local, setLocal] = useState<Features | null>(null);
  const [busy, setBusy] = useState<keyof Features | null>(null);
  const f = local ?? data;
  if (error && !f) return <p className="warn" role="alert">{error}</p>;
  if (!f) return <div className="adm-stack" aria-busy="true"><div className="sk sk-hero" /><div className="sk sk-hero" /></div>;

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

  const on = Object.values(f).filter(Boolean).length;
  return (
    <div className="adm-stack">
      <div className="row between wrap">
        <h2 className="adm-h2">Features <span className="lb-count">{on} of {Object.keys(f).length} on</span></h2>
      </div>
      <div className="adm-alert info adm-enforced">
        <span aria-hidden>🛡</span>
        <span className="grow"><b>Enforced server-side.</b> A switch that is off is refused by the server for everyone, not merely hidden in the interface. Players pick up changes the next time they load the site.</span>
      </div>
      <div className="adm-grid adm-feature-groups">
        {GROUPS.map(g => (
          <section key={g.title} className="adm-card" aria-labelledby={`feat-${g.title}`}>
            <h3 id={`feat-${g.title}`}>{g.title}</h3>
            <p className="muted small adm-group-blurb">{g.blurb}</p>
            <ul className="adm-rows adm-switches">
              {g.keys.map(k => {
                const dim = k === 'reactions' && !f.chat && f.reactions;
                return (
                  <li key={k} className="adm-switch-row">
                    <span className="grow" id={`feat-label-${k}`}>
                      <b>{EXPLAIN[k][0]}</b>
                      <br /><span className="muted small">{EXPLAIN[k][1]}</span>
                      {dim && <><br /><span className="warn small">Inactive while chat is off.</span></>}
                    </span>
                    <button type="button" role="switch" aria-checked={f[k]} aria-labelledby={`feat-label-${k}`} aria-busy={busy === k || undefined}
                      className={`adm-switch ${f[k] ? 'on' : ''}`} disabled={busy === k} onClick={() => void flip(k, !f[k])}>
                      <span className="adm-switch-knob" aria-hidden />
                      <span className="sr-only">{f[k] ? 'On' : 'Off'}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
