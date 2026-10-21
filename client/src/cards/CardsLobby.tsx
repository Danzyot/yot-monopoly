// The card table's lobby, in the Monopoly lobby's design language
// (components/Lobby.tsx, styles/lobby.css): the host gets the set-up panels
// (players and bots, the mode, match, timer, house rules with their help
// text); everyone else gets the clean member view: a live summary, a big chat
// and the players, with their own character folded underneath. Everyone picks
// the same base looks as at Monopoly: character (as the season allows), outfit
// and colour, or their own NFT Chog.

import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { CARDS_HOUSE_RULES, CARDS_MODES, TARGET_SCORE_MAX, TARGET_SCORE_MIN, type CardsGameMode, type CardsRules } from '../../../shared/cards/rules.ts';
import { CARDS_GAME_NAME, CARDS_MAX_PLAYERS, CARDS_MIN_PLAYERS } from '../../../shared/cards/meta.ts';
import {
  CARDS_BOT_LEVELS, CARDS_SEAT_COLORS, CARDS_TARGET_CHOICES, CARDS_TURN_CHOICES, matchLabel,
  type CardsRoomView, type CardsSeatView,
} from '../../../shared/cards/room.ts';
import type { CardsBotLevel } from '../../../shared/cards/types.ts';
import { CHAOS_CARD_HELP, KIND_LABEL, type Card } from '../../../shared/cards/deck.ts';
import { getCharacter, type CharacterId } from '../../../shared/characters.ts';
import type { Outfit } from '../../../shared/outfits.ts';
import { availableCharacters, characterShared } from '../../../shared/season.ts';
import { chogName, isLegendary } from '../../../shared/chogs/traits.ts';
import type { ChatMsg } from '../net.ts';
import { cardsCall, cardsChat, cardsConfigure } from './net.ts';
import { toast, toastError } from '../toast.tsx';
import { useAuth } from '../auth.tsx';
import Chat from '../components/Chat.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { askConfirm } from '../components/Modal.tsx';
import { InviteFriends } from '../components/FriendInvites.tsx';
import { CardBack, CardFace } from './CardFace.tsx';
import { CardsBackdrop } from './CardsBackdrop.tsx';
import ChogPicker, { ChogArt, saveChogTokenPref } from '../components/ChogPicker.tsx';
import { WornItems, loadColorPref, loadOutfitPref, sameOutfit, saveColorPref, saveOutfitPref } from '../components/outfitBits.tsx';
import { CharacterFace, Face } from '../components/CharacterFace.tsx';

// The 3D character preview and the outfit picker's fit check bring three.js: only when someone opens the picker.
const CharacterPreview = lazy(() => import('../three/characters/CharacterPreview.tsx'));
const OutfitPicker = lazy(() => import('../components/OutfitPicker.tsx'));

/**
 * Start downloading what the 3D table needs while people are still in the
 * lobby: the Chog room and its reflections, the characters at the table, and
 * the card atlas, so the deal is seen from the first card.
 */
function preloadTable(characters: string, tokens: boolean) {
  void Promise.all([
    import('../three/environments/index.tsx'),
    import('../three/characters/Figure.tsx'),
    import('./three/cardAtlas.ts'),
  ]).then(([env, fig, atlas]) => {
    env.preloadEnvironment('lounge', 'chog');
    fig.preloadCharacters(characters.split(',') as CharacterId[]);
    // Holders' own Chogs are built from one shared file of trait parts.
    if (tokens) fig.preloadChogTraits();
    void atlas.loadCardAtlas();
  }).catch(() => {});
}

const withCurrent = (choices: number[], v: number) => (choices.includes(v) ? choices : [...choices, v].sort((a, b) => a - b));

/** Each mode's three signature cards, for its picker button and the summary. */
const MODE_FAN: Record<CardsGameMode, Card[]> = {
  classic: [
    { id: 0, kind: 'number', color: 'red', value: 7 },
    { id: 1, kind: 'wild', color: null },
    { id: 2, kind: 'skip', color: 'blue' },
  ],
  chaos: [
    { id: 0, kind: 'purge', color: 'green' },
    { id: 1, kind: 'wild10', color: null },
    { id: 2, kind: 'roulette', color: null },
  ],
};

function ModeFan({ mode }: { mode: CardsGameMode }) {
  return <div className="cl-fan" aria-hidden>{MODE_FAN[mode].map(c => <CardFace key={c.id} card={c} />)}</div>;
}

