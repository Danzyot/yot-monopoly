// Public player profile (/u/:id): headline stats, favourites and recent games,
// all from finished-game results. Unknown players get a friendly page, not an error.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { ProfileLink } from '../community.tsx';
import { getMap } from '../../../shared/maps.ts';
import { getTheme } from '../../../shared/themes.ts';
import { getCharacter } from '../../../shared/characters.ts';
import type { PublicProfile } from '../../../shared/types.ts';

const MEDALS = ['🥇', '🥈', '🥉'];

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}

function when(t: number): string {
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

export default function Profile() {
  const { id = '' } = useParams();
  const { profile: me } = useAuth();
  const [p, setP] = useState<PublicProfile | null>(null);
  const [err, setErr] = useState<{ status?: number; message: string } | null>(null);

  useEffect(() => {
    let live = true;
    setP(null);
    setErr(null);
    api<{ profile: PublicProfile | null }>(`/api/players/${encodeURIComponent(id)}`)
      .then(r => {
        if (!live) return;
        if (r.profile) setP(r.profile);
        else setErr({ status: 404, message: 'unknown' });
      })
      .catch((e: Error & { status?: number }) => { if (live) setErr({ status: e.status, message: e.message }); });
    return () => { live = false; };
  }, [id]);

  useEffect(() => {
    document.title = p ? `${p.name} · Yot Monopoly` : 'Player · Yot Monopoly';
    return () => { document.title = 'Yot Monopoly'; };
  }, [p]);

  const mine = me?.id === id;

  if (err) {
    return (
      <div className="page profile-page">
        <div className="panel pf-empty">
          <div className="pf-empty-icon">🎩</div>
          <h1>{mine ? 'No games yet' : 'Nobody here yet'}</h1>
          <p className="muted">
            {err.status === 404
              ? err.message.includes('switched off')
                ? 'Player profiles are switched off on this site right now.'
                : mine
                  ? 'Your profile appears after your first finished game. Go and bankrupt somebody!'
                  : 'We have no finished games for this player — the link may be wrong, or they have not finished a game yet.'
              : err.message}
          </p>
          <div className="row center">
            <Link className="btn primary" to="/">Find a game</Link>
            <Link className="btn" to="/leaderboard">Leaderboard</Link>
          </div>
        </div>
      </div>
    );
  }
  if (!p) return <div className="page"><p className="muted">Loading…</p></div>;

  const favChar = p.favouriteCharacter ? getCharacter(p.favouriteCharacter.id) : null;
  return (
    <div className="page profile-page">
      <section className="panel pf-head">
        <Avatar src={p.avatar} size={72} />
        <div className="pf-who">
          <h1>{p.name}{mine && <em className="tag">you</em>}</h1>
          <span className="muted small">{p.games} game{p.games === 1 ? '' : 's'} finished</span>
        </div>
      </section>

      <section className="pf-stats">
        <div className="pf-stat"><b>{p.games}</b><span>Games</span></div>
        <div className="pf-stat"><b>{p.wins}</b><span>Wins</span></div>
        <div className="pf-stat"><b>{Math.round(p.winRate * 100)}%</b><span>Win rate</span></div>
        <div className="pf-stat" title="Leaderboard points: one for every opponent you outlast, in games with 2+ people">
          <b>{p.points}</b><span>Points</span>
        </div>
      </section>
      {p.rankedGames < p.games && (
        <p className="muted small pf-note">Points count only games with at least two people ({p.rankedGames} of {p.games}); games against bots alone still show below.</p>
      )}

      <section className="pf-favs">
        <div className="panel pf-fav">
          <span className="muted small">Favourite map</span>
          <b>{p.favouriteMap ? getMap(p.favouriteMap.id).name : '—'}</b>
          {p.favouriteMap && <span className="small muted">{p.favouriteMap.games} game{p.favouriteMap.games === 1 ? '' : 's'}</span>}
        </div>
        <div className="panel pf-fav">
          <span className="muted small">Favourite character</span>
          <b>{favChar ? <>{favChar.emoji} {favChar.name}</> : '—'}</b>
          {p.favouriteCharacter && <span className="small muted">{p.favouriteCharacter.games} game{p.favouriteCharacter.games === 1 ? '' : 's'}</span>}
        </div>
      </section>

      <section className="panel">
        <h2>Recent games</h2>
        <ul className="pf-games">
          {p.recent.map(g => (
            <li key={`${g.code}-${g.endedAt}`} className={g.place === 1 ? 'won' : ''}>
              <div className="pf-place" title={`${ordinal(g.place)} of ${g.of}`}>
                <span className="pf-medal">{MEDALS[g.place - 1] ?? ordinal(g.place)}</span>
                <span className="small muted">of {g.of}</span>
              </div>
              <div className="pf-game">
                <div className="pf-game-top">
                  <b>{getMap(g.mapId).name}</b>
                  <span className="muted small">{getTheme(g.themeId).name} · {g.turns} turn{g.turns === 1 ? '' : 's'} · {when(g.endedAt)}</span>
                  {g.character && <span className="small" title={getCharacter(g.character).name}>{getCharacter(g.character).emoji}</span>}
                </div>
                <div className="pf-opps small">
                  <span className="muted">vs </span>
                  {g.opponents.map((o, i) => (
                    <span key={`${o.id}-${i}`}>
                      {i > 0 && <span className="muted">, </span>}
                      <ProfileLink id={o.id} isBot={o.isBot}>{o.name}</ProfileLink>
                      {o.isBot && <span className="muted"> (bot)</span>}
                    </span>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
