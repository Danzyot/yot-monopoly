import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveTheme, tableLabel } from '../../../shared/themes.ts';
import { getMap } from '../../../shared/maps.ts';
import type { GameView, RoomView } from '../../../shared/types.ts';
import { act, call, useConnected, type ChatMsg } from '../net.ts';
import { useAuth } from '../auth.tsx';
import { toast, toastError } from '../toast.tsx';
import { themeStyle } from '../themeStyle.ts';
import BoardScene from '../three/BoardScene.tsx';
import Chat, { QuickChatButton } from './Chat.tsx';
import Deed from './Deed.tsx';
import MusicPlayer from './MusicPlayer.tsx';
import { useGameSounds } from '../useGameSounds.ts';
import { useAmbience } from '../ambience.ts';
import { useMusicScene } from '../music.ts';
import { CARD_FLIGHT_MS, markRoll, useMoveBusy, useSceneBusy, useStaged, useStagedLog } from '../three/sequence.ts';
import { useCinematicPref } from '../three/cinematic.ts';
import { CAMERA_MODES, useCameraMode } from '../three/camera.ts';
import { QUALITY_LEVELS, useQuality } from '../three/quality.ts';
import PlayerMenu from './PlayerMenu.tsx';
import { TradeCenter, TradeModal, TradeOffers, TradePing, counterDraft, incomingTrades, type CounterDraft } from './Trade.tsx';
import MinigamePanel from './MinigamePanel.tsx';
import { DebtClock, PauseButton, PausedBanner, TimeLeft, TurnClock } from './GameClock.tsx';
import { ChooseBar, DiceRead } from './SpeedChoice.tsx';
import EndScreen from './EndScreen.tsx';
import { PlayerBadge } from './PlayerBadge.tsx';
import { recordHistory } from '../gameHistory.ts';
import { useCutsceneOverlay } from '../three/cinematics/store.ts';
import Portfolio, { PortfolioModal } from './Portfolio.tsx';
import { PokeButton, PokeNotice, ReactionPicker, SpectatorReactions, latestReaction } from './Reactions.tsx';
import { useShortcuts } from './Shortcuts.tsx';
import ManagePanel, { type ManageMode } from './ManagePanel.tsx';
import HowToPlay, { markHowToSeen } from './HowToPlay.tsx';
import { AuctionPanel, SoldBanner } from './Auction.tsx';
import { RollResult, useDiceShown } from './RollResult.tsx';
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
  // Stage this view before any of the HUD below renders: the throw (the dice
  // mark it too, but the board renders after the HUD) and the move it brought,
  // so the action bar, tips and player cards already hold back what it led to.
  const mounted = useRef(false);
  markRoll(game.rollSeq, !mounted.current);
  mounted.current = true;
  stageView(game);
  const moveBusy = useMoveBusy(game);
  // Net worth turn by turn and set-completing trades, for the end screen's story.
  useEffect(() => { recordHistory(game, theme.spaces); }, [game, theme.spaces]);
  const [selected, setSelected] = useState<number | null>(null);
  const [tradeWith, setTradeWith] = useState<string | null>(null);
  const { config } = useAuth();
  // Chat is the main tab (the log is one tap away); with chat switched off the log leads.
  const [tab, setTab] = useState<'log' | 'chat' | 'mine' | 'table'>(config.features.chat ? 'chat' : 'log');
  const [counter, setCounter] = useState<CounterDraft | null>(null);
  /** The Trades dialog (every open offer), scrolled to `focus` when it opened from one. */
  const [tradeView, setTradeView] = useState<{ focus: string | null } | null>(null);
  const viewTrade = (id: string | null) => setTradeView({ focus: id });
  const counterTrade = (t: Parameters<typeof counterDraft>[0]) => { setTradeView(null); setCounter(counterDraft(t)); };
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
  // Phones (held either way) start with the side panel folded so the board stays visible.
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth > 760 && window.innerHeight > 500);
  /** Phones: the dock's secondary buttons live in a small "⋯" sheet. */
  const [dockMore, setDockMore] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dockMore) return;
    const away = (e: PointerEvent) => { if (!dockRef.current?.contains(e.target as Node)) setDockMore(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [dockMore]);
  useEffect(() => { if (helpOpen) setDockMore(false); }, [helpOpen]);
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
  const nav = useNavigate();
  const myPlayer = game.players.find(p => p.id === me);
  useGameSounds(game, me);
  useAmbience(game);
  useMusicScene(game);
  const social = useSocial(me, room);
  const systemLines = useSystemLines(room);
  const reactionsOn = config.features.reactions !== false && config.features.chat;
  const [notify, toggleNotify] = useNotifyPref();
  const [cinematic, toggleCinematic] = useCinematicPref();
  const [quality, nextQuality] = useQuality();
  const qualityInfo = QUALITY_LEVELS.find(q => q.id === quality)!;
  const cycleQuality = () => {
    const i = (QUALITY_LEVELS.findIndex(q => q.id === quality) + 1) % QUALITY_LEVELS.length;
    toast(`${QUALITY_LEVELS[i].icon} ${QUALITY_LEVELS[i].label} — ${QUALITY_LEVELS[i].hint}`);
    nextQuality();
  };
  const [cameraMode, , nextCameraMode] = useCameraMode();
  const camInfo = CAMERA_MODES.find(m => m.id === cameraMode)!;
  const cycleCamera = () => {
    nextCameraMode();
    const i = (CAMERA_MODES.findIndex(m => m.id === cameraMode) + 1) % CAMERA_MODES.length;
    toast(`${CAMERA_MODES[i].icon} ${CAMERA_MODES[i].label} view — ${CAMERA_MODES[i].hint}`);
  };
  useTurnAlerts(game, me, notify, `${room.code} · Yot Monopoly`);
  const over = !!game.winner || room.status === 'finished';
  // The results wait for the last move and the bankruptcy/winner cutscenes to play.
  const endReady = useEndReady(over);
  const closeDialogs = () => {
    setTradeWith(null); setCounter(null); setTradeView(null); setPortfolio(undefined); setHelpOpen(false); setSelected(null); setManage(null);
  };
  const amIn = !!myPlayer && !myPlayer.bankrupt && !over;
  /** Offers waiting for my answer: the badge on Trades and the Players tab. */
  const offersForMe = amIn ? incomingTrades(game, me).length : 0;
  // Trade and manage dialogs only show while I'm still playing (see below).
  // The end screen is a modal (Shortcuts skips keys inside it); once dismissed to view the board, C and ? work again.
  const dialogOpen = (amIn && (!!tradeWith || !!counter || !!manage)) || !!tradeView || portfolio !== undefined || helpOpen;
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
        body: 'Leaving forfeits the game — your property goes back to the bank. (Just closing the tab keeps your seat: auto-play plays until you are back.)',
      }))) return;
    await call('room:leave').catch(() => {});
    nav('/');
  };

  return (
    <div className={`game ${theme.ui ? 'branded' : ''} ${pokedMe ? 'poked' : ''}`} style={themeStyle(theme)}>
      <div className="scene"><BoardScene themeId={game.themeId} mapId={game.mapId} game={game} selected={selected} onSelect={setSelected} tableStyle={room.style} reactions={pieceReactions} me={me} cinematic={cinematic} cameraMode={cameraMode} quality={quality} /></div>

      <header className="topbar">
        <div className="tb-left">
          {theme.logoUrl && <img className="brand-mark" src={theme.logoUrl} alt="" />}
          <b className="mono accent tb-code">{room.code}</b>
          <span className="tb-meta">{tableLabel(getMap(game.mapId).name, theme.name)}</span>
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
          <MusicPlayer askOnce />
          <button className="btn tiny danger" onClick={leave}>Leave</button>
        </div>
      </header>

      <Players game={game} room={room} me={me} onTrade={setTradeWith} reactions={social.reactions} onPortfolio={setPortfolio} />

      {/* Desktop: the side panel is a right-hand column and the action bar floats
          at the bottom. Phones stack both at the bottom (see the HUD CSS). */}
      <div className="hud-bottom">
      <EventFeed game={game} me={me} />
      <CoachHint game={game} me={me} busy={dialogOpen || moveBusy || game.phase === 'auction' || game.phase === 'minigame'}
        onHelp={openHelp} onBuild={() => openManage('build')} onRaise={() => openManage('raise')} onTrade={openTrade} />
      {/* The dock: bottom-left on desktop and landscape phones (both lay the
          bottom wrapper out as `display: contents`); on portrait phones one
          compact row in the bottom stack, just above the tab row. */}
      <div className={`social-dock ${dockMore ? 'more-open' : ''}`} ref={dockRef}>
        {me && reactionsOn && <ReactionPicker sentSeq={social.sentSeq} />}
        {me && config.features.chat && <QuickChatButton />}
        {reactionsOn && !over && <PokeButton room={room} game={game} me={me} skew={skew} />}
        {/* Every open trade (mine and everyone else's); the badge counts offers waiting for me. */}
        {!over && (
          <button className={`dock-btn trades-btn ${offersForMe ? 'hot' : ''}`} onClick={() => viewTrade(null)}
            aria-label={`Trades${game.trades.length ? `: ${game.trades.length} open` : ''}${offersForMe ? `, ${offersForMe} for you` : ''}`}
            title={offersForMe ? `${offersForMe} trade offer${offersForMe > 1 ? 's' : ''} waiting for your answer` : 'Open trades at the table'}>
            <span className="dock-ico" aria-hidden>🤝</span><span className="dock-text">Trades</span>
            {(offersForMe > 0 || game.trades.length > 0) && (
              <span className={`dock-badge ${offersForMe ? '' : 'quiet'}`} aria-hidden>{offersForMe || game.trades.length}</span>
            )}
          </button>
        )}
        {/* Only shown on phones: the rest of the dock folds into this sheet. */}
        <button className={`dock-btn dock-more ${dockMore ? 'on' : ''}`} onClick={() => setDockMore(o => !o)}
          aria-expanded={dockMore} aria-label="More: camera, graphics, alerts, help" title="More">
          <span className="dock-ico" aria-hidden>⋯</span><span className="dock-text">More</span>
        </button>
        {/* On desktop this wrapper is transparent to layout. */}
        <div className="dock-extra">
        {myPlayer && !over && (
          <button className={`dock-btn ${notify ? 'on' : ''}`} onClick={toggleNotify}
            title={notify ? 'Turn alerts on — click to turn off' : 'Notify me when it\'s my turn (while this tab is hidden)'}
            aria-pressed={notify}>
            <span className="dock-ico" aria-hidden>{notify ? '🔔' : '🔕'}</span><span className="dock-text">{notify ? 'Alerts on' : 'Alerts'}</span>
          </button>
        )}
        <button className="dock-btn on cam-btn" onClick={cycleCamera} aria-label={`Camera: ${camInfo.label}. Change view`}
          title={`Camera: ${camInfo.label} — ${camInfo.hint}. Click (or C) for the next view`}>
          <span className="dock-ico" aria-hidden>{camInfo.icon}</span><span className="dock-text">Camera</span>
        </button>
        <button className={`dock-btn ${cinematic ? 'on' : ''}`} onClick={toggleCinematic} aria-pressed={cinematic}
          title={cinematic ? 'Cinematic camera on — big moments get a close-up. Click to turn off' : 'Cinematic camera off — click to turn on'}>
          <span className="dock-ico" aria-hidden>🎬</span><span className="dock-text">Cinematic</span>
        </button>
        <button className="dock-btn" onClick={cycleQuality} aria-label={`${qualityInfo.label}. Change`}
          title={`${qualityInfo.label} — ${qualityInfo.hint}. Click for the next setting`}>
          <span className="dock-ico" aria-hidden>{qualityInfo.icon}</span><span className="dock-text">Graphics</span>
        </button>
        <button className="dock-btn" onClick={() => window.open(`/r/${room.code}?tv=1`, '_blank', 'noopener')} title="Broadcast view — a clean TV / stream picture of this table, in a new tab" aria-label="Open broadcast view">
          <span className="dock-ico" aria-hidden>📺</span><span className="dock-text">TV</span>
        </button>
        <button className={`dock-btn ${helpOpen ? 'on' : ''}`} onClick={openHelp} title="How to play (?)" aria-label="How to play">
          <span className="dock-ico" aria-hidden>?</span><span className="dock-text">Help</span>
        </button>
        </div>
      </div>
      <aside className={`sidepanel ${panelOpen ? '' : 'closed'}`}>
        <TradeOffers game={game} me={me} onCounter={counterTrade} onView={viewTrade} />
        {/* Landscape phones: the folded panel is one small button (with the unread count). */}
        {!panelOpen && (
          <button className="panel-toggle" onClick={() => setPanelOpen(true)} aria-expanded={false}
            aria-label={config.features.chat ? `Open chat and log${unread ? ` (${unread} unread)` : ''}` : 'Open the game log'}>
            <span aria-hidden>{config.features.chat ? '💬' : '📜'}</span> {config.features.chat ? 'Chat' : 'Log'}
            {unread > 0 && <span className="tab-badge" aria-hidden>{unread > 9 ? '9+' : unread}</span>}
          </button>
        )}
        <div className="tabs" role="tablist">
          {config.features.chat && (
            <button role="tab" aria-selected={tab === 'chat' && panelOpen} className={tab === 'chat' && panelOpen ? 'on' : ''} onClick={() => pickTab('chat')}>
              Chat{unread > 0 && <span className="tab-badge" aria-label={`${unread} unread`}>{unread > 9 ? '9+' : unread}</span>}
            </button>
          )}
          <button role="tab" aria-selected={tab === 'log' && panelOpen} className={tab === 'log' && panelOpen ? 'on' : ''} onClick={() => pickTab('log')}>Log</button>
          {myPlayer && !myPlayer.bankrupt && <button role="tab" aria-selected={tab === 'mine' && panelOpen} className={tab === 'mine' && panelOpen ? 'on' : ''} onClick={() => pickTab('mine')}>Deeds</button>}
          <button role="tab" aria-selected={tab === 'table' && panelOpen} className={tab === 'table' && panelOpen ? 'on' : ''} onClick={() => pickTab('table')}>
            Players{offersForMe > 0 && <span className="tab-badge" aria-label={`${offersForMe} trade offer${offersForMe > 1 ? 's' : ''} for you`}>{offersForMe}</span>}
          </button>
          {panelOpen && <button className="tab-close" onClick={() => setPanelOpen(false)} aria-label="Close the panel" title="Close">✕</button>}
        </div>
        <div className="tab-body">
          {(tab === 'log' || (tab === 'chat' && !config.features.chat)) && <Log game={game} />}
          {tab === 'chat' && config.features.chat && <Chat chat={chat} system={systemLines} me={me} />}
          {tab === 'mine' && <MyDeeds game={game} me={me} onPick={setSelected} onManage={() => openManage(debtOf(game, me) > (myPlayer?.cash ?? 0) ? 'raise' : 'build')} />}
          {tab === 'table' && <TradesStrip game={game} me={me} onOpen={() => viewTrade(null)} />}
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
      <RollResult game={game} me={me} />
      <CardPopup game={game} />
      {myPlayer && <TurnBanner game={game} me={me} />}
      <TurnClock game={game} me={me} skew={skew} />
      <PausedBanner game={game} />
      {amIn && <AutopilotBanner game={game} room={room} me={me} />}
      {amIn && !tradeView && <TradePing game={game} me={me} onView={viewTrade} />}
      {theme.logoUrl && <img className="corner-mark" src={theme.logoUrl} alt={theme.name} />}

      <SpectatorReactions reactions={social.reactions} />
      <PokeNotice poke={social.poke} game={game} me={me} />

      {tradeWith && amIn && <TradeModal game={game} me={me} withId={tradeWith} onClose={() => setTradeWith(null)} />}
      {counter && amIn && <TradeModal key={counter.counterOf} game={game} me={me} withId={counter.withId} counter={counter} onClose={() => setCounter(null)} />}
      {tradeView && (
        <TradeCenter game={game} me={me} focus={tradeView.focus} onClose={() => setTradeView(null)}
          onCounter={amIn ? counterTrade : undefined} onNew={amIn ? () => { setTradeView(null); openTrade(); } : undefined} />
      )}
      {portfolio !== undefined && (
        <PortfolioModal game={game} me={me} focus={portfolio} onPick={setSelected}
          onTrade={id => { setPortfolio(undefined); setTradeWith(id); }} onClose={() => setPortfolio(undefined)} />
      )}
      {manage && amIn && (
        <ManagePanel game={game} me={me} mode={manage} onClose={() => setManage(null)} onPick={i => { setManage(null); setSelected(i); }} />
      )}
      {helpOpen && <HowToPlay rules={game.rules} currency={theme.currency} shortcuts={!!myPlayer} onClose={() => setHelpOpen(false)} />}
      {endReady && <EndScreen room={room} game={game} me={me} onLeave={leave} />}
    </div>
  );
}

