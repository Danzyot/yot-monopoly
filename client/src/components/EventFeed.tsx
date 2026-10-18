// Short notices for the moments that matter to you, picked out of the game
// log as it grows: rent paid to you or by you, trade answers, someone going
// bankrupt. Everything else stays in the Log tab. At most three at a time,
// each for a few seconds, so a busy turn never buries the board. Money lines
// are matched on the player ids the engine puts on them (LogEntry from/to),
// never on names in the text: two players can share a name.
import { stageView, useStagedLog } from '../three/sequence.ts';
import { useEffect, useRef, useState } from 'react';
import { resolveTheme } from '../../../shared/themes.ts';
import type { GameView, LogEntry, Trade } from '../../../shared/types.ts';

type Tone = 'good' | 'bad' | 'info';
interface Notice { id: number; icon: string; text: string; tone: Tone }

const LIFE_MS = 4200;
const MAX = 3;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What (if anything) a new log line should tell this player. */
export function classify(l: LogEntry, game: GameView, me: string, prevTrades: Trade[]): Omit<Notice, 'id'> | null {
  const myName = game.players.find(p => p.id === me)?.name;
  const t = l.text;
  const name = (id?: string) => game.players.find(p => p.id === id)?.name;
  const who = name(l.who);
  // Everyone hears about these.
  if (/ went bankrupt/.test(t)) {
    return l.who === me ? { icon: '💥', text: 'You went bankrupt — you can keep watching.', tone: 'bad' }
      : { icon: '💥', text: `${who ?? 'Someone'} went bankrupt!`, tone: 'info' };
  }
  if (t.startsWith('⏰ Time is up')) return { icon: '⏰', text: 'Time is up — last turn!', tone: 'info' };
  if (t.startsWith('🛠 ')) return { icon: '🛠', text: t.slice(3), tone: 'info' };
  if (!myName) {
    if (/ accepted .*'s trade\.$/.test(t)) return { icon: '🤝', text: t.replace(/\.$/, ''), tone: 'info' };
    return null;
  }
  const M = esc(myName);
  let m: RegExpMatchArray | null;
  // Money in and out, by player id.
  if (l.amount !== undefined) {
    const sum = `${resolveTheme(game.themeId, game.mapId).currency}${l.amount.toLocaleString()}`;
    const what = l.reason?.startsWith('rent') ? 'rent' : l.reason ?? '';
    const payer = name(l.from) ?? 'Someone';
    if (l.owed) {
      return l.to === me && l.from !== me ? { icon: '⏳', text: `${payer} owes you ${sum} — they're raising cash`, tone: 'info' } : null;
    }
    if (l.from && l.to === me && l.from !== me) return { icon: '💰', text: `${payer} paid you ${sum} ${what}`.trimEnd(), tone: 'good' };
    if (l.from === me) {
      return { icon: '💸', text: l.to ? `You paid ${name(l.to) ?? 'someone'} ${sum} ${what}`.trimEnd() : `You paid ${sum}${what ? ` (${what})` : ''}`, tone: 'bad' };
    }
    // Salary, a card's prize: the board shows those (MoneyFX). A won jackpot still earns a notice below.
    if (!(l.who === me && / scooped the /.test(t))) return null;
  }
  // Lines from older servers (no ids on them).
  if ((m = t.match(new RegExp(`^(.+) paid (\\S+) to ${M} \\((.+)\\)\\.$`)))) {
    const what = m[3].startsWith('rent') ? 'rent' : m[3];
    return { icon: '💰', text: `${m[1]} paid you ${m[2]} ${what}`, tone: 'good' };
  }
  if (l.who === me && (m = t.match(new RegExp(`^${M} paid (\\S+)(?: to (.+?))? \\((.+)\\)\\.$`)))) {
    const what = m[3].startsWith('rent') ? 'rent' : m[3];
    return { icon: '💸', text: m[2] ? `You paid ${m[2]} ${m[1]} ${what}` : `You paid ${m[1]} (${what})`, tone: 'bad' };
  }
  if ((m = t.match(new RegExp(`^(.+) owes (\\S+) to ${M} `)))) {
    return { icon: '⏳', text: `${m[1]} owes you ${m[2]} — they're raising cash`, tone: 'info' };
  }
  if (l.who === me && / was sent to /.test(t)) return { icon: '🔒', text: 'Busted! You were sent to jail.', tone: 'bad' };
  if (l.who === me && / rolled out of jail/.test(t)) return { icon: '🔓', text: 'Doubles! You rolled out of jail.', tone: 'good' };
  if (l.who === me && / ran out of time/.test(t)) return { icon: '⏱', text: 'You ran out of time — the safe move was made for you.', tone: 'bad' };
  if (l.who === me && / won .* from the bank /.test(t)) return { icon: '🎉', text: t.replace(myName, 'You').replace(/\.$/, ''), tone: 'good' };
  if (l.who === me && / scooped the /.test(t)) return { icon: '🅿️', text: t.replace(myName, 'You').replace(/!$/, '!'), tone: 'good' };
  // Trades.
  if ((m = t.match(new RegExp(`^(.+) accepted ${M}'s trade\\.$`)))) return { icon: '🤝', text: `${m[1]} accepted your trade!`, tone: 'good' };
  if (/ accepted .*'s trade\.$/.test(t) && l.who !== me) return { icon: '🤝', text: t.replace(/\.$/, ''), tone: 'info' };
  if ((m = t.match(new RegExp(`^(.+) offered ${M} a trade\\.$`)))) return { icon: '📨', text: `${m[1]} sent you a trade offer`, tone: 'info' };
  if ((m = t.match(new RegExp(`^(.+) countered ${M}'s offer\\.$`)))) return { icon: '📨', text: `${m[1]} countered your offer`, tone: 'info' };
  if (l.who !== me && / declined a trade\.$/.test(t) && prevTrades.some(x => x.from === me && x.to === l.who)) {
    return { icon: '✋', text: `${who} declined your offer`, tone: 'bad' };
  }
  // Threats on the board.
  if (l.who !== me && / built a hotel on /.test(t)) return { icon: '🏨', text: t.replace(/\.$/, ''), tone: 'info' };
  return null;
}

export default function EventFeed({ game, me }: { game: GameView; me: string }) {
  // Plan this view's move before the lines it brought are staged.
  stageView(game);
  const [items, setItems] = useState<Notice[]>([]);
  // The newest log line already looked at, and the offers open before this update.
  const log = useStagedLog(game.log);
  const mark = useRef<LogEntry | undefined>(log.at(-1));
  const trades = useRef<Trade[]>(game.trades);
  const seq = useRef(0);

  useEffect(() => {
    const last = mark.current;
    let from = 0;
    if (last) {
      let k = log.length - 1;
      while (k >= 0 && !(log[k].t === last.t && log[k].text === last.text)) k--;
      from = k >= 0 ? k + 1 : log.findIndex(l => l.t > last.t);
      if (from < 0) from = log.length;
    }
    const fresh = log.slice(from);
    mark.current = log.at(-1);
    const prevTrades = trades.current;
    trades.current = game.trades;
    if (!fresh.length) return;
    const add = fresh.map(l => classify(l, game, me, prevTrades)).filter((n): n is Omit<Notice, 'id'> => !!n)
      .map(n => ({ ...n, id: ++seq.current }));
    if (!add.length) return;
    setItems(cur => [...cur, ...add].slice(-MAX));
    for (const n of add) setTimeout(() => setItems(cur => cur.filter(x => x.id !== n.id)), LIFE_MS);
  }, [log, game.trades, game, me]);

  if (!items.length) return null;
  return (
    <div className="feed" role="status" aria-live="polite">
      {items.map(n => (
        <div key={n.id} className={`feed-item ${n.tone}`}><span className="feed-icon" aria-hidden>{n.icon}</span>{n.text}</div>
      ))}
    </div>
  );
}
