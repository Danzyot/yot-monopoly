// /terms, /privacy and /fair-play. The words are data (shared/legal.ts, and an
// operator's edits from Dashboard → Pages), drawn from a tiny markup into
// elements, never as HTML. The built-in version shows at once and the
// server's copy replaces it if an operator has changed it.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { api } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { DEFAULT_LEGAL, parseLegal, type LegalInline, type LegalPage as Page, type LegalSlug } from '../../../shared/legal.ts';
import '../styles/pages.css';

function Inline({ parts }: { parts: LegalInline[] }) {
  return (
    <>
      {parts.map((p, i) => {
        let node: ReactNode = p.text;
        if (p.bold) node = <strong>{node}</strong>;
        if (p.href?.startsWith('/')) node = <Link to={p.href}>{node}</Link>;
        else if (p.href) node = <a href={p.href} target="_blank" rel="noopener noreferrer">{node}</a>;
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}

const dateFmt = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};

export default function LegalPage({ slug }: { slug: LegalSlug }) {
  const { config } = useAuth();
  const [page, setPage] = useState<Page>(DEFAULT_LEGAL[slug]);
  useEffect(() => {
    setPage(DEFAULT_LEGAL[slug]);
    let live = true;
    api<{ page: Page }>(`/api/pages/${slug}`)
      .then(r => { if (live && r.page?.body) setPage(r.page); })
      .catch(() => { /* the built-in words stand */ });
    window.scrollTo(0, 0);
    return () => { live = false; };
  }, [slug]);

  const blocks = parseLegal(page.body, config.inviteUrl ?? null);
  return (
    <div className="page legal-page">
      <nav className="legal-tabs" aria-label="Site information">
        <NavLink to="/terms">Terms</NavLink>
        <NavLink to="/privacy">Privacy</NavLink>
        <NavLink to="/fair-play">Fair play</NavLink>
      </nav>
      <article className="panel legal-body" aria-labelledby="legal-title">
        <header className="legal-head">
          <h1 id="legal-title">{page.title}</h1>
          <p className="legal-meta">Last updated <time dateTime={page.updated}>{dateFmt(page.updated)}</time></p>
        </header>
        {blocks.map((b, i) => {
          if (b.kind === 'h2') return <h2 key={i}>{b.text}</h2>;
          if (b.kind === 'ul') return <ul key={i}>{b.items.map((it, j) => <li key={j}><Inline parts={it} /></li>)}</ul>;
          return <p key={i}><Inline parts={b.parts} /></p>;
        })}
        <p className="legal-note">Written in plain language for players. Not legal advice.</p>
      </article>
    </div>
  );
}
