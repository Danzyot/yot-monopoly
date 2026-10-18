import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveTheme } from '../../../shared/themes.ts';
import { getMap } from '../../../shared/maps.ts';
import type { GameView, RoomView } from '../../../shared/types.ts';
import { act, call, useConnected, type ChatMsg } from '../net.ts';
import { useAuth } from '../auth.tsx';
import { characterEmoji } from '../format.ts';
import { toast, toastError } from '../toast.tsx';
import { themeStyle } from '../themeStyle.ts';
import BoardScene from '../three/BoardScene.tsx';
import Chat, { QuickChatButton } from './Chat.tsx';
import Deed from './Deed.tsx';
import MusicPlayer from './MusicPlayer.tsx';
import { useGameSounds } from '../useGameSounds.ts';
import { useAmbience } from '../ambience.ts';
import { CARD_FLIGHT_MS, useSceneBusy } from '../three/sequence.ts';
import { useCinematicPref } from '../three/cinematic.ts';
import { CAMERA_MODES, useCameraMode } from '../three/camera.ts';
import PlayerMenu from './PlayerMenu.tsx';
import { TradeModal, TradeOffers, counterDraft, type CounterDraft } from './Trade.tsx';
import MinigamePanel from './MinigamePanel.tsx';
import { DebtClock, PauseButton, PausedBanner, TimeLeft, TurnClock } from './GameClock.tsx';
import { ChooseBar, DiceRead } from './SpeedChoice.tsx';
import EndScreen from './EndScreen.tsx';
import Portfolio, { PortfolioModal } from './Portfolio.tsx';
import { PokeButton, PokeNotice, ReactionPicker, SpectatorReactions, latestReaction } from './Reactions.tsx';
import { useShortcuts } from './Shortcuts.tsx';
import ManagePanel, { type ManageMode } from './ManagePanel.tsx';
import HowToPlay, { markHowToSeen } from './HowToPlay.tsx';
import { AuctionPanel, SoldBanner } from './Auction.tsx';
import EventFeed from './EventFeed.tsx';
import { CoachHint, markHint, tradePartnerFor } from './Hints.tsx';
import { askConfirm } from './Modal.tsx';
import { canBuildAnywhere, debtOf, hasFullSet, ownedBy, raisable } from '../gameHelpers.ts';
import { useSocial, useSystemLines } from '../social.ts';
import { useNotifyPref, useTurnAlerts } from '../turnAlerts.ts';
import type { ReactionMsg } from '../../../shared/types.ts';

