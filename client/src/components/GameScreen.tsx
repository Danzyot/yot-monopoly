import { useEffect, useRef, useState } from 'react';
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
import { TradeModal, TradeOffers } from './Trade.tsx';

export default function GameScreen({ room, game, me, chat, skew }: {
  room: RoomView; game: GameView; me: string; chat: ChatMsg[]; skew: number;
}) {
  const theme = resolveTheme(game.themeId, game.mapId);
  const [selected, setSelected] = useState<number | null>(null);
  const [tradeWith, setTradeWith] = useState<string | null>(null);
  const [tab, setTab] = useState<'log' | 'chat' | 'mine'>('log');
  // Phones start with the side panel folded so the board stays visible.
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth > 760);
  const pickTab = (t: typeof tab) => {
    setPanelOpen(open => !(open && t === tab));
    setTab(t);
  };
  const connected = useConnected();
  const { config } = useAuth();
  const nav = useNavigate();
  const myPlayer = game.players.find(p => p.id === me);

  const leave = async () => {
    if (myPlayer && !myPlayer.bankrupt && game.phase !== 'over'
      && !confirm('Leaving forfeits the game — your property goes back to the bank. Leave?')) return;
    await call('room:leave').catch(() => {});
    nav('/');
  };

  return (
    <div className={`game ${theme.ui ? 'branded' : ''}`} style={themeStyle(theme)}>
      <div className="scene"><BoardScene themeId={game.themeId} mapId={game.mapId} game={game} selected={selected} onSelect={setSelected} /></div>

      <header className="topbar">
        <div className="row">
          {theme.logoUrl && <img className="brand-mark" src={theme.logoUrl} alt="" />}
          <b className="mono accent">{room.code}</b>
          <span className="muted small">{getMap(game.mapId).name} · {theme.name} · turn {game.turnNumber}</span>
          {!connected && <span className="tag warn">reconnecting…</span>}
        </div>
        <div className="row">
          {game.rules.freeParkingPot && <span className="pill hide-sm">🅿️ pot {theme.currency}{game.pot}</span>}
          <span className="pill hide-sm" title="Houses / hotels left in the bank">🏠 {game.housesLeft} · 🏨 {game.hotelsLeft}</span>
          <button className="btn tiny ghost" onClick={leave}>Leave</button>
        </div>
      </header>

      <Players game={game} room={room} me={me} onTrade={setTradeWith} />

      <aside className={`sidepanel ${panelOpen ? '' : 'closed'}`}>
        <TradeOffers game={game} me={me} />
        <div className="tabs">
          <button className={tab === 'log' && panelOpen ? 'on' : ''} onClick={() => pickTab('log')}>Log</button>
          {config.features.chat && <button className={tab === 'chat' && panelOpen ? 'on' : ''} onClick={() => pickTab('chat')}>Chat</button>}
          {myPlayer && <button className={tab === 'mine' && panelOpen ? 'on' : ''} onClick={() => pickTab('mine')}>My deeds</button>}
        </div>
        <div className="tab-body">
          {tab === 'log' && <Log game={game} />}
          {tab === 'chat' && <Chat chat={chat} />}
          {tab === 'mine' && <MyDeeds game={game} me={me} onPick={setSelected} />}
        </div>
      </aside>

      {selected !== null && (
        <div className="deed-float"><Deed game={game} index={selected} me={me} onClose={() => setSelected(null)} /></div>
      )}

      <AuctionPanel game={game} me={me} skew={skew} />
      <CardPopup game={game} />
      <ActionBar game={game} me={me} />
      {theme.logoUrl && <img className="corner-mark" src={theme.logoUrl} alt={theme.name} />}

      {tradeWith && <TradeModal game={game} me={me} withId={tradeWith} onClose={() => setTradeWith(null)} />}
      {game.winner && <Winner game={game} onHome={() => nav('/')} />}
    </div>
  );
}

