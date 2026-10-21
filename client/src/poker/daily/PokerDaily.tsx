// /poker/daily: Daily Hands, the Poker Daily. Ten poker decisions, the same
// for everyone today: pick a move, see what every move was worth, next hand.
// One official run a day (leaving locks it in), then practice on fresh hands.
// The hands come from the server one at a time and are graded there.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth.tsx';
import { toastError } from '../../toast.tsx';
import { askConfirm } from '../../components/Modal.tsx';
import { ProfileLink } from '../../community.tsx';
import { shareDaily, untilNext } from '../../cards/daily.ts';
import {
  POKER_RANKING_HELP, POKER_SCORING_HELP, formatTime, gridSquare, pokerShareText,
  type PokerDailyInfo, type PokerDailyRow, type PokerReveal, type PokerRunView,
} from '../../../../shared/poker/daily.ts';
import PokerTable, { cardLabel } from './PokerTable.tsx';
import { answerPokerDaily, evText, leavePokerDaily, pctText, playPokerDaily, pokerDailyUrl, usePokerDaily } from './pokerDaily.ts';
import './pokerDaily.css';

export const POKER_DAILY_BLURB = '10 poker hands, the same for everyone today. Pick the best move in each. You get one try.';

export function PokerBoard({ rows, me, empty }: { rows: PokerDailyRow[]; me?: string; empty: string }) {
  if (!rows.length) return <p className="muted small pd-empty">{empty}</p>;
  return (
    <ol className="pd-board-list">
      {rows.map(r => (
        <li key={r.id} className={`${r.left ? 'left' : ''}${r.id === me ? ' me' : ''}`}>
          <span className="pd-rank">{r.rank}</span>
          <ProfileLink id={r.id} className="pd-name">{r.name}</ProfileLink>
          {r.id === me && <em className="tag">you</em>}
          <span className="pd-res"><b>{r.points}</b>/100 · {formatTime(r.timeMs)}</span>
        </li>
      ))}
    </ol>
  );
}

/** The ten squares: how close each answer was. */
export function Grid({ grid }: { grid: number[] }) {
  return (
    <span className="pd-grid" role="img" aria-label={grid.map((p, i) => `hand ${i + 1}: ${p < 0 ? 'not answered' : `${p} points`}`).join(', ')}>
      {grid.map((p, i) => <span key={i}>{gridSquare(p)}</span>)}
    </span>
  );
}

function Progress({ view, current }: { view: PokerRunView; current: number }) {
  return (
    <ol className="pd-progress" aria-label={`Hand ${current + 1} of ${view.total}`}>
      {Array.from({ length: view.total }, (_, i) => {
        const r = view.reveals[i];
        const cls = r ? (r.points >= 10 ? 'best' : r.points >= 6 ? 'close' : r.points >= 1 ? 'off' : 'miss') : i === current ? 'now' : '';
        return <li key={i} className={cls} />;
      })}
    </ol>
  );
}

