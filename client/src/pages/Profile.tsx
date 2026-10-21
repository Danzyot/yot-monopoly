// Public player profile (/u/:id): a hero card with Share buttons, the badges,
// then one section per game the player has finished: Monopoly (headline stats,
// favourites, recent games) and Cards (headline stats, tournament record,
// recent matches), all from finished-game results. Unknown players get a
// friendly page, not an error. A shared link previews as the player's card.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.ts';
import { useAuth } from '../auth.tsx';
import FriendButton from '../components/FriendButton.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { ProfileLink } from '../community.tsx';
import { getMap } from '../../../shared/maps.ts';
import { getTheme } from '../../../shared/themes.ts';
import { getCharacter, isCharacterId } from '../../../shared/characters.ts';
import type { CardsProfile, CardsProfileGame, PublicProfile } from '../../../shared/types.ts';
import { BRAND, GAMES } from '../../../shared/brand.ts';
import ProfileTournaments from '../tournaments/ProfileTournaments.tsx';
import ProfileDaily from '../cards/ProfileDaily.tsx';
import ProfileMonopolyDaily from '../monopolyDaily/ProfileMonopolyDaily.tsx';
import { BadgeGrid, ShareProfile } from '../achievements.tsx';

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
const plural = (n: number, w: string) => `${n} ${n === 1 ? w : /(ch|sh|s|x)$/.test(w) ? `${w}es` : `${w}s`}`;

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

/** One game's four headline tiles. */
function StatTiles({ games, wins, winRate, points, gamesLabel, pointsHelp }: {
  games: number; wins: number; winRate: number; points: number; gamesLabel: string; pointsHelp: string;
}) {
  const rate = Math.round(winRate * 100);
  return (
    <section className="pf-stats" aria-label={`${gamesLabel} stats`}>
      <div className="pf-stat"><span className="pf-stat-icon" aria-hidden>🎲</span><b>{games}</b><span>{gamesLabel}</span></div>
      <div className="pf-stat win"><span className="pf-stat-icon" aria-hidden>🏆</span><b>{wins}</b><span>Wins</span></div>
      <div className="pf-stat">
        <span className="pf-stat-icon" aria-hidden>📈</span><b>{rate}%</b><span>Win rate</span>
        <span className="pf-stat-bar" aria-hidden><i style={{ ['--w' as string]: `${rate}%` }} /></span>
      </div>
      <div className="pf-stat gold" title={pointsHelp}>
        <span className="pf-stat-icon" aria-hidden>⭐</span><b>{points}</b><span>Points</span>
      </div>
    </section>
  );
}

function Opponents({ list }: { list: { id: string; name: string; isBot: boolean }[] }) {
  return (
    <div className="pf-opps small">
      <span className="muted">vs </span>
      {list.map((o, i) => (
        <span key={`${o.id}-${i}`}>
          {i > 0 && <span className="muted">, </span>}
          <ProfileLink id={o.id} isBot={o.isBot}>{o.name}</ProfileLink>
          {o.isBot && <span className="muted"> (bot)</span>}
        </span>
      ))}
    </div>
  );
}

function PlaceBadge({ place, of }: { place: number; of: number }) {
  return (
    <span className={`pf-place-badge p${Math.min(place, 4)}`} aria-label={`Finished ${ordinal(place)} of ${of}`}>
      <span aria-hidden>{MEDALS[place - 1] ?? ordinal(place)}</span>
      <small>of {of}</small>
    </span>
  );
}

