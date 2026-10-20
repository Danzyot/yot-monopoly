// Pages: the words on /terms, /privacy and /fair-play. Each page is a title
// and a body in the small markup described under the editor (shared/legal.ts
// has the defaults and the parser); saving stamps today's date on the page.
// The Content tab and demo-mode "Edit text" only rename short strings, so
// long-form pages get their own editor here.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.ts';
import { LEGAL_LIMITS, LEGAL_SLUGS, type LegalPage, type LegalSlug } from '../../../../shared/legal.ts';
import { act, usePoll } from './adminApi.ts';

type Row = LegalPage & { edited: boolean };
const NAMES: Record<LegalSlug, string> = { terms: 'Terms', privacy: 'Privacy', 'fair-play': 'Fair play' };

export default function PagesTab() {
  const [slug, setSlug] = useState<LegalSlug>('terms');
  const { data, error, reload } = usePoll<{ page: Row }>(`/api/pages/${slug}`);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const page = data?.page ?? null;
  useEffect(() => { if (page) { setTitle(page.title); setBody(page.body); } }, [page]);
  const dirty = !!page && (title !== page.title || body !== page.body);

  const save = () => act(async () => {
    await api(`/api/admin/pages/${slug}`, { method: 'PUT', json: { title, body } });
    await reload();
  }, { ok: `/${slug} saved` });
  const reset = () => act(async () => {
    await api(`/api/admin/pages/${slug}`, { method: 'DELETE' });
    await reload();
  }, { confirm: `Put /${slug} back to the built-in text? Your edits to it are lost.`, ok: `/${slug} is back to the built-in text` });

  return (
    <div className="adm-stack" data-no-edit>
      <div className="row between wrap adm-toolbar">
        <h2 className="adm-h2">Pages</h2>
        <nav className="adm-seg" aria-label="Pages">
          {LEGAL_SLUGS.map(s => (
            <button key={s} type="button" className={s === slug ? 'on' : ''} aria-pressed={s === slug}
              onClick={() => setSlug(s)}>{NAMES[s]}</button>
          ))}
        </nav>
      </div>
      <div className="adm-alert info">
        <span aria-hidden>ℹ️</span>{' '}
        The footer's info pages. Plain language, and not legal advice: have them checked if that matters.
        Saving updates the page for everyone at once and sets its “last updated” date to today.
      </div>
      {error && !page && <p className="warn">{error}</p>}
      {!page && !error && <div className="sk sk-row" aria-busy="true" aria-label="Loading the page" />}
      {page && (
        <form className="adm-card adm-stack" onSubmit={e => { e.preventDefault(); void save(); }}>
          <div className="row between wrap">
            <span className="muted small">
              {page.edited ? `Edited · last updated ${page.updated}` : `Built-in text · ${page.updated}`}
              {' · '}<Link to={`/${slug}`} target="_blank" rel="noopener">View /{slug}</Link>
            </span>
          </div>
          <label className="adm-field">
            <span>Title</span>
            <input value={title} maxLength={LEGAL_LIMITS.title} onChange={e => setTitle(e.target.value)} />
          </label>
          <label className="adm-field">
            <span>Text <span className="muted small">({body.length.toLocaleString()} / {LEGAL_LIMITS.body.toLocaleString()})</span></span>
            <textarea value={body} rows={22} maxLength={LEGAL_LIMITS.body} spellCheck onChange={e => setBody(e.target.value)}
              style={{ width: '100%', font: '14px/1.5 ui-monospace, Menlo, monospace', resize: 'vertical' }} />
          </label>
          <p className="muted small" style={{ margin: 0 }}>
            <code>## Heading</code> starts a section · <code>- item</code> makes a bullet · <code>**bold**</code> ·{' '}
            <code>[words](/privacy)</code> or <code>[words](https://…)</code> links · <code>[our Discord](discord:)</code> links the Discord invite ·
            a blank line starts a new paragraph.
          </p>
          <div className="row end wrap">
            <button type="button" className="btn small ghost" disabled={!page.edited} onClick={() => void reset()}>Back to built-in</button>
            <button type="button" className="btn small ghost" disabled={!dirty} onClick={() => { setTitle(page.title); setBody(page.body); }}>Undo changes</button>
            <button type="submit" className="btn small primary" disabled={!dirty || !title.trim() || !body.trim()}>Save</button>
          </div>
        </form>
      )}
    </div>
  );
}
