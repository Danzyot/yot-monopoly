import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveTheme } from '../../../shared/themes.ts';
import { getMap } from '../../../shared/maps.ts';
import type { GameView, RoomView } from '../../../shared/types.ts';
import { act, call, useConnected, type ChatMsg } from '../net.ts';
import { useAuth } from '../auth.tsx';
import { characterEmoji } from '../format.ts';
import { toastError } from '../toast.tsx';
import { themeStyle } from '../themeStyle.ts';
import BoardScene from '../three/BoardScene.tsx';
import Chat from './Chat.tsx';
import Deed from './Deed.tsx';
import MusicPlayer from './MusicPlayer.tsx';
import { useGameSounds } from '../useGameSounds.ts';
import { useSceneBusy } from '../three/sequence.ts';
import { useCinematicPref } from '../three/cinematic.ts';
import PlayerMenu from './PlayerMenu.tsx';
import { TradeModal, TradeOffers, counterDraft, type CounterDraft } from './Trade.tsx';
import MinigamePanel from './MinigamePanel.tsx';
import { DebtClock, PauseButton, PausedBanner, TimeLeft, TurnClock } from './GameClock.tsx';
import { ChooseBar, DiceRead } from './SpeedChoice.tsx';
import EndScreen from './EndScreen.tsx';
import Portfolio, { PortfolioModal } from './Portfolio.tsx';
import { PokeButton, PokeNotice, ReactionPicker, SpectatorReactions, latestReaction } from './Reactions.tsx';
import { ShortcutHelp, useShortcuts } from './Shortcuts.tsx';
import { useSocial } from '../social.ts';
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
  // Phones start with the side panel folded so the board stays visible.
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth > 760);
  const pickTab = (t: typeof tab) => {
    setPanelOpen(open => !(open && t === tab));
    setTab(t);
  };
  /** "Raise cash" in the debt bar: straight to my deeds, opening the panel if it was folded. */
  const openDeeds = () => {
    setTab('mine');
    setPanelOpen(true);
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
  const social = useSocial(me);
  const reactionsOn = config.features.reactions !== false && config.features.chat;
  const [notify, toggleNotify] = useNotifyPref();
  const [cinematic, toggleCinematic] = useCinematicPref();
  useTurnAlerts(game, me, notify, `${room.code} · Yot Monopoly`);
  const over = !!game.winner || room.status === 'finished';
  const closeDialogs = () => {
    setTradeWith(null); setCounter(null); setPortfolio(undefined); setHelpOpen(false); setSelected(null);
  };
  useShortcuts(game, me, {
    dialogOpen: !!tradeWith || !!counter || portfolio !== undefined || over,
    onEscape: closeDialogs,
    onTrade: () => setPortfolio(game.players.find(p => p.id !== me && !p.bankrupt)?.id ?? me),
    onHelp: () => setHelpOpen(o => !o),
  });
  // The poked player's screen gives a little shake.
  const pokedMe = social.poke?.to === me;
  // Memoised: a new object every render would re-render every character in the scene.
  const pieceReactions = useMemo(() => Object.fromEntries(game.players
    .map(p => [p.id, latestReaction(social.reactions, p.id)] as const)
    .filter((e): e is readonly [string, ReactionMsg] => !!e[1])
    .map(([id, r]) => [id, { emoji: r.emoji, seq: r.seq }])), [social.reactions, game.players]);

  const leave = async () => {
    if (myPlayer && !myPlayer.bankrupt && game.phase !== 'over' && room.status !== 'finished'
      && !confirm('Leaving forfeits the game — your property goes back to the bank. Leave?')) return;
    await call('room:leave').catch(() => {});
    nav('/');
  };

  return (
    <div className={`game ${theme.ui ? 'branded' : ''} ${pokedMe ? 'poked' : ''}`} style={themeStyle(theme)}>
      <div className="scene"><BoardScene themeId={game.themeId} mapId={game.mapId} game={game} selected={selected} onSelect={setSelected} tableStyle={room.style} reactions={pieceReactions} me={me} cinematic={cinematic} /></div>

      <header className="topbar">
        <div className="tb-left">
          {theme.logoUrl && <img className="brand-mark" src={theme.logoUrl} alt="" />}
          <b className="mono accent tb-code">{room.code}</b>
          <span className="tb-meta">{getMap(game.mapId).name === theme.name ? theme.name : `${getMap(game.mapId).name} · ${theme.name}`}</span>
          <span className="tb-turn">Turn {game.turnNumber}</span>
          {!connected && <span className="tag warn">reconnecting…</span>}
        </div>
        <div className="tb-right">
          <TimeLeft game={game} skew={skew} />
          <PauseButton room={room} game={game} me={me} />
          {/* The bank's stock in one place: buildings left and the jackpot. */}
          <span className="pill tb-bank" title="Houses and hotels left in the bank">
            🏠 {game.housesLeft}<span className="tb-sep">·</span>🏨 {game.hotelsLeft}
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
      <aside className={`sidepanel ${panelOpen ? '' : 'closed'}`}>
        <TradeOffers game={game} me={me} onCounter={t => setCounter(counterDraft(t))} />
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'log' && panelOpen} className={tab === 'log' && panelOpen ? 'on' : ''} onClick={() => pickTab('log')}>Log</button>
          {config.features.chat && (
            <button role="tab" aria-selected={tab === 'chat' && panelOpen} className={tab === 'chat' && panelOpen ? 'on' : ''} onClick={() => pickTab('chat')}>
              Chat{unread > 0 && <span className="tab-badge" aria-label={`${unread} unread`}>{unread > 9 ? '9+' : unread}</span>}
            </button>
          )}
          {myPlayer && <button role="tab" aria-selected={tab === 'mine' && panelOpen} className={tab === 'mine' && panelOpen ? 'on' : ''} onClick={() => pickTab('mine')}>Deeds</button>}
          <button role="tab" aria-selected={tab === 'table' && panelOpen} className={tab === 'table' && panelOpen ? 'on' : ''} onClick={() => pickTab('table')}>Players</button>
        </div>
        <div className="tab-body">
          {tab === 'log' && <Log game={game} />}
          {tab === 'chat' && <Chat chat={chat} />}
          {tab === 'mine' && <MyDeeds game={game} me={me} onPick={setSelected} />}
          {tab === 'table' && <Portfolio game={game} me={me} onPick={setSelected} onTrade={setTradeWith} compact />}
        </div>
      </aside>

      {selected !== null && (
        <div className="deed-float"><Deed game={game} index={selected} me={me} onClose={() => setSelected(null)} /></div>
      )}

      <ActionBar game={game} me={me} skew={skew} selected={selected} onRaiseCash={openDeeds} />
      </div>

      <AuctionPanel game={game} me={me} skew={skew} />
      <MinigamePanel game={game} me={me} skew={skew} />
      <CardPopup game={game} />
      <TurnClock game={game} me={me} skew={skew} />
      <PausedBanner game={game} />
      {theme.logoUrl && <img className="corner-mark" src={theme.logoUrl} alt={theme.name} />}

      <div className="social-dock">
        {me && reactionsOn && <ReactionPicker />}
        {reactionsOn && !over && <PokeButton room={room} game={game} me={me} skew={skew} />}
        {myPlayer && !over && (
          <button className={`dock-btn ${notify ? 'on' : ''}`} onClick={toggleNotify}
            title={notify ? 'Turn alerts on — click to turn off' : 'Notify me when it\'s my turn (while this tab is hidden)'}
            aria-pressed={notify}>{notify ? '🔔' : '🔕'}</button>
        )}
        <button className={`dock-btn ${cinematic ? 'on' : ''}`} onClick={toggleCinematic} aria-pressed={cinematic}
          title={cinematic ? 'Cinematic camera on — big moments get a close-up. Click to turn off' : 'Cinematic camera off — click to turn on'}>🎬</button>
        {myPlayer && !over && <ShortcutHelp open={helpOpen} onToggle={() => setHelpOpen(o => !o)} />}
      </div>
      <SpectatorReactions reactions={social.reactions} />
      <PokeNotice poke={social.poke} game={game} me={me} />

      {tradeWith && <TradeModal game={game} me={me} withId={tradeWith} onClose={() => setTradeWith(null)} />}
      {counter && <TradeModal key={counter.counterOf} game={game} me={me} withId={counter.withId} counter={counter} onClose={() => setCounter(null)} />}
      {portfolio !== undefined && (
        <PortfolioModal game={game} me={me} focus={portfolio} onPick={setSelected}
          onTrade={id => { setPortfolio(undefined); setTradeWith(id); }} onClose={() => setPortfolio(undefined)} />
      )}
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

function ActionBar({ game, me, skew, selected, onRaiseCash }: {
  game: GameView; me: string; skew: number; selected: number | null; onRaiseCash: () => void;
}) {
  const theme = resolveTheme(game.themeId, game.mapId);
  const cur = (n: number) => `${theme.currency}${n}`;
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
    return <div className="actionbar"><span className="ab-status">{p ? 'You’re out! ' : '👀 Watching · '}<b style={{ color: current.color }}>{current.name}</b>’s turn</span>{dice}</div>;
  }

  const owe = game.debts.filter(d => d.from === me).reduce((a, d) => a + d.amount, 0);
  if (owe > 0) {
    return (
      <div className="actionbar danger">
        <span className="ab-prompt"><b className="ab-big">Short on cash!</b> You owe <b>{cur(owe)}</b> — mortgage or sell buildings to raise it.</span>
        <DebtClock game={game} id={me} skew={skew} />
        <button className="btn primary" disabled={busy || p.cash < owe} onClick={() => run({ type: 'payDebt' })}>Pay {cur(owe)}</button>
        {p.cash < owe && <button className="btn" onClick={onRaiseCash} title="Open your deeds to mortgage them or sell buildings">Raise cash</button>}
        <button className="btn ghost" disabled={busy} onClick={() => confirm('Declare bankruptcy? You will be out of the game.') && run({ type: 'bankrupt' })}>Give up</button>
      </div>
    );
  }

  if (game.phase === 'minigame') return <div className="actionbar"><span className="ab-status">🎮 Mini-game time!</span>{dice}</div>;
  if (game.phase === 'choose') return <ChooseBar game={game} me={me} selected={selected} />;
  if (game.current !== me) {
    if (game.phase === 'auction') return <div className="actionbar"><span className="ab-status">🔨 Auction on!</span>{dice}</div>;
    const what = game.phase === 'buy' ? 'is eyeing a property' : game.phase === 'done' ? 'is wheeling and dealing' : 'is rolling';
    return <div className="actionbar"><span className="ab-status"><b style={{ color: current.color }}>{current.name}</b> {what}…</span>{dice}</div>;
  }

  if (game.phase === 'roll') {
    return (
      <div className="actionbar mine">
        {p.inJail ? (
          <>
            <span className="ab-prompt"><b className="ab-big">Busted! 🔒</b>{p.jailTurns ? ` Try ${p.jailTurns + 1} of 3` : ' Roll doubles to escape'}</span>
            <button className="btn primary go-btn" disabled={busy} onClick={() => run({ type: 'roll' })} aria-label="Roll for doubles">
              <span className="go-word">GO</span><span className="go-sub">Roll doubles</span>
            </button>
            <button className="btn" disabled={busy || p.cash < game.rules.jailFine} onClick={() => run({ type: 'payJail' })}>Pay {cur(game.rules.jailFine)} bail</button>
            {p.jailCards.length > 0 && <button className="btn gold" disabled={busy} onClick={() => run({ type: 'useJailCard' })}>Use Get Out card</button>}
          </>
        ) : (
          <>
            <span className="ab-prompt"><b className="ab-big">{game.doublesCount > 0 ? 'Doubles!' : 'Your turn!'}</b>{game.doublesCount > 0 ? ' Roll again' : ''}</span>
            <button className="btn primary go-btn" disabled={busy} onClick={() => run({ type: 'roll' })}
              aria-label={game.doublesCount > 0 ? 'Roll again' : 'Roll dice'}>
              <span className="go-word">GO</span><span className="go-sub">{game.doublesCount > 0 ? 'Roll again' : 'Roll dice'}</span>
            </button>
          </>
        )}
        {dice}
      </div>
    );
  }

  if (game.phase === 'buy') {
    const s = theme.spaces[p.position];
    return (
      <div className="actionbar mine">
        {dice}
        <span className="ab-prompt"><b className="ab-big">For sale!</b> <b>{s.name}</b></span>
        <button className="btn primary chunky" disabled={busy || p.cash < (s.price ?? 0)} onClick={() => run({ type: 'buy' })}>Buy it · {cur(s.price!)}</button>
        <button className="btn" disabled={busy} onClick={() => run({ type: 'decline' })}>{game.rules.auctions ? 'Auction it' : 'Skip'}</button>
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
        <span className="ab-prompt small">Build, trade or mortgage — then</span>
        <button className="btn primary chunky" disabled={busy} onClick={() => run({ type: 'endTurn' })}>End turn ✓</button>
      </div>
    );
  }
  return <div className="actionbar">{dice}</div>;
}

