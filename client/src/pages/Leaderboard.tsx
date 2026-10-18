// All-time leaderboard: a podium for the top three, then every ranked player.
// Points come from finished games with two or more people (server/src/stats.ts).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { profilePath } from '../community.tsx';
import { getCharacter } from '../../../shared/characters.ts';

interface Row {
  id: string; name: string; games: number; wins: number; points: number;
  /** Optional: older results carry neither. */
  avatar?: string; character?: string;
}

const MEDALS = ['🥇', '🥈', '🥉'];
const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
const pct = (r: Row) => (r.games ? Math.round((r.wins / r.games) * 100) : 0);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Character emoji on a disc, or the avatar when the character is unknown. */
function Disc({ row, size }: { row: Row; size: number }) {
  if (row.character) {
    const c = getCharacter(row.character);
    return <span className="lb-disc" style={{ width: size, height: size, fontSize: size * 0.54 }} role="img" aria-label={c.name}>{c.emoji}</span>;
  }
  return <Avatar src={row.avatar || '🎩'} size={size} />;
}

export default function Leaderboard() {
  const { profile: me } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<Row[]>('/api/leaderboard').then(r => { if (live) setRows(r); }).catch(e => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    document.title = 'Leaderboard · Yot Monopoly';
    return () => { document.title = 'Yot Monopoly'; };
  }, []);

  const top = rows ? rows.slice(0, 3) : [];
  // Podium: 2nd · 1st · 3rd, the classic silhouette; missing places stay empty.
  const podium = [top[1], top[0], top[2]].map((r, k) => ({ r, place: [2, 1, 3][k] }));

  return (
    <div className="page lb-page">
      <header className="lb-head">
        <h1 className="lb-title"><span aria-hidden>🏆</span> Leaderboard</h1>
        <p className="lb-blurb">One point for every opponent you outlast. Games against bots alone don't count.</p>
      </header>

      {err && <p className="warn" role="alert">{err}</p>}

      {!rows && !err && (
        <div className="lb-skeleton" aria-busy="true" aria-label="Loading the leaderboard">
          <div className="sk sk-podium" />
          <div className="sk sk-row" /><div className="sk sk-row" /><div className="sk sk-row" /><div className="sk sk-row" />
        </div>
      )}

      {rows && rows.length === 0 && (
        <section className="panel lb-empty">
          <div className="lb-empty-icon" aria-hidden>🎩</div>
          <h2>The board is still empty</h2>
          <p className="muted">Nobody has finished a game against another person yet. Gather a friend, bankrupt them, and be the first name up here.</p>
          <div className="row center wrap">
            <Link className="btn primary chunky" to="/">Create a game</Link>
            <Link className="btn" to="/characters">Meet the characters</Link>
          </div>
        </section>
      )}

      {rows && rows.length > 0 && (
        <>
          <section className="panel lb-podium-panel" aria-labelledby="lb-podium-title">
            <h2 id="lb-podium-title" className="sr-only">Top three</h2>
            <ol className="podium lb-podium" aria-label="Podium">
              {podium.map(({ r, place }) => r ? (
                <li key={r.id} className={`podium-spot p${place} ${r.id === me?.id ? 'me' : ''}`} style={{ ['--pc' as string]: `var(--medal-${place})` }}>
                  <Link className="lb-podium-link" to={profilePath(r.id)} aria-label={`${r.name}, ${ordinal(place)} with ${plural(r.points, 'point')}`}>
                    <span className="podium-char lb-podium-char"><Disc row={r} size={place === 1 ? 56 : 44} /></span>
                    <span className="podium-name">{r.name}</span>
                  </Link>
                  <span className="podium-block">
                    <span className="podium-medal" aria-hidden>{MEDALS[place - 1]}</span>
                    <span className="podium-place">{plural(r.points, 'pt')}</span>
                  </span>
                </li>
              ) : <li key={place} className={`podium-spot p${place} empty`} aria-hidden />)}
            </ol>
          </section>

          <section className="panel lb-table-panel" aria-labelledby="lb-table-title">
            <h2 id="lb-table-title" className="lb-h2">All players <span className="lb-count">{rows.length}</span></h2>
            <table className="lb-table">
              <thead>
                <tr>
                  <th scope="col" className="lb-c-rank">#</th>
                  <th scope="col" className="lb-c-player">Player</th>
                  <th scope="col" className="lb-c-num">Games</th>
                  <th scope="col" className="lb-c-num">Wins</th>
                  <th scope="col" className="lb-c-rate">Win rate</th>
                  <th scope="col" className="lb-c-num">Points</th>
                  <th scope="col" className="lb-c-char">Plays as</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const rank = i + 1;
                  const c = r.character ? getCharacter(r.character) : null;
                  return (
                    <tr key={r.id} className={`${rank <= 3 ? `top top-${rank}` : ''} ${r.id === me?.id ? 'me' : ''}`}>
                      <td className="lb-c-rank">
                        <span className={`lb-rank ${rank <= 3 ? `r${rank}` : ''}`} aria-label={ordinal(rank)}>{rank}</span>
                      </td>
                      <th scope="row" className="lb-c-player">
                        <Link className="lb-player" to={profilePath(r.id)}>
                          <Avatar src={r.avatar || '🎩'} size={32} />
                          <span className="lb-name">{r.name}{r.id === me?.id && <em className="tag">you</em>}</span>
                        </Link>
                      </th>
                      <td className="lb-c-num" data-label="Games">{r.games}</td>
                      <td className="lb-c-num" data-label="Wins">{r.wins}</td>
                      <td className="lb-c-rate" data-label="Win rate">
                        <span className="lb-rate">
                          <span className="lb-bar" aria-hidden><i style={{ ['--w' as string]: `${pct(r)}%` }} /></span>
                          <span className="lb-rate-n">{pct(r)}%</span>
                        </span>
                      </td>
                      <td className="lb-c-num lb-points" data-label="Points"><b>{r.points}</b></td>
                      <td className="lb-c-char" data-label="Plays as">
                        {c ? <span className="lb-char" title={c.name}><span className="lb-char-emoji" aria-hidden>{c.emoji}</span><span className="lb-char-name">{c.name}</span></span> : <span className="muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