function Players({ game, room, me, onTrade }: {
  game: GameView; room: RoomView; me: string; onTrade: (id: string) => void;
}) {
  const theme = resolveTheme(game.themeId, game.mapId);
  const amIn = game.players.some(p => p.id === me && !p.bankrupt);
  return (
    <div className="players">
      {game.players.map(p => {
        const seat = room.seats.find(s => s.id === p.id);
        const props = Object.values(game.owned).filter(o => o.owner === p.id).length;
        const owes = game.debts.filter(d => d.from === p.id).reduce((a, d) => a + d.amount, 0);
        return (
          <div key={p.id} className={`player ${p.id === game.current ? 'turn' : ''} ${p.bankrupt ? 'out' : ''}`} style={{ borderColor: p.color }}>
            <span className="token-badge" style={{ background: p.color }}>{characterEmoji(p.character)}</span>
            <div className="grow">
              <div className="pname">
                {p.name}{p.id === me && ' (you)'}
                {p.isBot && <em className="tag">bot</em>}
                {seat && !seat.connected && !p.isBot && <em className="tag warn">away</em>}
              </div>
              <div className="small muted">
                {p.bankrupt ? 'bankrupt' : <>
                  <b className="cash">{theme.currency}{p.cash.toLocaleString()}</b> · {props} deeds
                  {p.inJail && ' · 🔒 jail'}
                  {p.jailCards.length > 0 && ` · 🎫×${p.jailCards.length}`}
                  {owes > 0 && <span className="warn"> · owes {theme.currency}{owes}</span>}
                </>}
              </div>
            </div>
            {amIn && p.id !== me && !p.bankrupt && game.phase !== 'over' && (
              <button className="btn tiny" onClick={() => onTrade(p.id)}>Trade</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ActionBar({ game, me }: { game: GameView; me: string }) {
  const theme = resolveTheme(game.themeId, game.mapId);
  const cur = (n: number) => `${theme.currency}${n}`;
  const p = game.players.find(x => x.id === me);
  const current = game.players.find(x => x.id === game.current)!;
  const [busy, setBusy] = useState(false);
  const run = (a: Parameters<typeof act>[0]) => {
    setBusy(true);
    act(a).catch(toastError).finally(() => setBusy(false));
  };

  const dice = game.dice && (
    <span className="dice-read">🎲 {game.dice[0]} + {game.dice[1]} = <b>{game.dice[0] + game.dice[1]}</b></span>
  );

  if (game.phase === 'over') return null;
  if (!p || p.bankrupt) {
    return <div className="actionbar"><span className="muted">{p ? 'You are out — ' : 'Watching — '}{current.name} to play</span>{dice}</div>;
  }

  const owe = game.debts.filter(d => d.from === me).reduce((a, d) => a + d.amount, 0);
  if (owe > 0) {
    return (
      <div className="actionbar danger">
        <span>You owe <b>{cur(owe)}</b>. Mortgage or sell buildings to raise cash, or give up.</span>
        <button className="btn primary" disabled={busy || p.cash < owe} onClick={() => run({ type: 'payDebt' })}>Pay {cur(owe)}</button>
        <button className="btn ghost" disabled={busy} onClick={() => confirm('Declare bankruptcy? You will be out of the game.') && run({ type: 'bankrupt' })}>Go bankrupt</button>
      </div>
    );
  }

  if (game.current !== me) {
    if (game.phase === 'auction') return <div className="actionbar"><span className="muted">Auction running…</span>{dice}</div>;
    const what = game.phase === 'buy' ? 'is deciding whether to buy' : 'is playing';
    return <div className="actionbar"><span className="muted"><b style={{ color: current.color }}>{current.name}</b> {what}…</span>{dice}</div>;
  }

  if (game.phase === 'roll') {
    return (
      <div className="actionbar mine">
        {p.inJail ? (
          <>
            <span>You're in jail{p.jailTurns ? ` (try ${p.jailTurns + 1}/3)` : ''}.</span>
            <button className="btn primary" disabled={busy} onClick={() => run({ type: 'roll' })}>Roll for doubles</button>
            <button className="btn" disabled={busy || p.cash < game.rules.jailFine} onClick={() => run({ type: 'payJail' })}>Pay {cur(game.rules.jailFine)}</button>
            {p.jailCards.length > 0 && <button className="btn" disabled={busy} onClick={() => run({ type: 'useJailCard' })}>Use card</button>}
          </>
        ) : (
          <button className="btn primary big" disabled={busy} onClick={() => run({ type: 'roll' })}>
            {game.doublesCount > 0 ? 'Doubles! Roll again' : 'Roll dice'}
          </button>
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
        <span>Buy <b>{s.name}</b>?</span>
        <button className="btn primary" disabled={busy || p.cash < (s.price ?? 0)} onClick={() => run({ type: 'buy' })}>Buy for {cur(s.price!)}</button>
        <button className="btn" disabled={busy} onClick={() => run({ type: 'decline' })}>{game.rules.auctions ? 'Auction it' : 'Pass'}</button>
      </div>
    );
  }

  if (game.phase === 'done') {
    return (
      <div className="actionbar mine">
        {dice}
        <span className="muted small">Build, trade or mortgage now — or</span>
        <button className="btn primary" disabled={busy} onClick={() => run({ type: 'endTurn' })}>End turn</button>
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
  const left = Math.max(0, Math.ceil((a.endsAt - (now + skew)) / 1000));
  const inIt = a.bidders.includes(me);
  const myCash = game.players.find(p => p.id === me)?.cash ?? 0;
  const bid = (amount: number) => act({ type: 'bid', amount }).catch(toastError);
  return (
    <div className="auction">
      <div className="auction-head" style={{ background: s.group ? theme.groupColors[s.group] : '#2a3142' }}>
        <small>AUCTION</small><b>{s.name}</b>
      </div>
      <div className="auction-body">
        <div className="row between">
          <span>High bid</span>
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
              <button className="btn small ghost" type="button" onClick={() => act({ type: 'pass' }).catch(toastError)}>Drop out</button>
            </form>
          </>
        )}
        {a.highBidder === me && <div className="small accent">You're winning — hold tight.</div>}
      </div>
    </div>
  );
}

function CardPopup({ game }: { game: GameView }) {
  const card = game.lastCard;
  const theme = resolveTheme(game.themeId, game.mapId);
  const firstSeq = useRef(card?.seq ?? 0);
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!card || card.seq <= firstSeq.current) return;
    setShown(card.seq);
    const t = setTimeout(() => setShown(null), 5000);
    return () => clearTimeout(t);
  }, [card?.seq]);
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
  if (!mine.length) return <p className="muted small">You don't own anything yet.</p>;
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

function Winner({ game, onHome }: { game: GameView; onHome: () => void }) {
  const w = game.players.find(p => p.id === game.winner)!;
  return (
    <div className="modal-back">
      <div className="modal winner">
        <div className="trophy">🏆</div>
        <h2 style={{ color: w.color }}>{w.name} wins!</h2>
        <p className="muted">after {game.turnNumber} turns</p>
        <button className="btn primary" onClick={onHome}>Back to lobby</button>
      </div>
    </div>
  );
}
