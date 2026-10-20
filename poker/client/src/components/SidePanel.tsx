import { useEffect, useRef, useState } from 'react';
import type { ChatMsg, TableLogEntry } from '../../../shared/types';
import { CHAT_COOLDOWN_MS } from '../../../shared/types';
import Avatar from './Avatar';
import { IconClock } from './icons';
import { useAuth } from '../auth';

interface Props {
  chat: ChatMsg[];
  log: TableLogEntry[];
  // The reply id, when the message answers another one.
  onSend: (text: string, replyTo?: string) => void;
  // Everyone taggable here, for @mention autocomplete.
  people?: { id: string; name: string }[];
  // The viewer, so messages that tag them can light up.
  meId?: string | null;
  extraTabs?: { key: string; label: string; render: () => React.ReactNode }[];
  // The tournament lobby has no hands of its own — hide the tab there rather
  // than showing an empty twin of the chat.
  showLog?: boolean;
  // Chat can be switched off for the whole site by the operator.
  showChat?: boolean;
}

const hhmm = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// Desktop: a fixed right-hand column. Phones: a floating chat button that
// opens the same panel as a bottom sheet — chat exists everywhere now, and
// scrolling it never drags the page (the sheet scrolls inside itself).
export default function SidePanel({
  chat, log, onSend, extraTabs = [], showLog = true, showChat = true, people = [], meId = null,
}: Props) {
  const { chatEnabled } = useAuth();
  const [tab, setTab] = useState<string>(showChat ? 'chat' : 'log');
  const [draft, setDraft] = useState('');
  // The message being answered, if any. Only its id goes to the server: the
  // quote everyone sees is rebuilt there from the stored message.
  const [replyTo, setReplyTo] = useState<ChatMsg | null>(null);
  // Typing '@' on its own offers the last people who SPOKE — that is who you
  // are answering. It used to offer whoever was seated, ranked by recency, so
  // in a table full of quiet players you got three names that had nothing to
  // do with the conversation.
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const mentionFragment = (() => {
    const m = /@([\p{L}\p{N}_.-]*)$/u.exec(draft);
    return m ? m[1].toLowerCase() : null;
  })();
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Most recent speaker first, each person once.
  const speakers: { id: string; name: string }[] = [];
  for (let i = chat.length - 1; i >= 0; i--) {
    const m = chat[i];
    if (m.from === 'system') continue;
    const who = m.from as { id: string; name: string };
    if (who.id === meId || speakers.some(x => x.id === who.id)) continue;
    speakers.push({ id: who.id, name: who.name });
  }

  const suggestions = (() => {
    if (mentionFragment === null) return [];
    // Bare '@': the last three voices in the room.
    if (!mentionFragment) return speakers.slice(0, 3);
    // Once letters are typed it is a search, and a name is looked up by how it
    // STARTS — typing 'm' should not offer everyone with an m in the middle.
    const want = flat(mentionFragment);
    const pool = [...speakers];
    for (const p of people) {
      if (p.id === meId || pool.some(x => x.id === p.id)) continue;
      pool.push(p);
    }
    return pool.filter(p => flat(p.name).startsWith(want)).slice(0, 5);
  })();
  // Tags carry no spaces — "@Big Slick" would read as a tag on "Big" followed
  // by a stray word, and a space inside a tag is exactly what let "@yo t" ping
  // Yot. Picking from the list is the supported way to tag someone.
  const applyMention = (name: string) => {
    setDraft(d => d.replace(/@([\p{L}\p{N}_.-]*)$/u, `@${name.replace(/\s+/g, '')} `));
    inputRef.current?.focus();
  };
  const [open, setOpen] = useState(false); // mobile sheet
  // Reading chat is optional. Hidden, the panel leaves the layout entirely and
  // new messages arrive as pop-ups that fade by themselves, so nothing about
  // the conversation can change the height of the page.
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem('chatHidden') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('chatHidden', hidden ? '1' : '0'); } catch { /* private mode */ }
  }, [hidden]);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Chat is for people. The system's running commentary — eliminations,
  // level changes, balance moves, kicks — drowned real conversation during
  // the first live event, so it gets its own tab instead of the middle of
  // everyone's sentences. It is not dropped: the operator reads exactly these
  // lines to verify kicks and balancing did their job.
  const humanChat = chat.filter(m => m.from !== 'system');
  const events = chat.filter(m => m.from === 'system');
  const tabCount =
    (showChat ? 1 : 0) + (events.length > 0 ? 1 : 0) + (showLog ? 1 : 0) + extraTabs.length;

  // Unread badge: messages that arrived while the mobile sheet was closed.
  const seen = useRef(0);
  const humanCount = humanChat.length;
  useEffect(() => { if (open) seen.current = humanCount; }, [humanCount, open]);
  const unread = Math.min(99, Math.max(0, humanCount - seen.current));

  // Follow new messages only while the reader is already at the bottom.
  // Yanking someone back down mid-scroll is what makes a log feel like it
  // "jumps up" every time something happens.
  const stick = useRef(true);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    const el = bodyRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat, log, tab, open]);
  // Switching tabs (or opening the sheet) always lands at the newest entry.
  useEffect(() => { stick.current = true; }, [tab, open]);

  // Pop-ups for whoever is not watching the panel: the newest messages, each
  // dropped again a few seconds later. Only messages that arrive from now on
  // pop up — opening a table does not replay the backlog at you.
  const [toasts, setToasts] = useState<ChatMsg[]>([]);
  const lastSeenId = useRef<string | null>(null);
  const away = hidden || (!open && typeof window !== 'undefined' && window.innerWidth <= 900);
  useEffect(() => {
    const newest = humanChat[humanChat.length - 1];
    // Prime on the first run, whether or not there is a backlog. Returning
    // early on an EMPTY backlog left this unprimed, so the first message ever
    // said at a fresh table arrived looking like a backlog and never popped
    // up — the one message a player at a new table most needed to notice.
    if (lastSeenId.current === null) { lastSeenId.current = newest?.id ?? ''; return; }
    if (!newest) return;
    const already = lastSeenId.current === newest.id;
    lastSeenId.current = newest.id;
    if (already || !away) return;
    setToasts(t => [...t, newest].slice(-3));
    const drop = setTimeout(() => {
      setToasts(t => t.filter(x => x.id !== newest.id));
    }, 5_000);
    return () => clearTimeout(drop);
  }, [humanChat, away]);
  // Nothing lingers once the panel is back in view.
  useEffect(() => { if (!away) setToasts([]); }, [away]);

  // Slow mode. The server refuses a second message inside the cooldown, so the
  // wait is shown here instead of being discovered by having a message
  // rejected. It counts from the send this box made: an unprompted timer on a
  // fresh page would be a lie about a rule that has not been triggered.
  const [sentAt, setSentAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const waitLeft = Math.max(0, CHAT_COOLDOWN_MS - (now - sentAt));
  const cooling = sentAt > 0 && waitLeft > 0;

  useEffect(() => {
    if (!cooling) return;
    // Quarter-second ticks: the displayed second changes on time without a
    // timer running for the whole session.
    const iv = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(iv);
  }, [cooling]);

  const send = () => {
    const text = draft.trim();
    if (!text || cooling) return;
    onSend(text, replyTo?.id);
    setDraft('');
    setReplyTo(null);
    setSentAt(Date.now());
    setNow(Date.now());
  };

  return (
    <>
      <button
        className={`chat-fab${open ? ' active' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Close chat' : 'Open chat'}
      >
        💬
        {!open && unread > 0 && <span className="chat-fab-badge">{unread}</span>}
      </button>
      {open && <div className="side-backdrop" onClick={() => setOpen(false)} />}

      {showChat && toasts.length > 0 && (
        <div className="chat-toasts" aria-live="polite">
          {toasts.map(m => (
            <div key={m.id} className="chat-toast">
              <Avatar value={(m.from as { avatar: string }).avatar} size={16} chog={m.from === 'system' ? null : m.from.chog} />
              <span className="who">{(m.from as { name: string }).name}</span>
              <span className="chat-toast-text">{m.text}</span>
            </div>
          ))}
        </div>
      )}

      {hidden && (
        <button className="chat-reveal" onClick={() => setHidden(false)}>
          💬 Show chat{unread > 0 ? ` (${unread})` : ''}
        </button>
      )}

      <aside className={`side-panel${open ? ' open' : ''}${hidden ? ' hidden' : ''}`}>
        {/* With only one tab there is nothing to switch between, so the
            segmented control is dropped and it reads as a plain heading —
            a lone tab filling the strip looks like a giant button. */}
        <div className={`side-tabs${tabCount < 2 ? ' single' : ''}`}>
          {showChat && (
            <button className={`side-tab${tab === 'chat' ? ' active' : ''}`} onClick={() => setTab('chat')}>Chat</button>
          )}
          {events.length > 0 && (
            <button className={`side-tab${tab === 'events' ? ' active' : ''}`} onClick={() => setTab('events')}>Events</button>
          )}
          {showLog && (
            <button className={`side-tab${tab === 'log' ? ' active' : ''}`} onClick={() => setTab('log')}>Hands</button>
          )}
          {extraTabs.map(t => (
            <button key={t.key} className={`side-tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
          <button
            className="side-hide"
            onClick={() => setHidden(true)}
            title="Hide chat — new messages will pop up instead"
            aria-label="Hide chat"
          >
            ⤫
          </button>
          <button className="side-close" onClick={() => setOpen(false)} aria-label="Close chat">✕</button>
        </div>
        <div className="side-body" ref={bodyRef}>
          {tab === 'chat' && humanChat.length === 0 && (
            <div className="chat-msg system">No messages yet — say hi!</div>
          )}
          {tab === 'chat' && humanChat.map(m => (
            <div
              key={m.id}
              className={`chat-msg${meId && m.mentions?.includes(meId) ? ' mentioned' : ''}`}
            >
              {m.replyTo && (
                <button
                  className="chat-quote"
                  title="Jump to the message this answers"
                  onClick={() => {
                    const el = document.getElementById(`msg-${m.replyTo!.id}`);
                    if (!el) return;
                    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    el.classList.add('flash');
                    setTimeout(() => el.classList.remove('flash'), 1200);
                  }}
                >
                  <span className="quote-who">{m.replyTo.name}</span>
                  <span className="quote-text">{m.replyTo.text}</span>
                </button>
              )}
              <span className="chat-head" id={`msg-${m.id}`}>
                <Avatar value={(m.from as { avatar: string }).avatar} size={16} chog={m.from === 'system' ? null : m.from.chog} />
                <span className="who">{(m.from as { name: string }).name}</span>
                <span className="chat-time">{hhmm(m.ts)}</span>
                {chatEnabled && (
                  <button
                    className="chat-reply-btn"
                    title={`Reply to ${(m.from as { name: string }).name}`}
                    onClick={() => { setReplyTo(m); inputRef.current?.focus(); }}
                  >
                    ↩
                  </button>
                )}
              </span>
              <span className="chat-text">{m.text}</span>
            </div>
          ))}
          {tab === 'events' && events.map(m => (
            <div key={m.id} className="chat-msg system">
              <span className="chat-time">{hhmm(m.ts)}</span>{m.text}
            </div>
          ))}
          {tab === 'log' && showLog && log.map((e, i) => (
            <div key={i} className="log-entry">
              <span className="chat-time">{hhmm(e.ts)}</span>{e.text}
            </div>
          ))}
          {extraTabs.find(t => t.key === tab)?.render()}
        </div>
        {showChat && tab === 'chat' && !chatEnabled && (
          <p className="chat-off-note">Chat is turned off by the host.</p>
        )}
        {showChat && tab === 'chat' && chatEnabled && (
          <div className="chat-compose">
            {suggestions.length > 0 && (
              <div className="mention-list" role="listbox" aria-label="Tag someone">
                <p className="mention-head">Tag someone</p>
                {suggestions.map((p, i) => (
                  <button
                    key={p.id}
                    role="option"
                    aria-selected={i === active}
                    className={`mention-opt${i === active ? ' on' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => applyMention(p.name)}
                  >
                    <span className="mention-name">{p.name}</span>
                    <span className="mention-tag">@{p.name.replace(/\s+/g, '')}</span>
                  </button>
                ))}
              </div>
            )}
            {replyTo && (
              <div className="reply-bar">
                <span className="reply-label">Replying to <strong>{(replyTo.from as { name: string }).name}</strong></span>
                <span className="reply-snip">{replyTo.text}</span>
                <button className="reply-cancel" title="Cancel reply" onClick={() => setReplyTo(null)}>✕</button>
              </div>
            )}
            <div className="chat-input-row">
              <input
                ref={inputRef}
                className="input"
                placeholder="Say something… @ to tag"
                value={draft}
                maxLength={300}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  const list = suggestions;
                  if (list.length > 0) {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % list.length); return; }
                    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + list.length) % list.length); return; }
                    if (e.key === 'Tab' || e.key === 'Enter') {
                      // A name is being picked, so this keystroke completes it
                      // rather than sending a half-typed tag.
                      e.preventDefault();
                      applyMention(list[Math.min(active, list.length - 1)].name);
                      return;
                    }
                  }
                  if (e.key === 'Enter') send();
                }}
              />
              {/* Stacked, not beside: inline it took width from the row and pushed
                  Send off the edge of a panel this narrow. */}
              <div className="chat-send-col">
                {cooling && (
                  <span className="chat-cooldown" title={`Slow mode — one message every ${CHAT_COOLDOWN_MS / 1000}s`}>
                    <IconClock size={12} />
                    <span className="cc-secs">{Math.ceil(waitLeft / 1000)}s</span>
                  </span>
                )}
                <button className="btn btn-sm" onClick={send} disabled={cooling}>Send</button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
