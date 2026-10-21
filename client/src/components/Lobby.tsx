import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { GAMES } from '../../../shared/brand.ts';
import { call, type ChatMsg } from '../net.ts';
import { TIME_LIMIT_CHOICES, TURN_SECONDS_CHOICES, getTheme, resolveTheme, type RuleConfig } from '../../../shared/themes.ts';
import { getMap } from '../../../shared/maps.ts';
import { PLAYER_COLORS, type RoomSeat, type RoomView } from '../../../shared/types.ts';
import { getCharacter, isCharacterId, type CharacterId } from '../../../shared/characters.ts';
import { characterEmoji } from '../format.ts';
import { toast, toastError } from '../toast.tsx';
import { useAuth } from '../auth.tsx';
import Chat from './Chat.tsx';
import MusicPlayer from './MusicPlayer.tsx';
import { Avatar } from './Avatar.tsx';
import BoardScene from '../three/BoardScene.tsx';
import TableStylePicker from './TableStylePicker.tsx';
import BoardPicker, { LOOK_STEP } from './BoardPicker.tsx';
import { availableCharacters, characterAvailable, characterShared, mapThumbUrl } from '../../../shared/season.ts';
import CharacterPreview from '../three/characters/CharacterPreview.tsx';
import { preloadCharacters, preloadChogTraits } from '../three/characters/Figure.tsx';
import { themeStyle } from '../themeStyle.ts';
import RequirementsPicker from './RequirementsPicker.tsx';
import { ProfileLink } from '../community.tsx';
import { askConfirm } from './Modal.tsx';
import { loadColorPref, saveColorPref } from './outfitBits.tsx';
import { HowToPlayButton } from './HowToPlay.tsx';
import OutfitPicker, { loadOutfitPref, sameOutfit, saveOutfitPref } from './OutfitPicker.tsx';
import ChogPicker, { ChogArt, loadChogTokenPref } from './ChogPicker.tsx';
import { chogName, isLegendary } from '../../../shared/chogs/traits.ts';
import type { Outfit } from '../../../shared/outfits.ts';

const TOGGLES: [keyof RuleConfig, string, string][] = [
  ['auctions', 'Auctions', 'Unbought property goes to auction'],
  ['evenBuild', 'Even building', 'Build houses evenly across a set'],
  ['limitedBuildings', 'Limited houses', 'Bank has 32 houses / 12 hotels'],
  ['freeParkingPot', 'Free Parking jackpot', 'Taxes, card fines & arcade losses (not jail bail) pile up on Free Parking'],
  ['doubleOnGo', 'Double on GO', 'Landing exactly on GO pays double'],
  ['minigames', 'Mini-games', 'Arcade spaces start a quick mini-game for cash prizes'],
  ['arcadeParking', 'Free Parking arcade', 'Free Parking is an arcade too (mini-games on Classic)'],
  ['speedDie', 'Speed Die', 'Official variant: a third die once you have passed GO (Mr. Monopoly, Bus, triples)'],
  ['noRentInJail', 'No rent in jail', 'Owners sitting in jail collect no rent'],
];

/** The gallery's "Play as …" remembers a character here; the lobby applies it once per room. */
export const CHARACTER_PREF_KEY = 'yot:character';

/** One line for the folded house-rules panel: the switches people ask about first. */
function rulesSummary(r: RuleConfig): string {
  return [
    `Jackpot ${r.freeParkingPot ? 'on' : 'off'}`,
    `Auctions ${r.auctions ? 'on' : 'off'}`,
    r.turnSeconds ? `${r.turnSeconds} s turns` : 'No turn timer',
    r.timeLimitMin ? `${r.timeLimitMin} min game` : 'No time limit',
  ].join(' · ');
}

/** A select's options, keeping a value set some other way (e.g. a theme's default) visible. */
const withCurrent = (choices: number[], v: number) => (choices.includes(v) ? choices : [...choices, v].sort((a, b) => a - b));