function AuctionPanel({ game, me, skew }: { game: GameView; me: string; skew: number }) {
  const a = game.auction;
  const theme = resolveTheme(game.themeId, game.mapId);
  const [now, setNow] = useState(Date.now());
  const [custom, setCustom] = useState('');
  useEffect(() => {
    if (!a) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [a]);
  if (!a) return null;
  const s = theme.spaces[a.space];
  const leader = game.players.find(p => p.id === a.highBidder);
  // Frozen at the pause while the game is paused.
  const left = Math.max(0, Math.ceil((a.endsAt - (game.paused ? game.paused.at : now + skew)) / 1000));
  const inIt = a.bidders.includes(me);
  const myCash = game.players.find(p => p.id === me)?.cash ?? 0;
  const bid = (amount: number) => act({ type: 'bid', amount }).catch(toastError);
  return (
    <div className="auction">
      <div className="auction-head" style={{ background: s.group ? theme.groupColors[s.group] : '#2a3142' }}>
        <small>{a.bank ? 'Bank auction!' : 'Auction!'}</small><b>{s.name}</b>
      </div>
      <div className="auction-body">
        <div className="row between">
          <span>Top bid</span>
          <b className="big-num">{theme.currency}{a.highBid}</b>
        </div>
        <div className="row between small">
          <span className="muted">{leader ? <>by <b style={{ color: leader.color }}>{leader.name}</b></> : 'no bids yet'}</span>
          <span className={left <= 3 ? 'warn' : 'muted'}>⏱ {left}s</span>
        </div>
        <div className="small muted">Still in: {a.bidders.map(id => game.players.find(p => p.id === id)?.name).join(', ')}</div>
        {inIt && a.highBidder !== me && (
          <>
            <div className="row wrap">
              {[1, 10, 50, 100].map(inc => (
                <button key={inc} className="btn small" disabled={a.highBid + inc > myCash} onClick={() => bid(a.highBid + inc)}>+{inc}</button>
              ))}
            </div>
            <form className="row" onSubmit={e => { e.preventDefault(); bid(Number(custom)); setCustom(''); }}>
              <input type="number" placeholder="Custom" value={custom} onChange={e => setCustom(e.target.value)} />
              <button className="btn small primary" type="submit">Bid</button>
              <button className="btn small danger" type="button" onClick={() => act({ type: 'pass' }).catch(toastError)}>Drop out</button>
            </form>
          </>
        )}
        {a.highBidder === me && <div className="small win-note">🏆 You're winning — hold tight!</div>}
      </div>
    </div>
  );
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
    firstSeq.current = pending;
    setShown(pending);
  }, [pending, busy]);
  useEffect(() => {
    if (shown === null) return;
    const t = setTimeout(() => setShown(null), 5000);
    return () => clearTimeout(t);
  }, [shown]);
  if (!card || shown !== card.seq) return null;
  const who = game.players.find(p => p.id === card.player);
  return (
    <div className={`card-pop ${card.deck} ${theme.ui ? 'branded' : ''}`} onClick={() => setShown(null)}>
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

function MyDeeds({ game, me, onPick }: { game: GameView; me: string; onPick: (i: number) => void }) {
  const theme = resolveTheme(game.themeId, game.mapId);
  const mine = Object.entries(game.owned).filter(([, o]) => o.owner === me).map(([k]) => Number(k)).sort((a, b) => a - b);
  if (!mine.length) return <p className="muted small">No deeds yet — land on something and buy it!</p>;
  return (
    <div className="mydeeds">
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