function MonopolySection({ p, titled }: { p: PublicProfile; titled: boolean }) {
  const favChar = p.favouriteCharacter ? getCharacter(p.favouriteCharacter.id) : null;
  const favMap = p.favouriteMap ? getMap(p.favouriteMap.id) : null;
  return (
    <>
      {titled && <h2 className="lb-h2 pf-game-title"><span aria-hidden>🎩</span> {GAMES.monopoly.name}</h2>}
      <StatTiles games={p.games} wins={p.wins} winRate={p.winRate} points={p.points} gamesLabel="Games"
        pointsHelp="Leaderboard points: one for every opponent you outlast, in games with 2+ people" />
      {p.rankedGames < p.games && (
        <p className="muted small pf-note">Points count only games with at least two people ({p.rankedGames} of {p.games}); games against bots alone still show below.</p>
      )}
      {p.daily && <ProfileMonopolyDaily d={p.daily} />}

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
                  <PlaceBadge place={g.place} of={g.of} />
                </div>
                <div className="pf-game">
                  <div className="pf-game-top">
                    <b className="pf-game-map">{getMap(g.mapId).name}</b>
                    <span className="chip pf-edition" style={{ background: theme.palette.board, color: theme.palette.boardText, borderColor: theme.palette.boardLine }}>{theme.name}</span>
                    {ch && <span className="chip pf-char-chip" title={`Played as ${ch.name}`}><span aria-hidden>{ch.emoji}</span> {ch.name}</span>}
                  </div>
                  <div className="muted small pf-game-meta">{plural(g.turns, 'turn')} · {when(g.endedAt)}</div>
                  <Opponents list={g.opponents} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

const matchName = (g: CardsProfileGame) => (g.match === 'single' ? 'Single round' : `First to ${g.targetScore}`);

function CardsSection({ c, id, titled }: { c: CardsProfile | null; id: string; titled: boolean }) {
  return (
    <>
      {titled && <h2 className="lb-h2 pf-game-title"><span aria-hidden>🃏</span> {GAMES.cards.name}</h2>}
      {c && (
        <StatTiles games={c.games} wins={c.wins} winRate={c.winRate} points={c.points} gamesLabel="Matches"
          pointsHelp="Cards leaderboard points: one for every opponent you beat, in matches with 2+ people" />
      )}
      {c && c.rankedGames < c.games && (
        <p className="muted small pf-note">Points count only matches with at least two people ({c.rankedGames} of {c.games}); matches against bots alone still show below.</p>
      )}
      {c?.daily && <ProfileDaily d={c.daily} />}
      {/* Tournaments are played at Cards tables. */}
      <ProfileTournaments id={id} />
      {c && (
        <section className="panel pf-recent" aria-labelledby="pf-cards-recent-title">
          <h2 id="pf-cards-recent-title" className="lb-h2">Recent matches <span className="lb-count">{c.recent.length}</span></h2>
          <ul className="pf-games">
            {c.recent.map(g => {
              const ch = g.character && isCharacterId(g.character) ? getCharacter(g.character) : null;
              return (
                <li key={`${g.code}-${g.endedAt}`} className={`pf-game-card ${g.place === 1 ? 'won' : ''}`}>
                  <div className="pf-thumb-wrap">
                    <span className="pf-thumb pf-thumb-cards" aria-hidden>🃏</span>
                    <PlaceBadge place={g.place} of={g.of} />
                  </div>
                  <div className="pf-game">
                    <div className="pf-game-top">
                      <b className="pf-game-map">{matchName(g)}</b>
                      <span className="chip">{g.score} pts</span>
                      {ch && <span className="chip pf-char-chip" title={`Played as ${ch.name}`}><span aria-hidden>{ch.emoji}</span> {ch.name}</span>}
                      {g.left && <span className="chip">left early</span>}
                    </div>
                    <div className="muted small pf-game-meta">{plural(g.rounds, 'round')} · {when(g.endedAt)}</div>
                    <Opponents list={g.opponents} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

type Loaded<T> = { status: 'ok'; value: T | null } | { status: 'error'; code?: number; message: string };

function load<T>(url: string, key: 'profile'): Promise<Loaded<T>> {
  return api<Record<typeof key, T | null>>(url)
    .then(r => ({ status: 'ok' as const, value: r[key] }))
    .catch((e: Error & { status?: number }) => ({ status: 'error' as const, code: e.status, message: e.message }));
}

export default function Profile() {
  const { id = '' } = useParams();
  const { profile: me } = useAuth();
  const [mono, setMono] = useState<Loaded<PublicProfile> | null>(null);
  const [cards, setCards] = useState<Loaded<CardsProfile> | null>(null);

  useEffect(() => {
    let live = true;
    setMono(null);
    setCards(null);
    const enc = encodeURIComponent(id);
    void load<PublicProfile>(`/api/players/${enc}`, 'profile').then(r => { if (live) setMono(r); });
    void load<CardsProfile>(`/api/players/${enc}/cards`, 'profile').then(r => { if (live) setCards(r); });
    return () => { live = false; };
  }, [id]);

  const p = mono?.status === 'ok' ? mono.value : null;
  const c = cards?.status === 'ok' ? cards.value : null;
  // The hero shows whichever game they played last: its name and avatar are the newest.
  const latestMono = p?.recent[0]?.endedAt ?? 0;
  const hero = p && (!c || latestMono >= c.lastGameAt) ? p : c;

  useEffect(() => {
    document.title = hero ? `${hero.name} · ${BRAND.name}` : `Player · ${BRAND.name}`;
    return () => { document.title = BRAND.name; };
  }, [hero?.name]);

  const mine = me?.id === id;

  if (!mono || !cards) return <Skeleton />;

  if (!p && !c) {
    const err = mono.status === 'error' ? mono : cards.status === 'error' ? cards : null;
    const off = !!err?.message.includes('switched off');
    return (
      <div className="page profile-page">
        <section className="panel pf-empty">
          <div className="pf-empty-icon" aria-hidden>🎩</div>
          <h1>{mine ? 'No games yet' : 'Nobody here yet'}</h1>
          <p className="muted">
            {err && err.code !== 404
              ? err.message
              : off
                ? 'Player profiles are switched off on this site right now.'
                : mine
                  ? 'Your profile appears after your first finished game. Go and bankrupt somebody, or empty your hand first!'
                  : 'We have no finished games for this player — the link may be wrong, or they have not finished a game yet.'}
          </p>
          <div className="row center wrap">
            {mine ? (
              <>
                <Link className="btn primary chunky" to={GAMES.monopoly.path}>Play {GAMES.monopoly.name}</Link>
                <Link className="btn primary chunky" to={GAMES.cards.path}>Play {GAMES.cards.name}</Link>
                <Link className="btn chunky" to={`${GAMES.cards.path}#daily`}>Daily Challenge</Link>
                <Link className="btn chunky ghost" to="/settings"><span aria-hidden>🔔</span> Notification settings</Link>
              </>
            ) : (
              <>
                {me && !off && <FriendButton id={id} name="this player" />}
                <Link className="btn primary chunky" to="/">Find a game</Link>
                <Link className="btn chunky" to="/leaderboard">Leaderboard</Link>
              </>
            )}
          </div>
        </section>
        {!off && <ProfileTournaments id={id} />}
      </div>
    );
  }

  const favChar = p?.favouriteCharacter ? getCharacter(p.favouriteCharacter.id) : null;
  const since = Math.min(...[p?.firstGameAt, c?.firstGameAt].filter((t): t is number => !!t));
  const both = !!p && !!c;
  const totalWins = (p?.wins ?? 0) + (c?.wins ?? 0);

  return (
    <div className="page profile-page">
      <section className="panel pf-hero" aria-labelledby="pf-name">
        <div className="pf-hero-avatar">
          <Avatar src={hero!.avatar} size={96} />
          {favChar && <span className="pf-hero-char" role="img" aria-label={`Plays as ${favChar.name}`}>{favChar.emoji}</span>}
        </div>
        <div className="pf-who">
          <h1 id="pf-name">{hero!.name}{mine && <em className="tag">you</em>}</h1>
          <p className="pf-sub">
            {favChar
              ? <span className="pf-sub-item"><span aria-hidden>{favChar.emoji}</span> Plays as <b>{favChar.name}</b></span>
              : <span className="pf-sub-item"><span aria-hidden>{p ? '🎩' : '🃏'}</span> Plays <b>{[p && GAMES.monopoly.name, c && GAMES.cards.name].filter(Boolean).join(' and ')}</b></span>}
            {Number.isFinite(since) && <span className="pf-sub-item"><span aria-hidden>📅</span> Playing since <b>{monthYear(since)}</b></span>}
          </p>
          <div className="pf-chips">
            {p && <span className="chip">{GAMES.monopoly.name} · {plural(p.games, 'game')} finished</span>}
            {c && <span className="chip">{GAMES.cards.name} · {plural(c.games, 'match')} finished</span>}
            {totalWins > 0 && <span className="chip chip-win">{plural(totalWins, 'win')}</span>}
            {p?.favouriteMap && <span className="chip">Favourite map · {getMap(p.favouriteMap.id).name}</span>}
          </div>
          <ShareProfile id={id} name={hero!.name} mine={mine} />
          {!mine && <div className="pf-friend"><FriendButton id={id} name={hero!.name} /></div>}
          {mine && <div className="pf-friend"><Link className="btn small ghost" to="/settings"><span aria-hidden>🔔</span> Notification settings</Link></div>}
        </div>
      </section>

      <BadgeGrid id={id} />

      {p && <MonopolySection p={p} titled={both} />}
      <CardsSection c={c} id={id} titled={both || !p} />
    </div>
  );
}
