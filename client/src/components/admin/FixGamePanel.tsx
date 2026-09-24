// "Fix game" for one live room: correct a player's cash, move a deed, give or
// take a Get Out of Jail Free card, clear a debt, send someone to or from
// jail. Every change asks first, and the server logs it (operator log, room
// log, and a line in the game log the players see).
import { useEffect, useState } from 'react';
import { act, post, usePoll } from './adminApi.ts';

interface GameState {
  phase: string;
  current: string;
  paused: { by: string; at: number } | null;
  housesLeft: number;
  hotelsLeft: number;
  players: {
    id: string; name: string; cash: number; inJail: boolean; jailCards: number; debt: number;
    bankrupt: boolean; afk: boolean; autopilot: boolean;
  }[];
  deeds: { space: number; name: string; group: string | null; owner: string | null; houses: number; mortgaged: boolean }[];
}

export default function FixGamePanel({ code, onClose, onChanged }: { code: string; onClose: () => void; onChanged: () => unknown }) {
  const { data, error, reload } = usePoll<GameState>(`/api/admin/rooms/${code}/game`, 5_000);
  const [deed, setDeed] = useState<number | ''>('');
  const [to, setTo] = useState('');
  const fix = (body: Record<string, unknown>, confirm: string, ok: string) =>
    act(() => post(`/api/admin/rooms/${code}/fix`, body), { confirm, ok, after: () => Promise.all([reload(), onChanged()]) });

  if (error && !data) return <div className="adm-fix"><p className="warn">{error}</p><button className="btn small ghost" onClick={onClose}>Close</button></div>;
  if (!data) return <div className="adm-fix"><p className="muted small">Loading…</p></div>;
  const alive = data.players.filter(p => !p.bankrupt);
  const name = (id: string | null) => (id ? data.players.find(p => p.id === id)?.name ?? id : 'Bank');
  const picked = data.deeds.find(d => d.space === deed);
  const over = data.phase === 'over';

  return (
    <div className="adm-fix">
      <div className="row between">
        <b>Fix game</b>
        <span className="small muted">
          {data.paused ? `⏸️ paused by ${data.paused.by}` : `phase ${data.phase}`} · 🏠 {data.housesLeft} · 🏨 {data.hotelsLeft}
        </span>
        <button className="btn tiny ghost" onClick={onClose}>Close</button>
      </div>
      {over && <p className="muted small">This game is over; there is nothing to fix.</p>}
      {!over && (
        <>
          <table className="adm-fix-table">
            <thead><tr><th>Player</th><th>Cash</th><th>Jail</th><th>Cards</th><th>Debt</th></tr></thead>
            <tbody>
              {alive.map(p => <PlayerRow key={p.id} p={p} fix={fix} />)}
            </tbody>
          </table>
          <div className="row wrap adm-fix-move">
            <select value={deed} onChange={e => setDeed(e.target.value === '' ? '' : Number(e.target.value))} aria-label="Deed">
              <option value="">Deed…</option>
              {data.deeds.map(d => (
                <option key={d.space} value={d.space}>
                  {d.name} — {name(d.owner)}{d.houses ? ` · ${d.houses === 5 ? 'hotel' : `${d.houses}🏠`}` : ''}{d.mortgaged ? ' · mortgaged' : ''}
                </option>
              ))}
            </select>
            <span className="muted">→</span>
            <select value={to} onChange={e => setTo(e.target.value)} aria-label="New owner">
              <option value="">Bank</option>
              {alive.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="btn small" disabled={!picked || (picked.owner ?? '') === to}
              onClick={() => picked && void fix({ kind: 'property', space: picked.space, to: to || null },
                `Move ${picked.name} from ${name(picked.owner)} to ${name(to || null)}?`
                + (picked.group && data.deeds.some(d => d.group === picked.group && d.houses > 0)
                  ? ' The buildings on its colour group go back to the bank at half price.' : ''),
                `Moved ${picked.name}`)}>Move deed</button>
          </div>
        </>
      )}
    </div>
  );
}

function PlayerRow({ p, fix }: {
  p: GameState['players'][number];
  fix: (body: Record<string, unknown>, confirm: string, ok: string) => Promise<boolean>;
}) {
  const [cash, setCash] = useState(String(p.cash));
  useEffect(() => { setCash(String(p.cash)); }, [p.cash]);
  return (
    <tr>
      <td className="adm-ellipsis">{p.name}{(p.afk || p.autopilot) && <em className="tag warn">autopilot</em>}</td>
      <td>
        <form className="row" onSubmit={e => {
          e.preventDefault();
          void fix({ kind: 'cash', id: p.id, cash: Number(cash) }, `Set ${p.name}'s cash from ${p.cash} to ${Number(cash)}?`, `Cash set for ${p.name}`);
        }}>
          <input type="number" min={0} value={cash} onChange={e => setCash(e.target.value)} aria-label={`${p.name}'s cash`} />
          <button className="btn tiny" type="submit" disabled={cash === '' || Number(cash) === p.cash}>Set</button>
        </form>
      </td>
      <td>
        <button className="btn tiny ghost" onClick={() => void fix({ kind: 'jail', id: p.id, jail: !p.inJail },
          p.inJail ? `Release ${p.name} from jail?` : `Send ${p.name} to jail?`, p.inJail ? 'Released' : 'Sent to jail')}>
          {p.inJail ? '🔓 Release' : '🔒 Jail'}
        </button>
      </td>
      <td className="row">
        <span className="small">{p.jailCards}</span>
        <button className="btn tiny ghost" title="Give a Get Out of Jail Free card"
          onClick={() => void fix({ kind: 'jailCard', id: p.id, give: true }, `Give ${p.name} a Get Out of Jail Free card?`, 'Card given')}>+</button>
        <button className="btn tiny ghost" title="Take a Get Out of Jail Free card" disabled={!p.jailCards}
          onClick={() => void fix({ kind: 'jailCard', id: p.id, give: false }, `Take a Get Out of Jail Free card from ${p.name}?`, 'Card taken')}>−</button>
      </td>
      <td>
        {p.debt > 0 ? (
          <button className="btn tiny ghost" onClick={() => void fix({ kind: 'clearDebt', id: p.id }, `Clear ${p.name}'s debt of ${p.debt}? Nobody gets that money.`, 'Debt cleared')}>
            Clear {p.debt}
          </button>
        ) : <span className="muted small">—</span>}
      </td>
    </tr>
  );
}
