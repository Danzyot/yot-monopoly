// Bans, and the way back out of one.
//
// Two kinds, because a cheat comes back two ways: the account ban follows the
// person (and their Discord, so a fresh guest sign-up is still barred), the
// IP ban follows the machine. Both are listed together, searchable, and each
// row can be lifted.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BAN_REASONS } from '../../../shared/types';
import { api, type BanRow } from '../api';
import { banMessagePreview } from './BanDialog';
import { useToast } from '../toast';

function when(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function BanManager() {
  const [bans, setBans] = useState<BanRow[] | null>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'player' | 'ip'>('player');
  const [scope, setScope] = useState<'game' | 'lifetime'>('lifetime');
  const [gameId, setGameId] = useState('');
  const [games, setGames] = useState<{ id: string; name: string; kind: string }[]>([]);
  const [value, setValue] = useState('');
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  // Off by default and a deliberate choice: a Discord ban is public and
  // reaches beyond the card room. Only a player ban can carry it.
  const [discordBan, setDiscordBan] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const refresh = useCallback(() => {
    api.bans().then(r => setBans(r.bans)).catch(() => {});
    // The game list is what makes "ban from this one" possible, and it
    // changes as games start and finish.
    api.bannableGames().then(r => setGames(r.games)).catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);

  // Search covers everything on the row — a name, an id, an address, or the
  // reason someone was banned months ago.
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = bans ?? [];
    if (!needle) return list;
    return list.filter(b => [b.name, b.value, b.reason, b.by, b.kind, b.scope, b.gameName]
      .some(f => (f ?? '').toLowerCase().includes(needle)));
  }, [bans, q]);

  const add = async () => {
    if (!value.trim()) { toast('error', kind === 'ip' ? 'Enter an address' : 'Enter a player or Discord id'); return; }
    if (scope === 'game' && !gameId) { toast('error', 'Pick which game to ban them from'); return; }
    setBusy(true);
    try {
      const r = await api.ban({
        kind, scope, gameId: scope === 'game' ? gameId : null,
        value: value.trim(), name: name.trim(), reason: reason.trim(),
        discordBan: kind === 'player' && discordBan,
      });
      const gone = r.ejected.tournaments + r.ejected.tables;
      const base = gone
        ? `Banned — and removed from ${gone} live game${gone === 1 ? '' : 's'}`
        : 'Banned';
      // A Discord ban that quietly did not happen is worse than one never
      // attempted — say so where the operator is looking.
      const failed = !!r.discordNote && /NOT on Discord/.test(r.discordNote);
      toast(failed ? 'error' : 'success', r.discordNote ? `${base}. ${r.discordNote}` : base);
      setValue(''); setName(''); setReason('');
      refresh();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not ban');
    } finally {
      setBusy(false);
    }
  };

  const lift = async (b: BanRow) => {
    const what = b.scope === 'game' ? `rejoin ${b.gameName || 'that game'}` : 'use the site again';
    if (!window.confirm(`Unban ${b.name || b.value}? They can ${what}.`)) return;
    try {
      await api.unban(b);
      toast('success', `Unbanned ${b.name || b.value}`);
      refresh();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not unban');
    }
  };

  return (
    <div className="ban-admin">
      {/* Adding a ban: labelled fields in a card, like every other form in the
          dashboard, rather than a row of unlabelled boxes. */}
      <div className="panel ban-form">
        <h3>Add a ban</h3>
        <div className="ban-grid">
          <div className="field">
            <label htmlFor="ban-scope">Reach</label>
            <select id="ban-scope" className="input" value={scope}
              onChange={e => setScope(e.target.value as 'game' | 'lifetime')}>
              <option value="lifetime">Lifetime — off the site entirely</option>
              <option value="game">One game only</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="ban-kind">Match on</label>
            <select id="ban-kind" className="input" value={kind}
              onChange={e => setKind(e.target.value as 'player' | 'ip')}>
              <option value="player">Player / Discord id</option>
              <option value="ip">IP address</option>
            </select>
          </div>
          {scope === 'game' && (
            <div className="field">
              <label htmlFor="ban-game">Which game</label>
              <select id="ban-game" className="input" value={gameId}
                onChange={e => setGameId(e.target.value)}>
                <option value="">Pick a game…</option>
                {games.map(g => (
                  <option key={g.id} value={g.id}>{g.name} ({g.kind})</option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="ban-value">{kind === 'ip' ? 'Address' : 'Player or Discord id'}</label>
            <input
              id="ban-value" className="input mono" value={value} maxLength={64}
              placeholder={kind === 'ip' ? '203.0.113.7' : 'player id or Discord id'}
              onChange={e => setValue(e.target.value)}
            />
          </div>
          {kind === 'player' && (
            <div className="field ban-grid-wide">
              <label className="ban-discord">
                <input type="checkbox" checked={discordBan} onChange={e => setDiscordBan(e.target.checked)} />
                <span>
                  Ban from the Discord server too
                  <span className="field-hint">
                    Works for an account that signed in with Discord, or a bare Discord id. A guest
                    is banned here and reported as not banned there. Needs the bot to have Ban
                    Members, with its role above theirs.
                  </span>
                </span>
              </label>
            </div>
          )}
          <div className="field">
            <label htmlFor="ban-name">Name</label>
            <input id="ban-name" className="input" value={name} maxLength={60}
              placeholder="For your own reference"
              onChange={e => setName(e.target.value)} />
            <span className="field-hint">Never used for matching — just so the list reads.</span>
          </div>
          <div className="field ban-grid-wide">
            <label htmlFor="ban-reason">Reason</label>
            <input id="ban-reason" className="input" value={reason} maxLength={200}
              placeholder="Shown to them — leave empty for none"
              onChange={e => setReason(e.target.value)} />
            <div className="reason-presets">
              {BAN_REASONS.map(r => (
                <button
                  key={r} type="button"
                  className={`reason-chip${reason === r ? ' on' : ''}`}
                  onClick={() => setReason(reason === r ? '' : r)}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="ban-preview-wrap">
          <span className="ban-preview-label">They will see</span>
          <div className="ban-preview">{banMessagePreview(scope, reason)}</div>
        </div>

        <div className="ban-form-foot">
          <p className="tag">
            A <strong>lifetime</strong> ban keeps them off the site entirely; a{' '}
            <strong>game</strong> ban costs them one tournament or table and
            nothing else. A player ban also covers the Discord account behind it.
            An IP ban covers everyone on that address — check the audit for a
            shared household first. Either way they are removed from the game
            immediately and cannot return through late registration.
          </p>
          <button className="btn btn-danger" disabled={busy} onClick={() => void add()}>
            {busy ? 'Banning…' : 'Ban'}
          </button>
        </div>
      </div>

      {/* The list: one card per ban, the way the app lists payout history. */}
      <div className="ban-list-head">
        <span className="section-title">Banned</span>
        {bans && <span className="count-chip">{bans.length}</span>}
      </div>

      <input
        className="input ban-search" value={q}
        placeholder="Search by name, id, address or reason…"
        onChange={e => setQ(e.target.value)}
      />

      {!bans && <p className="tag">Loading…</p>}
      {bans && bans.length === 0 && <div className="empty-note">Nobody is banned.</div>}
      {bans && bans.length > 0 && shown.length === 0 && <div className="empty-note">No bans match “{q}”.</div>}

      <div className="ban-cards">
        {shown.map(b => (
          <div key={`${b.kind}:${b.scope}:${b.gameId ?? ''}:${b.value}`} className="ban-card">
            <div className="bc-top">
              <span className="bc-who">{b.name || <em>unknown</em>}</span>
              <span className="bc-pills">
                <span className={`bc-pill kind-${b.kind}`}>{b.kind === 'ip' ? 'IP' : 'PLAYER'}</span>
                <span className={`bc-pill scope-${b.scope}`}>
                  {b.scope === 'lifetime' ? 'LIFETIME' : (b.gameName || 'GAME')}
                </span>
              </span>
            </div>
            <div className="bc-grid">
              <div><span className="k">{b.kind === 'ip' ? 'Address' : 'Identifier'}</span><span className="v mono">{b.value}</span></div>
              <div><span className="k">Reason</span><span className="v">{b.reason || '—'}</span></div>
              <div><span className="k">Banned</span><span className="v">{when(b.at)}</span></div>
              <div><span className="k">By</span><span className="v">{b.by || '—'}</span></div>
            </div>
            <div className="bc-foot">
              <button className="btn btn-sm" onClick={() => void lift(b)}>Unban</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
