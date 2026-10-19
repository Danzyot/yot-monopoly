import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ActionType, ChatMsg, TableReaction, TableView, TournamentView } from '../../../shared/types';
import { useAuth } from '../auth';
import { BRAND } from '../../../shared/brand';
import ActionBar from '../components/ActionBar';
import AuthModal from '../components/AuthModal';
import Avatar from '../components/Avatar';
import CardView from '../components/CardView';
import CashBustModal, { type CashBustInfo } from '../components/CashBustModal';
import CashSettingsModal from '../components/CashSettingsModal';
import EliminationModal, { type EliminationInfo } from '../components/EliminationModal';
import ReplayerModal from '../components/ReplayerModal';
import Seat from '../components/Seat';
import SessionLogModal from '../components/SessionLogModal';
import SidePanel from '../components/SidePanel';
import WinnerModal, { type WinnerInfo } from '../components/WinnerModal';
import {
  IconArrowLeft, IconEye, IconGavel, IconGear, IconLink, IconRabbit, IconReplay, IconScroll,
  IconSoundOff, IconSoundOn,
} from '../components/icons';
import { amount, chips, getDisplayMode, setDisplayMode, type DisplayMode } from '../format';
import { mergeChat } from '../chatlog';
import { getSocket, withResub } from '../socket';
import {
  isMuted, playBust, playCheck, playChips, playDeal, playFold,
  playPotAway, playTurnAlert, playWin, setMuted,
} from '../sound';
import { duckForTable } from '../music';
import { feltById } from '../felts';
import FeltInfo from '../components/FeltInfo';
import Reactions, { ReactionWheel } from '../components/Reactions';
import { useFeatures } from '../features';
import PropRail from '../components/PropRail';
import ChogMark from '../components/ChogMark';
import HostTools from '../components/HostTools';
import { useToast } from '../toast';

// Seat anchor positions (percent of felt) — hero rotates to bottom center.
// On narrow (portrait) screens the horizontal radius is pulled in so the
// side seats don't clip off the edges of the phone.
function seatPositions(n: number, narrow: boolean): { x: number; y: number }[] {
  const rx = narrow ? 36 : 45;
  const ry = narrow ? 44 : 46;
  // A seat is centred on its point, so the bottom of the ellipse puts half of
  // the hero's seat below the felt — at 50 + 44 = 94%, with a seat 82px tall,
  // roughly 40px of it lands in the action dock. On a tall phone that is a
  // pixel or two; measured on an iPhone SE it was 16px of the player's own
  // stack box sitting under the buttons they act with.
  //
  // Only the bottom of the arc is pulled in. Shrinking ry instead would drag
  // the top seats down onto the board, and the problem is not the ellipse —
  // it is that one edge of it has a 60px dock beneath it and the others do
  // not.
  const maxY = narrow ? 89 : 96;
  const out: { x: number; y: number }[] = [];
  for (let k = 0; k < n; k++) {
    const theta = Math.PI / 2 + (2 * Math.PI * k) / n;
    out.push({
      x: 50 + rx * Math.cos(theta),
      y: Math.min(maxY, 50 + ry * Math.sin(theta)),
    });
  }
  return out;
}

// Matches the stylesheet's 900px table breakpoint — tablets and landscape
// phones need pulled-in seats just as much as portrait ones (the old 640px
// cutoff left everything between clipping off both edges).
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 900);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth <= 900);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return narrow;
}

// Bets sit between the seat and the pot; on narrow screens they follow the
// seats inward so they never land on top of a seat box.
function betPosition(n: number, k: number, narrow: boolean): { x: number; y: number } {
  const rx = narrow ? 22 : 27;
  const ry = narrow ? 24 : 28;
  const theta = Math.PI / 2 + (2 * Math.PI * k) / n;
  return {
    x: 50 + rx * Math.cos(theta),
    y: 48 + ry * Math.sin(theta),
  };
}

// The dealer button rides on the same ray as the player's bet, but further
// out — between the bet and the seat, and swung a little around the ring.
//
// It used to be the bet position plus a flat "34px right, 20px up", which
// works for a seat on the left and walks the button straight onto the
// community cards for a seat at the top: at 1024px wide it covered 90% of
// the board. Going radial means it moves away from the middle of the table
// for every seat, whatever the seat count.
function dealerPosition(n: number, k: number, narrow: boolean): { x: number; y: number } {
  const rx = narrow ? 27 : 31;
  const ry = narrow ? 29 : 33;
  const theta = Math.PI / 2 + (2 * Math.PI * k) / n + 0.30;
  return {
    x: 50 + rx * Math.cos(theta),
    y: 48 + ry * Math.sin(theta),
  };
}

