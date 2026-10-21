// The app's last line: if a page throws while drawing, show a friendly
// "something broke" screen with Reload and Home instead of a blank page, and
// tell the server (POST /api/client-error, which lands in Dashboard → Logs
// under "client-errors"). At most a few reports per page load, never the same
// one twice, and never for a stale bundle after a deploy (that one just asks
// for a reload).
//
// Nothing is swallowed: the error still goes to the console (React logs it
// too), and in development the screen shows the message and the stack.
// Changing page (resetKey) clears the screen, so the header still works.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { getToken } from '../api.ts';

const sent = new Set<string>();
const MAX_REPORTS = 3;

/** An old tab asking for a code chunk the new deploy no longer has. */
function isStaleBundle(e: Error): boolean {
  return /dynamically imported module|Importing a module script failed|error loading dynamically|ChunkLoadError|Loading chunk/i.test(`${e.name} ${e.message}`);
}

export function reportClientError(e: Error, where = ''): void {
  if (import.meta.env.DEV || isStaleBundle(e)) return;
  const key = e.message;
  if (sent.has(key) || sent.size >= MAX_REPORTS) return;
  sent.add(key);
  const token = getToken();
  try {
    void fetch('/api/client-error', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        message: `${e.name}: ${e.message}`.slice(0, 300),
        path: location.pathname,
        // The first component frames say where; enough to find it, short enough to log.
        where: where.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 3).join(' < ').slice(0, 200),
        ua: navigator.userAgent.slice(0, 160),
      }),
    }).catch(() => { /* offline: nothing to do */ });
  } catch { /* fetch missing or blocked */ }
}

interface Props { children: ReactNode; resetKey?: string; full?: boolean }
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const e = error instanceof Error ? error : new Error(String(error));
    console.error('The page crashed:', e, info.componentStack);
    reportClientError(e, info.componentStack ?? '');
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isStaleBundle(error);
    return (
      <div className={`crash ${this.props.full ? 'crash-full' : ''}`} role="alert">
        <div className="crash-card">
          <img className="crash-chog" src="/brand/chog-mark-128.webp" alt="" width={96} height={96} />
          <h1>{stale ? 'A new version is out' : 'Something broke'}</h1>
          <p>
            {stale
              ? 'Chog Games was updated while this tab was open. Reload to get the new version.'
              : 'Sorry, this page hit a snag. Reloading usually fixes it. If it keeps happening, tell us in Discord.'}
          </p>
          <div className="crash-actions">
            <button type="button" className="btn primary" onClick={() => location.reload()} autoFocus>Reload</button>
            <a className="btn ghost" href="/">Go home</a>
          </div>
          {import.meta.env.DEV && (
            <pre className="crash-dev">{`${error.name}: ${error.message}\n\n${error.stack ?? ''}`}</pre>
          )}
        </div>
      </div>
    );
  }
}
