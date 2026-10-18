// Demo-mode "Edit text". Overrides map the ORIGINAL on-page string to a new
// one (server: textOverrides.ts). They are applied to the DOM, not through
// React, by a MutationObserver that rewrites matching text nodes as React
// renders them; React never notices because it only writes a text node when
// its own value changes, and then the observer looks again.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api } from './api.ts';
import { useAuth } from './auth.tsx';
import { toast, toastError } from './toast.tsx';

const CACHE_KEY = 'yot:text-overrides';
/** Never rewritten or editable: form fields, the 3D canvas, code, and our own UI. */
const SKIP = 'script,style,noscript,textarea,input,select,option,canvas,svg,[data-te-ui],[data-no-edit],[contenteditable="true"]';
/** Something worth editing has at least a couple of letters ("7", "$1,500" are data). */
const WORDY = /\p{L}{2}/u;
export const MAX_TEXT = 300;

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

// ---- store ----------------------------------------------------------------

interface Snap { overrides: Record<string, string>; editing: boolean; history: { original: string; prev: string | null }[] }

function readCache(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as unknown;
    if (raw && typeof raw === 'object') {
      return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    }
  } catch { /* no storage: fine */ }
  return {};
}

let snap: Snap = { overrides: readCache(), editing: false, history: [] };
const subs = new Set<() => void>();

function set(patch: Partial<Snap>) {
  snap = { ...snap, ...patch };
  if (patch.overrides) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(snap.overrides)); } catch { /* ignore */ }
    applyAll();
  }
  subs.forEach(f => f());
}

export function useTextEdit(): Snap {
  return useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => snap);
}

export const setTextEditing = (on: boolean) => { if (snap.editing !== on) set({ editing: on }); };

export async function refreshTextOverrides(): Promise<void> {
  try {
    const r = await api<{ overrides: Record<string, string> }>('/api/text-overrides');
    set({ overrides: r.overrides ?? {} });
  } catch { /* offline: keep the cached copy */ }
}

/** text null = reset. Resolves to the server's full list. */
async function save(original: string, text: string | null): Promise<void> {
  const prev = snap.overrides[original] ?? null;
  const r = await api<{ overrides: Record<string, string> }>('/api/text-overrides', { method: 'PUT', json: { original, text } });
  set({ overrides: r.overrides, history: [...snap.history, { original, prev }].slice(-30) });
}

async function undo(): Promise<void> {
  const last = snap.history[snap.history.length - 1];
  if (!last) return;
  const r = await api<{ overrides: Record<string, string> }>('/api/text-overrides', { method: 'PUT', json: { original: last.original, text: last.prev } });
  set({ overrides: r.overrides, history: snap.history.slice(0, -1) });
}

// ---- DOM rewriting --------------------------------------------------------

/** Nodes we rewrote: their raw original value, and the value we wrote. */
const rawOrig = new WeakMap<Text, string>();
const written = new WeakMap<Text, string>();

const skipped = (t: Text) => {
  const el = t.parentElement;
  return !el || !!el.closest(SKIP);
};

function withSpace(raw: string, text: string): string {
  const lead = /^\s*/.exec(raw)?.[0] ?? '';
  const trail = /\s*$/.exec(raw)?.[0] ?? '';
  return lead + text + trail;
}

function applyNode(t: Text) {
  const cur = t.nodeValue ?? '';
  const mine = written.get(t);
  if (mine !== undefined) {
    if (mine === cur) {
      // Still our text: follow the current override (changed or removed).
      const raw = rawOrig.get(t) ?? cur;
      const target = snap.overrides[norm(raw)];
      const next = target ? withSpace(raw, target) : raw;
      if (next !== cur) t.nodeValue = next;
      if (target) written.set(t, next);
      else { written.delete(t); rawOrig.delete(t); }
      return;
    }
    // React wrote something new over it: treat as a fresh node.
    written.delete(t); rawOrig.delete(t);
  }
  const target = snap.overrides[norm(cur)];
  if (!target || skipped(t)) return;
  const next = withSpace(cur, target);
  if (next === cur) return;
  rawOrig.set(t, cur);
  written.set(t, next);
  t.nodeValue = next;
}

function walk(root: Node) {
  if (root.nodeType === 3) { applyNode(root as Text); return; }
  if (root.nodeType !== 1) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) applyNode(n as Text);
}

function applyAll() {
  if (typeof document !== 'undefined' && document.body) walk(document.body);
}

