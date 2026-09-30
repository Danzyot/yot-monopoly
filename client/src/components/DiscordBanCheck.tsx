// "Check Discord ban setup": every condition a Discord ban depends on, tested
// live by the server against the real Discord server, and against one player
// if an id is typed into the ban form. Each line says pass or fail and why,
// in place of the operator guessing which of several invisible settings is
// the one refusing them.
import { useState } from 'react';
import { api } from '../api';

type Line = { ok: boolean; label: string; detail: string };

export default function DiscordBanCheck({ target }: { target: string }) {
  const [lines, setLines] = useState<Line[] | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.discordBanCheck(target.trim() || undefined);
      setLines(r.lines); setWho(r.target ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Check failed'); setLines(null);
    } finally {
      setBusy(false);
    }
  };

  const allOk = !!lines && lines.every(l => l.ok);
  return (
    <div className="dban-check">
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void run()}>
        {busy ? 'Checking…' : target.trim() ? 'Check Discord ban for this player' : 'Check Discord ban setup'}
      </button>
      {err && <p className="dban-err">{err}</p>}
      {lines && (
        <ul className="dban-lines">
          {lines.map((l, i) => (
            <li key={i} className={l.ok ? 'ok' : 'bad'}>
              <span className="dban-mark">{l.ok ? '✓' : '✗'}</span>
              <span className="dban-label">{l.label}</span>
              <span className="dban-detail">{l.detail}</span>
            </li>
          ))}
          <li className={`dban-verdict ${allOk ? 'ok' : 'bad'}`}>
            {allOk
              ? (who ? `A Discord ban on ${who} will go through.` : 'The bot can ban. Type a player id above and check again to test one person.')
              : 'Fix the first ✗ — everything after it depends on it.'}
          </li>
        </ul>
      )}
    </div>
  );
}
