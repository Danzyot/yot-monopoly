import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { useNavigate } from 'react-router-dom';
import { call, type ChatMsg } from '../net.ts';
import { THEMES, TIME_LIMIT_CHOICES, TURN_SECONDS_CHOICES, getTheme, type RuleConfig } from '../../../shared/themes.ts';
import { MAPS, getMap } from '../../../shared/maps.ts';
import { PLAYER_COLORS, type RoomView } from '../../../shared/types.ts';
import { CHARACTER_DEFS, getCharacter, isCharacterId } from '../../../shared/characters.ts';
import { characterEmoji } from '../format.ts';
import { toast, toastError } from '../toast.tsx';
import { useAuth } from '../auth.tsx';
import Chat from './Chat.tsx';
import MusicPlayer from './MusicPlayer.tsx';
import { Avatar } from './Avatar.tsx';
import BoardScene from '../three/BoardScene.tsx';
import TableStylePicker from './TableStylePicker.tsx';
import CharacterPreview from '../three/characters/CharacterPreview.tsx';
import { themeStyle } from '../themeStyle.ts';
import RequirementsPicker from './RequirementsPicker.tsx';
import { ProfileLink } from '../community.tsx';
import { askConfirm } from './Modal.tsx';
import { HowToPlayButton } from './HowToPlay.tsx';