let observer: MutationObserver | null = null;
function startObserver() {
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver(records => {
    // Nothing to rewrite and nothing to restore: stay out of React's way.
    if (!Object.keys(snap.overrides).length) return;
    for (const m of records) {
      if (m.type === 'characterData') applyNode(m.target as Text);
      else m.addedNodes.forEach(walk);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  applyAll();
}

// ---- finding what was clicked ---------------------------------------------

function editable(t: Text | null): t is Text {
  return !!t && !skipped(t) && WORDY.test(t.nodeValue ?? '');
}

function pickText(target: EventTarget | null, x: number, y: number): Text | null {
  const el = target instanceof Element ? target : null;
  if (!el || el.closest(SKIP)) return null;
  let n: Node | null = null;
  try {
    if (document.caretPositionFromPoint) n = document.caretPositionFromPoint(x, y)?.offsetNode ?? null;
    else if (document.caretRangeFromPoint) n = document.caretRangeFromPoint(x, y)?.startContainer ?? null;
  } catch { /* some browsers throw for odd points */ }
  if (n && n.nodeType === 3 && el.contains(n) && editable(n as Text)) return n as Text;
  // Otherwise the closest element at or above the click that has words of its own.
  let e: Element | null = el;
  for (let i = 0; e && i < 4 && e !== document.body; i++, e = e.parentElement) {
    if (e.closest(SKIP)) return null;
    for (const c of Array.from(e.childNodes)) if (c.nodeType === 3 && editable(c as Text)) return c as Text;
  }
  return null;
}

// ---- UI ---------------------------------------------------------------------

/** The header switch. Only demo servers, only signed-in players. */
export function EditTextToggle() {
  const { config, profile } = useAuth();
  const { editing } = useTextEdit();
  if (!config.demoMode || !profile) return null;
  return (
    <button
      className={`btn tiny ghost te-toggle ${editing ? 'on' : ''}`}
      aria-pressed={editing}
      data-te-ui
      onClick={() => setTextEditing(!editing)}
      title="Demo mode: click any text on the site to rewrite it for everyone"
    >
      ✏️ {editing ? 'Editing text' : 'Edit text'}
    </button>
  );
}

interface Target { node: Text; original: string; current: string; rect: DOMRect }

/** Mounted once at the app root: loads and applies overrides, runs edit mode. */
export function TextEditHost() {
  const { config, profile } = useAuth();
  const { editing, overrides, history } = useTextEdit();
  const [target, setTarget] = useState<Target | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const hoverEl = useRef<Element | null>(null);
  const allowed = config.demoMode && !!profile;

  useEffect(() => {
    startObserver();
    void refreshTextOverrides();
    const onFocus = () => { void refreshTextOverrides(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Signing out (or demo mode ending) ends edit mode.
  useEffect(() => { if (editing && !allowed) setTextEditing(false); }, [editing, allowed]);
  useEffect(() => { if (!editing) setTarget(null); }, [editing]);

  useEffect(() => {
    if (!editing) return;
    document.body.classList.add('te-on');
    const clearHover = () => { hoverEl.current?.classList.remove('te-hover'); hoverEl.current = null; };
    const onOver = (e: MouseEvent) => {
      const t = pickText(e.target, e.clientX, e.clientY);
      const el = t?.parentElement ?? null;
      if (el === hoverEl.current) return;
      clearHover();
      if (el) { el.classList.add('te-hover'); hoverEl.current = el; }
    };
    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest('[data-te-ui]')) return;
      const t = pickText(e.target, e.clientX, e.clientY);
      if (!t) return;
      // Editing, not pressing: the button underneath must not fire.
      e.preventDefault();
      e.stopPropagation();
      const current = norm(t.nodeValue ?? '');
      const original = norm(rawOrig.get(t) ?? t.nodeValue ?? '');
      setTarget({ node: t, original, current, rect: (t.parentElement ?? document.body).getBoundingClientRect() });
      setDraft(current);
    };
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('click', onClick, true);
      document.body.classList.remove('te-on');
      clearHover();
    };
  }, [editing]);

  const run = (p: Promise<void>, done?: () => void) => {
    setBusy(true);
    p.then(done).catch(toastError).finally(() => setBusy(false));
  };

  const doSave = () => {
    if (!target) return;
    const text = norm(draft);
    if (!text) { toast('Type some text, or use Reset', 'error'); return; }
    run(save(target.original, text === target.original ? null : text), () => { setTarget(null); toast('Saved for everyone'); });
  };

  const keys = Object.keys(overrides);
  if (!editing) return null;

  const r = target?.rect;
  const narrow = typeof window !== 'undefined' && window.innerWidth < 640;
  const pop: React.CSSProperties = !r || narrow ? {} : {
    left: Math.max(8, Math.min(r.left, window.innerWidth - 340)),
    top: r.bottom + 330 > window.innerHeight ? Math.max(8, r.top - 190) : r.bottom + 8,
  };

  return (
    <>
      <div className="te-panel" data-te-ui role="region" aria-label="Edit text">
        <div className="te-bar">
          <b>✏️ Click any text to change it</b>
          <button className="btn tiny" onClick={() => setOpen(o => !o)} aria-expanded={open}>Edits ({keys.length})</button>
          <button className="btn tiny" disabled={!history.length || busy} onClick={() => run(undo())}>Undo</button>
          <button className="btn tiny primary" onClick={() => setTextEditing(false)}>Done</button>
        </div>
        {open && (
          <ul className="te-list">
            {keys.length === 0 && <li className="muted">Nothing edited yet.</li>}
            {keys.map(k => (
              <li key={k}>
                <span className="te-was">{k}</span>
                <span className="te-arrow">→</span>
                <span className="te-now">{overrides[k]}</span>
                <button className="btn tiny" disabled={busy} onClick={() => run(save(k, null))}>Reset</button>
              </li>
            ))}
          </ul>
        )}
        <p className="te-note muted">Words that change as you play (names, money) can only be edited as exact text.</p>
      </div>

      {target && (
        <div className="te-pop" data-te-ui style={pop} role="dialog" aria-label="Edit this text">
          <label className="te-lab">
            Text (everyone sees it)
            <textarea
              autoFocus
              rows={3}
              maxLength={MAX_TEXT}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSave(); }
                if (e.key === 'Escape') setTarget(null);
              }}
            />
          </label>
          {target.original !== target.current && <p className="te-orig muted">Original: {target.original}</p>}
          <div className="te-actions">
            <button className="btn small primary" disabled={busy} onClick={doSave}>Save</button>
            {target.original in overrides && (
              <button className="btn small" disabled={busy} onClick={() => run(save(target.original, null), () => { setTarget(null); toast('Back to the original'); })}>Reset this text</button>
            )}
            <button className="btn small ghost" onClick={() => setTarget(null)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