export default function GameScreen({ room, game, me, chat, skew }: {
  room: RoomView; game: GameView; me: string; chat: ChatMsg[]; skew: number;
}) {
  const theme = resolveTheme(game.themeId, game.mapId);
  const [selected, setSelected] = useState<number | null>(null);
  const [tradeWith, setTradeWith] = useState<string | null>(null);
  const [tab, setTab] = useState<'log' | 'chat' | 'mine' | 'table'>('log');
  const [counter, setCounter] = useState<CounterDraft | null>(null);
  /** Portfolio dialog, focused on this player (undefined = closed). */
  const [portfolio, setPortfolio] = useState<string | undefined>(undefined);
  const [helpOpen, setHelpOpen] = useState(false);
  /** The build & manage panel ('raise' when short on cash), or closed. */
  const [manage, setManage] = useState<ManageMode | null>(null);
  const openManage = (m: ManageMode) => {
    setManage(m);
    markHint(m === 'raise' ? 'raise' : 'build');
  };
  const openHelp = () => { setHelpOpen(true); markHowToSeen(); markHint('welcome'); };
  /** A new offer, to whoever holds the rest of a set I've started (else the first opponent). */
  const openTrade = () => {
    const id = tradePartnerFor(game, me) ?? game.players.find(x => x.id !== me && !x.bankrupt)?.id;
    if (id) { setTradeWith(id); markHint('trade'); }
  };
  // Phones start with the side panel folded so the board stays visible.
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth > 760);
  const pickTab = (t: typeof tab) => {
    setPanelOpen(open => !(open && t === tab));
    setTab(t);
  };
  // Chat messages that arrived while the chat tab was not showing.
  const [seenChat, setSeenChat] = useState(chat.length);
  const chatVisible = panelOpen && tab === 'chat';
  useEffect(() => { if (chatVisible) setSeenChat(chat.length); }, [chatVisible, chat.length]);
  const unread = chatVisible ? 0 : Math.max(0, chat.filter((m, i) => i >= seenChat && m.id !== me).length);
  const connected = useConnected();
  const { config } = useAuth();
  const nav = useNavigate();
  const myPlayer = game.players.find(p => p.id === me);
  useGameSounds(game, me);
  useAmbience(game);
  const social = useSocial(me, room);
  const systemLines = useSystemLines(room);
  const reactionsOn = config.features.reactions !== false && config.features.chat;
  const [notify, toggleNotify] = useNotifyPref();
  const [cinematic, toggleCinematic] = useCinematicPref();
  const [cameraMode, , nextCameraMode] = useCameraMode();
  const camInfo = CAMERA_MODES.find(m => m.id === cameraMode)!;
  const cycleCamera = () => {
    nextCameraMode();
    const i = (CAMERA_MODES.findIndex(m => m.id === cameraMode) + 1) % CAMERA_MODES.length;
    toast(`${CAMERA_MODES[i].icon} ${CAMERA_MODES[i].label} view — ${CAMERA_MODES[i].hint}`);
  };
  useTurnAlerts(game, me, notify, `${room.code} · Yot Monopoly`);
  const over = !!game.winner || room.status === 'finished';
  const closeDialogs = () => {
    setTradeWith(null); setCounter(null); setPortfolio(undefined); setHelpOpen(false); setSelected(null); setManage(null);
  };
  const amIn = !!myPlayer && !myPlayer.bankrupt && !over;
  // Trade and manage dialogs only show while I'm still playing (see below).
  // The end screen is a modal (Shortcuts skips keys inside it); once dismissed to view the board, C and ? work again.
  const dialogOpen = (amIn && (!!tradeWith || !!counter || !!manage)) || portfolio !== undefined || helpOpen;
  useShortcuts(game, me, {
    dialogOpen,
    onEscape: closeDialogs,
    onTrade: () => {
      if (amIn) openTrade();
      else setPortfolio(game.players.find(p => p.id !== me && !p.bankrupt)?.id ?? me);
    },
    onHelp: () => (helpOpen ? setHelpOpen(false) : openHelp()),
    onBuild: () => { if (amIn) openManage(debtOf(game, me) > myPlayer!.cash ? 'raise' : 'build'); },
    onCamera: cycleCamera,
  });
  // The poked player's screen gives a little shake.
  const pokedMe = social.poke?.to === me;
  // Memoised on who is playing (not on the players array, which is new with every update).
  const playerIds = game.players.map(p => p.id).join(',');
  // Memoised: a new object every render would re-render every character in the scene.
  const pieceReactions = useMemo(() => Object.fromEntries(game.players
    .map(p => [p.id, latestReaction(social.reactions, p.id)] as const)
    .filter((e): e is readonly [string, ReactionMsg] => !!e[1])
    .map(([id, r]) => [id, { emoji: r.emoji, seq: r.seq }])), [social.reactions, playerIds]);

  const leave = async () => {
    if (myPlayer && !myPlayer.bankrupt && game.phase !== 'over' && room.status !== 'finished'
      && !(await askConfirm({
        icon: '🚪', title: 'Leave the game?', danger: true, confirm: 'Leave & forfeit', cancel: 'Keep playing',
        body: 'Leaving forfeits the game — your property goes back to the bank. (Just closing the tab keeps your seat: autopilot plays until you are back.)',
      }))) return;
    await call('room:leave').catch(() => {});
    nav('/');
  };

  return (
    <div className={`game ${theme.ui ? 'branded' : ''} ${pokedMe ? 'poked' : ''}`} style={themeStyle(theme)}>
      <div className="scene"><BoardScene themeId={game.themeId} mapId={game.mapId} game={game} selected={selected} onSelect={setSelected} tableStyle={room.style} reactions={pieceReactions} me={me} cinematic={cinematic} cameraMode={cameraMode} /></div>

      <header className="topbar">
        <div className="tb-left">
          {theme.logoUrl && <img className="brand-mark" src={theme.logoUrl} alt="" />}
          <b className="mono accent tb-code">{room.code}</b>
          <span className="tb-meta">{getMap(game.mapId).name === theme.name ? theme.name : `${getMap(game.mapId).name} · ${theme.name}`}</span>
          <span className="tb-turn">Turn {game.turnNumber}</span>
          {!connected && <span className="tag warn">reconnecting…</span>}
          {!myPlayer && <span className="tag watch-tag" title="You are watching this game">👀 Watching</span>}
          {myPlayer?.bankrupt && !over && <span className="tag watch-tag" title="You are out — watching the rest">👀 Out · watching</span>}
        </div>
        <div className="tb-right">
          <TimeLeft game={game} skew={skew} />
          <PauseButton room={room} game={game} me={me} />
          {/* The bank's stock in one place: buildings left and the jackpot. */}
          <span className="pill tb-bank" title={game.rules.limitedBuildings ? 'Houses and hotels left in the bank' : 'Unlimited houses and hotels'}>
            {game.rules.limitedBuildings
              ? <>🏠 {game.housesLeft}<span className="tb-sep">·</span>🏨 {game.hotelsLeft}</>
              : <>🏠 ∞</>}
            {game.rules.freeParkingPot && <><span className="tb-sep">·</span><span title="Free Parking jackpot">🅿️ {theme.currency}{game.pot.toLocaleString()}</span></>}
          </span>
          <MusicPlayer />
          <button className="btn tiny danger" onClick={leave}>Leave</button>
        </div>
      </header>

      <Players game={game} room={room} me={me} onTrade={setTradeWith} reactions={social.reactions} onPortfolio={setPortfolio} />

      {/* Desktop: the side panel is a right-hand column and the action bar floats
          at the bottom. Phones stack both at the bottom (see the HUD CSS). */}
      <div className="hud-bottom">
      <EventFeed game={game} me={me} />
      <CoachHint game={game} me={me} busy={dialogOpen || game.phase === 'auction' || game.phase === 'minigame'}
        onHelp={openHelp} onBuild={() => openManage('build')} onRaise={() => openManage('raise')} onTrade={openTrade} />
      <aside className={`sidepanel ${panelOpen ? '' : 'closed'}`}>
        <TradeOffers game={game} me={me} onCounter={t => setCounter(counterDraft(t))} />
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'log' && panelOpen} className={tab === 'log' && panelOpen ? 'on' : ''} onClick={() => pickTab('log')}>Log</button>
          {config.features.chat && (
            <button role="tab" aria-selected={tab === 'chat' && panelOpen} className={tab === 'chat' && panelOpen ? 'on' : ''} onClick={() => pickTab('chat')}>
              Chat{unread > 0 && <span className="tab-badge" aria-label={`${unread} unread`}>{unread > 9 ? '9+' : unread}</span>}
            </button>
          )}
          {myPlayer && !myPlayer.bankrupt && <button role="tab" aria-selected={tab === 'mine' && panelOpen} className={tab === 'mine' && panelOpen ? 'on' : ''} onClick={() => pickTab('mine')}>Deeds</button>}
          <button role="tab" aria-selected={tab === 'table' && panelOpen} className={tab === 'table' && panelOpen ? 'on' : ''} onClick={() => pickTab('table')}>Players</button>
        </div>
        <div className="tab-body">
          {tab === 'log' && <Log game={game} />}
          {tab === 'chat' && <Chat chat={chat} system={systemLines} me={me} />}
          {tab === 'mine' && <MyDeeds game={game} me={me} onPick={setSelected} onManage={() => openManage(debtOf(game, me) > (myPlayer?.cash ?? 0) ? 'raise' : 'build')} />}
          {tab === 'table' && <Portfolio game={game} me={me} onPick={setSelected} onTrade={setTradeWith} compact />}
        </div>
      </aside>

      {selected !== null && (
        <div className="deed-float"><Deed game={game} index={selected} me={me} onClose={() => setSelected(null)} /></div>
      )}

      <ActionBar game={game} me={me} skew={skew} selected={selected} onManage={openManage} onLeave={leave}
        onTrade={openTrade} />
      </div>

      <AuctionPanel game={game} me={me} skew={skew} />
      <SoldBanner game={game} me={me} />
      <MinigamePanel game={game} me={me} skew={skew} />
      <CardPopup game={game} />
      {myPlayer && <TurnBanner game={game} me={me} />}
      <TurnClock game={game} me={me} skew={skew} />
      <PausedBanner game={game} />
      {theme.logoUrl && <img className="corner-mark" src={theme.logoUrl} alt={theme.name} />}

      <div className="social-dock">
        {me && reactionsOn && <ReactionPicker sentSeq={social.sentSeq} />}
        {me && config.features.chat && <QuickChatButton />}
        {reactionsOn && !over && <PokeButton room={room} game={game} me={me} skew={skew} />}
        {myPlayer && !over && (
          <button className={`dock-btn ${notify ? 'on' : ''}`} onClick={toggleNotify}
            title={notify ? 'Turn alerts on — click to turn off' : 'Notify me when it\'s my turn (while this tab is hidden)'}
            aria-pressed={notify}>{notify ? '🔔' : '🔕'}</button>
        )}
        <button className="dock-btn on cam-btn" onClick={cycleCamera} aria-label={`Camera: ${camInfo.label}. Change view`}
          title={`Camera: ${camInfo.label} — ${camInfo.hint}. Click (or C) for the next view`}>{camInfo.icon}</button>
        <button className={`dock-btn ${cinematic ? 'on' : ''}`} onClick={toggleCinematic} aria-pressed={cinematic}
          title={cinematic ? 'Cinematic camera on — big moments get a close-up. Click to turn off' : 'Cinematic camera off — click to turn on'}>🎬</button>
        <button className={`dock-btn ${helpOpen ? 'on' : ''}`} onClick={openHelp} title="How to play (?)" aria-label="How to play">?</button>
      </div>
      <SpectatorReactions reactions={social.reactions} />
      <PokeNotice poke={social.poke} game={game} me={me} />

      {tradeWith && amIn && <TradeModal game={game} me={me} withId={tradeWith} onClose={() => setTradeWith(null)} />}
      {counter && amIn && <TradeModal key={counter.counterOf} game={game} me={me} withId={counter.withId} counter={counter} onClose={() => setCounter(null)} />}
      {portfolio !== undefined && (
        <PortfolioModal game={game} me={me} focus={portfolio} onPick={setSelected}
          onTrade={id => { setPortfolio(undefined); setTradeWith(id); }} onClose={() => setPortfolio(undefined)} />
      )}
      {manage && amIn && (
        <ManagePanel game={game} me={me} mode={manage} onClose={() => setManage(null)} onPick={i => { setManage(null); setSelected(i); }} />
      )}
      {helpOpen && <HowToPlay rules={game.rules} shortcuts={!!myPlayer} onClose={() => setHelpOpen(false)} />}
      {over && <EndScreen room={room} game={game} me={me} onLeave={leave} />}
    </div>
  );
}

