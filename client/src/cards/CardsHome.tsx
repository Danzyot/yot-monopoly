// /cards: the Chog Cards home. Open a table, join one by code, or pick an
// open one; how to play in three steps, and the top players.
import { Suspense, lazy, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useConnected } from '../net.ts';
import { useAuth } from '../auth.tsx';
import { toastError } from '../toast.tsx';
import { api } from '../api.ts';
import { CARDS_GAME_NAME, LAST_CARD_CALL } from '../../../shared/cards/meta.ts';
import type { Card } from '../../../shared/cards/deck.ts';
import { cardsCall, chogPref, useCardsRoomList } from './net.ts';
import { CardBack, CardFace } from './CardFace.tsx';
import { CardsBackdrop } from './CardsLobby.tsx';
import './cards.css';

// The full tutorial is the hub's (the "?" on the Cards hub card), fetched when it is wanted.
const HowToPlay = lazy(() => import('../components/HowToPlay.tsx'));

const SHOWCASE: Card[] = [
  { id: 0, kind: 'number', color: 'red', value: 7 },
  { id: 1, kind: 'skip', color: 'yellow' },
  { id: 2, kind: 'wild', color: null },
  { id: 3, kind: 'reverse', color: 'green' },
  { id: 4, kind: 'draw2', color: 'blue' },
  { id: 5, kind: 'wild4', color: null },
];

const STEPS = [
  { icon: '🃏', title: 'Open a table', body: 'Pick the house rules, one round or first to a score, and the turn timer. Bots fill empty seats.' },
  { icon: '🔗', title: 'Share the code', body: 'Friends join with the five-letter code or the invite link, on a phone or a laptop.' },
  { icon: '🏁', title: 'Shed your hand', body: `Match colour, number or symbol. Down to one card? Hit "${LAST_CARD_CALL}" before someone catches you.` },
];

interface Leader { id: string; name: string; games: number; wins: number; points: number }

export default function CardsHome() {
  const nav = useNavigate();
  const { profile, config, openSignIn } = useAuth();
  const rooms = useCardsRoomList();
  const connected = useConnected();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [howTo, setHowTo] = useState(false);
  const canCreate = !!profile && (config.features.publicRooms || profile.isAdmin);

  useEffect(() => { document.title = CARDS_GAME_NAME; }, []);
  useEffect(() => {
    if (!config.features.leaderboard) return;
    api<{ leaders: Leader[] }>('/api/cards/leaderboard').then(r => setLeaders(r.leaders.slice(0, 5))).catch(() => {});
  }, [config.features.leaderboard]);

  const create = async () => {
    if (!profile) return openSignIn();
    setBusy(true);
    try {
      const r = await cardsCall<{ code: string }>('cards:create', chogPref());
      nav(`/cards/r/${r.code}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const join = (c: string) => {
    const clean = c.trim().toUpperCase();
    if (clean.length < 4) return toastError(new Error('Enter a table code'));
    nav(`/cards/r/${clean}`);
  };

  return (
    <div className="cards-home">
      <CardsBackdrop />
      <section className="ch-hero">
        <div className="ch-fan" aria-hidden>
          {SHOWCASE.map((c, i) => (
            <div key={c.id} className="ch-fan-card" style={{ transform: `rotate(${(i - 2.5) * 11}deg) translateY(${Math.abs(i - 2.5) * 9}px)` }}>
              <CardFace card={c} />
            </div>
          ))}
        </div>
        <h1>{CARDS_GAME_NAME}</h1>
        <p className="ch-tag">Match it, stack it, shout “{LAST_CARD_CALL}” — the fast card game for the whole table.</p>
        <div className="ch-actions">
          {profile ? (
            <button className="btn primary big" disabled={busy || !connected || !canCreate} onClick={create}>
              {canCreate ? 'Open a table' : 'Opening tables is operators-only right now'}
            </button>
          ) : (
            <button className="btn primary big" onClick={openSignIn}>Sign in to play</button>
          )}
          <form className="ch-join" onSubmit={e => { e.preventDefault(); join(code); }}>
            <input className="code-input" value={code} maxLength={5} placeholder="CODE" aria-label="Table code"
              autoCapitalize="characters" autoComplete="off" spellCheck={false}
              onChange={e => setCode(e.target.value.toUpperCase())} />
            <button className="btn gold" type="submit">Join!</button>
          </form>
        </div>
        <p className="muted small" role="status">
          {!connected ? 'Connecting…' : rooms.length === 0 ? 'No open tables yet — open one and invite your friends!' : `${rooms.length} open table${rooms.length === 1 ? '' : 's'}`}
        </p>
      </section>

      <div className="ch-body">
        {rooms.length > 0 && (
          <section className="panel" aria-labelledby="ch-tables">
            <h2 id="ch-tables">Open tables</h2>
            <ul className="ch-tables">
              {rooms.map(r => {
                const open = r.status === 'lobby';
                return (
                  <li key={r.code}>
                    <span className="ch-table-back" aria-hidden><CardBack /></span>
                    <span className="grow">
                      <b className="mono">{r.code}</b> <span className={`room-status ${r.status}`}>{open ? 'Open' : 'Playing'}</span>
                      <span className="muted small ch-table-meta">host {r.hostName} · {r.match} · <b>{r.players}/{r.maxPlayers}</b></span>
                    </span>
                    <button className={`btn small ${open ? 'primary' : ''}`} onClick={() => join(r.code)} aria-label={`${open ? 'Join' : 'Watch'} table ${r.code}`}>
                      {open ? 'Join!' : 'Watch'}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="panel" aria-labelledby="ch-how">
          <h2 id="ch-how">How it works</h2>
          <ol className="how-steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="how-icon" aria-hidden>{s.icon}</span>
                <b><span className="how-n">{i + 1}</span>{s.title}</b>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
          <div className="lobby-howto"><button type="button" className="btn small ghost" onClick={() => setHowTo(true)}>❓ How to play</button></div>
          {howTo && createPortal(<Suspense fallback={null}><HowToPlay game="cards" onClose={() => setHowTo(false)} /></Suspense>, document.body)}
        </section>

        {leaders.length > 0 && (
          <section className="panel" aria-labelledby="ch-top">
            <h2 id="ch-top">Top players</h2>
            <ol className="ch-leaders">
              {leaders.map(l => <li key={l.id}><b>{l.name}</b> <span className="muted small">{l.wins} win{l.wins === 1 ? '' : 's'} · {l.games} game{l.games === 1 ? '' : 's'}</span></li>)}
            </ol>
          </section>
        )}
        <p className="ch-foot muted small"><Link to="/">← Back to Monopoly</Link></p>
      </div>
    </div>
  );
}
