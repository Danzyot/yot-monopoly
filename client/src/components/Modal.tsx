// The one dialog shell every popup uses: a dimmed backdrop, role="dialog" with
// aria-modal, focus moved in on open (and handed back on close), Tab kept
// inside, Escape and a backdrop click to close. Plus an in-style replacement
// for window.confirm / window.prompt (askConfirm / askText), mounted once by
// <DialogHost /> in App.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement);
}

export function Modal({ onClose, label, labelledBy, className = '', backClassName = '', children, dismissable = true, behind }: {
  /** Escape, the backdrop and close buttons call this (absent: the dialog can't be dismissed). */
  onClose?: () => void;
  label?: string;
  labelledBy?: string;
  className?: string;
  backClassName?: string;
  children: ReactNode;
  /** false: a backdrop click does not close (Escape still does when onClose is set). */
  dismissable?: boolean;
  /** Decoration drawn on the backdrop, behind the dialog (confetti). */
  behind?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // Only a press that starts on the backdrop closes: a drag (selecting text)
  // that begins inside and lets go outside lands its click on the backdrop too.
  const downOutside = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const before = document.activeElement as HTMLElement | null;
    // Focus what the dialog asks for, else the dialog itself (Tab then walks
    // its controls) — never a text field on its own, which would pop the
    // phone keyboard over the dialog.
    const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? el;
    first.focus({ preventScroll: true });
    return () => {
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && close.current) {
      e.stopPropagation();
      e.preventDefault();
      close.current();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const list = focusables(ref.current);
    if (!list.length) { e.preventDefault(); return; }
    const first = list[0], last = list[list.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div className={`modal-back ${backClassName}`}
      onPointerDown={e => { downOutside.current = !ref.current?.contains(e.target as Node); }}
      onClick={() => dismissable && downOutside.current && close.current?.()}>
      {behind}
      <div ref={ref} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy} tabIndex={-1} onKeyDown={onKey} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/** The round ✕ in a dialog's corner. */
export function CloseX({ onClick, label = 'Close' }: { onClick: () => void; label?: string }) {
  return <button type="button" className="btn tiny ghost modal-x" onClick={onClick} aria-label={label}>✕</button>;
}

// ---- askConfirm / askText -----------------------------------------------------

interface ConfirmOpts {
  title: string;
  body?: ReactNode;
  /** Label of the go-ahead button. */
  confirm?: string;
  cancel?: string;
  /** Red go-ahead button, for things that cannot be undone. */
  danger?: boolean;
  icon?: string;
}
interface TextOpts { title: string; body?: ReactNode; placeholder?: string; initial?: string; confirm?: string; maxLength?: number }

type Request =
  | { kind: 'confirm'; opts: ConfirmOpts; done: (v: boolean) => void }
  | { kind: 'text'; opts: TextOpts; done: (v: string | null) => void };

const listeners = new Set<(r: Request) => void>();
function ask(r: Request) {
  if (!listeners.size) {
    // No host mounted (should not happen): fall back to the browser's own.
    if (r.kind === 'confirm') r.done(window.confirm(r.opts.title));
    else r.done(window.prompt(r.opts.title, r.opts.initial ?? ''));
    return;
  }
  listeners.forEach(f => f(r));
}

/** An in-style yes/no dialog. Resolves true when confirmed. */
export function askConfirm(opts: ConfirmOpts): Promise<boolean> {
  return new Promise(done => ask({ kind: 'confirm', opts, done }));
}

/** An in-style one-line text prompt. Resolves the text, or null when cancelled. */
export function askText(opts: TextOpts): Promise<string | null> {
  return new Promise(done => ask({ kind: 'text', opts, done }));
}

export function DialogHost() {
  const [queue, setQueue] = useState<Request[]>([]);
  useEffect(() => {
    const add = (r: Request) => setQueue(q => [...q, r]);
    listeners.add(add);
    return () => { listeners.delete(add); };
  }, []);
  const r = queue[0];
  if (!r) return null;
  const finish = (v: boolean | string | null) => {
    setQueue(q => q.slice(1));
    if (r.kind === 'confirm') r.done(v === true);
    else r.done(typeof v === 'string' ? v : null);
  };
  return createPortal(
    r.kind === 'confirm'
      ? <ConfirmBox key={queue.length} opts={r.opts} onDone={finish} />
      : <TextBox key={queue.length} opts={r.opts} onDone={finish} />,
    document.body,
  );
}

function ConfirmBox({ opts, onDone }: { opts: ConfirmOpts; onDone: (v: boolean) => void }) {
  return (
    <Modal onClose={() => onDone(false)} labelledBy="confirm-title" className="confirm-box" backClassName="confirm-back">
      {opts.icon && <div className="confirm-icon" aria-hidden>{opts.icon}</div>}
      <h2 id="confirm-title">{opts.title}</h2>
      {opts.body && <div className="confirm-body">{opts.body}</div>}
      <div className="confirm-actions">
        <button className="btn ghost" onClick={() => onDone(false)} data-autofocus={opts.danger ? true : undefined}>{opts.cancel ?? 'Cancel'}</button>
        <button className={`btn ${opts.danger ? 'danger' : 'primary'}`} onClick={() => onDone(true)}
          data-autofocus={opts.danger ? undefined : true}>{opts.confirm ?? 'OK'}</button>
      </div>
    </Modal>
  );
}

function TextBox({ opts, onDone }: { opts: TextOpts; onDone: (v: string | null) => void }) {
  const [text, setText] = useState(opts.initial ?? '');
  return (
    <Modal onClose={() => onDone(null)} labelledBy="confirm-title" className="confirm-box" backClassName="confirm-back">
      <h2 id="confirm-title">{opts.title}</h2>
      {opts.body && <div className="confirm-body">{opts.body}</div>}
      <form onSubmit={e => { e.preventDefault(); onDone(text); }}>
        <input data-autofocus value={text} maxLength={opts.maxLength ?? 80} placeholder={opts.placeholder} onChange={e => setText(e.target.value)} />
        <div className="confirm-actions">
          <button type="button" className="btn ghost" onClick={() => onDone(null)}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!text.trim()}>{opts.confirm ?? 'OK'}</button>
        </div>
      </form>
    </Modal>
  );
}
