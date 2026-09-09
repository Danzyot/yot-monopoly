import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { TableOverview, TournamentTablesView } from '../../../shared/types';
import Avatar from '../components/Avatar';
import CardView from '../components/CardView';
import { chips } from '../format';
import { IconArrowLeft, IconEye } from '../components/icons';
import { getSocket, withResub } from '../socket';

// Seats around a compact oval, hero-less (this is a spectator view).
function miniPositions(n: number): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, k) => {
    const theta = Math.PI / 2 + (2 * Math.PI * k) / n;
    return { x: 50 + 42 * Math.cos(theta), y: 50 + 40 * Math.sin(theta) };
  });
}

// Case-folded "does this name match the search" — one definition, used for
// filtering tables and lighting up the seat that matched.
function nameMatches(name: string, q: string): boolean {
  return q !== '' && name.toLowerCase().includes(q);
}

function MiniTable({ t, q }: { t: TableOverview; q: string }) {
  const pos = miniPositions(t.maxSeats);
  const live = t.street !== 'waiting';
  return (
    <Link to={`/table/${t.id}`} className="mini-table-card" title={`Spectate ${t.name}`}>
      <div className="mini-head">
        <span className="mini-name">{t.name.replace(/^.*—\s*/, '')}</span>
        <span className="mini-count">{t.seats.length}/{t.maxSeats}</span>
      </div>
      <div className="mini-felt">
        {live && t.community.length > 0 && (
          <div className="mini-board">
            {t.community.map((c, i) => <CardView key={i} card={c} small />)}
          </div>
        )}
        {t.totalPot > 0 && <div className="mini-pot">{chips(t.totalPot)}</div>}
        {!live && <div className="mini-idle">between hands</div>}
        {t.seats.map(s => (
          <div
            key={s.idx}
            className={`mini-seat${s.isTurn ? ' turn' : ''}${s.folded ? ' folded' : ''}${s.allIn ? ' allin' : ''}${nameMatches(s.name, q) ? ' found' : ''}`}
            style={{ left: `${pos[s.idx].x}%`, top: `${pos[s.idx].y}%` }}
          >
            <span className="ms-name">
              <Avatar value={s.avatar} size={13} />
              <span className="ms-label">{s.name}</span>
              {s.isDealer && <span className="ms-d">D</span>}
            </span>
            <span className={`ms-stack${s.stack === t.chipLeader && s.stack > 0 ? ' leader' : ''}`}>
              {chips(s.stack)}
            </span>
          </div>
        ))}
      </div>
    </Link>
  );
}

export default function TablesOverview() {
  const { id = '' } = useParams();
  const [view, setView] = useState<TournamentTablesView | null>(null);
  // Finding one player in a 40-table room by eye does not work — the operator
  // asked for this mid-event, scanning for a name among 349. Typing filters
  // the grid to tables seating a match and lights the matching seat up.
  const [query, setQuery] = useState('');
  const q = query.trim().replace(/^@/, '').toLowerCase();

  useEffect(() => {
    const sock = getSocket();
    const onTables = (v: TournamentTablesView) => { if (v.tournamentId === id) setView(v); };
    sock.on('tourney:tables', onTables);
    const cleanup = withResub(() => sock.emit('tourney:tablesSub', id));
    return () => {
      cleanup();
      sock.emit('tourney:tablesUnsub', id);
      sock.off('tourney:tables', onTables);
    };
  }, [id]);

  return (
    <main className="page">
      <div className="page-head">
        <h2><IconEye size={22} /> All tables</h2>
        {view && (
          <span className="online-pill">
            {view.tables.length} table{view.tables.length === 1 ? '' : 's'} · {view.playersAlive} players
          </span>
        )}
        <div className="spacer" />
        {view && (
          <span className="pill">
            Level {view.level.level} — {view.level.sb}/{view.level.bb}
            {view.level.ante ? ` (${view.level.ante})` : ''}
          </span>
        )}
        <Link className="btn btn-ghost btn-sm" to={`/t/${id}`}><IconArrowLeft /> Tournament</Link>
      </div>

      <div className="find-player">
        <input
          className="input"
          placeholder="Find a player — type a name or @mention"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {q !== '' && view && (
          <span className="find-count">
            {(() => {
              const n = view.tables.filter(t => t.seats.some(s => nameMatches(s.name, q))).length;
              return n === 0 ? 'No live table seats that name' : `${n} table${n === 1 ? '' : 's'}`;
            })()}
          </span>
        )}
      </div>

      {!view ? (
        <div className="empty-note">Loading tables…</div>
      ) : view.tables.length === 0 ? (
        <div className="empty-note">No tables running yet — they appear when the tournament starts.</div>
      ) : (
        <div className="mini-grid">
          {(q === ''
            ? view.tables
            : view.tables.filter(t => t.seats.some(s => nameMatches(s.name, q)))
          ).map(t => <MiniTable key={t.id} t={t} q={q} />)}
        </div>
      )}
    </main>
  );
}