function Players({ game, room, me, onTrade, reactions, onPortfolio }: {
  game: GameView; room: RoomView; me: string; onTrade: (id: string) => void;
  reactions: ReactionMsg[]; onPortfolio: (id: string) => void;
}) {
  const theme = resolveTheme(game.themeId, game.mapId);
  const amIn = game.players.some(p => p.id === me && !p.bankrupt);
  return (
    <div className="players">
      {game.players.map(p => {
        const seat = room.seats.find(s => s.id === p.id);
        const props = Object.values(game.owned).filter(o => o.owner === p.id).length;
        const owes = game.debts.filter(d => d.from === p.id).reduce((a, d) => a + d.amount, 0);
        const reaction = latestReaction(reactions, p.id);
        const worth = game.netWorth?.[p.id];
        return (
          <div key={p.id} className={`player ${p.id === game.current ? 'turn' : ''} ${p.bankrupt ? 'out' : ''}`} style={{ borderColor: p.color }}
            title={!p.bankrupt && worth !== undefined ? `Net worth ${theme.currency}${worth.toLocaleString()}` : undefined}>
            {p.id === game.current && !p.bankrupt && game.phase !== 'over' && <span className="turn-ribbon">{p.id === me ? 'Your turn' : 'Playing'}</span>}
            <span className="token-badge" style={{ background: p.color }}>
              {characterEmoji(p.character)}
              {reaction && <span key={reaction.seq} className="row-react" aria-label={`${p.name} reacted ${reaction.emoji}`}>{reaction.emoji}</span>}
            </span>
            <div className="grow pf-open" role="button" tabIndex={0} title={`${p.name}'s portfolio`}
              onClick={() => onPortfolio(p.id)} onKeyDown={e => { if (e.key === 'Enter') onPortfolio(p.id); }}>
              <div className="pname">
                <span className="pname-text">{p.name}</span>{p.id === me && <em className="tag you">you</em>}
                {p.isBot && <em className="tag">bot</em>}
                {seat && !seat.connected && !p.isBot && <em className="tag warn">away</em>}
                {!p.bankrupt && (p.afk || seat?.autopilot) && <em className="tag warn" title="Autopilot is playing until they act again">{p.afk ? 'afk' : 'autopilot'}</em>}
              </div>
              <div className="pmoney">
                {p.bankrupt ? <span className="muted">bankrupt</span> : <>
                  <b className="cash"><i className="coin" aria-hidden>{theme.currency}</i>{p.cash.toLocaleString()}</b>
                  <span className="muted pdeeds">{props} {props === 1 ? 'deed' : 'deeds'}</span>
                  {p.inJail && <span className="pchip" title="In jail">🔒</span>}
                  {p.jailCards.length > 0 && <span className="pchip" title="Get Out of Jail Free cards">🎫{p.jailCards.length > 1 ? `×${p.jailCards.length}` : ''}</span>}
                  {owes > 0 && <span className="pchip warn" title="Owes money">owes {theme.currency}{owes.toLocaleString()}</span>}
                </>}
              </div>
            </div>
            {amIn && p.id !== me && !p.bankrupt && game.phase !== 'over' && (
              <button className="btn tiny ptrade" onClick={() => onTrade(p.id)} title={`Trade with ${p.name}`} aria-label={`Trade with ${p.name}`}>⇄</button>
            )}
            <PlayerMenu room={room} player={p} me={me} />
          </div>
        );
      })}
    </div>
  );
}

