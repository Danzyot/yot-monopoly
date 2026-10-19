// Table chat: grouped messages with hover timestamps, system lines for who
// came and went, a quick-chat row of canned phrases (sent as ordinary chat, so
// the filter and cooldown apply), and a "new messages" pill when the reader
// has scrolled up. The dock's 💬 button (and Q) opens the same phrases as a
// popover so a seated player can fire one without opening the panel.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { QUICK_CHAT } from '../../../shared/types.ts';
import { call, type ChatMsg } from '../net.ts';
import { sendQuickChat, type SystemLine } from '../social.ts';
import { toastError } from '../toast.tsx';
import { useAuth } from '../auth.tsx';

/** Consecutive lines from one player within this long share a header. */
const GROUP_MS = 2 * 60_000;
/** Lines sent from the quick row carry this (added by the server). */
type Line = ChatMsg & { quick?: boolean };

type Entry =
  | { kind: 'group'; key: string; id: string; name: string; color: string; spectator?: boolean; admin?: boolean; t: number; lines: Line[] }
  | { kind: 'system'; key: string; t: number; text: string; sys: SystemLine['kind'] };

/** Interleave chat and system lines by time, then fold runs by one player into groups. */
export function groupChat(chat: Line[], system: SystemLine[]): Entry[] {
  const all: ({ s: true; v: SystemLine } | { s: false; v: Line; i: number })[] = [
    ...chat.map((v, i) => ({ s: false as const, v, i })),
    ...system.map(v => ({ s: true as const, v })),
  ];
  all.sort((a, b) => a.v.t - b.v.t);
  const out: Entry[] = [];
  for (const e of all) {
    if (e.s) { out.push({ kind: 'system', key: `s${e.v.t}-${e.v.text}`, t: e.v.t, text: e.v.text, sys: e.v.kind }); continue; }
    const last = out[out.length - 1];
    const m = e.v;
    if (last?.kind === 'group' && last.id === m.id && m.t - last.lines[last.lines.length - 1].t < GROUP_MS) { last.lines.push(m); continue; }
    out.push({ kind: 'group', key: `m${m.t}-${e.i}`, id: m.id, name: m.name, color: m.color, spectator: m.spectator, admin: m.admin, t: m.t, lines: [m] });
  }
  return out;
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * `send`: where messages go (another game's chat event); the table's own
 * `chat` event when absent. Quick-chat chips go the same way.
 */
export default function Chat({ chat, system = [], me, send: sendTo, quick = true }: {
  chat: ChatMsg[]; system?: SystemLine[]; me?: string; send?: (text: string, quick?: boolean) => Promise<unknown>; quick?: boolean;
}) {
  const [text, setText] = useState('');
  const { profile, openSignIn } = useAuth();
  const list = useRef<HTMLDivElement>(null);
  // Only follow new messages while the reader is at (or near) the bottom.
  const atBottom = useRef(true);
  const [pending, setPending] = useState(0);
  const seen = useRef(chat.length);

  const nearBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  const toBottom = () => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottom.current = true;
    setPending(0);
  };
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const fresh = chat.length - seen.current;
    seen.current = chat.length;
    const mine = fresh > 0 && chat[chat.length - 1]?.id === me;
    if (atBottom.current || mine) toBottom();
    else if (fresh > 0) setPending(n => n + fresh);
  }, [chat.length, system.length]);
  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    atBottom.current = nearBottom(el);
    if (atBottom.current) setPending(0);
  };

  const send = () => {
    if (!text.trim()) return;
    (sendTo ? sendTo(text) : call('chat', { text })).catch(toastError);
    setText('');
  };
  const entries = groupChat(chat, system);
  return (
    <div className="chat">
      <div className="chat-scroll">
        <div className="chat-lines" ref={list} onScroll={onScroll}>
          {entries.length === 0 && <div className="muted small">Say hi 👋</div>}
          {entries.map(e => e.kind === 'system' ? (
            <div key={e.key} className={`chat-sys ${e.sys}`} role="status">
              <span className="chat-sys-text">{e.text}</span>
              <time className="chat-time" dateTime={new Date(e.t).toISOString()}>{clock(e.t)}</time>
            </div>
          ) : (
            <div key={e.key} className={`chat-group ${e.id === me ? 'mine' : ''}`}>
              <div className="chat-head">
                {e.admin && <em className="tag accent-tag">op</em>}
                <b style={{ color: e.color }}>{e.name}</b>
                {e.spectator && <span className="muted small">(watching)</span>}
                <time className="chat-time" dateTime={new Date(e.t).toISOString()}>{clock(e.t)}</time>
              </div>
              {e.lines.map((m, i) => (
                <div key={i} className={`chat-line ${m.quick ? 'quick' : ''}`} title={clock(m.t)}>{m.text}</div>
              ))}
            </div>
          ))}
        </div>
        {pending > 0 && (
          <button className="chat-new" onClick={toBottom}>
            {pending} new message{pending > 1 ? 's' : ''} ↓
          </button>
        )}
      </div>
      {profile ? (
        <>
          {quick && <QuickChatRow send={sendTo} />}
          <form className="row" onSubmit={e => { e.preventDefault(); send(); }}>
            <input value={text} maxLength={300} placeholder="Message" onChange={e => setText(e.target.value)} />
            <button className="btn small" type="submit">Send</button>
          </form>
        </>
      ) : (
        <button className="btn small" onClick={openSignIn}>Sign in to chat</button>
      )}
    </div>
  );
}

/** The canned phrases as chips. Scrolls sideways on a phone. */
export function QuickChatRow({ onSent, send }: { onSent?: () => void; send?: (text: string, quick?: boolean) => Promise<unknown> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const fire = (phrase: string) => {
    if (busy) return;
    setBusy(phrase);
    (send ? send(phrase, true) : sendQuickChat(phrase)).catch(toastError).finally(() => { setBusy(null); onSent?.(); });
  };
  return (
    <div className="quick-chat" role="group" aria-label="Quick chat">
      {QUICK_CHAT.map(p => (
        <button key={p} type="button" className={`quick-chip ${busy === p ? 'busy' : ''}`} onClick={() => fire(p)} disabled={!!busy}>{p}</button>
      ))}
    </div>
  );
}

function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el?.tagName && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

/** Dock button: the quick phrases as a popover, for when the chat panel is closed. Q toggles it. */
export function QuickChatButton({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || typing(e.target)) return;
      if ((e.target as Element | null)?.closest?.('[aria-modal="true"]')) return;
      if (e.key.toLowerCase() === 'q' && !disabled) { e.preventDefault(); setOpen(o => !o); }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);
  return (
    <div className="react-picker quick-pop-wrap" ref={ref}>
      {open && (
        <div className="react-pop quick-pop" role="menu" aria-label="Quick chat">
          <QuickChatRow onSent={() => setOpen(false)} />
          <div className="react-hint muted">Q opens · Esc closes</div>
        </div>
      )}
      <button className={`dock-btn ${open ? 'on' : ''}`} disabled={disabled} onClick={() => setOpen(o => !o)}
        title={disabled ? 'Chat is switched off' : 'Quick chat (Q)'} aria-label="Quick chat" aria-expanded={open} aria-haspopup="menu">
        <span className="dock-ico" aria-hidden>💬</span><span className="dock-text">Quick chat</span>
      </button>
    </div>
  );
}