/** What the Chog Chaos cards do, under the picker and in the summary. */
function ChaosCards() {
  return (
    <ul className="cl-chaos">
      {CHAOS_CARD_HELP.map(h => (
        <li key={h.kind}>
          <CardFace card={{ id: -1, kind: h.kind, color: h.kind === 'purge' ? 'red' : h.kind === 'blitz' ? 'yellow' : null }} />
          <span><b>{KIND_LABEL[h.kind]}</b> {h.help}</span>
        </li>
      ))}
    </ul>
  );
}

/** What a seat plays as: its character, or its own Chog Genesis token. */
const seatName = (s: CardsSeatView) => (s.chogToken ? chogName(s.chogToken) : getCharacter(s.character).name);

/** A seat's character badge: the emoji on the seat's colour, or the token's art framed in its background colour. */
function SeatBadge({ seat: s, hidden }: { seat: CardsSeatView; hidden?: boolean }) {
  const label = hidden ? undefined : `${seatName(s)}, ${s.color}`;
  if (s.chogToken) {
    return (
      <span className="token-badge chog-badge" role={hidden ? undefined : 'img'} aria-label={label} aria-hidden={hidden || undefined}>
        <ChogArt token={s.chogToken} />
      </span>
    );
  }
  return (
    <span className="token-badge" style={{ background: s.color }} role={hidden ? undefined : 'img'} aria-label={label} aria-hidden={hidden || undefined}>
      <CharacterFace id={s.character} />
    </span>
  );
}