const TOGGLES: [keyof RuleConfig, string, string][] = [
  ['auctions', 'Auctions', 'Unbought property goes to auction'],
  ['evenBuild', 'Even building', 'Build houses evenly across a set'],
  ['limitedBuildings', 'Limited houses', 'Bank has 32 houses / 12 hotels'],
  ['freeParkingPot', 'Free Parking jackpot', 'Taxes & fines pile up on Free Parking'],
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

/** A select's options, keeping a value set some other way (e.g. an edition) visible. */
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

  // The character picked on /characters ("Play as …"): applied once, the first
  // time we hold a seat in this room, and only while nobody else has it.
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (!mySeat || applied.current === room.code) return;
    applied.current = room.code;
    let pref: string | null = null;
    try { pref = localStorage.getItem(CHARACTER_PREF_KEY); } catch { /* private mode */ }
    if (!isCharacterId(pref) || pref === mySeat.character) return;
    if (room.seats.some(s => s.character === pref && s.id !== me)) return;
    call('room:seat', { character: pref }).catch(() => {});
  }, [mySeat, room.code, room.seats, me]);

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
  const leave = async () => { await call('room:leave').catch(() => {}); nav('/'); };
  const makeHost = async (id: string, name: string) => {
    const mine = room.hostId === me;
    if (mine && !(await askConfirm({ title: `Make ${name} the host?`, body: 'You will no longer control the room.', confirm: 'Make host' }))) return;
    // RoomPage's host notice announces the change to everyone, us included.
    call('room:host', { id }).catch(toastError);
  };

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
            <button className="btn small" onClick={() => { void navigator.clipboard?.writeText(link); toast('Invite link copied!'); }}>Copy link</button>
          </div>
          {spectating && profile && <p className="muted small">{room.seats.length >= room.rules.maxPlayers ? 'The room is full — you are watching.' : 'You are watching.'}</p>}

          <h3>Players {room.seats.length}/{room.rules.maxPlayers}{room.spectators > 0 && <span className="muted small"> · {room.spectators} watching</span>}</h3>
          <ul className="seats">
            {room.seats.map(s => (
              <li key={s.id} style={{ borderColor: s.color }}>
                {/* Character first (it is what they play as); their own avatar rides on its corner. */}
                <span className="seat-ids">
                  <span className="token-badge" style={{ background: s.color }} role="img" aria-label={`${getCharacter(s.character).name}, ${s.color}`}>{characterEmoji(s.character)}</span>
                  {!s.isBot && <span className="seat-avatar"><Avatar src={s.avatar} size={16} /></span>}
                </span>
                <span className="grow">
                  <span className="seat-name"><ProfileLink id={s.id} isBot={s.isBot} newTab>{s.name}</ProfileLink> {s.id === me && <em className="tag you">you</em>}{s.id === room.hostId && <em className="tag">host</em>} {s.isBot && <em className="tag">bot</em>}
                  {!s.connected && <em className="tag warn">away</em>}</span>
                  <span className="seat-char small"><i className="seat-swatch" style={{ background: s.color }} aria-hidden /> {getCharacter(s.character).name}</span>
                </span>
                {isHost && !s.isBot && s.connected && s.id !== room.hostId && (
                  <button className="btn tiny ghost" title={`Make ${s.name} the host`} onClick={() => makeHost(s.id, s.name)}>Make host</button>
                )}
                {isHost && s.id !== me && (
                  <button className="btn tiny ghost" title={`Remove ${s.name}`} aria-label={`Remove ${s.name}`} onClick={() => call('room:kick', { id: s.id }).catch(toastError)}>✕</button>
                )}
              </li>
            ))}
          </ul>
          {isHost && room.seats.length < room.rules.maxPlayers && canBots && (
            <button className="btn small" onClick={() => call('room:addBot').catch(toastError)}>+ Add bot</button>
          )}
          <RequirementsPicker room={room} canEdit={isHost} />

          {mySeat && (
            <>
              <h3>Your character</h3>
              <div className="char-picker">
                <div className="char-preview">
                  <CharacterPreview character={mySeat.character} color={mySeat.color} />
                  <div className="char-about">
                    <b>{getCharacter(mySeat.character).name}</b>
                    <span className="small muted">{getCharacter(mySeat.character).blurb}</span>
                  </div>
                </div>
                <div className="char-grid">
                  {CHARACTER_DEFS.map(c => {
                    const holder = room.seats.find(s => s.character === c.id && s.id !== me);
                    return (
                      <button key={c.id} disabled={!!holder} aria-pressed={mySeat.character === c.id}
                        title={holder ? `${c.name} — taken by ${holder.name}` : `${c.name} — ${c.blurb}`}
                        aria-label={holder ? `${c.name}, taken by ${holder.name}` : c.name}
                        className={`char-pick ${mySeat.character === c.id ? 'on' : ''}`}
                        onClick={() => call('room:seat', { character: c.id }).catch(toastError)}>
                        <span className="char-emoji">{c.emoji}</span>
                        <span className="char-name">{c.name}</span>
                        {holder && <span className="char-taken" style={{ background: holder.color }} />}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="color-grid" role="group" aria-label="Your colour">
                {PLAYER_COLORS.map(c => {
                  const taken = room.seats.some(s => s.color === c && s.id !== me);
                  return (
                    <button key={c} disabled={taken} aria-label={`Colour ${c}${taken ? ' (taken)' : ''}`} aria-pressed={mySeat.color === c}
                      className={`color-pick ${mySeat.color === c ? 'on' : ''}`} style={{ background: c }}
                      onClick={() => call('room:seat', { color: c }).catch(toastError)} />
                  );
                })}
              </div>
            </>
          )}

          <div className="lobby-howto"><HowToPlayButton rules={room.rules} /></div>
          {isHost ? (
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
          ) : (
            <p className="muted waiting-host">Waiting for the host to hit Start…</p>
          )}
        </section>

        <section className="panel">
          <h3>Board</h3>
          <p className="pick-hint muted small">The map: how many spaces there are and the 3D setting around the table.{!isHost && ' Only the host can change it.'}</p>
          <div className="edition-pick" role="group" aria-label="Board">
            {MAPS.map(m => (
              <button key={m.id} disabled={!isHost} className={`edition small map-card ${m.id === room.mapId ? 'on' : ''}`}
                aria-pressed={m.id === room.mapId} onClick={() => configure({ mapId: m.id })}>
                {m.id === room.mapId && <span className="pick-selected">✓ Selected</span>}
                <img className="map-thumb" src={`/maps/${m.id}.webp`} alt="" loading="lazy" />
                <b>{m.name}</b>
                <span className="small muted">{m.description}</span>
                <span className="small">{m.spaces.length} spaces · best with {m.players[0]}–{m.players[1]}</span>
              </button>
            ))}
          </div>

          <h3>Edition</h3>
          <p className="pick-hint muted small">The skin: property names, colours, money and cards. Some editions bring their own house rules.{!isHost && ' Only the host can change it.'}</p>
          <div className="edition-pick" role="group" aria-label="Edition">
            {THEMES.map(t => (
              <button key={t.id} disabled={!isHost}
                className={`edition small ${t.id === room.themeId ? 'on' : ''}`} aria-pressed={t.id === room.themeId}
                style={{ background: t.palette.board, color: t.palette.boardText, borderColor: t.id === room.themeId ? t.palette.accent : t.palette.boardLine }}
                onClick={() => configure({ themeId: t.id })}>
                {t.id === room.themeId && <span className="pick-selected">✓ Selected</span>}
                <span className="row">
                  {t.logoUrl && <img className="edition-logo" src={t.logoUrl} alt="" />}
                  <b>{t.name}</b>
                </span>
                <span className="swatches" aria-hidden>
                  {Object.values(t.groupColors).slice(0, 8).map((c, i) => <i key={`${c}${i}`} style={{ background: c }} />)}
                </span>
                <span className="small">{t.tagline}</span>
              </button>
            ))}
          </div>

          <h3>Table style</h3>
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
            <label className="rule" title="Time for each step of a turn; on timeout the safe move is made (never buying). Twice in a row and autopilot takes over.">
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
