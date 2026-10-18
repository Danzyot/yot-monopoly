// Broadcast mode (/r/CODE?tv=1): the table as a TV picture. A full-bleed 3D
// scene with the Auto camera and cinematic shots, and a broadcast overlay on
// top — a slim top bar, a lower third for whoever is playing, standings down
// the right, a ticker of the log along the bottom, the drawn card centre
// stage and big stingers for doubles, jail, bankruptcies and the winner. It
// never offers a button that plays the game: it is for a screen on the wall
// or a stream overlay, and a seated viewer plays in another tab.
//
// Keys: H hides the overlay, C cycles the camera, F goes fullscreen, M mutes.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { resolveTheme, type Theme } from '../../../shared/themes.ts';
import { getMap } from '../../../shared/maps.ts';
import { MINIGAME_INFO } from '../../../shared/minigames.ts';
import type { GameView, RoomView } from '../../../shared/types.ts';
import { useConnected } from '../net.ts';
import { characterEmoji } from '../format.ts';
import { themeStyle } from '../themeStyle.ts';
import { Avatar } from './Avatar.tsx';
import BoardScene from '../three/BoardScene.tsx';
import { useGameSounds } from '../useGameSounds.ts';
import { useAmbience } from '../ambience.ts';
import { CARD_FLIGHT_MS, useSceneBusy } from '../three/sequence.ts';
import { RollResult, useDiceShown } from './RollResult.tsx';
import { CAMERA_MODES, type CameraMode } from '../three/camera.ts';
import { setSfxMuted, sfxState } from '../sound.ts';
import { setMuted as setMusicMuted } from '../music.ts';
import { ownedBy } from '../gameHelpers.ts';

