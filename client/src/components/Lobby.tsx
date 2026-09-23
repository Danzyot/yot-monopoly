import { useNavigate } from 'react-router-dom';
import { call, type ChatMsg } from '../net.ts';
import { THEMES, getTheme, type RuleConfig } from '../../../shared/themes.ts';
import { TOKENS, type RoomView } from '../../../shared/types.ts';
import { TOKEN_EMOJI, TOKEN_LABEL } from '../format.ts';
import { toast, toastError } from '../toast.tsx';
import Chat from './Chat.tsx';
import BoardScene from '../three/BoardScene.tsx';

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
  const isHost = room.hostId === me;
  const theme = getTheme(room.themeId);
  const mySeat = room.seats.find(s => s.id === me);
  const link = `${location.origin}/r/${room.code}`;

  const configure = (p: { themeId?: string; rules?: Partial<RuleConfig> }) => call('room:configure', p).catch(toastError);
  const leave = async () => { await call('room:leave').catch(() => {}); nav('/'); };

  return (
    <div className="lobby" style={{ ['--accent' as string]: theme.palette.accent }}>
      <div className="lobby-bg"><BoardScene themeId={room.themeId} game={null} spin /></div>
      <div className="lobby-panels">
        <section className="panel">
          <div className="row between">
            <h2>Room <span className="mono accent">{room.code}</span></h2>
            <button className="btn small ghost" onClick={leave}>Leave</button>
          </div>
          <div className="row">
            <input readOnly value={link} onFocus={e => e.target.select()} />
            <button className="btn small" onClick={() => { navigator.clipboard?.writeText(link); toast('Invite link copied'); }}>Copy</button>
          </div>
          {spectating && <p className="muted small">The room is full — you are watching.</p>}

          <h3>Players {room.seats.length}/{room.rules.maxPlayers}</h3>
          <ul className="seats">
            {room.seats.map(s => (
              <li key={s.id} style={{ borderColor: s.color }}>
                <span className="token-badge" style={{ background: s.color }}>{TOKEN_EMOJI[s.token]}</span>
                <span className="grow">
                  {s.name} {s.id === room.hostId && <em className="tag">host</em>} {s.isBot && <em className="tag">bot</em>}
                  {!s.connected && <em className="tag warn">away</em>}
                </span>
                {isHost && s.id !== me && (
                  <button className="btn tiny ghost" onClick={() => call('room:kick', { id: s.id }).catch(toastError)}>✕</button>
                )}
              </li>
            ))}
          </ul>
          {isHost && room.seats.length < room.rules.maxPlayers && (
            <button className="btn small" onClick={() => call('room:addBot').catch(toastError)}>+ Add bot</button>
          )}

          {mySeat && (
            <>
              <h3>Your token</h3>
              <div className="token-grid">
                {TOKENS.map(t => {
                  const taken = room.seats.some(s => s.token === t && s.id !== me);
                  return (
                    <button key={t} title={TOKEN_LABEL[t]} disabled={taken}
                      className={`token-pick ${mySeat.token === t ? 'on' : ''}`}
                      onClick={() => call('room:token', { token: t }).catch(toastError)}>
                      {TOKEN_EMOJI[t]}
                    </button>
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
          <h3>Edition</h3>
          <div className="edition-pick">
            {THEMES.map(t => (
              <button key={t.id} disabled={!isHost}
                className={`edition small ${t.id === room.themeId ? 'on' : ''}`}
                style={{ background: t.palette.board, color: t.palette.boardText, borderColor: t.id === room.themeId ? t.palette.accent : t.palette.boardLine }}
                onClick={() => configure({ themeId: t.id })}>
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
          </div>
        </section>

        <section className="panel chat-panel">
          <h3>Chat</h3>
          <Chat chat={chat} />
        </section>
      </div>
    </div>
  );
}