/** The narrowest a full player card gets on a phone (with the gap between cards). */
const PLAYER_CARD_W = 168;

function Players({ game, room, me, onTrade, reactions, onPortfolio }: {
  game: GameView; room: RoomView; me: string; onTrade: (id: string) => void;
  reactions: ReactionMsg[]; onPortfolio: (id: string) => void;
}) {
  const theme = resolveTheme(game.themeId, game.mapId);
  const amIn = game.players.some(p => p.id === me && !p.bankrupt);
  // Portrait phones: when the full cards don't fit across the screen (three or
  // more players on most phones), each player is a compact chip (avatar, cash,
  // turn ring, deed strip); tapping one opens it into the full card. Two
  // players always get full cards, sharing the width.
  const portraitPhone = useMedia('(max-width: 760px) and (orientation: portrait)');
  const cardsFit = useMedia(`(min-width: ${game.players.length * PLAYER_CARD_W + 16}px)`);
  const chips = portraitPhone && game.players.length > 2 && !cardsFit;
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => { if (!chips) setExpanded(null); }, [chips]);
  // Whoever is playing (and a chip just opened) is always in view: the row
  // scrolls sideways on portrait phones and down in the landscape column.
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = rowRef.current;
    const el = row?.querySelector<HTMLElement>(expanded ? '.player.expanded' : '.player.turn');
    if (!row || !el) return;
    const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    const pad = 8;
    if (row.scrollWidth > row.clientWidth) {
      const l = el.offsetLeft - pad, r = el.offsetLeft + el.offsetWidth + pad;
      if (l < row.scrollLeft) row.scrollTo({ left: l, behavior });
      else if (r > row.scrollLeft + row.clientWidth) row.scrollTo({ left: r - row.clientWidth, behavior });
    }
    if (row.scrollHeight > row.clientHeight) {
      const t = el.offsetTop - pad, b = el.offsetTop + el.offsetHeight + pad;
      if (t < row.scrollTop) row.scrollTo({ top: t, behavior });
      else if (b > row.scrollTop + row.clientHeight) row.scrollTo({ top: b - row.clientHeight, behavior });
    }
  }, [game.current, chips, expanded, game.players.length]);
  // Cash, deeds and the rest as the board has shown them: what a roll led to
  // (salary, rent, jail) changes the cards once the move has played, not as
  // the dice leave the hand.
  const live = Object.fromEntries(game.players.map(p => [p.id, {
    cash: p.cash,
    inJail: p.inJail,
    jailCards: p.jailCards.length,
    owes: game.debts.filter(d => d.from === p.id).reduce((a, d) => a + d.amount, 0),
    worth: game.netWorth?.[p.id],
    deeds: Object.entries(game.owned).filter(([, o]) => o.owner === p.id).map(([k, o]) => [Number(k), o] as const).sort((a, b) => a[0] - b[0]),
  }]));
  // Houses and hotels standing on each player's deeds (counted from the staged deeds below, so they go up with the board's).
  const builtOf = (deeds: (typeof live)[string]['deeds']) => ({
    houses: deeds.reduce((a, [, o]) => a + (o.houses < 5 ? o.houses : 0), 0),
    hotels: deeds.filter(([, o]) => o.houses === 5).length,
  });
  const staged = useStaged(live, JSON.stringify(live));
  return (
    <div className={`players ${chips ? 'compact' : ''}`} ref={rowRef}>
      {game.players.map(p => {
        const seat = room.seats.find(s => s.id === p.id);
        const st = staged[p.id] ?? live[p.id];
        const { cash, owes, worth, deeds } = st;
        const props = deeds.length;
        const { houses, hotels } = builtOf(deeds);
        const reaction = latestReaction(reactions, p.id);
        const chip = chips && expanded !== p.id;
        // A chip opens into the full card first; the full card opens the portfolio.
        const open = () => (chip ? setExpanded(p.id) : onPortfolio(p.id));
        return (
          <div key={p.id} className={`player ${p.id === game.current ? 'turn' : ''} ${p.bankrupt ? 'out' : ''} ${chip ? 'mini' : ''} ${chips && !chip ? 'expanded' : ''}`}
            style={{ borderColor: p.color }}
            title={!p.bankrupt && worth !== undefined ? `Net worth ${theme.currency}${worth.toLocaleString()}` : undefined}>
            {p.id === game.current && !p.bankrupt && game.phase !== 'over' && <span className="turn-ribbon">{p.id === me ? 'Your turn' : 'Playing'}</span>}
            <PlayerBadge p={p} onClick={chips && !chip ? () => setExpanded(null) : chip ? open : undefined}>
              {reaction && <span key={reaction.seq} className="row-react" aria-label={`${p.name} reacted ${reaction.emoji}`}>{reaction.emoji}</span>}
            </PlayerBadge>
            <div className="grow pf-open" role="button" tabIndex={0}
              title={chip ? `${p.name}${p.id === game.current ? ' — playing' : ''}. Tap for more` : `${p.name}'s portfolio`}
              aria-label={chip ? `${p.name}, ${p.bankrupt ? 'bankrupt' : `${theme.currency}${cash.toLocaleString()}`}${p.id === game.current ? ', playing now' : ''}` : undefined}
              onClick={open} onKeyDown={e => { if (e.key === 'Enter') open(); }}>
              <div className="pname">
                <span className="pname-text">{p.name}</span>{p.id === me && <em className="tag you">you</em>}
                {p.isBot && <em className="tag">bot</em>}
                {seat && !seat.connected && !p.isBot && <em className="tag warn">away</em>}
                {!p.bankrupt && (p.afk || seat?.autopilot) && <em className="tag warn" title="Auto-play is playing until they act again">auto-play</em>}
              </div>
              <div className="pmoney">
                {p.bankrupt ? <span className="muted">bankrupt</span> : <>
                  <b className="cash"><i className="coin" aria-hidden>{theme.currency}</i>{cash.toLocaleString()}</b>
                  <span className="muted pdeeds">{props} {props === 1 ? 'deed' : 'deeds'}</span>
                  {st.inJail && <span className="pchip" title="In jail">🔒</span>}
                  {st.jailCards > 0 && <span className="pchip" title="Get Out of Jail Free cards">🎫{st.jailCards > 1 ? `×${st.jailCards}` : ''}</span>}
                  {owes > 0 && <span className="pchip warn" title="Owes money">owes {theme.currency}{owes.toLocaleString()}</span>}
                </>}
              </div>
              {!p.bankrupt && props > 0 && (
                <div className="passets">
                  <div className="pdeed-strip" aria-label={`${p.name}'s deeds`}>
                    {deeds.map(([i, o]) => {
                      const sp = theme.spaces[i];
                      const c = sp.group ? theme.groupColors[sp.group] : sp.kind === 'railroad' ? '#2f3340' : '#a9b3c6';
                      // A built-on deed wears its buildings: a white cap per house, a red one for a hotel.
                      return <i key={i} className={o.mortgaged ? 'mort' : o.houses === 5 ? 'hotel' : o.houses ? `built h${o.houses}` : undefined} style={{ background: c }}
                        title={`${sp.name}${o.houses === 5 ? ' · hotel' : o.houses ? ` · ${o.houses} house${o.houses > 1 ? 's' : ''}` : ''}${o.mortgaged ? ' · mortgaged' : ''}`} />;
                    })}
                  </div>
                  {(houses > 0 || hotels > 0) && (
                    <span className="pbuild" aria-label={`${houses} ${houses === 1 ? 'house' : 'houses'}, ${hotels} ${hotels === 1 ? 'hotel' : 'hotels'}`}>
                      {hotels > 0 && <span className="pb hotel" title={`${hotels} ${hotels === 1 ? 'hotel' : 'hotels'}`}><i aria-hidden>🏨</i>{hotels}</span>}
                      {houses > 0 && <span className="pb house" title={`${houses} ${houses === 1 ? 'house' : 'houses'}`}><i aria-hidden>🏠</i>{houses}</span>}
                    </span>
                  )}
                </div>
              )}
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

  // The scene, or the latest move (to its planned end), is still playing.
  const sceneBusy = useMoveBusy(game);
  const diceShown = useDiceShown(game);
  const dice = <DiceRead game={game} />;

  if (game.phase === 'over') return null;
  const auctionBar = () => {
    const lot = game.auction ? theme.spaces[game.auction.space]?.name : null;
    return <div className="actionbar"><span className="ab-status">🔨 {lot ? <><b>{lot}</b> is up for auction</> : 'Auction on!'} — bid in the auction panel</span>{dice}</div>;
  };
  // An open auction is the news, even while the last walk is still settling
  // (a debt of mine still comes first, below).
  if (game.phase === 'auction' && !game.paused && !(p && !p.bankrupt && debtOf(game, me) > 0)) return auctionBar();
  // Roll → result → walk: hold my buttons while the dice tumble, the score shows and the piece moves.
  // (Not in an arcade round: its panel holds the scene for its own show, and the bar says so below.)
  if (sceneBusy && game.current === me && !game.paused && game.phase !== 'minigame') {
    return <div className="actionbar mine"><span className="ab-status rolling">{diceShown ? '🚶 Moving…' : '🎲 Rolling…'}</span>{dice}</div>;
  }
  if (game.paused) return <div className="actionbar"><span className="ab-status">⏸️ Game paused</span>{dice}</div>;
  if (!p || p.bankrupt) {
    return (
      <div className="actionbar watching">
        <span className="ab-status">
          {p ? <><b className="ab-big out-big">You're out!</b> Keep watching &amp; chatting · </> : '👀 Watching · '}
          <b style={{ color: current.color }} data-user-text>{current.name}</b>'s turn
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
  if (game.phase === 'auction') return auctionBar();
  if (game.current !== me) {
    // While their roll plays out, say so rather than giving away what it led to;
    // before they throw, it is only their turn to roll.
    const what = sceneBusy ? (diceShown ? ' is on the move…' : ' is rolling…')
      : game.phase === 'buy' ? ' is eyeing a property…' : game.phase === 'done' ? ' is wheeling and dealing…'
      : game.phase === 'roll' ? '\'s turn to roll' : '\'s turn';
    return (
      <div className="actionbar">
        <span className="ab-status"><b style={{ color: current.color }} data-user-text>{current.name}</b>{what}</span>
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
        {/* Not buying always says where the deed goes: to auction (when the rules have
            auctions) or back to the bank. The second button does the same and hands
            the turn over once it's settled (doubles still roll again, so it's hidden then). */}
        <button className="btn" disabled={busy} onClick={() => run({ type: 'decline' })} aria-keyshortcuts="a"
          title={game.rules.auctions ? `Don't buy: everyone (you too) bids on ${s.name}, highest bid wins. Then finish your turn` : `Don't buy ${s.name}; it stays with the bank. Then finish your turn`}>
          {game.rules.auctions ? '🔨 Auction it' : 'Don\'t buy'}
        </button>
        {!afford && owns && <button className="btn small ghost" onClick={() => onManage('raise')}>💸 Raise cash</button>}
        {!game.extraRoll && (
          <button className="btn ghost" disabled={busy} onClick={() => run({ type: 'decline', endTurn: true })}
            title={game.rules.auctions ? `Send ${s.name} to auction; your turn ends when the auction does` : `Don't buy ${s.name} and end your turn`}>
            {game.rules.auctions ? 'Auction & end turn' : 'Don\'t buy & end turn'}
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

/**
 * Autopilot is playing for me (I timed out turn after turn, or the host handed
 * my seat over): say so over the HUD, with one big button to take the seat
 * back. It only goes when I press it or make a move myself; the server gives
 * me a moment before autopilot takes each step, so there is time to press it.
 */
function AutopilotBanner({ game, room, me }: { game: GameView; room: RoomView; me: string }) {
  const p = game.players.find(x => x.id === me);
  const handedOver = !!room.seats.find(s => s.id === me)?.autopilot;
  const [busy, setBusy] = useState(false);
  if (!p || p.bankrupt || game.phase === 'over' || !(p.afk || handedOver)) return null;
  const back = () => {
    setBusy(true);
    act({ type: 'back' }).catch(toastError).finally(() => setBusy(false));
  };
  return (
    <div className="autopilot-banner" role="alertdialog" aria-labelledby="ap-title" aria-describedby="ap-why">
      <span className="ap-bot" aria-hidden>🤖</span>
      <div className="ap-text">
        <b id="ap-title">Auto-play is on for you</b>
        <span id="ap-why">
          {p.afk ? 'You were away for a few turns — the turn clock ran out each time.' : 'The host switched your seat to auto-play.'}
          {' '}It keeps your game moving but never buys, builds or trades for you.
        </span>
      </div>
      <button className="btn primary chunky ap-back" disabled={busy} onClick={back}>I'm back!</button>
    </div>
  );
}

/** Players tab: how many trades are open, one tap from the full list. */
function TradesStrip({ game, me, onOpen }: { game: GameView; me: string; onOpen: () => void }) {
  const n = game.trades.length;
  if (!n) return null;
  const mine = incomingTrades(game, me).length;
  const sent = game.trades.filter(t => t.from === me).length;
  const parts = [mine && `${mine} for you`, sent && `${sent} sent`, n - mine - sent && `${n - mine - sent} between others`].filter(Boolean);
  return (
    <button className={`trades-strip ${mine ? 'hot' : ''}`} onClick={onOpen}>
      <span aria-hidden>🤝</span>
      <span className="grow"><b>{n} open trade{n > 1 ? 's' : ''}</b> · {parts.join(' · ')}</span>
      <span className="trades-strip-go">View</span>
    </button>
  );
}

// (Card staging lives in three/sequence.ts; imported here to keep this edit to CardPopup.)
import { CARD_MS, stageView, useCardCue } from '../three/sequence.ts';
import type { CardShown } from '../../../shared/types.ts';

/**
 * The drawn card's text, on the move's plan (three/sequence.ts): the 3D card
 * flies off its pile as the piece arrives on the square (CardDecks), its text
 * takes over as it reaches the camera, and any move the card makes plays
 * after it has been read.
 */
function CardPopup({ game }: { game: GameView }) {
  // Plan this view's move now, so the cue below is on the clock even before the board renders.
  stageView(game);
  const cue = useCardCue();
  const theme = resolveTheme(game.themeId, game.mapId);
  const [mountedAt] = useState(() => performance.now());
  const [shown, setShown] = useState<CardShown | null>(null);
  useEffect(() => {
    // A card cued before we were here is history.
    if (!cue || cue.at + CARD_FLIGHT_MS < mountedAt) return;
    const now = performance.now();
    const show = setTimeout(() => setShown(cue.card), Math.max(0, cue.at + CARD_FLIGHT_MS - 60 - now));
    // Up while it is read and the move it makes plays out, then out of the way.
    const hide = setTimeout(() => setShown(s => (s === cue.card ? null : s)), Math.max(0, cue.at + CARD_MS + 3500 - now));
    return () => { clearTimeout(show); clearTimeout(hide); };
  }, [cue, mountedAt]);
  useEffect(() => {
    // A card the next one replaced (or one clicked away) does not linger: belt and braces for the timers above.
    if (!shown) return;
    const t = setTimeout(() => setShown(s => (s === shown ? null : s)), 9000);
    return () => clearTimeout(t);
  }, [shown]);
  const card = shown;
  if (!card) return null;
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
  const log = useStagedLog(game.log);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [log.length, log.at(-1)?.t]);
  const color = (id?: string) => game.players.find(p => p.id === id)?.color;
  return (
    <div className="log">
      {log.map((l, i) => (
        <div key={i} className="log-line" style={{ borderLeftColor: color(l.who) ?? 'transparent' }}>{l.text}</div>
      ))}
      <div ref={end} />
    </div>
  );
}

/** Whether a CSS media query matches, kept up to date (rotation, resizing). */
function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const f = () => setOn(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [query]);
  return on;
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

/**
 * True once a finished game's results may cover the board: after the final
 * move and its cutscenes (bankruptcy, then the winner's podium) have played,
 * plus a breath. A game that was already over when the screen opened (a
 * reload) shows them at once; a stuck scene can't hold them back for long.
 */
function useEndReady(over: boolean): boolean {
  const busy = useSceneBusy();
  const cut = useCutsceneOverlay();
  const [ready, setReady] = useState(over);
  const since = useRef(0);
  useEffect(() => {
    if (!over) { setReady(false); since.current = 0; return; }
    if (ready) return;
    if (!since.current) since.current = performance.now();
    const left = Math.max(0, 16_000 - (performance.now() - since.current));
    const t = setTimeout(() => setReady(true), !busy && !cut ? Math.min(900, left) : left);
    return () => clearTimeout(t);
  }, [over, busy, cut, ready]);
  return over && ready;
}