function ActionBar({ game, me, skew, selected, onManage, onLeave, onTrade }: {
  game: GameView; me: string; skew: number; selected: number | null;
  onManage: (mode: ManageMode) => void; onLeave: () => void; onTrade: () => void;
}) {
  const theme = resolveTheme(game.themeId, game.mapId);
  const cur = (n: number) => `${theme.currency}${n.toLocaleString()}`;
  const p = game.players.find(x => x.id === me);
  const current = game.players.find(x => x.id === game.current)!;
  const [busy, setBusy] = useState(false);
  const run = (a: Parameters<typeof act>[0]) => {
    setBusy(true);
    act(a).catch(toastError).finally(() => setBusy(false));
  };

  const sceneBusy = useSceneBusy();
  const dice = <DiceRead game={game} />;

  if (game.phase === 'over') return null;
  // Roll → walk → result: hold my buttons while the dice tumble and the piece moves.
  if (sceneBusy && game.current === me && !game.paused) {
    return <div className="actionbar mine"><span className="ab-status rolling">🎲 Rolling…</span></div>;
  }
  if (game.paused) return <div className="actionbar"><span className="ab-status">⏸️ Game paused</span>{dice}</div>;
  if (!p || p.bankrupt) {
    return (
      <div className="actionbar watching">
        <span className="ab-status">
          {p ? <><b className="ab-big out-big">You're out!</b> Keep watching &amp; chatting · </> : '👀 Watching · '}
          <b style={{ color: current.color }}>{current.name}</b>'s turn
        </span>
        {dice}
        {p && <button className="btn small ghost" onClick={onLeave}>Leave table</button>}
      </div>
    );
  }

  const owe = debtOf(game, me);
  const buildable = canBuildAnywhere(game, theme.spaces, me);
  const owns = ownedBy(game, me).length > 0;
  // The Build / Manage entry point, shown whenever building is possible (any time, per the rules)
  // and always on my own turn once I have deeds.
  const buildBtn = (big: boolean) => buildable ? (
    <button className={`btn ${big ? 'chunky' : 'small'} gold build-btn`} onClick={() => onManage('build')} aria-keyshortcuts="h"
      title="Build houses on your full sets (H)">🏠 Build</button>
  ) : owns ? (
    <button className="btn small ghost" onClick={() => onManage('build')} aria-keyshortcuts="h"
      title={hasFullSet(game, theme.spaces, me) ? 'Your sets, buildings and mortgages (H)' : 'Mortgage deeds or lift mortgages (H)'}>🗂 Manage</button>
  ) : null;

  if (owe > 0) {
    const debts = game.debts.filter(d => d.from === me);
    const to = debts.length === 1 ? game.players.find(x => x.id === debts[0].to) : null;
    const reason = debts.length === 1 ? debts[0].reason : null;
    const short = owe - p.cash;
    const max = raisable(game, theme.spaces, me);
    const giveUp = async () => {
      const ok = await askConfirm({
        icon: '💥', title: 'Declare bankruptcy?', danger: true, confirm: 'Go bankrupt', cancel: 'Keep trying',
        body: <>
          <p>You owe <b>{cur(owe)}</b>{to ? <> to <b style={{ color: to.color }}>{to.name}</b></> : ' to the bank'} and have {cur(p.cash)}.</p>
          <p>{to ? `Everything you own goes to ${to.name}` : 'Your property goes back to the bank'} and you're out of the game. You can keep watching and chatting.</p>
          {p.cash >= owe ? <p className="warn">You have enough cash to pay right now!</p>
            : max >= owe && <p className="warn">Selling and mortgaging could still raise {cur(max)} — enough to pay!</p>}
        </>,
      });
      if (ok) run({ type: 'bankrupt' });
    };
    return (
      <div className="actionbar danger">
        <span className="ab-prompt">
          <b className="ab-big">Short on cash!</b> You owe <b>{cur(owe)}</b>{to ? <> to <b style={{ color: to.color }}>{to.name}</b></> : ''}
          {reason && <span className="ab-reason"> ({reason})</span>}
          {short > 0 && <span className="ab-need"> · need <b>{cur(short)}</b> more</span>}
        </span>
        <DebtClock game={game} id={me} skew={skew} />
        {p.cash >= owe
          ? <button className="btn primary chunky" disabled={busy} onClick={() => run({ type: 'payDebt' })}>Pay {cur(owe)}</button>
          : <button className="btn gold chunky" onClick={() => onManage('raise')} title="Sell houses and mortgage deeds">💸 Raise cash</button>}
        <button className="btn ghost small" disabled={busy} onClick={() => void giveUp()}>Give up</button>
      </div>
    );
  }

  if (game.phase === 'minigame') return <div className="actionbar"><span className="ab-status">🎮 Mini-game time!</span>{dice}</div>;
  if (game.phase === 'choose') return <ChooseBar game={game} me={me} selected={selected} />;
  if (game.current !== me) {
    if (game.phase === 'auction') return <div className="actionbar"><span className="ab-status">🔨 Auction on!</span>{dice}</div>;
    const what = game.phase === 'buy' ? 'is eyeing a property' : game.phase === 'done' ? 'is wheeling and dealing' : 'is rolling';
    return (
      <div className="actionbar">
        <span className="ab-status"><b style={{ color: current.color }}>{current.name}</b> {what}…</span>
        {dice}
        {buildable && buildBtn(false)}
      </div>
    );
  }

  if (game.phase === 'roll') {
    if (p.inJail) {
      const attempt = p.jailTurns + 1;
      const canPay = p.cash >= game.rules.jailFine;
      return (
        <div className="actionbar mine jail">
          <div className="ab-jail">
            <span className="ab-prompt"><b className="ab-big">In jail 🔒</b> <span className="jail-try">Try {attempt} of 3</span></span>
            <span className="small jail-help">
              {attempt < 3 ? 'Roll doubles to walk out free.' : `Last try: miss and you pay ${cur(game.rules.jailFine)} and move anyway.`}
              {' '}Or pay {cur(game.rules.jailFine)} bail{p.jailCards.length ? ' or use your card' : ''} and roll as normal.
            </span>
          </div>
          <button className="btn primary go-btn" disabled={busy} onClick={() => run({ type: 'roll' })} aria-label="Roll for doubles">
            <span className="go-word">GO</span><span className="go-sub">Roll doubles</span>
          </button>
          <div className="ab-jail-pay">
            <button className="btn small" disabled={busy || !canPay} onClick={() => run({ type: 'payJail' })}
              title={canPay ? `Pay ${cur(game.rules.jailFine)} and roll as normal` : 'Not enough cash'}>Pay {cur(game.rules.jailFine)} bail</button>
            {p.jailCards.length > 0 && <button className="btn small gold" disabled={busy} onClick={() => run({ type: 'useJailCard' })}>🎫 Use card{p.jailCards.length > 1 ? ` (${p.jailCards.length})` : ''}</button>}
          </div>
          {dice}
        </div>
      );
    }
    return (
      <div className="actionbar mine">
        <span className="ab-prompt"><b className="ab-big">{game.doublesCount > 0 ? 'Doubles!' : 'Your turn!'}</b>{game.doublesCount > 0 ? ' Roll again' : ''}</span>
        <button className="btn primary go-btn" disabled={busy} onClick={() => run({ type: 'roll' })}
          aria-label={game.doublesCount > 0 ? 'Roll again' : 'Roll dice'} aria-keyshortcuts="Space r">
          <span className="go-word">GO</span><span className="go-sub">{game.doublesCount > 0 ? 'Roll again' : 'Roll dice'}</span>
        </button>
        {buildable && buildBtn(false)}
        {dice}
      </div>
    );
  }

  if (game.phase === 'buy') {
    const s = theme.spaces[p.position];
    const price = s.price ?? 0;
    const afford = p.cash >= price;
    return (
      <div className="actionbar mine">
        {dice}
        <span className="ab-prompt">
          <b className="ab-big">For sale!</b> <b>{s.name}</b>
          {!afford && <span className="ab-need"> · you have {cur(p.cash)}</span>}
        </span>
        <button className="btn primary chunky" disabled={busy || !afford} onClick={() => run({ type: 'buy' })} aria-keyshortcuts="b"
          title={afford ? undefined : 'Not enough cash — mortgage something first, or auction it'}>Buy it · {cur(price)}</button>
        <button className="btn" disabled={busy} onClick={() => run({ type: 'decline' })} aria-keyshortcuts="a">{game.rules.auctions ? 'Auction it' : 'Skip'}</button>
        {!afford && owns && <button className="btn small ghost" onClick={() => onManage('raise')}>💸 Raise cash</button>}
        {/* Pass and hand over in one tap (after the auction, when auctions are on). Doubles still roll again. */}
        {!game.extraRoll && (
          <button className="btn ghost" disabled={busy} onClick={() => run({ type: 'decline', endTurn: true })}
            title={game.rules.auctions ? 'Skip it: it goes to auction, then your turn ends' : 'Skip it and end your turn'}>
            End turn
          </button>
        )}
      </div>
    );
  }

  if (game.phase === 'done') {
    return (
      <div className="actionbar mine">
        {dice}
        <span className="ab-prompt small ab-hint">{buildable ? 'Build, trade — then' : 'Trade or manage — then'}</span>
        {buildBtn(buildable)}
        <button className="btn small ghost" onClick={onTrade} aria-keyshortcuts="t" title="Offer another player a trade (T)">🤝 Trade</button>
        <button className="btn primary chunky" disabled={busy} onClick={() => run({ type: 'endTurn' })} aria-keyshortcuts="e">End turn ✓</button>
      </div>
    );
  }
  return <div className="actionbar">{dice}</div>;
}

/** A big "Your turn!" splash when the turn comes round to you (after the last move has played out). */
function TurnBanner({ game, me }: { game: GameView; me: string }) {
  const busy = useSceneBusy();
  const mine = game.current === me && game.phase === 'roll' && !game.winner && !game.paused;
  const key = `${game.turnNumber}:${game.current}`;
  const seen = useRef<string | null>(mine ? key : null);
  const [show, setShow] = useState<string | null>(null);
  useEffect(() => {
    if (!mine || busy || seen.current === key) return;
    seen.current = key;
    setShow(key);
    const t = setTimeout(() => setShow(null), 1500);
    return () => clearTimeout(t);
  }, [mine, busy, key]);
  if (!show) return null;
  return <div className="turn-banner" aria-hidden><span>Your turn!</span></div>;
}

function CardPopup({ game }: { game: GameView }) {
  const card = game.lastCard;
  const theme = resolveTheme(game.themeId, game.mapId);
  const firstSeq = useRef(card?.seq ?? 0);
  const [shown, setShown] = useState<number | null>(null);
  // Turn the card over once the piece has arrived, not while it is still walking.
  const busy = useSceneBusy();
  const pending = card && card.seq > firstSeq.current ? card.seq : null;
  useEffect(() => {
    if (pending === null || busy) return;
    // The 3D card flies off its pile first (CardDecks); its text takes over as it arrives.
    const t = setTimeout(() => {
      firstSeq.current = pending;
      setShown(pending);
    }, CARD_FLIGHT_MS - 60);
    return () => clearTimeout(t);
  }, [pending, busy]);
  useEffect(() => {
    if (shown === null) return;
    const t = setTimeout(() => setShown(null), 5000);
    return () => clearTimeout(t);
  }, [shown]);
  if (!card || shown !== card.seq) return null;
  const who = game.players.find(p => p.id === card.player);
  return (
    <div className={`card-pop ${card.deck} ${theme.ui ? 'branded' : ''}`} onClick={() => setShown(null)} role="status" aria-live="polite">
      {theme.logoUrl && <img className="card-logo" src={theme.logoUrl} alt="" />}
      <small>{theme.deckNames[card.deck].toUpperCase()}</small>
      <p>{card.text}</p>
      <span className="small muted">drawn by <b style={{ color: who?.color }}>{who?.name}</b></span>
    </div>
  );
}

function Log({ game }: { game: GameView }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [game.log.length, game.log.at(-1)?.t]);
  const color = (id?: string) => game.players.find(p => p.id === id)?.color;
  return (
    <div className="log">
      {game.log.map((l, i) => (
        <div key={i} className="log-line" style={{ borderLeftColor: color(l.who) ?? 'transparent' }}>{l.text}</div>
      ))}
      <div ref={end} />
    </div>
  );
}

