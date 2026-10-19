// Public player profile (/u/:id): a hero card, headline stats, favourites and
// recent games as cards, all from finished-game results. Unknown players get a
// friendly page, not an error.
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
import { BRAND } from '../../../shared/brand.ts';

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

const monthYear = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function Skeleton() {
  return (
    <div className="page profile-page" aria-busy="true" aria-label="Loading profile">
      <div className="sk sk-hero" />
      <div className="pf-stats">
        <div className="sk sk-tile" /><div className="sk sk-tile" /><div className="sk sk-tile" /><div className="sk sk-tile" />
      </div>
      <div className="sk sk-row" /><div className="sk sk-card" /><div className="sk sk-card" />
    </div>
  );
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
    document.title = p ? `${p.name} · ${BRAND.name}` : `Player · ${BRAND.name}`;
    return () => { document.title = BRAND.name; };
  }, [p]);

  const mine = me?.id === id;

  if (err) {
    return (
      <div className="page profile-page">
        <section className="panel pf-empty">
          <div className="pf-empty-icon" aria-hidden>🎩</div>
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
          <div className="row center wrap">
            <Link className="btn primary chunky" to="/">Find a game</Link>
            <Link className="btn" to="/leaderboard">Leaderboard</Link>
          </div>
        </section>
      </div>
    );
  }
  if (!p) return <Skeleton />;

  const favChar = p.favouriteCharacter ? getCharacter(p.favouriteCharacter.id) : null;
  const favMap = p.favouriteMap ? getMap(p.favouriteMap.id) : null;
  const winRate = Math.round(p.winRate * 100);

  return (
    <div className="page profile-page">
      <section className="panel pf-hero" aria-labelledby="pf-name">
        <div className="pf-hero-avatar">
          <Avatar src={p.avatar} size={96} />
          {favChar && <span className="pf-hero-char" role="img" aria-label={`Plays as ${favChar.name}`}>{favChar.emoji}</span>}
        </div>
        <div className="pf-who">
          <h1 id="pf-name">{p.name}{mine && <em className="tag">you</em>}</h1>
          <p className="pf-sub">
            {favChar
              ? <span className="pf-sub-item"><span aria-hidden>{favChar.emoji}</span> Plays as <b>{favChar.name}</b></span>
              : <span className="pf-sub-item muted">No favourite character yet</span>}
            {p.firstGameAt && <span className="pf-sub-item"><span aria-hidden>📅</span> Playing since <b>{monthYear(p.firstGameAt)}</b></span>}
          </p>
          <div className="pf-chips">
            <span className="chip">{plural(p.games, 'game')} finished</span>
            {p.wins > 0 && <span className="chip chip-win">{plural(p.wins, 'win')}</span>}
            {favMap && <span className="chip">Favourite map · {favMap.name}</span>}
          </div>
        </div>
      </section>

      <section className="pf-stats" aria-label="Headline stats">
        <div className="pf-stat"><span className="pf-stat-icon" aria-hidden>🎲</span><b>{p.games}</b><span>Games</span></div>
        <div className="pf-stat win"><span className="pf-stat-icon" aria-hidden>🏆</span><b>{p.wins}</b><span>Wins</span></div>
        <div className="pf-stat">
          <span className="pf-stat-icon" aria-hidden>📈</span><b>{winRate}%</b><span>Win rate</span>
          <span className="pf-stat-bar" aria-hidden><i style={{ ['--w' as string]: `${winRate}%` }} /></span>
        </div>
        <div className="pf-stat gold" title="Leaderboard points: one for every opponent you outlast, in games with 2+ people">
          <span className="pf-stat-icon" aria-hidden>⭐</span><b>{p.points}</b><span>Points</span>
        </div>
      </section>
      {p.rankedGames < p.games && (
        <p className="muted small pf-note">Points count only games with at least two people ({p.rankedGames} of {p.games}); games against bots alone still show below.</p>
      )}

      <section className="pf-favs" aria-label="Favourites">
        <div className="panel pf-fav">
          {favMap && <img className="pf-fav-thumb" src={`/maps/${favMap.id}.webp`} alt="" loading="lazy" />}
          <div className="pf-fav-text">
            <span className="muted small">Favourite map</span>
            <b>{favMap ? favMap.name : '—'}</b>
            {p.favouriteMap && <span className="small muted">{plural(p.favouriteMap.games, 'game')}</span>}
          </div>
        </div>
        <div className="panel pf-fav">
          {favChar && <span className="pf-fav-emoji" aria-hidden>{favChar.emoji}</span>}
          <div className="pf-fav-text">
            <span className="muted small">Favourite character</span>
            <b>{favChar ? favChar.name : '—'}</b>
            {p.favouriteCharacter && <span className="small muted">{plural(p.favouriteCharacter.games, 'game')}</span>}
          </div>
        </div>
      </section>

      <section className="panel pf-recent" aria-labelledby="pf-recent-title">
        <h2 id="pf-recent-title" className="lb-h2">Recent games <span className="lb-count">{p.recent.length}</span></h2>
        {p.recent.length === 0 && <p className="muted">No finished games yet.</p>}
        <ul className="pf-games">
          {p.recent.map(g => {
            const theme = getTheme(g.themeId);
            const ch = g.character ? getCharacter(g.character) : null;
            return (
              <li key={`${g.code}-${g.endedAt}`} className={`pf-game-card ${g.place === 1 ? 'won' : ''}`}>
                <div className="pf-thumb-wrap">
                  <img className="pf-thumb" src={`/maps/${g.mapId}.webp`} alt="" loading="lazy" />
                  <span className={`pf-place-badge p${Math.min(g.place, 4)}`} aria-label={`Finished ${ordinal(g.place)} of ${g.of}`}>
                    <span aria-hidden>{MEDALS[g.place - 1] ?? ordinal(g.place)}</span>
                    <small>of {g.of}</small>
                  </span>
                </div>
                <div className="pf-game">
                  <div className="pf-game-top">
                    <b className="pf-game-map">{getMap(g.mapId).name}</b>
                    <span className="chip pf-edition" style={{ background: theme.palette.board, color: theme.palette.boardText, borderColor: theme.palette.boardLine }}>{theme.name}</span>
                    {ch && <span className="chip pf-char-chip" title={`Played as ${ch.name}`}><span aria-hidden>{ch.emoji}</span> {ch.name}</span>}
                  </div>
                  <div className="muted small pf-game-meta">{plural(g.turns, 'turn')} · {when(g.endedAt)}</div>
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
            );
          })}
        </ul>
      </section>
    </div>
  );
}