export default function BroadcastScreen({ room, me }: { room: RoomView; me: string }) {
  const game = room.game;
  const theme = resolveTheme(game?.themeId ?? room.themeId, game?.mapId ?? room.mapId);
  const tptv = theme.id === 'tptv';
  const [overlay, setOverlay] = useState(true);
  const [muted, setMutedState] = useState(() => sfxState().muted);
  // Always opens on Auto (the saved in-game preference is the player's, not the TV's); C cycles, unsaved.
  const [cameraMode, setCameraMode] = useState<CameraMode>('auto');
  /** Set (to anything new) when C is pressed; shows the camera's name for a moment. */
  const [camToast, setCamToast] = useState<string | null>(null);
  const connected = useConnected();
  useGameSounds(game, me);
  useAmbience(game);

  useEffect(() => {
    document.title = `📺 ${room.code} · ${theme.name}`;
  }, [room.code, theme.name]);

  // Mute covers both buses; the choice is remembered like the in-game toggle.
  const toggleMute = () => {
    setMutedState(m => {
      setSfxMuted(!m);
      setMusicMuted(!m);
      return !m;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'h') setOverlay(v => !v);
      else if (k === 'c') {
        setCameraMode(m => CAMERA_MODES[(CAMERA_MODES.findIndex(x => x.id === m) + 1) % CAMERA_MODES.length].id);
        setCamToast(String(Date.now()));
      } else if (k === 'f') {
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
        else document.documentElement.requestFullscreen?.().catch(() => {});
      } else if (k === 'm') toggleMute();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // A brief label naming the camera just chosen.
  useEffect(() => {
    if (camToast === null) return;
    const t = setTimeout(() => setCamToast(null), 1600);
    return () => clearTimeout(t);
  }, [camToast, cameraMode]);
  const camInfo = CAMERA_MODES.find(m => m.id === cameraMode)!;

  const seated = !!me && room.seats.some(s => s.id === me);
  const over = !!game?.winner || room.status === 'finished';

  return (
    <div className={`game bc ${theme.ui ? 'branded' : ''} ${tptv ? 'bc-tptv' : ''} ${overlay ? '' : 'bc-clean'}`} style={themeStyle(theme)}>
      <div className="scene">
        <BoardScene themeId={theme.id} mapId={theme.mapId} game={game} tableStyle={room.style} me={me}
          spin={!game} cinematic cameraMode={cameraMode} quality="high" />
      </div>

      <div className={`bc-overlay ${overlay ? '' : 'hidden'}`} aria-hidden={!overlay}>
        <header className="bc-top">
          <div className="bc-brand">
            {theme.logoUrl ? <img className="bc-logo" src={theme.logoUrl} alt="" /> : <span className="bc-hat" aria-hidden>🎩</span>}
            <b className="bc-name">{theme.name}</b>
            {tptv && <span className="bc-onair"><i /> ON AIR</span>}
            {!tptv && <span className="bc-live"><i /> LIVE</span>}
          </div>
          <div className="bc-top-mid">
            <span className="bc-code mono">{room.code}</span>
            {game && <span className="bc-turn">Turn {game.turnNumber}</span>}
            {game && getMap(game.mapId).name !== theme.name && <span className="bc-map">{getMap(game.mapId).name}</span>}
          </div>
          <div className="bc-top-right">
            {!connected && <span className="bc-tag warn">reconnecting…</span>}
            {seated && !over && <span className="bc-tag">You're seated — open the game in another tab to play</span>}
            {room.spectators > 0 && <span className="bc-tag" title="Spectators">👀 {room.spectators}</span>}
            {muted && <span className="bc-tag" title="Muted (M)">🔇</span>}
          </div>
        </header>

        {game ? <>
          <Standings game={game} theme={theme} />
          <LowerThird game={game} room={room} theme={theme} />
          <Ticker game={game} />
          <StateBadge game={game} theme={theme} />
          <BroadcastCard game={game} theme={theme} />
          <Stingers game={game} />
          <RollResult game={game} target=".bc-lower" />
        </> : (
          <WaitingThird room={room} theme={theme} />
        )}

        {camToast !== null && <div className="bc-camtoast" role="status">{camInfo.icon} {camInfo.label} camera</div>}
        <div className="bc-keys" aria-hidden>H overlay · C camera · F fullscreen · M mute</div>
      </div>
    </div>
  );
}

/** The lobby, on air: the spinning table and a strip of who is seated. */
function WaitingThird({ room, theme }: { room: RoomView; theme: Theme }) {
  return (
    <div className="bc-lower bc-waiting" key="waiting">
      <div className="bc-lt-main">
        <span className="bc-lt-kicker">{room.status === 'finished' ? 'Game over' : 'Coming up'}</span>
        <b className="bc-lt-name">{room.status === 'finished' ? 'Thanks for watching' : 'Waiting for the game to start'}</b>
        <span className="bc-lt-sub">{theme.tagline}</span>
      </div>
      <div className="bc-lt-seats">
        {room.seats.map(s => (
          <span key={s.id} className="bc-seat" style={{ borderColor: s.color }}>
            <span className="bc-seat-tok" style={{ background: s.color }}>{characterEmoji(s.character)}</span>{s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** What the current player is up to, in a phrase. */
function doing(game: GameView, theme: Theme): string {
  const p = game.players.find(x => x.id === game.current);
  if (!p) return '';
  if (game.winner) return 'wins the game!';
  if (game.paused) return 'paused';
  if (p.bankrupt) return 'is out';
  if (game.phase === 'auction') return 'is at auction';
  if (game.phase === 'minigame') return `is in the arcade`;
  if (game.phase === 'choose') return 'is picking a move';
  if (game.phase === 'buy') return `is eyeing ${theme.spaces[p.position]?.name ?? 'a property'}`;
  if (game.phase === 'done') return game.debts.some(d => d.from === p.id) ? 'is raising cash' : 'is wheeling and dealing';
  if (p.inJail) return `is in jail · try ${p.jailTurns + 1} of 3`;
  if (game.doublesCount > 0) return 'rolled doubles — rolling again';
  return 'is rolling';
}

/** The lower third: the player whose turn it is, sliding in whenever the turn changes. */
function LowerThird({ game, room, theme }: { game: GameView; room: RoomView; theme: Theme }) {
  const id = game.winner ?? game.current;
  const p = game.players.find(x => x.id === id);
  // This turn's roll only, once the score has popped up and flown down here.
  const diceShown = useDiceShown(game);
  if (!p) return null;
  const seat = room.seats.find(s => s.id === p.id);
  const deeds = ownedBy(game, p.id).length;
  const worth = game.netWorth?.[p.id];
  const dice = diceShown && !game.winner ? game.dice : null;
  // Keyed on the turn, so the panel re-mounts (and slides in) with every new turn.
  return (
    <div className={`bc-lower ${game.winner ? 'winner' : ''}`} key={`${game.turnNumber}:${id}`} style={{ '--pc': p.color } as React.CSSProperties}>
      <div className="bc-lt-avatar" style={{ background: p.color }}>
        {seat?.avatar && /^https:/.test(seat.avatar)
          ? <Avatar src={seat.avatar} size={56} />
          : <span className="bc-lt-emoji">{characterEmoji(p.character)}</span>}
      </div>
      <div className="bc-lt-main">
        <span className="bc-lt-kicker">{game.winner ? '🏆 Champion' : game.phase === 'over' ? 'Final turn' : 'Now playing'}{p.isBot ? ' · bot' : ''}</span>
        <b className="bc-lt-name">{p.name}</b>
        <span className="bc-lt-sub">{doing(game, theme)}</span>
      </div>
      <div className="bc-lt-stats">
        <span className="bc-lt-cash"><i className="coin" aria-hidden>{theme.currency}</i>{p.cash.toLocaleString()}</span>
        <span className="bc-lt-meta">
          {deeds} {deeds === 1 ? 'deed' : 'deeds'}
          {worth !== undefined && <> · worth {theme.currency}{worth.toLocaleString()}</>}
          {p.jailCards.length > 0 && <> · 🎫{p.jailCards.length > 1 ? `×${p.jailCards.length}` : ''}</>}
        </span>
      </div>
      {dice && (
        <div className="bc-lt-dice" aria-label={`Rolled ${dice[0]} and ${dice[1]}`}>
          <span className={`bc-die ${dice[0] === dice[1] ? 'dbl' : ''}`}>{dice[0]}</span>
          <span className={`bc-die ${dice[0] === dice[1] ? 'dbl' : ''}`}>{dice[1]}</span>
          {game.speed !== null && game.speed !== undefined && <span className="bc-die speed">{game.speed === 'mr' ? '🎩' : game.speed === 'bus' ? '🚌' : game.speed}</span>}
        </div>
      )}
    </div>
  );
}

/** Players by net worth, reordering with a FLIP slide whenever the order changes. */
function Standings({ game, theme }: { game: GameView; theme: Theme }) {
  const sorted = useMemo(() => [...game.players].sort((a, b) => {
    if (a.bankrupt !== b.bankrupt) return a.bankrupt ? 1 : -1;
    return (game.netWorth?.[b.id] ?? b.cash) - (game.netWorth?.[a.id] ?? a.cash);
  }), [game.players, game.netWorth]);
  const order = sorted.map(p => p.id).join(',');
  const rows = useRef(new Map<string, HTMLDivElement>());
  const last = useRef(new Map<string, number>());
  // FLIP: remember where each row was, then on the next layout slide it from there.
  useLayoutEffect(() => {
    const prev = last.current;
    const next = new Map<string, number>();
    for (const [id, el] of rows.current) {
      const top = el.getBoundingClientRect().top;
      next.set(id, top);
      const was = prev.get(id);
      if (was !== undefined && Math.abs(was - top) > 1) {
        el.style.transition = 'none';
        el.style.transform = `translateY(${was - top}px)`;
        requestAnimationFrame(() => {
          el.style.transition = 'transform 0.55s cubic-bezier(.2,.9,.3,1.1)';
          el.style.transform = '';
        });
      }
    }
    last.current = next;
  }, [order]);
  return (
    <aside className="bc-standings" aria-label="Standings">
      <div className="bc-st-head">Standings</div>
      {sorted.map((p, i) => {
        const deeds = ownedBy(game, p.id).length;
        return (
          <div key={p.id} ref={el => { if (el) rows.current.set(p.id, el); else rows.current.delete(p.id); }}
            className={`bc-row ${p.id === game.current && !p.bankrupt ? 'turn' : ''} ${p.bankrupt ? 'out' : ''} ${i === 0 && !p.bankrupt ? 'lead' : ''}`}>
            <span className="bc-rank">{p.bankrupt ? '—' : i + 1}</span>
            <span className="bc-chip" style={{ background: p.color }}>{characterEmoji(p.character)}</span>
            <span className="bc-row-main">
              <span className="bc-row-name">{p.name}{p.inJail && <span title="In jail"> 🔒</span>}</span>
              <span className="bc-row-sub">{p.bankrupt ? 'bankrupt' : <>{deeds} {deeds === 1 ? 'deed' : 'deeds'}</>}</span>
            </span>
            {!p.bankrupt && <b className="bc-row-cash">{theme.currency}{p.cash.toLocaleString()}</b>}
          </div>
        );
      })}
    </aside>
  );
}

/** The last few log lines, crawling along the bottom edge. */
function Ticker({ game }: { game: GameView }) {
  const entries = game.log.slice(-8);
  if (!entries.length) return null;
  const color = (id?: string) => game.players.find(p => p.id === id)?.color ?? 'var(--line)';
  const copy = (tag: string) => entries.map((l, i) => (
    <span key={`${tag}${i}`} className="bc-tick" style={{ '--pc': color(l.who) } as React.CSSProperties}><i /> {l.text}</span>
  ));
  // Two copies, so the crawl loops without a gap; keyed on the newest line so a
  // fresh line restarts the crawl from the start.
  return (
    <div className="bc-ticker" aria-live="off">
      <span className="bc-ticker-label">Latest</span>
      <div className="bc-ticker-clip">
        <div className="bc-ticker-track" key={`${game.log.length}:${game.log.at(-1)?.t}`}>
          {copy('a')}{copy('b')}
        </div>
      </div>
    </div>
  );
}

/** A badge for the states the board alone does not explain: auction, arcade, pause, time up. */
function StateBadge({ game, theme }: { game: GameView; theme: Theme }) {
  const name = (id?: string | null) => game.players.find(p => p.id === id)?.name;
  if (game.paused) return <div className="bc-badge pause">⏸ Paused by {game.paused.by}</div>;
  if (game.phase === 'auction' && game.auction) {
    const a = game.auction;
    return (
      <div className="bc-badge auction">
        <span className="bc-badge-kicker">🔨 Auction{a.bank ? ' · bank sale' : ''}</span>
        <b>{theme.spaces[a.space]?.name}</b>
        <span>{a.highBidder ? <>{theme.currency}{a.highBid.toLocaleString()} — <em>{name(a.highBidder)}</em></> : 'No bids yet'} · {a.bidders.length} in</span>
      </div>
    );
  }
  if (game.phase === 'minigame' && game.minigame) {
    const info = MINIGAME_INFO[game.minigame.kind];
    return (
      <div className="bc-badge arcade">
        <span className="bc-badge-kicker">{info.icon} Arcade</span>
        <b>{info.title}</b>
        <span>{game.minigame.stage === 'result' ? 'Result in…' : `${name(game.minigame.host)} plays`}</span>
      </div>
    );
  }
  if (game.timeUp) return <div className="bc-badge pause">⏰ Time is up — last turn</div>;
  return null;
}

/** The drawn card, big and centred, in the in-game card's look; waits for the 3D card's flight. */
function BroadcastCard({ game, theme }: { game: GameView; theme: Theme }) {
  const card = game.lastCard;
  const firstSeq = useRef(card?.seq ?? 0);
  const [shown, setShown] = useState<number | null>(null);
  const busy = useSceneBusy();
  const pending = card && card.seq > firstSeq.current ? card.seq : null;
  useEffect(() => {
    if (pending === null || busy) return;
    const t = setTimeout(() => { firstSeq.current = pending; setShown(pending); }, CARD_FLIGHT_MS - 60);
    return () => clearTimeout(t);
  }, [pending, busy]);
  useEffect(() => {
    if (shown === null) return;
    const t = setTimeout(() => setShown(null), 6000);
    return () => clearTimeout(t);
  }, [shown]);
  if (!card || shown !== card.seq) return null;
  const who = game.players.find(p => p.id === card.player);
  return (
    <div className={`card-pop bc-card ${card.deck} ${theme.ui ? 'branded' : ''}`} role="status" aria-live="polite">
      {theme.logoUrl && <img className="card-logo" src={theme.logoUrl} alt="" />}
      <small>{theme.deckNames[card.deck].toUpperCase()}</small>
      <p>{card.text}</p>
      <span className="small muted">drawn by <b style={{ color: who?.color }}>{who?.name}</b></span>
    </div>
  );
}

type Sting = { id: number; text: string; sub?: string; tone: 'gold' | 'red' | 'blue' | 'win' };
const STING_MS = 2200;

/** Big brief titles for the moments the whole room shouts about. */
function Stingers({ game }: { game: GameView }) {
  const prev = useRef<GameView | null>(null);
  const seq = useRef(0);
  const [queue, setQueue] = useState<Sting[]>([]);
  const busy = useSceneBusy();
  // Detected on arrival; shown once the dice have settled, so the title lands with the piece.
  const waiting = useRef<Sting[]>([]);
  useEffect(() => {
    const before = prev.current;
    prev.current = game;
    if (!before || before.turnNumber > game.turnNumber) return;
    const add: Sting[] = [];
    const name = (id: string) => game.players.find(p => p.id === id)?.name ?? '';
    if (game.rollSeq > before.rollSeq && game.dice && game.dice[0] === game.dice[1]) {
      add.push({ id: ++seq.current, text: 'DOUBLES!', sub: game.doublesCount >= 3 ? `${name(game.current)} — three in a row!` : name(game.current), tone: 'gold' });
    }
    for (const p of game.players) {
      const was = before.players.find(x => x.id === p.id);
      if (!was) continue;
      if (p.inJail && !was.inJail) add.push({ id: ++seq.current, text: 'JAIL!', sub: `${p.name} is behind bars`, tone: 'blue' });
      if (p.bankrupt && !was.bankrupt) add.push({ id: ++seq.current, text: 'BANKRUPT', sub: `${p.name} is out`, tone: 'red' });
    }
    if (game.winner && !before.winner) add.push({ id: ++seq.current, text: 'WINNER!', sub: `${name(game.winner)} takes the table`, tone: 'win' });
    if (add.length) waiting.current.push(...add);
  }, [game]);
  // Release the queue once the scene is quiet; one at a time.
  useEffect(() => {
    if (busy || !waiting.current.length || queue.length) return;
    setQueue([waiting.current.shift()!]);
  }, [busy, queue, game]);
  // Each title has its moment, then makes way for the next (timed apart from
  // the effect above, which re-runs with every snapshot).
  useEffect(() => {
    const cur = queue[0];
    if (!cur) return;
    const t = setTimeout(() => setQueue([]), cur.tone === 'win' ? STING_MS * 2 : STING_MS);
    return () => clearTimeout(t);
  }, [queue]);
  if (!queue.length) return null;
  return (
    <div className="bc-sting" aria-live="assertive">
      {queue.map(s => (
        <div key={s.id} className={`bc-sting-in ${s.tone}`}>
          <span className="bc-sting-title">{s.text}</span>
          {s.sub && <span className="bc-sting-sub">{s.sub}</span>}
        </div>
      ))}
    </div>
  );
}
