import { useNavigate } from 'react-router-dom';
import { call, type ChatMsg } from '../net.ts';
import { THEMES, getTheme, type RuleConfig } from '../../../shared/themes.ts';
import { MAPS, getMap } from '../../../shared/maps.ts';
import { PLAYER_COLORS, TOKENS, type RoomView } from '../../../shared/types.ts';
import { TOKEN_EMOJI, TOKEN_LABEL } from '../format.ts';
import { toast, toastError } from '../toast.tsx';
import { useAuth } from '../auth.tsx';
import Chat from './Chat.tsx';
import MusicPlayer from './MusicPlayer.tsx';
import { Avatar } from './Avatar.tsx';
import BoardScene from '../three/BoardScene.tsx';
import { themeStyle } from '../themeStyle.ts';

const TOGGLES: [keyof RuleConfig, string, string][] = [
  ['auctions', 'Auctions', 'Unbought property goes to auction'],
  ['evenBuild', 'Even building', 'Build houses evenly across a set'],
  ['limitedBuildings', 'Limited houses', 'Bank has 32 houses / 12 hotels'],
  ['freeParkingPot', 'Free Parking jackpot', 'Taxes & fines pile up on Free Parking'],
  ['doubleOnGo', 'Double on GO', 'Landing exactly on GO pays double'],
];

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

  const configure = (p: { themeId?: string; mapId?: string; rules?: Partial<RuleConfig>; private?: boolean }) =>
    call('room:configure', p).catch(toastError);
  const leave = async () => { await call('room:leave').catch(() => {}); nav('/'); };

  return (
    <div className={`lobby ${theme.ui ? 'branded' : ''}`} style={themeStyle(theme)}>
      <div className="lobby-bg"><BoardScene themeId={room.themeId} mapId={room.mapId} game={null} spin /></div>
      <div className="lobby-panels">
        <section className="panel">
          <div className="row between">
            <h2 className="row">{theme.logoUrl && <img className="brand-mark" src={theme.logoUrl} alt="" />}Room <span className="mono accent">{room.code}</span></h2>
            <div className="row lobby-audio"><MusicPlayer /><button className="btn small ghost" onClick={leave}>Leave</button></div>
          </div>
          <div className="row">
            <input readOnly value={link} onFocus={e => e.target.select()} />
            <button className="btn small" onClick={() => { void navigator.clipboard?.writeText(link); toast('Invite link copied'); }}>Copy</button>
          </div>
          {spectating && profile && <p className="muted small">The room is full — you are watching.</p>}

          <h3>Players {room.seats.length}/{room.rules.maxPlayers}{room.spectators > 0 && <span className="muted small"> · {room.spectators} watching</span>}</h3>
          <ul className="seats">
            {room.seats.map(s => (
              <li key={s.id} style={{ borderColor: s.color }}>
                <span className="token-badge" style={{ background: s.color }}>{TOKEN_EMOJI[s.token]}</span>
                <Avatar src={s.avatar} size={24} />
                <span className="grow">
                  {s.name} {s.id === room.hostId && <em className="tag">host</em>} {s.isBot && <em className="tag">bot</em>}
                  {!s.connected && <em className="tag warn">away</em>}
                </span>
                {isHost && s.id !== me && (
                  <button className="btn tiny ghost" title="Remove" onClick={() => call('room:kick', { id: s.id }).catch(toastError)}>✕</button>
                )}
              </li>
            ))}
          </ul>
          {isHost && room.seats.length < room.rules.maxPlayers && (config.features.bots || profile?.isAdmin) && (
            <button className="btn small" onClick={() => call('room:addBot').catch(toastError)}>+ Add bot</button>
          )}

          {mySeat && (
            <>
              <h3>Your piece</h3>
              <div className="token-grid">
                {TOKENS.map(t => {
                  const taken = room.seats.some(s => s.token === t && s.id !== me);
                  return (
                    <button key={t} title={TOKEN_LABEL[t]} disabled={taken}
                      className={`token-pick ${mySeat.token === t ? 'on' : ''}`}
                      onClick={() => call('room:seat', { token: t }).catch(toastError)}>
                      {TOKEN_EMOJI[t]}
                    </button>
                  );
                })}
              </div>
              <div className="color-grid">
                {PLAYER_COLORS.map(c => {
                  const taken = room.seats.some(s => s.color === c && s.id !== me);
                  return (
                    <button key={c} disabled={taken} aria-label={`Colour ${c}`}
                      className={`color-pick ${mySeat.color === c ? 'on' : ''}`} style={{ background: c }}
                      onClick={() => call('room:seat', { color: c }).catch(toastError)} />
                  );
                })}
              </div>
            </>
          )}

          {isHost ? (
            <button className="btn primary big" disabled={room.seats.length < 2} onClick={() => call('room:start').catch(toastError)}>
              {room.seats.length < 2 ? 'Need 2+ players' : 'Start game'}
            </button>
          ) : (
            <p className="muted">Waiting for the host to start…</p>
          )}
        </section>

        <section className="panel">
          <h3>Map</h3>
          <div className="edition-pick">
            {MAPS.map(m => (
              <button key={m.id} disabled={!isHost} className={`edition small map-card ${m.id === room.mapId ? 'on' : ''}`}
                onClick={() => configure({ mapId: m.id })}>
                <b>{m.name}</b>
                <span className="small muted">{m.description}</span>
                <span className="small">{m.spaces.length} spaces · best with {m.players[0]}–{m.players[1]}</span>
              </button>
            ))}
          </div>

          <h3>Edition</h3>
          <div className="edition-pick">
            {THEMES.map(t => (
              <button key={t.id} disabled={!isHost}
                className={`edition small ${t.id === room.themeId ? 'on' : ''}`}
                style={{ background: t.palette.board, color: t.palette.boardText, borderColor: t.id === room.themeId ? t.palette.accent : t.palette.boardLine }}
                onClick={() => configure({ themeId: t.id })}>
                {t.logoUrl && <img className="edition-logo" src={t.logoUrl} alt="" />}
                <b>{t.name}</b>
                <span className="small">{t.tagline}</span>
              </button>
            ))}
          </div>

          <h3>House rules</h3>
          <div className="rules">
            <label className="rule">
              <span>Starting cash</span>
              <input type="number" step={100} min={100} disabled={!isHost} value={room.rules.startingCash}
                onChange={e => configure({ rules: { startingCash: Number(e.target.value) } })} />
            </label>
            <label className="rule">
              <span>Max players</span>
              <select disabled={!isHost} value={room.rules.maxPlayers}
                onChange={e => configure({ rules: { maxPlayers: Number(e.target.value) } })}>
                {[2, 3, 4, 5, 6, 7, 8].map(n => <option key={n}>{n}</option>)}
              </select>
            </label>
            {TOGGLES.map(([k, label, hint]) => (
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