function MyDeeds({ game, me, onPick, onManage }: { game: GameView; me: string; onPick: (i: number) => void; onManage: () => void }) {
  const theme = resolveTheme(game.themeId, game.mapId);
  const mine = ownedBy(game, me);
  const out = game.players.find(p => p.id === me)?.bankrupt || game.phase === 'over';
  if (!mine.length) return <p className="muted small">No deeds yet — land on something and buy it!</p>;
  const buildable = canBuildAnywhere(game, theme.spaces, me);
  return (
    <div className="mydeeds">
      {!out && (
        <button className={`btn small ${buildable ? 'gold' : 'ghost'} mydeeds-manage`} onClick={onManage}>
          {buildable ? '🏠 Build houses' : '🗂 Manage deeds'}
        </button>
      )}
      {mine.map(i => {
        const s = theme.spaces[i];
        const o = game.owned[i];
        return (
          <button key={i} className="mydeed" onClick={() => onPick(i)}>
            <i style={{ background: s.group ? theme.groupColors[s.group] : '#777' }} />
            <span className="grow">{s.name}</span>
            <span className="small muted">{o.mortgaged ? 'mortgaged' : o.houses === 5 ? '🏨' : '🏠'.repeat(o.houses)}</span>
          </button>
        );
      })}
    </div>
  );
}
