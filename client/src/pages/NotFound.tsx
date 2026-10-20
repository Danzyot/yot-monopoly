// Any address no page answers (App.tsx's catch-all). The server sends these
// with status 404 and noindex too (server/src/seo.ts).
import { Link, useLocation } from 'react-router-dom';
import { GAMES } from '../../../shared/brand.ts';
import '../styles/pages.css';

export default function NotFound() {
  const path = useLocation().pathname;
  return (
    <div className="page nf-page">
      <div className="nf-card panel">
        <div className="nf-art" aria-hidden="true">
          <span className="nf-4">4</span>
          <img src="/brand/chog-mark-128.webp" alt="" width={112} height={112} />
          <span className="nf-4">4</span>
        </div>
        <h1>Chog took a wrong turn</h1>
        <p className="nf-text">
          There's nothing at <code className="nf-path">{path.length > 60 ? `${path.slice(0, 57)}…` : path}</code>.
          The link may be old, or the table may have closed.
        </p>
        <div className="nf-actions">
          <Link className="btn primary chunky" to="/">Back to the games</Link>
          <Link className="btn ghost" to={GAMES.cards.path}>{GAMES.cards.name}</Link>
          <Link className="btn ghost" to="/tournaments">Tournaments</Link>
        </div>
      </div>
    </div>
  );
}