function SeatList({ room, me, isHost }: { room: CardsRoomView; me: string; isHost: boolean }) {
  const makeHost = async (s: CardsSeatView) => {
    if (room.hostId === me && !(await askConfirm({ title: `Make ${s.name} the host?`, body: 'You will no longer control the table.', confirm: 'Make host' }))) return;
    cardsCall('cards:host', { id: s.id }).catch(toastError);
  };
  return (
    <ul className="seats">
      {room.seats.map(s => (
        <li key={s.id} style={{ borderColor: s.color }}>
          <span className="seat-ids">
            <SeatBadge seat={s} />
            {!s.isBot && <span className="seat-avatar"><Avatar src={s.avatar} size={16} /></span>}
          </span>
          <span className="grow">
            <span className="seat-name">{s.name} {s.id === me && <em className="tag you">you</em>}{s.id === room.hostId && <em className="tag">host</em>}
              {s.isBot && <em className="tag">bot</em>}{!s.connected && <em className="tag warn">away</em>}</span>
            <span className="seat-char small">
              <i className="seat-swatch" style={{ background: s.color }} aria-hidden /> {seatName(s)}
              {/* An NFT Chog wears its own traits, not outfit items. */}
              {!s.chogToken && <WornItems outfit={s.outfit} color={s.color} className="seat-worn" />}
              {s.isBot && !isHost && <> · {CARDS_BOT_LEVELS.find(l => l.id === s.level)?.label ?? 'Normal'}</>}
            </span>
          </span>
          {isHost && s.isBot && (
            <select className="cl-level" aria-label={`${s.name}'s difficulty`} value={s.level ?? 'normal'}
              onChange={e => cardsCall('cards:botLevel', { id: s.id, level: e.target.value }).catch(toastError)}>
              {CARDS_BOT_LEVELS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          )}
          {isHost && !s.isBot && s.connected && s.id !== room.hostId && (
            <button className="btn tiny ghost" title={`Make ${s.name} the host`} onClick={() => void makeHost(s)}>Make host</button>
          )}
          {isHost && s.id !== me && (
            <button className="btn tiny ghost" aria-label={`Remove ${s.name}`} title={`Remove ${s.name}`} onClick={() => cardsCall('cards:kick', { id: s.id }).catch(toastError)}>✕</button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Our character (the Monopoly cast, as the season allows: shared/season.ts), the holder's own Chogs, outfit and seat colour. */
function CharacterPicker({ room, me, seat, onWear }: { room: CardsRoomView; me: string; seat: CardsSeatView; onWear: (o: Outfit) => void }) {
  const picks = availableCharacters();
  const token = seat.chogToken;
  // Remembered for the next table too (sent on join; the server checks the wallet each time).
  const pick = (character: CharacterId, chogToken?: number) =>
    cardsCall('cards:seat', { character, ...(chogToken ? { chogToken } : {}) })
      .then(() => saveChogTokenPref(chogToken ?? null))
      .catch(toastError);
  return (
    <>
      <div className="char-picker">
        <div className="char-preview">
          <Suspense fallback={<span className="char-preview-emoji" style={{ background: seat.color }}><CharacterFace id={seat.character} /></span>}>
            <CharacterPreview character={seat.character} color={seat.color} outfit={seat.outfit} chogToken={token} />
          </Suspense>
          <div className="char-about">
            <b>{seatName(seat)}</b>
            <span className="small muted">
              {token
                ? isLegendary(token) ? `Legendary 1:1 #${token} — one of ten hand-painted Chogs.` : 'Your own Chog Genesis, built from its traits.'
                : getCharacter(seat.character).blurb}
            </span>
          </div>
        </div>
        {/* During the Chog season there is one character (everyone is a Chog, told apart by colour): no grid
            to pick from, except the base Chog to go back to after playing as your own. */}
        {(picks.length > 1 || !!token) && <div className="char-grid">
          {picks.map(c => {
            // A token Chog is its own character: the base Chog stays free for someone else.
            const holder = characterShared(c.id) ? undefined : room.seats.find(s => s.character === c.id && !s.chogToken && s.id !== me);
            const on = seat.character === c.id && !token;
            return (
              <button key={c.id} disabled={!!holder} aria-pressed={on}
                title={holder ? `${c.name} — taken by ${holder.name}` : c.name}
                className={`char-pick ${on ? 'on' : ''}`}
                onClick={() => pick(c.id)}>
                <span className="char-emoji"><Face emoji={c.emoji} image={c.face} /></span>
                <span className="char-name">{c.name}</span>
                {holder && <span className="char-taken" style={{ background: holder.color }} />}
              </button>
            );
          })}
        </div>}
        <ChogPicker selected={token ?? null}
          taken={id => room.seats.find(s => s.chogToken === id && s.id !== me)?.name}
          onPick={id => pick('chog', id)} />
      </div>
      <h4 className="lobby-outfit-head">Outfit</h4>
      {token && <p className="small muted cl-outfit-note">Your own Chog wears its own traits. Your outfit shows when you play the base Chog.</p>}
      <Suspense fallback={<p className="small muted">Loading outfits…</p>}>
        <OutfitPicker outfit={seat.outfit ?? {}} color={seat.color} character={seat.character} onChange={onWear} disabled={!!token} />
      </Suspense>
      <div className="outfit-colors">
        <span>Colour</span>
        <div className="color-grid" role="group" aria-label="Your colour">
          {CARDS_SEAT_COLORS.map(c => {
            const taken = room.seats.some(s => s.color === c && s.id !== me);
            return (
              <button key={c} disabled={taken} aria-label={`Colour ${c}${taken ? ' (taken)' : ''}`} aria-pressed={seat.color === c}
                className={`color-pick ${seat.color === c ? 'on' : ''}`} style={{ background: c }}
                onClick={() => { saveColorPref(c); cardsCall('cards:seat', { color: c }).catch(toastError); }} />
            );
          })}
        </div>
      </div>
    </>
  );
}

/** A value that glows for a moment when the host changes it. */
function Live({ value, children }: { value: unknown; children: ReactNode }) {
  const last = useRef(value);
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    if (Object.is(last.current, value)) return;
    last.current = value;
    setFlash(n => n + 1);
  }, [value]);
  return <span key={flash} className={`ls-val ${flash ? 'changed' : ''}`}>{children}</span>;
}

function inviteLink(code: string) {
  return `${location.origin}/cards/r/${code}`;
}

function copyLink(code: string) {
  void navigator.clipboard?.writeText(inviteLink(code));
  toast('Invite link copied!');
}

/** Everyone but the host: what the host picked, live, beside a big chat. */
function MemberLobby({ room, me, spectating, chat, onLeave, onWear }: {
  room: CardsRoomView; me: string; spectating: boolean; chat: ChatMsg[]; onLeave: () => void; onWear: (o: Outfit) => void;
}) {
  const { profile, config } = useAuth();
  const mySeat = room.seats.find(s => s.id === me);
  const host = room.seats.find(s => s.id === room.hostId);
  const r = room.rules;
  const on = CARDS_HOUSE_RULES.filter(h => r[h.key]);
  return (
    <div className={`lobby lobby-member cards-lobby ${config.features.chat ? '' : 'no-chat'}`}>
      <CardsBackdrop />
      <div className="lm">
        <header className="panel lm-head">
          <div className="lm-title">
            <h2 className="row">
              <span className="lm-name">{host ? `${host.name}’s table` : 'Card table'}</span>
              <span className="lm-code mono" title="Table code">{room.code}</span>
            </h2>
            <p className="lm-status" aria-live="polite">
              <span className="lm-pulse" aria-hidden />
              <span>{host ? <>Waiting for <b>{host.name}</b> to deal</> : 'Waiting for a host'}</span>
              <span className="lm-count"><b>{room.seats.length}/{room.maxPlayers}</b> players{room.spectators > 0 && ` · ${room.spectators} watching`}</span>
            </p>
            {spectating && profile && <p className="muted small lm-watch">{room.seats.length >= room.maxPlayers ? 'The table is full — you are watching.' : 'You are watching.'}</p>}
          </div>
          <div className="row lm-actions">
            <button className="btn small ghost" onClick={() => copyLink(room.code)}>Copy link</button>
            <button className="btn small danger" onClick={onLeave}>Leave</button>
          </div>
        </header>

        <aside className="panel lm-summary" aria-label="Table settings">
          <h3>{CARDS_GAME_NAME}</h3>
          <ModeFan mode={r.mode} />
          <dl className="ls-facts">
            <div><dt>Mode</dt><dd><Live value={r.mode}>{CARDS_MODES.find(m => m.id === r.mode)?.label}</Live></dd></div>
            <div><dt>Match</dt><dd><Live value={`${r.match}${r.targetScore}`}>{matchLabel(r)}</Live></dd></div>
            <div><dt>Turn timer</dt><dd><Live value={r.turnSeconds}>{r.turnSeconds ? `${r.turnSeconds} s` : 'Off'}</Live></dd></div>
            <div><dt>Seats</dt><dd><Live value={room.maxPlayers}>up to {room.maxPlayers}</Live></dd></div>
          </dl>
          <h4 className="ls-rules-head">House rules</h4>
          <div className="ls-chips">
            {on.length === 0 && <span className="muted small">None: the standard game</span>}
            {on.map(h => <span key={h.key} className="ls-chip" title={h.help}>{h.label}</span>)}
            {room.private && <span className="ls-chip ls-private" title="Join by invite link only">🔒 Private</span>}
          </div>
          {on.length > 0 && <ul className="cl-help">{on.map(h => <li key={h.key}><b>{h.label}:</b> {h.help}</li>)}</ul>}
          {r.mode === 'chaos' && <><h4 className="ls-rules-head">Chog Chaos cards</h4><ChaosCards /></>}
        </aside>

        {config.features.chat && (
          <section className="panel chat-panel lm-chat">
            <h3>Chat</h3>
            <Chat chat={chat} me={me} send={text => cardsChat(text)} quick={false} />
          </section>
        )}

        <section className="panel lm-players">
          <h3>Players <span className="muted small">{room.seats.length}/{room.maxPlayers}</span></h3>
          <SeatList room={room} me={me} isHost={false} />
          {mySeat && (
            <details className="lm-me">
              <summary>
                <SeatBadge seat={mySeat} hidden />
                <span className="grow">
                  <b>{seatName(mySeat)}</b>
                  <span className="small muted">Your character · change it, your outfit or your colour</span>
                </span>
                <span className="lm-me-caret" aria-hidden>▾</span>
              </summary>
              <div className="lm-me-body"><CharacterPicker room={room} me={me} seat={mySeat} onWear={onWear} /></div>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}

export default function CardsLobby({ room, me, spectating, chat }: {
  room: CardsRoomView; me: string; spectating: boolean; chat: ChatMsg[];
}) {
  const nav = useNavigate();
  const { profile, config } = useAuth();
  const mySeat = room.seats.find(s => s.id === me);
  // An operator sitting at someone else's table plays as a guest; one looking in manages it.
  const isHost = room.hostId === me || (!!profile?.isAdmin && !mySeat);
  const canBots = config.features.bots || !!profile?.isAdmin;
  const [botLevel, setBotLevel] = useState<CardsBotLevel>('normal');
  const [starting, setStarting] = useState(false);
  const seatChars = room.seats.map(s => s.character).join(',');
  const tokensAtTable = room.seats.some(s => s.chogToken);
  useEffect(() => { if (seatChars) preloadTable(seatChars, tokensAtTable); }, [seatChars, tokensAtTable]);
  const r = room.rules;
  const rules = (p: Partial<CardsRules>) => cardsConfigure({ rules: p }).catch(toastError);
  const leave = async () => { await cardsCall('cards:leave').catch(() => {}); nav('/cards'); };

  // The outfit last worn at either game (or dressed up on /characters): put on
  // once per table, as worn by the character this seat plays, like Monopoly's lobby.
  const dressed = useRef<string | null>(null);
  useEffect(() => {
    if (!mySeat || dressed.current === room.code) return;
    dressed.current = room.code;
    const pref = loadOutfitPref(mySeat.character);
    if (!sameOutfit(pref, mySeat.outfit)) cardsCall('cards:seat', { outfit: pref }).catch(() => {});
  }, [mySeat, room.code]);
  // The colour picked in the welcome tour (or last picked at a table), when this table has it free.
  const tinted = useRef<string | null>(null);
  useEffect(() => {
    if (!mySeat || tinted.current === room.code) return;
    tinted.current = room.code;
    const pref = loadColorPref();
    if (!pref || pref === mySeat.color || !CARDS_SEAT_COLORS.includes(pref) || room.seats.some(s => s.color === pref && s.id !== me)) return;
    cardsCall('cards:seat', { color: pref }).catch(() => {});
  }, [mySeat, room.code, room.seats, me]);
  const wear = (o: Outfit) => {
    if (mySeat) saveOutfitPref(o, mySeat.character);
    cardsCall('cards:seat', { outfit: o }).catch(toastError);
  };

  const quickStart = async () => {
    const want = Math.min(4, room.maxPlayers);
    const bots = Math.max(0, want - room.seats.length);
    setStarting(true);
    try {
      for (let i = 0; i < bots; i++) await cardsCall('cards:addBot', { level: botLevel });
      await cardsCall('cards:start');
    } catch (e) {
      toastError(e);
    } finally {
      setStarting(false);
    }
  };

  if (!isHost) return <MemberLobby room={room} me={me} spectating={spectating} chat={chat} onLeave={leave} onWear={wear} />;

  return (
    <div className="lobby cards-lobby">
      <CardsBackdrop />
      <div className="lobby-panels">
        <section className="panel">
          <div className="row between">
            <h2 className="row">Table <span className="mono accent cl-code">{room.code}</span></h2>
            <button className="btn small danger" onClick={leave}>Leave</button>
          </div>
          <div className="row">
            <input readOnly value={inviteLink(room.code)} onFocus={e => e.target.select()} aria-label="Invite link" />
            <button className="btn small" onClick={() => copyLink(room.code)}>Copy link</button>
          </div>
          <p className="muted small">Friends join with the code <b className="mono">{room.code}</b> on the {CARDS_GAME_NAME} page, or with the link.</p>
          {mySeat && <InviteFriends seated={room.seats.map(s => s.id)} />}

          <h3>Players {room.seats.length}/{room.maxPlayers}{room.spectators > 0 && <span className="muted small"> · {room.spectators} watching</span>}</h3>
          <SeatList room={room} me={me} isHost />
          {room.seats.length < room.maxPlayers && canBots && (
            <div className="row cl-addbot">
              <button className="btn small" onClick={() => cardsCall('cards:addBot', { level: botLevel }).catch(toastError)}>+ Add bot</button>
              <select aria-label="New bot difficulty" value={botLevel} onChange={e => setBotLevel(e.target.value as CardsBotLevel)}
                title={CARDS_BOT_LEVELS.find(l => l.id === botLevel)?.help}>
                {CARDS_BOT_LEVELS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </div>
          )}
          {canBots && <p className="muted small">{CARDS_BOT_LEVELS.find(l => l.id === botLevel)?.help}</p>}

          {mySeat && (
            <>
              <h3>Your character</h3>
              <CharacterPicker room={room} me={me} seat={mySeat} onWear={wear} />
            </>
          )}

          <div className="start-row">
            <button className="btn primary big" disabled={room.seats.length < CARDS_MIN_PLAYERS || starting}
              onClick={() => cardsCall('cards:start').catch(toastError)}>
              {room.seats.length < CARDS_MIN_PLAYERS ? 'Need 2+ players' : 'Deal!'}
            </button>
            {canBots && room.seats.length < Math.min(4, room.maxPlayers) && (
              <button className="btn gold quick-start" disabled={starting} onClick={quickStart} title="Fill the table with bots up to 4 players and deal">
                🚀 Quick start <small>bots fill to {Math.min(4, room.maxPlayers)} players</small>
              </button>
            )}
          </div>
        </section>

        <section className="panel cl-settings">
          <h3 className="cl-head">Mode</h3>
          <div className="cl-seg cl-modes" role="radiogroup" aria-label="Game mode">
            {CARDS_MODES.map(mo => (
              <button key={mo.id} role="radio" aria-checked={r.mode === mo.id} className={`${r.mode === mo.id ? 'on' : ''} mode-${mo.id}`} data-mode={mo.id}
                onClick={() => r.mode !== mo.id && rules({ mode: mo.id })}>
                <ModeFan mode={mo.id} />
                <b>{mo.label}</b><small className="cl-mode-tag">{mo.tag}</small>
                <small>{mo.help}</small>
              </button>
            ))}
          </div>
          {r.mode === 'chaos' && <ChaosCards />}

          <h3 className="cl-head">Match</h3>
          <div className="cl-seg" role="radiogroup" aria-label="Match length">
            <button role="radio" aria-checked={r.match === 'single'} className={r.match === 'single' ? 'on' : ''} onClick={() => rules({ match: 'single' })}>
              <b>Single round</b><small>First out of cards wins</small>
            </button>
            <button role="radio" aria-checked={r.match === 'points'} className={r.match === 'points' ? 'on' : ''} onClick={() => rules({ match: 'points' })}>
              <b>First to {r.targetScore}</b><small>Rounds until someone reaches it</small>
            </button>
          </div>
          <div className="rules">
            {r.match === 'points' && (
              <label className="rule">
                <span>Points to win</span>
                <select value={r.targetScore} onChange={e => rules({ targetScore: Number(e.target.value) })}>
                  {withCurrent(CARDS_TARGET_CHOICES, r.targetScore).filter(n => n >= TARGET_SCORE_MIN && n <= TARGET_SCORE_MAX).map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}
            <label className="rule" title="Time for each step of a turn. On timeout the player draws and passes; twice in a row and auto-play takes over until they are back.">
              <span>Turn timer</span>
              <select value={r.turnSeconds} onChange={e => rules({ turnSeconds: Number(e.target.value) })}>
                {withCurrent(CARDS_TURN_CHOICES, r.turnSeconds).map(n => <option key={n} value={n}>{n ? `${n} s` : 'Off'}</option>)}
              </select>
            </label>
            <label className="rule">
              <span>Seats</span>
              <select value={room.maxPlayers} onChange={e => cardsConfigure({ maxPlayers: Number(e.target.value) }).catch(toastError)}>
                {Array.from({ length: CARDS_MAX_PLAYERS - CARDS_MIN_PLAYERS + 1 }, (_, i) => i + CARDS_MIN_PLAYERS).map(n => <option key={n}>{n}</option>)}
              </select>
            </label>
          </div>

          <h3 className="cl-head">House rules <small className="muted">{r.mode === 'chaos' ? 'Chog Chaos turned these on: change any' : 'stacking is on by default; turn it off for the official rules'}</small></h3>
          <div className="rules">
            {CARDS_HOUSE_RULES.map(h => {
              const off = h.key === 'stackMixed' && !r.stacking;
              return (
                <label key={h.key} className={`rule toggle ${off ? 'off' : ''}`}>
                  <input type="checkbox" checked={r[h.key]} disabled={off} onChange={e => rules({ [h.key]: e.target.checked })} />
                  <span>{h.label}<small className="muted"> — {h.help}</small></span>
                </label>
              );
            })}
            <label className="rule toggle">
              <input type="checkbox" checked={room.private} onChange={e => cardsConfigure({ private: e.target.checked }).catch(toastError)} />
              <span>Private table<small className="muted"> — join by code or link only</small></span>
            </label>
          </div>
        </section>

        {config.features.chat && (
          <section className="panel chat-panel">
            <h3>Chat</h3>
            <Chat chat={chat} me={me} send={text => cardsChat(text)} quick={false} />
          </section>
        )}
      </div>
    </div>
  );
}