/** A hand's question: the table, what happened, and the moves. */
function Puzzle({ view, busy, onPick, onLeave }: { view: PokerRunView; busy: boolean; onPick: (id: string) => void; onLeave: () => void }) {
  const spot = view.spot!;
  const [t0] = useState(() => Date.now());
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <section className="pd-play" aria-labelledby="pd-q">
      <div className="pd-topline">
        <span className="pd-hand-n">Hand {spot.index + 1} <small>of {spot.total}</small></span>
        <Progress view={view} current={spot.index} />
        <span className="pd-clock" title="Thinking time on this hand">⏱ {formatTime(Date.now() - t0)}</span>
      </div>
      <PokerTable spot={spot} />
      <ul className="pd-history" aria-label="What happened">
        {spot.history.map((h, i) => <li key={i}>{h}</li>)}
      </ul>
      <h2 id="pd-q" className="pd-question">{spot.facing}. Your move?</h2>
      <div className="pd-options">
        {spot.options.map(o => (
          <button key={o.id} type="button" className={`btn pd-opt ${o.kind}`} disabled={busy} onClick={() => onPick(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
      <p className="pd-foot muted small">
        {view.mode === 'practice' ? 'Practice: not on the leaderboard.' : 'Leaving this page locks in your answers so far.'}
        {' '}<button type="button" className="pd-link" onClick={onLeave}>{view.mode === 'practice' ? 'Stop practising' : 'Leave'}</button>
      </p>
    </section>
  );
}

/** After answering: what every move was worth, and why. */
function Reveal({ reveal: r, last, busy, onNext }: { reveal: PokerReveal; last: boolean; busy: boolean; onNext: () => void }) {
  const best = r.options.find(o => o.id === r.best)!;
  const mine = r.options.find(o => o.id === r.choice);
  const max = Math.max(1, ...r.options.map(o => Math.abs(o.ev)));
  const raises = r.options.filter(o => o.foldPct !== undefined);
  return (
    <section className="pd-play pd-reveal" aria-labelledby="pd-verdict">
      <div className={`pd-verdict ${r.points >= 10 ? 'best' : r.points >= 6 ? 'close' : 'off'}`} role="status">
        <span className="pd-score"><b>{r.points}</b><small>/10</small></span>
        <span>
          <b id="pd-verdict">{r.points >= 10 ? 'Best move!' : r.points >= 6 ? 'Close.' : 'Not this time.'}</b>
          <span className="small">{r.points >= 10 ? `${best.label} was the strongest play.` : `You picked ${mine?.label ?? 'nothing'}. Best was ${best.label}.`}</span>
        </span>
      </div>
      <div className="pd-mini">
        <span className="pd-mini-cards">{r.spot.hole.map(cardLabel).join(' ')}</span>
        {r.spot.board.length > 0 && <span className="muted"> on {r.spot.board.map(cardLabel).join(' ')}</span>}
        <span className="muted"> · {r.spot.facing}, pot {r.spot.pot}</span>
      </div>
      <ul className="pd-evs" aria-label="What each move was worth, in big blinds">
        {r.options.map(o => (
          <li key={o.id} className={`${o.id === r.best ? 'best' : ''}${o.id === r.choice ? ' mine' : ''}`}>
            <span className="pd-ev-label">{o.label}{o.id === r.choice && <em className="tag">you</em>}</span>
            <span className="pd-ev-bar" aria-hidden>
              <span className={o.ev >= 0 ? 'pos' : 'neg'} style={{ width: `${Math.max(2, (Math.abs(o.ev) / max) * 50)}%` }} />
            </span>
            <span className="pd-ev-val">{evText(o.ev)} bb</span>
            <span className="pd-ev-pts">{o.points}</span>
          </li>
        ))}
      </ul>
      <dl className="pd-facts">
        <div><dt>Your share of the pot vs his range</dt><dd>{pctText(r.equity)}</dd></div>
        {r.needed > 0 && <div><dt>Needed to call (pot odds)</dt><dd>{pctText(r.needed)}</dd></div>}
        {raises.map(o => (
          <div key={o.id}><dt>If you {o.label.toLowerCase()}</dt><dd>he folds {pctText(o.foldPct!)}; called, you win {pctText(o.eqCalled!)}</dd></div>
        ))}
      </dl>
      <p className="pd-why small">
        <b>His range:</b> {r.range} ({r.combos} hands). Moves are worth what they win on average, in big blinds (bb).
        After a call we assume the hand is checked down; he never re-raises.
      </p>
      <p className="muted small pd-help">{POKER_SCORING_HELP}</p>
      <button type="button" className="btn primary pd-next" disabled={busy} onClick={onNext} autoFocus>
        {last ? 'See your score' : 'Next hand →'}
      </button>
    </section>
  );
}

/** The end of a run: the score, the squares, sharing, and the ten hands again. */
function Result({ view, info, me, busy, onPractice }: { view: PokerRunView; info: PokerDailyInfo | null; me?: string; busy: boolean; onPractice: () => void }) {
  const practice = view.mode === 'practice';
  const grid = view.result?.grid ?? Array.from({ length: view.total }, (_, i) => view.reveals[i]?.choice != null ? view.reveals[i].points : -1);
  const points = view.result?.points ?? view.reveals.reduce((s, r) => s + r.points, 0);
  const time = view.result?.timeMs ?? view.reveals.reduce((s, r) => s + r.ms, 0);
  const text = !practice && view.result ? pokerShareText({ date: view.date, result: view.result, streak: view.streak, url: pokerDailyUrl() }) : null;
  return (
    <section className="pd-result" aria-labelledby="pd-result-title">
      <p className="pd-kicker">{practice ? 'Practice' : `Daily Hands #${view.number}`}</p>
      <h2 id="pd-result-title" className="pd-big"><b>{points}</b><small>/100</small></h2>
      <Grid grid={grid} />
      <div className="pd-tiles">
        <div><b>{formatTime(time)}</b><span>Time</span></div>
        {!practice && view.rank ? <div><b>#{view.rank}</b><span>of {view.of}</span></div> : null}
        {!practice && view.streak ? <div className="fire"><b>🔥{view.streak}</b><span>Streak</span></div> : null}
      </div>
      {view.result?.left && <p className="muted small">You left early: the hands you did not answer score 0.</p>}
      {practice && <p className="muted small">Practice: not on the leaderboard. Your score for today stands.</p>}
      {text && <pre className="pd-share" aria-label="Share text">{text}</pre>}
      <div className="pd-actions">
        {text && <button type="button" className="btn primary" onClick={() => void shareDaily(text)}>📋 Share result</button>}
        <button type="button" className="btn ghost" disabled={busy} onClick={onPractice}>{practice ? 'Practise again' : 'Practise more hands'}</button>
        <Link className="btn ghost" to="/daily">All dailies</Link>
      </div>
      <h3 className="pd-h3">Your hands</h3>
      <ol className="pd-review">
        {view.reveals.map(r => {
          const mine = r.options.find(o => o.id === r.choice);
          const best = r.options.find(o => o.id === r.best)!;
          return (
            <li key={r.index}>
              <span className="pd-review-sq" aria-hidden>{gridSquare(r.choice == null ? -1 : r.points)}</span>
              <span className="pd-review-cards">{r.spot.hole.map(cardLabel).join(' ')}{r.spot.board.length ? <small> · {r.spot.board.map(cardLabel).join(' ')}</small> : null}</span>
              <span className="pd-review-move">{mine ? mine.label : 'Not answered'}{r.choice !== r.best && <small> · best {best.label}</small>}</span>
              <b className="pd-review-pts">{r.choice == null ? 0 : r.points}</b>
            </li>
          );
        })}
      </ol>
      {!practice && info && info.leaders.length > 0 && (
        <>
          <h3 className="pd-h3">Today’s leaderboard</h3>
          <PokerBoard rows={info.leaders.slice(0, 10)} me={me} empty="" />
          <p className="muted small pd-help">{POKER_RANKING_HELP}</p>
        </>
      )}
    </section>
  );
}

/** Before playing (or when not signed in): what it is, the button, today's best. */
function Intro({ info, me, busy, onPlay, onSignIn }: { info: PokerDailyInfo | null; me?: string; busy: boolean; onPlay: () => void; onSignIn: () => void }) {
  const you = info?.you;
  const streak = you?.streaks.streak ?? 0;
  return (
    <section className="pd-intro">
      <div className="pd-intro-fan" aria-hidden>
        <span className="pd-card lg"><b>A</b><i>♠</i></span>
        <span className="pd-card lg red"><b>K</b><i>♥</i></span>
      </div>
      <p className="pd-kicker">Daily Hands{info ? ` #${info.number}` : ''}</p>
      <h1>Poker Daily</h1>
      <p className="pd-lede">{POKER_DAILY_BLURB}</p>
      {streak > 0 && <p className="pd-streak">🔥 {streak} day{streak === 1 ? '' : 's'} in a row</p>}
      <div className="pd-actions center">
        {!me ? (
          <button type="button" className="btn primary pd-go" onClick={onSignIn}>Sign in to play</button>
        ) : you?.status === 'playing' ? (
          <button type="button" className="btn primary pd-go" disabled={busy} onClick={onPlay}>▶ Carry on (hand {you.answered + 1} of {info!.hands})</button>
        ) : you?.status === 'done' ? (
          <button type="button" className="btn primary pd-go" disabled={busy} onClick={onPlay}>See today’s result</button>
        ) : (
          <button type="button" className="btn primary pd-go" disabled={busy || !info} onClick={onPlay}>▶ Play today’s hands</button>
        )}
      </div>
      <p className="muted small">Each hand: your cards, the board and his bet. Fold, call or raise. After each one you see what every move was worth.</p>
      {info && <p className="muted small">New hands in {untilNext(info.endsAt)}.</p>}
      {info && info.leaders.length > 0 && (
        <div className="pd-intro-board">
          <h3 className="pd-h3">Today’s best</h3>
          <PokerBoard rows={info.leaders.slice(0, 5)} me={me} empty="" />
        </div>
      )}
    </section>
  );
}

export default function PokerDaily() {
  const { profile, openSignIn } = useAuth();
  const { info, reload } = usePokerDaily(null, profile?.id);
  const [view, setView] = useState<PokerRunView | null>(null);
  const [reveal, setReveal] = useState<PokerReveal | null>(null);
  const [busy, setBusy] = useState(false);
  /** The official run under way on this page (left if the page is). */
  const running = useRef(false);

  useEffect(() => { document.title = 'Poker Daily · Chog Games'; }, []);
  // A finished run shows straight away; one under way waits for "Carry on".
  useEffect(() => {
    if (profile && info?.you?.status === 'done' && !view) void go({});
  }, [info?.you?.status, profile?.id]);
  // Leaving the page mid-run locks the answers in (closing the tab does not: come back to it).
  useEffect(() => () => {
    if (running.current) void leavePokerDaily('official');
  }, []);

  const show = (v: PokerRunView) => {
    setView(v);
    running.current = v.mode === 'official' && !v.result;
  };
  const go = async (opts: { practice?: boolean; fresh?: boolean }) => {
    setBusy(true);
    try {
      show(await playPokerDaily(opts));
      setReveal(null);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const pick = async (choice: string) => {
    if (!view?.spot) return;
    setBusy(true);
    try {
      const r = await answerPokerDaily(view.run, view.spot.index, choice);
      setReveal(r.reveal);
      show(r.view);
      if (r.view.result) reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const next = () => {
    if (!view) return;
    if (view.reveals.length >= view.total) { setReveal(null); return; }
    void go(view.mode === 'practice' ? { practice: true } : {});
  };
  const leave = async () => {
    if (!view) return;
    if (view.mode === 'official') {
      const ok = await askConfirm({
        title: 'Leave today’s run?',
        body: 'Your answers so far count. The hands you have not answered score 0, and you cannot come back to them.',
        confirm: 'Leave', cancel: 'Keep playing',
      });
      if (!ok) return;
    }
    running.current = false;
    await leavePokerDaily(view.run);
    setReveal(null);
    if (view.mode === 'official') await go({});
    else setView(null);
    reload();
  };

  const finished = !!view && !reveal && !view.spot && view.reveals.length > 0 && (view.mode === 'practice' ? view.reveals.length >= view.total : !!view.result);

  return (
    <div className="poker-daily">
      <div className="ph-bg" aria-hidden />
      <div className="pd-wrap">
        <p className="pd-crumbs small"><Link to="/poker">← Poker</Link><span aria-hidden> · </span><Link to="/daily">All dailies</Link>
          {view?.mode === 'practice' && <span className="pd-practice-tag">Practice</span>}
        </p>
        {reveal ? (
          <Reveal reveal={reveal} last={view!.reveals.length >= view!.total} busy={busy} onNext={next} />
        ) : view?.spot ? (
          <Puzzle key={`${view.run}:${view.spot.index}`} view={view} busy={busy} onPick={id => void pick(id)} onLeave={() => void leave()} />
        ) : finished ? (
          <Result view={view!} info={info} me={profile?.id} busy={busy} onPractice={() => void go({ practice: true, fresh: true })} />
        ) : (
          <Intro info={info} me={profile?.id} busy={busy} onPlay={() => void go({})} onSignIn={openSignIn} />
        )}
      </div>
    </div>
  );
}