/**
 * A number setting typed as a local draft and sent on blur or Enter (Escape
 * drops it). The server clamps every value it gets, so sending each
 * keystroke would rewrite the field mid-typing.
 */
function DraftNumber({ value, onCommit, ...rest }: {
  value: number; onCommit: (n: number) => Promise<unknown>;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  const [draft, setDraft] = useState<string | null>(null);
  const sending = useRef(false);
  const commit = () => {
    if (draft === null || sending.current) return;
    const n = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(n) || n === value) { setDraft(null); return; }
    // The room's new state arrives before the reply: show the draft until then.
    sending.current = true;
    void onCommit(n).finally(() => { sending.current = false; setDraft(null); });
  };
  return (
    <input {...rest} type="number" value={draft ?? value}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') setDraft(null);
      }} />
  );
}

/** Who is seated, with the host's make-host and remove buttons. */
function SeatList({ room, me, isHost, onMakeHost }: {
  room: RoomView; me: string; isHost: boolean; onMakeHost?: (id: string, name: string) => void;
}) {
  return (
    <ul className="seats">
      {room.seats.map(s => (
        <li key={s.id} style={{ borderColor: s.color }}>
          {/* Character first (it is what they play as); their own avatar rides on its corner. */}
          <span className="seat-ids">
            <SeatBadge seat={s} />
            {!s.isBot && <span className="seat-avatar"><Avatar src={s.avatar} size={16} /></span>}
          </span>
          <span className="grow">
            <span className="seat-name"><ProfileLink id={s.id} isBot={s.isBot} newTab>{s.name}</ProfileLink> {s.id === me && <em className="tag you">you</em>}{s.id === room.hostId && <em className="tag">host</em>} {s.isBot && <em className="tag">bot</em>}
            {!s.connected && <em className="tag warn">away</em>}</span>
            <span className="seat-char small"><i className="seat-swatch" style={{ background: s.color }} aria-hidden /> {seatName(s)}</span>
          </span>
          {isHost && onMakeHost && !s.isBot && s.connected && s.id !== room.hostId && (
            <button className="btn tiny ghost" title={`Make ${s.name} the host`} onClick={() => onMakeHost(s.id, s.name)}>Make host</button>
          )}
          {isHost && s.id !== me && (
            <button className="btn tiny ghost" title={`Remove ${s.name}`} aria-label={`Remove ${s.name}`} onClick={() => call('room:kick', { id: s.id }).catch(toastError)}>✕</button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** What a seat plays as: its character, or its own Chog Genesis token. */
const seatName = (s: RoomSeat) => (s.chogToken ? chogName(s.chogToken) : getCharacter(s.character).name);

/** A seat's character badge: the emoji on the player's colour, or the token's art framed in its background colour. */
function SeatBadge({ seat: s }: { seat: RoomSeat }) {
  if (s.chogToken) {
    return (
      <span className="token-badge chog-badge" role="img" aria-label={`${chogName(s.chogToken)}, ${s.color}`}>
        <ChogArt token={s.chogToken} />
      </span>
    );
  }
  return <span className="token-badge" style={{ background: s.color }} role="img" aria-label={`${seatName(s)}, ${s.color}`}>{characterEmoji(s.character)}</span>;
}

/** Our own seat: character (3D preview + grid), the holder's own Chogs, outfit and colour. */
function CharacterPicker({ room, me, seat, onWear }: {
  room: RoomView; me: string; seat: RoomSeat; onWear: (o: Outfit) => void;
}) {
  const token = seat.chogToken;
  return (
    <>
      <div className="char-picker">
        <div className="char-preview">
          <CharacterPreview character={seat.character} color={seat.color} outfit={seat.outfit} chogToken={token} />
          <div className="char-about">
            <b>{seatName(seat)}</b>
            <span className="small muted">
              {token
                ? isLegendary(token) ? `Legendary 1:1 #${token} — one of ten hand-painted Chogs.` : 'Your own Chog Genesis, built from its traits.'
                : getCharacter(seat.character).blurb}
            </span>
          </div>
        </div>
        <div className="char-grid">
          {availableCharacters().map(c => {
            // A token Chog is its own character: the base Chog stays free for someone else. A shared
            // character (everyone is a Chog in the Chog season) is never taken; colours tell players apart.
            const holder = characterShared(c.id) ? undefined : room.seats.find(s => s.character === c.id && !s.chogToken && s.id !== me);
            const on = seat.character === c.id && !token;
            return (
              <button key={c.id} disabled={!!holder} aria-pressed={on}
                title={holder ? `${c.name} — taken by ${holder.name}` : `${c.name} — ${c.blurb}`}
                aria-label={holder ? `${c.name}, taken by ${holder.name}` : c.name}
                className={`char-pick ${on ? 'on' : ''}`}
                onClick={() => call('room:seat', { character: c.id }).catch(toastError)}>
                <span className="char-emoji">{c.emoji}</span>
                <span className="char-name">{c.name}</span>
                {holder && <span className="char-taken" style={{ background: holder.color }} />}
              </button>
            );
          })}
        </div>
        <ChogPicker selected={token ?? null}
          taken={id => room.seats.find(s => s.chogToken === id && s.id !== me)?.name}
          onPick={id => call('room:seat', { character: 'chog', chogToken: id }).catch(toastError)} />
      </div>
      <h4 className="lobby-outfit-head">Outfit</h4>
      <OutfitPicker outfit={seat.outfit ?? {}} color={seat.color} character={seat.character} onChange={onWear} />
      <div className="outfit-colors">
        <span>Colour</span>
        <div className="color-grid" role="group" aria-label="Your colour">
          {PLAYER_COLORS.map(c => {
            const taken = room.seats.some(s => s.color === c && s.id !== me);
            return (
              <button key={c} disabled={taken} aria-label={`Colour ${c}${taken ? ' (taken)' : ''}`} aria-pressed={seat.color === c}
                className={`color-pick ${seat.color === c ? 'on' : ''}`} style={{ background: c }}
                onClick={() => { saveColorPref(c); call('room:seat', { color: c }).catch(toastError); }} />
            );
          })}
        </div>
      </div>
    </>
  );
}

/** A summary value that glows for a moment when the host changes it (not on first show). */
function Live({ value, children, className = '' }: { value: unknown; children: ReactNode; className?: string }) {
  const last = useRef(value);
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    if (Object.is(last.current, value)) return;
    last.current = value;
    setFlash(n => n + 1);
  }, [value]);
  // Re-keying restarts the CSS animation on every change.
  return <span key={flash} className={`ls-val ${flash ? 'changed' : ''} ${className}`}>{children}</span>;
}

/**
 * Everyone but the host: what the host picked, read-only and live, beside a
 * big chat. Their own character sits folded under the player list.
 */
function MemberLobby({ room, me, spectating, chat, onLeave, onWear }: {
  room: RoomView; me: string; spectating: boolean; chat: ChatMsg[]; onLeave: () => void; onWear: (o: Outfit) => void;
}) {
  const { profile, config } = useAuth();
  const theme = getTheme(room.themeId);
  const look = resolveTheme(room.themeId, room.mapId);
  const map = getMap(room.mapId);
  const mySeat = room.seats.find(s => s.id === me);
  const host = room.seats.find(s => s.id === room.hostId);
  const link = `${location.origin}/r/${room.code}`;
  const r = room.rules;
  const groups = [...new Set(map.spaces.filter(s => s.kind === 'property').map(s => s.group!))];
  const onRules = TOGGLES.filter(([k]) => r[k] && (config.features.minigames || (k !== 'minigames' && k !== 'arcadeParking')));

  return (
    <div className={`lobby lobby-member ${theme.ui ? 'branded' : ''} ${config.features.chat ? '' : 'no-chat'}`} style={themeStyle(theme)}>
      <div className="lobby-bg"><BoardScene themeId={room.themeId} mapId={room.mapId} game={null} spin tableStyle={room.style} /></div>
      <div className="lm">
        <header className="panel lm-head">
          <div className="lm-title">
            <h2 className="row">
              {theme.logoUrl && <img className="brand-mark" src={theme.logoUrl} alt="" />}
              <span className="lm-name">{host ? `${host.name}’s table` : 'Game room'}</span>
              <span className="lm-code mono" title="Room code">{room.code}</span>
            </h2>
            <p className="lm-status" aria-live="polite">
              <span className="lm-pulse" aria-hidden />
              <span>{host ? <>Waiting for <b>{host.name}</b> to start</> : 'Waiting for a host'}</span>
              <span className="lm-count"><b>{room.seats.length}/{r.maxPlayers}</b> players{room.spectators > 0 && ` · ${room.spectators} watching`}</span>
            </p>
            {spectating && profile && <p className="muted small lm-watch">{room.seats.length >= r.maxPlayers ? 'The room is full — you are watching.' : 'You are watching.'}</p>}
          </div>
          <div className="row lm-actions">
            <MusicPlayer />
            <button className="btn small ghost" onClick={() => { void navigator.clipboard?.writeText(link); toast('Invite link copied!'); }}>Copy link</button>
            <HowToPlayButton rules={r} mapId={room.mapId} label="❓ Rules" />
            <button className="btn small danger" onClick={onLeave} aria-label="Leave the room">Leave</button>
          </div>
        </header>

        <aside className="panel lm-summary" aria-label="Game settings">
          <h3>The table</h3>
          <div className="ls-board">
            <img className="ls-thumb" src={mapThumbUrl(map.id)} alt="" />
            <span className="ls-board-text">
              <Live value={map.id}><b>{map.name}</b></Live>
              <span className="small muted">{map.spaces.length} spaces</span>
            </span>
          </div>
          <dl className="ls-facts">
            <div>
              <dt>Look</dt>
              <dd><Live value={room.themeId}>
                <span className="swatches ls-swatches" aria-hidden>
                  {groups.slice(0, 4).map(g => <i key={g} style={{ background: look.groupColors[g] }} />)}
                </span>
                {look.name}
              </Live></dd>
            </div>
            <div><dt>Starting cash</dt><dd><Live value={r.startingCash}>{look.currency}{r.startingCash.toLocaleString()}</Live></dd></div>
            <div><dt>Turn timer</dt><dd><Live value={r.turnSeconds}>{r.turnSeconds ? `${r.turnSeconds} s` : 'Off'}</Live></dd></div>
            <div><dt>Game length</dt><dd><Live value={r.timeLimitMin}>{r.timeLimitMin ? `${r.timeLimitMin} min` : 'No limit'}</Live></dd></div>
          </dl>
          <h4 className="ls-rules-head">House rules</h4>
          <div className="ls-chips">
            {onRules.length === 0 && <span className="muted small">None: plain rules</span>}
            {onRules.map(([k, label, hint]) => <span key={k} className="ls-chip" title={hint}>{label}</span>)}
            {room.private && <span className="ls-chip ls-private" title="Join by invite link only">🔒 Private</span>}
          </div>
          <RequirementsPicker room={room} canEdit={false} />
        </aside>

        {config.features.chat && (
          <section className="panel chat-panel lm-chat">
            <h3>Chat</h3>
            <Chat chat={chat} />
          </section>
        )}

        <section className="panel lm-players">
          <h3>Players <span className="muted small">{room.seats.length}/{r.maxPlayers}</span></h3>
          <SeatList room={room} me={me} isHost={false} />
          {mySeat && (
            <details className="lm-me">
              <summary>
                <SeatBadge seat={mySeat} />
                <span className="grow">
                  <b>{seatName(mySeat)}</b>
                  <span className="small muted">Your character · change it or dress up</span>
                </span>
                <span className="lm-me-caret" aria-hidden>▾</span>
              </summary>
              <div className="lm-me-body">
                <CharacterPicker room={room} me={me} seat={mySeat} onWear={onWear} />
              </div>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}

export default function Lobby({ room, me, spectating, chat }: {
  room: RoomView; me: string; spectating: boolean; chat: ChatMsg[];
}) {
  const nav = useNavigate();
  const { profile, config } = useAuth();
  const isHost = room.hostId === me || !!profile?.isAdmin;
  const theme = getTheme(room.themeId);
  const map = getMap(room.mapId);
  const mySeat = room.seats.find(s => s.id === me);
  const link = `${location.origin}/r/${room.code}`;

  const canBots = config.features.bots || !!profile?.isAdmin;
  const [starting, setStarting] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  const configure = (p: { themeId?: string; mapId?: string; rules?: Partial<RuleConfig>; private?: boolean }) =>
    call('room:configure', p).catch(toastError);

  // Fetch the table's characters (one small file each) while everyone gathers, so the game starts with them in.
  const seatChars = room.seats.map(s => s.character).join(',');
  useEffect(() => { if (seatChars) preloadCharacters(seatChars.split(',') as CharacterId[]); }, [seatChars]);
  const tokensAtTable = room.seats.some(s => s.chogToken);
  useEffect(() => { if (tokensAtTable) preloadChogTraits(); }, [tokensAtTable]);

  // The character picked on /characters ("Play as …"): applied once, the first
  // time we hold a seat in this room, and only while nobody else has it.
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (!mySeat || applied.current === room.code) return;
    applied.current = room.code;
    let pref: string | null = null;
    try { pref = localStorage.getItem(CHARACTER_PREF_KEY); } catch { /* private mode */ }
    // "Play as Chog #n" from the gallery: the token comes along (the server checks we hold it).
    const token = pref === 'chog' ? loadChogTokenPref() : null;
    if (!isCharacterId(pref) || !characterAvailable(pref)) return;
    if (pref === mySeat.character && (token ?? undefined) === mySeat.chogToken) return;
    const clash = (s: RoomSeat) => s.character === pref && s.id !== me && (s.chogToken ?? 0) === (token ?? 0);
    if ((token || !characterShared(pref)) && room.seats.some(clash)) return;
    call('room:seat', { character: pref, ...(token ? { chogToken: token } : {}) }).catch(() => {});
  }, [mySeat, room.code, room.seats, me]);

  // The outfit last worn (or dressed up on /characters): put on once per room,
  // as worn by the character we are about to play (the effect above may switch it first).
  const dressed = useRef<string | null>(null);
  useEffect(() => {
    if (!mySeat || dressed.current === room.code) return;
    dressed.current = room.code;
    let prefChar: string | null = null;
    try { prefChar = localStorage.getItem(CHARACTER_PREF_KEY); } catch { /* private mode */ }
    const free = isCharacterId(prefChar) && characterAvailable(prefChar)
      && (characterShared(prefChar) || !room.seats.some(s => s.character === prefChar && s.id !== me));
    const pref = loadOutfitPref(free ? prefChar as CharacterId : mySeat.character);
    if (!sameOutfit(pref, mySeat.outfit)) call('room:seat', { outfit: pref }).catch(() => {});
  }, [mySeat, room.code, room.seats, me]);
  // The colour picked in the welcome tour (or last picked in a lobby): once per room, when nobody wears it.
  const tinted = useRef<string | null>(null);
  useEffect(() => {
    if (!mySeat || tinted.current === room.code) return;
    tinted.current = room.code;
    const pref = loadColorPref();
    if (!pref || pref === mySeat.color || !PLAYER_COLORS.includes(pref) || room.seats.some(s => s.color === pref && s.id !== me)) return;
    call('room:seat', { color: pref }).catch(() => {});
  }, [mySeat, room.code, room.seats, me]);
  const wear = (o: Outfit) => {
    if (mySeat) saveOutfitPref(o, mySeat.character);
    call('room:seat', { outfit: o }).catch(toastError);
  };

  /** Host: fill the table with bots up to four seats, then start. */
  const quickStart = async () => {
    const want = Math.min(4, room.rules.maxPlayers);
    const bots = Math.max(0, want - room.seats.length);
    const ok = await askConfirm({
      icon: '🚀', title: 'Quick start?',
      body: bots > 0
        ? `${bots} bot${bots === 1 ? '' : 's'} will join to make ${want} players, then the game starts right away.`
        : 'The game starts right away with the players seated now.',
      confirm: 'Start now',
    });
    if (!ok) return;
    setStarting(true);
    try {
      for (let i = 0; i < bots; i++) await call('room:addBot');
      await call('room:start');
    } catch (e) {
      toastError(e);
    } finally {
      setStarting(false);
    }
  };
  const leave = async () => { await call('room:leave').catch(() => {}); nav(GAMES.monopoly.path); };
  const makeHost = async (id: string, name: string) => {
    const mine = room.hostId === me;
    if (mine && !(await askConfirm({ title: `Make ${name} the host?`, body: 'You will no longer control the room.', confirm: 'Make host' }))) return;
    // RoomPage's host notice announces the change to everyone, us included.
    call('room:host', { id }).catch(toastError);
  };

  if (!isHost) return <MemberLobby room={room} me={me} spectating={spectating} chat={chat} onLeave={leave} onWear={wear} />;

  return (
    <div className={`lobby ${theme.ui ? 'branded' : ''}`} style={themeStyle(theme)}>
      <div className="lobby-bg"><BoardScene themeId={room.themeId} mapId={room.mapId} game={null} spin tableStyle={room.style} /></div>
      <div className="lobby-panels">
        <section className="panel">
          <div className="row between">
            <h2 className="row">{theme.logoUrl && <img className="brand-mark" src={theme.logoUrl} alt="" />}Room <span className="mono accent">{room.code}</span></h2>
            <div className="row lobby-audio"><MusicPlayer /><button className="btn small danger" onClick={leave} aria-label="Leave the room">Leave</button></div>
          </div>
          <div className="row">
            <input readOnly value={link} onFocus={e => e.target.select()} />
            <button className="btn small ghost" onClick={() => { void navigator.clipboard?.writeText(link); toast('Invite link copied!'); }}>Copy link</button>
          </div>
          {spectating && profile && <p className="muted small">{room.seats.length >= room.rules.maxPlayers ? 'The room is full — you are watching.' : 'You are watching.'}</p>}

          <h3>Players {room.seats.length}/{room.rules.maxPlayers}{room.spectators > 0 && <span className="muted small"> · {room.spectators} watching</span>}</h3>
          <SeatList room={room} me={me} isHost={isHost} onMakeHost={makeHost} />
          {isHost && room.seats.length < room.rules.maxPlayers && canBots && (
            <button className="btn small" onClick={() => call('room:addBot').catch(toastError)}>+ Add bot</button>
          )}
          <RequirementsPicker room={room} canEdit={isHost} />

          {mySeat && (
            <>
              <h3>Your character</h3>
              <CharacterPicker room={room} me={me} seat={mySeat} onWear={wear} />
            </>
          )}

          <div className="lobby-howto"><HowToPlayButton rules={room.rules} mapId={room.mapId} /></div>
          <div className="start-row">
            <button className="btn primary big" disabled={room.seats.length < 2 || starting} onClick={() => call('room:start').catch(toastError)}>
              {room.seats.length < 2 ? 'Need 2+ players' : 'Start Game!'}
            </button>
            {canBots && room.seats.length < Math.max(2, Math.min(4, room.rules.maxPlayers)) && (
              <button className="btn gold quick-start" disabled={starting} onClick={quickStart}
                title="Fill the table with bots up to 4 players and start">
                🚀 Quick start <small>bots fill to {Math.min(4, room.rules.maxPlayers)} players</small>
              </button>
            )}
          </div>
        </section>

        <section className="panel">
          <BoardPicker room={room} isHost={isHost} configure={configure} />

          <h3 className="bp-step"><span className="bp-num" aria-hidden>{LOOK_STEP ? 3 : 2}</span>Table <small className="muted">optional</small></h3>
          <TableStylePicker style={room.style} canEdit={isHost} />

          <div className="rules-head">
            <h3 id="rules-heading">House rules</h3>
            <button className="btn tiny ghost" aria-expanded={rulesOpen} aria-controls="rules-body" onClick={() => setRulesOpen(o => !o)}>
              {rulesOpen ? 'Hide' : isHost ? 'Edit' : 'Show all'}
            </button>
          </div>
          <p className="rules-summary small">{rulesSummary(room.rules)} · {theme.currency}{room.rules.startingCash.toLocaleString()} to start · up to {room.rules.maxPlayers} players{room.private ? ' · private' : ''}</p>
          <div className="rules" id="rules-body" hidden={!rulesOpen} aria-labelledby="rules-heading">
            <label className="rule">
              <span>Starting cash</span>
              <DraftNumber step={100} min={100} disabled={!isHost} value={room.rules.startingCash}
                onCommit={n => configure({ rules: { startingCash: n } })} />
            </label>
            <label className="rule">
              <span>Max players</span>
              <select disabled={!isHost} value={room.rules.maxPlayers}
                onChange={e => configure({ rules: { maxPlayers: Number(e.target.value) } })}>
                {[2, 3, 4, 5, 6, 7, 8].map(n => <option key={n}>{n}</option>)}
              </select>
            </label>
            <label className="rule" title="Time for each step of a turn; on timeout the safe move is made (never buying). Three times in a row and auto-play takes over.">
              <span>Turn timer</span>
              <select disabled={!isHost} value={room.rules.turnSeconds}
                onChange={e => configure({ rules: { turnSeconds: Number(e.target.value) } })}>
                {withCurrent(TURN_SECONDS_CHOICES, room.rules.turnSeconds).map(n => <option key={n} value={n}>{n ? `${n} s` : 'Off'}</option>)}
              </select>
            </label>
            <label className="rule" title="When time runs out the current turn finishes and the richest player wins">
              <span>Game length</span>
              <select disabled={!isHost} value={room.rules.timeLimitMin}
                onChange={e => configure({ rules: { timeLimitMin: Number(e.target.value) } })}>
                {withCurrent(TIME_LIMIT_CHOICES, room.rules.timeLimitMin).map(n => <option key={n} value={n}>{n ? `${n} min` : 'No limit'}</option>)}
              </select>
            </label>
            {TOGGLES.filter(([k]) => config.features.minigames || (k !== 'minigames' && k !== 'arcadeParking')).map(([k, label, hint]) => (
              <label key={k} className="rule toggle" title={hint}>
                <input type="checkbox" disabled={!isHost} checked={!!room.rules[k]}
                  onChange={e => configure({ rules: { [k]: e.target.checked } })} />
                <span>{label}<small className="muted"> — {hint}</small></span>
              </label>
            ))}
            <label className="rule toggle" title="Hide from the public room list">
              <input type="checkbox" disabled={!isHost} checked={room.private} onChange={e => configure({ private: e.target.checked })} />
              <span>Private room<small className="muted"> — join by invite link only</small></span>
            </label>
          </div>
          <p className="muted small">{map.name}: {map.spaces.length} spaces.</p>
        </section>

        {config.features.chat && (
          <section className="panel chat-panel">
            <h3>Chat</h3>
            <Chat chat={chat} />
          </section>
        )}
      </div>
    </div>
  );
}