export default function TablePage() {
  const feat = useFeatures();
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { profile } = useAuth();
  const toast = useToast();
  const [view, setView] = useState<TableView | null>(null);
  const [missing, setMissing] = useState(false);
  // Declared up here because the table-transfer grace period below reads it.
  const wasSeated = useRef(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [log, setLog] = useState<{ text: string; ts: number }[]>([]);
  const [sitSeat, setSitSeat] = useState<number | null>(null);
  const [buyIn, setBuyIn] = useState(0);
  const [showAuth, setShowAuth] = useState(false);
  const [winner, setWinner] = useState<WinnerInfo | null>(null);
  const [elimination, setElimination] = useState<EliminationInfo | null>(null);
  // Cash: run out of chips and you are told where you finished and offered a
  // way back in, rather than left sitting on zero.
  const [cashBust, setCashBust] = useState<CashBustInfo | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [showReplayer, setShowReplayer] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHostTools, setShowHostTools] = useState(false);
  const [muted, setMutedState] = useState(isMuted);
  const [reactions, setReactions] = useState<TableReaction[]>([]);
  const [display, setDisplay] = useState<DisplayMode>(() => getDisplayMode('chips', id));
  // Until the view lands there is nothing to inherit from; once it does, the
  // host's choice for THIS table wins over the site-wide default, unless this
  // player has already flipped it here.
  const tableDisplay = view?.displayMode;
  useEffect(() => {
    if (!tableDisplay) return;
    setDisplay(getDisplayMode(tableDisplay, id));
  }, [tableDisplay, id]);
  // Queued action chosen before the turn arrives ("check", "check/fold",
  // "fold"). Cleared whenever it fires or the hand moves on.
  const [preAction, setPreAction] = useState<'check' | 'checkfold' | 'fold' | null>(null);
  const wasMyTurn = useRef(false);

  // Being moved to another table is the tournament working normally, but the
  // player only learns about it if someone is listening HERE: this event used
  // to be handled on the tournament page alone, so a moved player sat on a
  // dead table until the spectator hop below dumped them somewhere random —
  // usually the lobby. That looked exactly like being kicked out.
  useEffect(() => {
    const sock = getSocket();
    const onAssigned = (p: { tableId: string }) => {
      if (!p?.tableId || p.tableId === id) return;
      toast('info', "Table balanced — you've moved to a new table. You're still in; your next hand deals there.");
      nav(`/table/${p.tableId}`, { replace: true });
    };
    sock.on('tourney:assigned', onAssigned);
    const onCashBust = (info: CashBustInfo) => {
      if (info.tableId === id) setCashBust(info);
    };
    sock.on('table:cashBust', onCashBust);
    return () => {
      sock.off('tourney:assigned', onAssigned);
      sock.off('table:cashBust', onCashBust);
    };
  }, [id, nav, toast]);

  // Spectators: when this tournament table breaks (players moved elsewhere)
  // or the event ends, hop automatically to a table that is still playing.
  const tournamentId = view?.mode === 'tournament' ? view.tournamentId : null;
  const tableDone = !!view?.closed && view?.mySeat === null;
  useEffect(() => {
    if (!tableDone || !tournamentId) return;
    const sock = getSocket();
    let cancelled = false;
    let subscribed = false;
    const onState = (tv: TournamentView) => {
      if (cancelled || tv.id !== tournamentId) return;
      cancelled = true;
      sock.off('tourney:state', onState);
      sock.emit('tourney:unsub', tournamentId);
      subscribed = false;
      const next = tv.tables
        .filter(t => t.id !== id && t.players > 0)
        .sort((a, b) => b.players - a.players)[0];
      if (next) {
        toast('info', 'This table is done — taking you to a live one.');
        nav(`/table/${next.id}`, { replace: true });
      } else {
        nav(`/t/${tournamentId}`, { replace: true });
      }
    };
    // Give the "table breaking" moment a beat on screen before hopping — and
    // much longer for someone who was sitting here, because they are probably
    // being moved and the assignment must win over any spectator hop.
    const timer = setTimeout(() => {
      sock.on('tourney:state', onState);
      sock.emit('tourney:sub', tournamentId);
      subscribed = true;
    }, wasSeated.current ? 8_000 : 1_600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      sock.off('tourney:state', onState);
      // Navigating away before the state arrived: leave the tournament room,
      // or the server keeps streaming full standings to this socket forever.
      if (subscribed) sock.emit('tourney:unsub', tournamentId);
    };
  }, [tableDone, tournamentId, id, nav, toast]);
  const lastBoardLen = useRef(0);
  const lastWinShown = useRef(0);
  const lastActionSeat = useRef<{ tag: string; seat: number }>({ tag: '', seat: -1 });

  // Turn alert (sound + tab title), deal and win cues.
  useEffect(() => {
    if (!view) return;
    const myTurn = !!view.myLegal;
    if (myTurn && !wasMyTurn.current) playTurnAlert();
    // Re-assert the title every update: unrelated broadcasts re-run this
    // effect, and a transition-only write would let them wipe the bell while
    // the player is tabbed away with their clock running.
    document.title = myTurn ? `🔔 Your turn — ${BRAND.name}` : BRAND.title;
    wasMyTurn.current = myTurn;

    if (view.community.length > lastBoardLen.current) {
      playDeal(view.community.length - lastBoardLen.current);
    }
    lastBoardLen.current = view.community.length;

    // Table noise for whatever just happened elsewhere at the table.
    const acted = view.seats.find(s => s.lastAction && s.idx !== lastActionSeat.current.seat);
    const tag = view.seats.map(s => `${s.idx}:${s.lastAction ?? ''}`).join('|');
    if (tag !== lastActionSeat.current.tag) {
      lastActionSeat.current = { tag, seat: acted?.idx ?? -1 };
      const fresh = acted?.lastAction?.toLowerCase() ?? '';
      if (fresh.startsWith('check')) playCheck();
      else if (fresh.startsWith('fold')) playFold();
      else if (fresh.startsWith('call') || fresh.startsWith('bet') || fresh.startsWith('raise')) playChips(3);
      else if (fresh.startsWith('all')) playChips(7);
    }

    if (view.lastResults && view.lastResults.length > 0) {
      const stamp = view.handNumber;
      if (stamp !== lastWinShown.current) {
        lastWinShown.current = stamp;
        const iWon = view.mySeat !== null && view.lastResults.some(r => r.seatIdx === view.mySeat);
        if (iWon) playWin();
        else playPotAway();
      }
    }
    if (view.mySeat === null && wasSeated.current && view.mode === 'tournament') {
      wasSeated.current = false;
      playBust();
    } else if (view.mySeat !== null) {
      wasSeated.current = true;
    }
  }, [view]);

  // Music keeps playing across pages; it just sits lower in the mix at a
  // table so it never buries the turn alert.
  useEffect(() => {
    duckForTable(true);
    return () => duckForTable(false);
  }, []);

  // Floating emoji reactions from anyone watching this table.
  useEffect(() => {
    const sock = getSocket();
    const onReact = (r: TableReaction) => {
      setReactions(list => [...list.slice(-8), r]);
      setTimeout(() => setReactions(list => list.filter(x => x.id !== r.id)), 2600);
    };
    sock.on('table:reaction', onReact);
    return () => { sock.off('table:reaction', onReact); };
  }, []);
  // Leaving the page resets the title once — not on every state update.
  useEffect(() => () => { document.title = BRAND.title; }, []);
  // The action dock publishes its own height, the way the header already
  // does. Anything pinned to the bottom of a phone screen — the chat toasts,
  // the floating chat button — has to sit clear of the buttons a player acts
  // with, and the dock's height is not a constant to guess at: it wraps to two
  // rows on a narrow phone, grows again when the raise panel opens, and
  // disappears entirely while spectating. Measured beats assumed; the previous
  // fixed 84px put every chat pop-up directly on top of Fold and Raise.
  const dockRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const el = document.querySelector('.action-dock') as HTMLElement | null;
    const apply = () => {
      const live = document.querySelector('.action-dock') as HTMLElement | null;
      // How far the dock's TOP edge sits above the bottom of the screen —
      // not the dock's height. The dock is not flush with the viewport
      // bottom, so positioning against its height left the toasts still
      // sitting on the buttons: right size, wrong origin.
      //
      // No early return when there is no dock (spectating): the other two
      // measurements below still have to be published, or they go stale.
      const r = live?.getBoundingClientRect();
      root.style.setProperty('--dock-gap',
        r ? `${Math.max(0, Math.round(window.innerHeight - r.top))}px` : '0px');
      // The hero's own seat is off limits too. Clearing the dock alone moved
      // the chat pop-ups off the buttons and straight onto the player's own
      // cards, stack and hand strength — which is the one part of the felt
      // they are reading on every street.
      const me = document.querySelector('.seat[data-hero]') as HTMLElement | null;
      const mr = me?.getBoundingClientRect();
      root.style.setProperty('--hero-gap',
        mr ? `${Math.max(0, Math.round(window.innerHeight - mr.top))}px` : '0px');
      // And the bottom edge of the table's own bar, measured from the top of
      // the screen. On a phone the pop-ups hang from here rather than rising
      // from the dock: clearing the dock and the hero moved them straight
      // onto the seats on either side of the hero, hiding those players'
      // stacks and cards. The strip under the bar holds the promo banner
      // and nothing a player is reading mid-hand.
      const bar = document.querySelector('.table-topbar') as HTMLElement | null;
      const br = bar?.getBoundingClientRect();
      root.style.setProperty('--topbar-gap', br ? `${Math.max(0, Math.round(br.bottom))}px` : '');
      // The two numbers the felt's own height is cut from on a phone. The
      // stylesheet used to subtract a fixed 232px for "topbar and dock", but
      // the dock is 109px waiting and 193px with the raise panel open — so
      // the felt was 84px too tall exactly when the player was deciding how
      // much to bet, and their own seat slid under the buttons. Each is
      // measured from something the felt's height cannot influence: the
      // dock's height depends only on what is in it, and the wrap's top edge
      // only on what sits above it.
      const row = (document.querySelector('.dock-row') ?? live) as HTMLElement | null;
      root.style.setProperty('--dock-h', row ? `${Math.round(row.offsetHeight)}px` : '0px');
      const wrap = document.querySelector('.felt-wrap') as HTMLElement | null;
      const wr = wrap?.getBoundingClientRect();
      root.style.setProperty('--felt-top', wr ? `${Math.max(0, Math.round(wr.top))}px` : '');
    };
    // Measure now, and again on the next frame. The first pass can land
    // mid-layout — the raise panel opening grows the dock before the felt has
    // shrunk to make room, and a measurement taken in that instant published
    // the topbar 7px higher than it ever actually sits, which put the pop-ups
    // back onto it. The second pass sees the settled layout.
    let raf = 0;
    const settle = () => {
      apply();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { raf = requestAnimationFrame(apply); });
    };
    settle();
    if (el === dockRef.current) return;
    dockRef.current = el;
    if (!el) return;
    const ro = new ResizeObserver(settle);
    ro.observe(el);
    // The topbar and the wrap are inputs to the felt's own height, so they
    // are watched too: a pill appearing in the bar, or a font arriving and
    // rewrapping it, changes where the felt starts without anything else
    // moving.
    for (const sel of ['.table-topbar', '.felt-wrap']) {
      const other = document.querySelector(sel);
      if (other) ro.observe(other);
    }
    // The dock can move without resizing — the felt above it growing is
    // enough — so the viewport is watched too.
    window.addEventListener('resize', settle);
    return () => {
      ro.disconnect(); window.removeEventListener('resize', settle); cancelAnimationFrame(raf);
    };
  });
  // Leaving the table must not leave the rest of the app offset by a dock
  // that is no longer on screen.
  useEffect(() => () => {
    document.documentElement.style.removeProperty('--dock-gap');
    document.documentElement.style.removeProperty('--hero-gap');
    document.documentElement.style.removeProperty('--topbar-gap');
    document.documentElement.style.removeProperty('--dock-h');
    document.documentElement.style.removeProperty('--felt-top');
  }, []);


  useEffect(() => {
    const sock = getSocket();
    const onState = (v: TableView) => { if (v.id === id) { setMissing(false); setView(v); } };
    const onMissing = (missingId: string) => { if (missingId === id) setMissing(true); };
    sock.on('table:missing', onMissing);
    const onChat = (m: ChatMsg) => setChat(c => mergeChat(c, m));
    const onEvent = (e: { text: string; ts: number }) => setLog(l => [...l.slice(-120), e]);
    // The full-tournament finish popup replaces any personal elimination one.
    const onFinished = (p: WinnerInfo) => { setElimination(null); setWinner(p); };
    const onEliminated = (e: EliminationInfo) => setElimination(e);
    sock.on('table:state', onState);
    sock.on('table:chat', onChat);
    sock.on('table:event', onEvent);
    sock.on('tourney:finished', onFinished);
    sock.on('tourney:eliminated', onEliminated);
    // Join now and re-join after any reconnect so state resyncs instantly.
    // Clear backlogs first — the server resends chat + session-log history.
    const rejoin = () => {
      setChat([]);
      setLog([]);
      sock.emit('table:join', id);
    };
    const cleanup = withResub(rejoin);
    // Phones freeze background tabs without dropping the socket, so a state
    // update (like "it's your turn") can be missed entirely — the player
    // comes back to a table with no action buttons. Re-sync on every return
    // to the foreground; the fresh table:state carries the current legal
    // actions.
    const onVisible = () => { if (document.visibilityState === 'visible') rejoin(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      cleanup();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      sock.emit('table:leave', id);
      sock.off('table:state', onState);
      sock.off('table:chat', onChat);
      sock.off('table:event', onEvent);
      sock.off('tourney:finished', onFinished);
      sock.off('tourney:eliminated', onEliminated);
      sock.off('table:missing', onMissing);
    };
  }, [id, profile?.id]);

  const act = useCallback((type: ActionType, amount?: number) => {
    getSocket().emit('table:action', { tableId: id, type, amount });
  }, [id]);

  // A queued action fires as soon as it is legally the player's turn. "Check"
  // only fires when checking is actually free — facing a bet it stands down
  // and hands the decision back, because auto-folding a hand someone meant to
  // check is the kind of surprise that loses a player their stack.
  useEffect(() => {
    const legal = view?.myLegal;
    if (!legal || !preAction) return;
    if (preAction === 'fold') { act('fold'); setPreAction(null); return; }
    if (legal.canCheck) { act('check'); setPreAction(null); return; }
    if (preAction === 'checkfold') { act('fold'); setPreAction(null); return; }
    setPreAction(null); // plain "check" facing a bet: your call now
  }, [view?.myLegal, preAction, act]);

  // Never carry a queued action across hands.
  const handNo = view?.handNumber;
  useEffect(() => { setPreAction(null); }, [handNo]);

  // Does the queued choice settle this turn on its own? If it does, the live
  // action buttons must not be drawn at all: the pre-select row and the real
  // buttons share the same strip of screen, so painting Fold/Call/Raise where
  // the player's finger already is turns a second tap — or the tail of the
  // first — into an action nobody chose. A short stack is the worst case,
  // because its raise button reads "All-in" the instant it appears.
  const queuedResolves = !!view?.myLegal && (
    preAction === 'fold'
    || (preAction !== null && view.myLegal.canCheck)
    || preAction === 'checkfold'
  );

  const sendChat = useCallback((text: string, replyTo?: string) => {
    getSocket().emit('table:chatSend', { tableId: id, text, replyTo });
  }, [id]);

  const narrow = useIsNarrow();
  const positions = useMemo(
    () => view ? seatPositions(view.maxSeats, narrow) : [],
    [view?.maxSeats, narrow],
  );

  if (!view) {
    if (missing) {
      return (
        <main className="page">
          <div className="big-status">
            This table doesn't exist — the game may have ended, or the link is wrong.
            <div style={{ marginTop: 14 }}>
              <Link className="btn btn-primary" to="/">Back to {BRAND.name}</Link>
            </div>
          </div>
        </main>
      );
    }
    return <main className="page"><div className="empty-note">Connecting to table…</div></main>;
  }

  // Stacks/bets honour the viewer's chips-vs-big-blinds preference.
  const fmt = (n: number) => amount(n, display, view.blinds.bb);

  // Rotate so my seat (or seat 0) is at the bottom.
  const anchor = view.mySeat ?? 0;
  const displayPos = (seatIdx: number) => positions[(seatIdx - anchor + view.maxSeats) % view.maxSeats];

  const winnersBySeat = new Set((view.lastResults ?? []).map(r => r.seatIdx));
  const isSeated = view.mySeat !== null;
  const canPickSeat = !isSeated && view.mode === 'cash' && !view.closed;
  const inHand = view.street !== 'waiting';

  const openSitModal = (seatIdx: number) => {
    if (!profile) { setShowAuth(true); return; }
    setSitSeat(seatIdx);
    setBuyIn(view.cashConfig ? view.cashConfig.minBuy * 2 : 0);
  };

  const confirmSit = () => {
    if (sitSeat === null) return;
    getSocket().emit('table:sit', { tableId: id, seat: sitSeat, buyIn });
    setSitSeat(null);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast('success', 'Table link copied — send it to your friends!');
    } catch {
      toast('info', window.location.href);
    }
  };

  return (
    <div className="table-page">
      <div className="table-main">
        <div className="table-topbar">
          <span className="tname">{view.name}</span>
          <span className="pill">{view.blinds.sb}/{view.blinds.bb}{view.blinds.ante ? ` (${view.blinds.ante})` : ''}</span>
          {view.handNumber > 0 && <span className="pill">Hand #{view.handNumber}</span>}
          {view.tournamentId && (
            <Link className="pill" to={`/t/${view.tournamentId}`}><IconArrowLeft size={13} /> Lobby</Link>
          )}
          {view.tournamentId && !isSeated && (
            <Link className="pill" to={`/t/${view.tournamentId}/tables`}><IconEye size={13} /> All tables</Link>
          )}
          {view.paused && <span className="pill" style={{ color: 'var(--blue)' }}>Paused</span>}
          {view.spectators > 0 && <span className="pill"><IconEye size={13} /> {view.spectators}</span>}
          <div className="spacer" style={{ flex: 1 }} />
          <button
            className="btn btn-ghost btn-sm"
            title={muted ? 'Unmute sounds' : 'Mute sounds'}
            onClick={() => { const m = !muted; setMuted(m); setMutedState(m); }}
          >
            {muted ? <IconSoundOff /> : <IconSoundOn />}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            title={display === 'bb' ? 'Showing big blinds — switch to chips' : 'Showing chips — switch to big blinds'}
            onClick={() => {
              const next: DisplayMode = display === 'bb' ? 'chips' : 'bb';
              setDisplay(next); setDisplayMode(next, id);
            }}
          >
            {display === 'bb' ? 'BB' : 'CHIPS'}
          </button>
          {feat.handLog && (
            <button className="btn btn-ghost btn-sm" title="Session log" onClick={() => setShowLog(true)}><IconScroll /> Log</button>
          )}
          {feat.replay && (
            <button className="btn btn-ghost btn-sm" title="Hand replayer" onClick={() => setShowReplayer(true)}><IconReplay /> Replay</button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => void copyLink()}><IconLink /> Invite</button>
          {/* Host tools: reverse a turn, correct a stack. Tournament tables have
              no hostId of their own, so the operator flag is what opens them. */}
          {profile && (view.hostId === profile.id || profile.isAdmin) && (
            <button className="btn btn-ghost btn-sm" onClick={() => setShowHostTools(true)}>
              <IconGavel /> Host tools
            </button>
          )}
          {view.mode === 'cash' && profile && view.hostId === profile.id && (
            <button className="btn btn-ghost btn-sm" title="Table settings"
              onClick={() => setShowSettings(true)}><IconGear /> Settings</button>
          )}
          {isSeated && view.mode === 'cash' && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => getSocket().emit('table:stand', id)}
            >
              Leave table
            </button>
          )}
        </div>

        {/* Rail and felt share a row on desktop and stack on narrow screens.
            The rail never floats over the felt — an advert that covers a seat
            is a bug, not an advert. */}
        <div className="table-body">
          <PropRail />
          <ChogMark />
          <div className="felt-wrap">
          <div
            className="felt"
            style={(() => {
              const f = feltById(view.theme?.felt);
              const style: React.CSSProperties & Record<string, string> = {
                ['--felt-1']: f.felt1,
                ['--felt-2']: f.felt2,
                ['--felt-edge']: f.edge,
                borderColor: f.rail,
              };
              if (view.theme?.backgroundUrl) {
                // A dark wash keeps cards and text readable over any image.
                style.background =
                  `radial-gradient(ellipse at 50% 38%, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.55) 85%), `
                  + `url(${JSON.stringify(view.theme.backgroundUrl)}) center / cover no-repeat`;
              }
              return style;
            })()}
          >
            {view.theme?.logoUrl
              ? <img className="felt-logo-img" src={view.theme.logoUrl} alt="" />
              : <div className="felt-logo">{BRAND.name}</div>}

            {(() => {
              // At showdown: name the winning hand above the board and light up
              // the community cards that are part of it.
              const winner = view.lastResults?.find(r => r.handName && r.bestFive);
              const hotKeys = new Set(
                winner?.bestFive?.map(c => `${c.r}-${c.s}`) ?? [],
              );
              return (
                <>
                  {winner?.handName && (
                    <div className="board-hand-name">{winner.handName}</div>
                  )}
                  <div className="board">
                    {view.rabbit && view.rabbit.length > 0 && (
                      <span className="rabbit-tag" title="What the rest of the board would have been"><IconRabbit size={18} /></span>
                    )}
                    {[0, 1, 2, 3, 4].map(i => {
                      const c = view.community[i];
                      if (!c) {
                        // Rabbit hunt fills the empty slots with the board that never came.
                        const r = view.rabbit?.[i - view.community.length];
                        if (r) return <CardView key={i} card={r} highlight="dim" />;
                        return <div key={i} className="slot" />;
                      }
                      const highlight = winner
                        ? (hotKeys.has(`${c.r}-${c.s}`) ? 'hot' as const : 'dim' as const)
                        : undefined;
                      return <CardView key={i} card={c} highlight={highlight} />;
                    })}
                  </div>
                </>
              );
            })()}

            {view.totalPot > 0 && (
              <div className="pot-line">
                <span className="street-label">{view.street === 'waiting' ? '' : view.street}</span>
                <span className="pot-chip"><span className="chip-disc" />{fmt(view.totalPot)}</span>
              </div>
            )}

            {view.lastResults && view.lastResults.length > 0 && (
              <div className="result-banner">
                {view.lastResults.every(r => r.split) && view.lastResults.length > 1 ? (
                  <div>
                    {/* Odd chips split unevenly — name each winner's real amount. */}
                    Split pot — {view.lastResults.map(r => `${r.name} takes ${chips(r.amount)}`).join(', ')}
                    {view.lastResults[0].handName ? ` with ${view.lastResults[0].handName}` : ''}
                  </div>
                ) : (
                  view.lastResults.map((r, i) => (
                    <div key={i}>
                      {r.name} {r.split ? 'splits, takes' : 'wins'} {chips(r.amount)}{r.handName ? ` — ${r.handName}` : ''}
                    </div>
                  ))
                )}
              </div>
            )}

            {view.seats.map(seat => {
              const pos = displayPos(seat.idx);
              return (
                <Seat
                  key={seat.idx}
                  seat={seat}
                  x={pos.x}
                  y={pos.y}
                  isWinner={winnersBySeat.has(seat.idx)}
                  canSit={canPickSeat}
                  hideEmpty={isSeated || view.mode === 'tournament'}
                  isSelf={seat.idx === view.mySeat}
                  myHandName={view.myHandName}
                  onSit={() => openSitModal(seat.idx)}
                  onBack={() => getSocket().emit('table:sitout', { tableId: id, out: false })}
                  actionDeadline={seat.isTurn ? view.actionDeadline : null}
                  actionStarted={seat.isTurn ? view.actionStarted : null}
                  fmt={fmt}
                />
              );
            })}

            {/* bets in front of players */}
            {view.seats.filter(s => s.bet > 0).map(s => {
              const pos = betPosition(view.maxSeats, (s.idx - anchor + view.maxSeats) % view.maxSeats, narrow);
              return (
                <div key={`bet-${s.idx}`} className="bet-chip" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
                  <span className="chip-disc" />{fmt(s.bet)}
                </div>
              );
            })}

            <FeltInfo view={view} />
            <Reactions
              reactions={reactions}
              positionOf={seat => {
                // Spectators (and any seat we cannot place) launch from the
                // top edge — never bottom-centre, where a hero sits and where
                // an empty seat made these look like a ghost player all night.
                if (seat === null) return { x: 50, y: 4 };
                return displayPos(seat) ?? { x: 50, y: 4 };
              }}
            />

            {/* dealer button */}
            {inHand && (() => {
              const dealer = view.seats.find(s => s.isDealer);
              if (!dealer) return null;
              const pos = dealerPosition(view.maxSeats, (dealer.idx - anchor + view.maxSeats) % view.maxSeats, narrow);
              return (
                <div className="dealer-btn" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
                  D
                </div>
              );
            })()}
          </div>
          </div>
        </div>

        {view.myLegal && queuedResolves ? (
          // The choice is already made and about to be sent; say so where the
          // buttons would have been, so nothing tappable appears under a
          // finger that is still on the screen.
          <div className="action-dock">
            <span className="action-info queued-note">
              {preAction === 'fold' || (preAction === 'checkfold' && !view.myLegal.canCheck)
                ? 'Folding…' : 'Checking…'}
            </span>
          </div>
        ) : view.myLegal ? (
          <div className="dock-row">
            {(view.myTimebankSeconds ?? 0) > 0 && (
              <span className="timebank-pill" title="Extra time granted automatically if your clock runs out">
                ⏱ +{view.myTimebankSeconds}s bank
              </span>
            )}
            <ActionBar legal={view.myLegal} bigBlind={view.blinds.bb} onAction={act} />
            <ReactionWheel tableId={id} />
          </div>
        ) : view.myCanReveal ? (
          (() => {
            // Show the actual cards on the buttons — "1st" and "2nd" made
            // players guess which card they were about to flip.
            const myCards = view.seats.find(s => s.idx === view.mySeat)?.cards;
            const reveal = (which: 'first' | 'second' | 'both') =>
              getSocket().emit('table:reveal', { tableId: id, which });
            return (
              <div className="action-dock reveal-dock">
                <span className="action-info">Show your cards?</span>
                <ReactionWheel tableId={id} />
                <button className="btn btn-sm reveal-btn" onClick={() => reveal('first')}>
                  Show {myCards?.[0] ? <CardView card={myCards[0]} small /> : '1st'}
                </button>
                <button className="btn btn-sm reveal-btn" onClick={() => reveal('second')}>
                  Show {myCards?.[1] ? <CardView card={myCards[1]} small /> : '2nd'}
                </button>
                <button className="btn btn-primary btn-sm reveal-btn" onClick={() => reveal('both')}>
                  Show both
                </button>
                {feat.rabbitHunting && view.rabbitAvailable && (
                  <button className="btn btn-sm" title="See the board that never came"
                    onClick={() => getSocket().emit('table:rabbit', id)}>
                    <IconRabbit /> Rabbit hunt
                  </button>
                )}
              </div>
            );
          })()
        ) : (
          <div className="action-dock">
            {feat.rabbitHunting && view.rabbitAvailable && (
              <button className="btn btn-sm" title="See the board that never came"
                onClick={() => getSocket().emit('table:rabbit', id)}>
                <IconRabbit /> Rabbit hunt
              </button>
            )}
            <ReactionWheel tableId={id} />
            {/* Pre-select while it is someone else's turn. */}
            {isSeated && inHand && !view.myLegal && !view.closed && (
              <div className="preaction-row">
                {([
                  ['check', 'Auto check'],
                  ['checkfold', 'Check / fold'],
                  ['fold', 'Fold now'],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    className={`pre-btn${preAction === key ? ' on' : ''}`}
                    onClick={() => setPreAction(p => (p === key ? null : key))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <span className="action-info">
              {view.closed && view.mode === 'cash' && 'This table has closed — thanks for playing!'}
              {!view.closed && !isSeated && view.mode === 'cash' && 'Pick an open seat to join the game.'}
              {!isSeated && view.mode === 'tournament' && 'Spectating — seats are assigned by the tournament.'}
              {isSeated && view.street === 'waiting' && !view.paused && 'Waiting for players…'}
              {isSeated && view.paused && 'Table paused.'}
              {isSeated && inHand && !view.myLegal && 'Waiting for your turn…'}
            </span>
          </div>
        )}
      </div>

      <SidePanel
        showChat={feat.chat}
        chat={chat}
        log={log}
        onSend={sendChat}
        meId={profile?.id ?? null}
        people={view.seats
          .filter(s => s.player)
          .map(s => ({ id: s.player!.id, name: s.player!.name }))}
        extraTabs={view.mode === 'cash' ? [{
          key: 'ledger',
          label: 'Ledger',
          render: () => (
            <table className="ledger-table">
              <thead>
                <tr><th>Player</th><th>Buy-in</th><th>Stack/Out</th><th>Net</th></tr>
              </thead>
              <tbody>
                {view.ledger.map((e, i) => (
                  <tr key={`${e.playerId}-${i}`}>
                    <td>
                      <span className="name-cell"><Avatar value={e.avatar} size={16} /> {e.name}</span>
                    </td>
                    <td>{chips(e.buyIn)}</td>
                    <td>{e.stack !== null ? chips(e.stack) : e.cashOut !== null ? `${chips(e.cashOut)} ⏏` : '—'}</td>
                    <td className={e.net >= 0 ? 'pos' : 'neg'}>{e.net >= 0 ? '+' : ''}{chips(e.net)}</td>
                  </tr>
                ))}
                {view.ledger.length === 0 && (
                  <tr><td colSpan={4} style={{ color: 'var(--text-faint)', textAlign: 'center' }}>No buy-ins yet</td></tr>
                )}
              </tbody>
            </table>
          ),
        }] : []}
      />

      {sitSeat !== null && view.cashConfig && (
        <div className="modal-backdrop" onClick={() => setSitSeat(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Take seat {sitSeat + 1}</h3>
            <div className="field">
              <label>Buy-in ({chips(view.cashConfig.minBuy)} – {chips(view.cashConfig.maxBuy)})</label>
              <input
                type="range"
                min={view.cashConfig.minBuy}
                max={view.cashConfig.maxBuy}
                step={view.blinds.bb}
                value={buyIn}
                onChange={e => setBuyIn(Number(e.target.value))}
                style={{ accentColor: 'var(--gold)' }}
              />
              <div className="raise-amount" style={{ alignSelf: 'center' }}>{chips(buyIn)}</div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setSitSeat(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={confirmSit}>Sit down</button>
            </div>
          </div>
        </div>
      )}

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      {showSettings && <CashSettingsModal view={view} onClose={() => setShowSettings(false)} />}
      {showHostTools && <HostTools view={view} onClose={() => setShowHostTools(false)} />}
      {winner && <WinnerModal info={winner} onClose={() => setWinner(null)} />}
      {!winner && elimination && (
        <EliminationModal info={elimination} onClose={() => setElimination(null)} />
      )}
      {cashBust && (
        <CashBustModal
          info={cashBust}
          onRebuy={amount => {
            getSocket().emit('table:topup', { tableId: id, amount });
            toast('success', `Bought in for ${amount.toLocaleString()} — you are back in the game.`);
          }}
          onClose={() => setCashBust(null)}
        />
      )}
      {showLog && (
        <SessionLogModal
          log={log}
          tableName={view.name}
          onClose={() => setShowLog(false)}
          onOpenReplayer={() => { setShowLog(false); setShowReplayer(true); }}
        />
      )}
      {showReplayer && <ReplayerModal tableId={id} onClose={() => setShowReplayer(false)} />}
    </div>
  );
}
