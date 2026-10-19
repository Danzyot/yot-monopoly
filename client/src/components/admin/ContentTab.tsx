// Content: every name a player reads on the board and around it, in one
// place. Space names, card text, look names and currency, characters and
// mini-games are stored server-side (server/src/content.ts) and merged into
// theme resolution everywhere, so a rename shows on the 3D board, deeds, the
// log and card pop-ups alike. Prices, rents and card effects are read-only.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.ts';
import { useAuth } from '../../auth.tsx';
import { setLiveContent, useContent } from '../../content.ts';
import { setTextEditing } from '../../textEdit.tsx';
import { toast } from '../../toast.tsx';
import { CHARACTER_DEFS } from '../../../../shared/characters.ts';
import { contentDefault, contentLimit, describeEffect } from '../../../../shared/content.ts';
import {
  countOverrides, overrideFor, type ContentItem, type ContentKind, type ContentOverrides, type EditionField,
} from '../../../../shared/contentOverrides.ts';
import { MAPS, getMap } from '../../../../shared/maps.ts';
import { MINIGAME_INFO, MINIGAME_KINDS } from '../../../../shared/minigames.ts';
import { THEMES, resolveTheme } from '../../../../shared/themes.ts';
import type { DeckId } from '../../../../shared/cards.ts';
import { act } from './adminApi.ts';
import '../../styles/content.css';

type Section = 'spaces' | 'cards' | 'looks' | 'characters' | 'minigames' | 'text';

const SECTIONS: { id: Section; label: string; kind?: ContentKind }[] = [
  { id: 'spaces', label: 'Board spaces', kind: 'space' },
  { id: 'cards', label: 'Cards', kind: 'card' },
  { id: 'looks', label: 'Looks', kind: 'edition' },
  { id: 'characters', label: 'Characters', kind: 'character' },
  { id: 'minigames', label: 'Mini-games', kind: 'minigame' },
  { id: 'text', label: 'Site text' },
];

const PLURAL: Record<ContentKind, string> = {
  space: 'space names', card: 'card texts', edition: 'look names', character: 'character names', minigame: 'mini-game names',
};

const SECTION_KEY = 'yot:adm-content-section';

async function save(item: ContentItem, text: string | null): Promise<void> {
  const r = await api<{ overrides: ContentOverrides }>('/api/admin/content', { method: 'PUT', json: { item, text } });
  setLiveContent(r.overrides);
}

async function resetKind(kind?: ContentKind): Promise<void> {
  const r = await api<{ overrides: ContentOverrides }>('/api/admin/content', { method: 'DELETE', json: kind ? { kind } : {} });
  setLiveContent(r.overrides);
}

export default function ContentTab() {
  const o = useContent();
  const [section, setSection] = useState<Section>(() => {
    try { return (SECTIONS.find(s => s.id === localStorage.getItem(SECTION_KEY))?.id) ?? 'spaces'; } catch { return 'spaces'; }
  });
  useEffect(() => { try { localStorage.setItem(SECTION_KEY, section); } catch { /* fine */ } }, [section]);
  const total = countOverrides(o);
  const cur = SECTIONS.find(s => s.id === section)!;

  return (
    <div className="adm-stack cn" data-no-edit>
      <div className="row between wrap adm-toolbar">
        <h2 className="adm-h2">Content <span className="lb-count">{total} edited</span></h2>
        <button type="button" className="btn tiny ghost" disabled={!total}
          onClick={() => void act(() => resetKind(), { confirm: `Put all ${total} edited names and texts back to their defaults?`, ok: 'Everything is back to default' })}>
          Reset everything
        </button>
      </div>
      <div className="adm-alert info">
        <span aria-hidden>ℹ️</span>
        <span className="grow">
          Renames show everywhere the name appears: the 3D board, deeds, card pop-ups, the game log and the lobby.
          New games use them straight away; a game already being played keeps its names until it ends.
          Players pick them up the next time they load the site.
        </span>
      </div>
      <nav className="adm-seg cn-sections" aria-label="Content sections">
        {SECTIONS.map(s => {
          const n = s.kind ? countOverrides(o, s.kind) : 0;
          return (
            <button key={s.id} type="button" className={s.id === section ? 'on' : ''} aria-pressed={s.id === section} onClick={() => setSection(s.id)}>
              {s.label}{n > 0 && <span className="cn-count"> {n}</span>}
            </button>
          );
        })}
      </nav>
      {cur.kind && countOverrides(o, cur.kind) > 0 && (
        <div className="row cn-reset-kind">
          <button type="button" className="btn tiny ghost"
            onClick={() => void act(() => resetKind(cur.kind), { confirm: `Put all ${PLURAL[cur.kind!]} back to their defaults?`, ok: `${cur.label}: back to default` })}>
            Reset all {PLURAL[cur.kind]}
          </button>
        </div>
      )}
      {section === 'spaces' && <SpacesPanel />}
      {section === 'cards' && <CardsPanel />}
      {section === 'looks' && <LooksPanel />}
      {section === 'characters' && <CharactersPanel />}
      {section === 'minigames' && <MinigamesPanel />}
      {section === 'text' && <SiteTextPanel />}
    </div>
  );
}

// ---- one editable value -----------------------------------------------------

function Field({ item, label, multiline }: { item: ContentItem; label: string; multiline?: boolean }) {
  const o = useContent();
  const over = overrideFor(o, item);
  const def = contentDefault(item);
  const value = over ?? def;
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const max = contentLimit(item);
  const clean = draft.replace(/\s+/g, ' ').trim();
  const dirty = clean !== value;
  const tooLong = Array.from(clean).length > max;

  const run = async (text: string | null) => {
    setBusy(true);
    const ok = await act(() => save(item, text), { ok: text === null ? `${label}: back to “${def}”` : `${label}: saved` });
    if (!ok) setDraft(value);
    setBusy(false);
  };
  const submit = () => { if (dirty && !tooLong && !busy) void run(clean || null); };
  const common = {
    value: draft,
    'aria-label': label,
    'aria-invalid': tooLong || undefined,
    maxLength: max + 20,
    disabled: busy,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !(multiline && e.shiftKey)) { e.preventDefault(); submit(); }
      if (e.key === 'Escape') setDraft(value);
    },
  };

  return (
    <div className={`cn-field ${over !== undefined ? 'edited' : ''} ${dirty ? 'dirty' : ''}`}>
      {multiline ? <textarea rows={2} {...common} /> : <input type="text" {...common} />}
      {(dirty || over !== undefined) && (
        <div className="cn-field-bar">
          {dirty ? (
            <>
              <span className={`small ${tooLong ? 'adm-field-error' : 'muted'}`}>{Array.from(clean).length}/{max}</span>
              <button type="button" className="btn tiny primary" disabled={tooLong || busy} onClick={submit}>Save</button>
              <button type="button" className="btn tiny ghost" disabled={busy} onClick={() => setDraft(value)}>Cancel</button>
            </>
          ) : (
            <>
              <span className="cn-chip" title="Changed from the default">edited</span>
              <span className="muted small cn-default" title={def}>was “{def}”</span>
              <button type="button" className="btn tiny ghost" disabled={busy} onClick={() => void run(null)}>Reset to default</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---- pickers ------------------------------------------------------------------

function BoardLookPicker({ mapId, themeId, setMapId, setThemeId }: {
  mapId: string; themeId: string; setMapId: (v: string) => void; setThemeId: (v: string) => void;
}) {
  return (
    <div className="row wrap cn-pickers">
      <div className="adm-seg" role="group" aria-label="Board">
        {MAPS.map(m => (
          <button key={m.id} type="button" className={m.id === mapId ? 'on' : ''} aria-pressed={m.id === mapId} onClick={() => setMapId(m.id)}>{m.name}</button>
        ))}
      </div>
      <div className="adm-seg" role="group" aria-label="Look">
        {THEMES.map(t => (
          <button key={t.id} type="button" className={t.id === themeId ? 'on' : ''} aria-pressed={t.id === themeId} onClick={() => setThemeId(t.id)}>{t.name}</button>
        ))}
      </div>
    </div>
  );
}

function useBoardLook() {
  const [mapId, setMapId] = useState('classic');
  const [themeId, setThemeId] = useState('classic');
  return { mapId, themeId, setMapId, setThemeId };
}

// ---- board spaces ---------------------------------------------------------------

const KIND_LABEL: Record<string, string> = {
  go: 'Start', property: 'Street', railroad: 'Railroad', utility: 'Utility', tax: 'Tax', chance: 'Chance',
  chest: 'Chest', jail: 'Jail', parking: 'Parking', gotojail: 'Go to jail', arcade: 'Arcade',
};

const SET_LABEL: Record<string, string> = { lightblue: 'Light blue', darkblue: 'Dark blue' };

function SpacesPanel() {
  const bl = useBoardLook();
  const { mapId, themeId } = bl;
  const o = useContent();
  const [q, setQ] = useState('');
  const theme = useMemo(() => resolveTheme(themeId, mapId), [themeId, mapId, o]);
  const map = getMap(mapId);
  const cur = theme.currency;

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = new Map<string, { title: string; color: string | null; rows: number[] }>();
    const add = (key: string, title: string, color: string | null, i: number) => {
      if (!out.has(key)) out.set(key, { title, color, rows: [] });
      out.get(key)!.rows.push(i);
    };
    // Streets first, set by set in board order; then the rest.
    const order: string[] = [];
    theme.spaces.forEach((s, i) => {
      const hay = `${i} ${s.name} ${map.spaces[i].name} ${s.group ?? ''} ${KIND_LABEL[s.kind] ?? s.kind}`.toLowerCase();
      if (needle && !hay.includes(needle)) return;
      if (s.kind === 'property') {
        if (!order.includes(s.group!)) order.push(s.group!);
        add(s.group!, SET_LABEL[s.group!] ?? s.group![0].toUpperCase() + s.group!.slice(1), theme.groupColors[s.group!] ?? '#888', i);
      } else if (s.kind === 'railroad') add('~rail', 'Railroads', null, i);
      else if (s.kind === 'utility') add('~util', 'Utilities', null, i);
      else add('~other', 'Corners, taxes, cards and arcades', null, i);
    });
    return [...order, '~rail', '~util', '~other'].filter(k => out.has(k)).map(k => ({ key: k, ...out.get(k)! }));
  }, [theme, map, q]);

  return (
    <section className="adm-stack" aria-label="Board spaces">
      <BoardLookPicker {...bl} />
      <label className="adm-search">
        <span className="sr-only">Search spaces</span>
        <input type="search" placeholder={`Search ${theme.spaces.length} spaces on ${map.name} · ${theme.name}`} value={q} onChange={e => setQ(e.target.value)} />
      </label>
      {!groups.length && <p className="adm-hint muted">No space matches “{q}”.</p>}
      {groups.map(g => (
        <div key={g.key} className="adm-card cn-group">
          <h3 className="cn-group-h">
            {g.color && <i className="cn-swatch" style={{ background: g.color }} aria-hidden />}
            <span className="cn-group-name">{g.title}</span>
            {g.color && <code className="muted small">{g.color}</code>}
            <span className="muted small">· {g.rows.length} space{g.rows.length === 1 ? '' : 's'}</span>
          </h3>
          <table className="cn-table">
            <thead>
              <tr><th className="cn-c-idx">#</th><th className="cn-c-kind">Kind</th><th className="cn-c-name">Name</th><th className="cn-c-price">Price</th><th>Rent</th><th className="cn-c-house">House</th></tr>
            </thead>
            <tbody>
              {g.rows.map(i => {
                const s = theme.spaces[i];
                const rent = s.kind === 'property' ? s.rent!.map(r => `${cur}${r}`).join(' · ')
                  : s.kind === 'railroad' ? `${cur}25 · ${cur}50 · ${cur}100 · ${cur}200 by railroads owned`
                    : s.kind === 'utility' ? '4× dice, 10× with every utility' : '—';
                return (
                  <tr key={i}>
                    <td data-label="#" className="cn-idx">{i}</td>
                    <td data-label="Kind">{KIND_LABEL[s.kind] ?? s.kind}</td>
                    <td data-label="Name" className="cn-name"><Field item={{ kind: 'space', theme: themeId, map: mapId, index: i }} label={`Space ${i} name`} /></td>
                    <td data-label="Price">{s.price ? `${cur}${s.price}` : s.tax ? `pay ${cur}${s.tax}` : '—'}</td>
                    <td data-label="Rent" className="cn-rent" title={s.kind === 'property' ? 'Base · 1 house · 2 · 3 · 4 · hotel' : undefined}>{rent}</td>
                    <td data-label="House">{s.houseCost ? `${cur}${s.houseCost}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

// ---- cards ----------------------------------------------------------------------

function CardsPanel() {
  const bl = useBoardLook();
  const { mapId, themeId } = bl;
  const o = useContent();
  const theme = useMemo(() => resolveTheme(themeId, mapId), [themeId, mapId, o]);
  const map = getMap(mapId);
  const name = (i: number) => theme.spaces[i]?.name ?? '?';

  return (
    <section className="adm-stack" aria-label="Cards">
      <BoardLookPicker {...bl} />
      <p className="muted small cn-help">
        In card text, <code>{'{39}'}</code> prints the name of space 39 on this board (so a rename follows), <code>{'{jail}'}</code> the jail’s name,
        and <code>$</code> the look’s currency. The effect is fixed by the game and only shown here.
      </p>
      {(['chance', 'chest'] as DeckId[]).map(deck => (
        <div key={deck} className="adm-card cn-group">
          <h3 className="cn-group-h"><span className="cn-group-name">{theme.deckNames[deck]}</span><span className="muted small">· {map[deck].length} cards</span></h3>
          <table className="cn-table cn-cards">
            <thead><tr><th className="cn-c-idx">#</th><th className="cn-c-card">Card text</th><th>Reads as</th><th className="cn-c-effect">Effect</th></tr></thead>
            <tbody>
              {map[deck].map((c, i) => (
                <tr key={i}>
                  <td data-label="#" className="cn-idx">{i}</td>
                  <td data-label="Card text" className="cn-name"><Field item={{ kind: 'card', theme: themeId, map: mapId, deck, index: i }} label={`${theme.deckNames[deck]} card ${i}`} multiline /></td>
                  <td data-label="Reads as" className="cn-preview">{theme[deck][i].text}</td>
                  <td data-label="Effect" className="muted small">{describeEffect(c.effect, name, theme.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

// ---- looks, characters, mini-games ---------------------------------------------

const EDITION_LABELS: [EditionField, string, boolean?][] = [
  ['name', 'Name'], ['tagline', 'Tagline', true], ['centerTitle', 'Title in the middle of the board'],
  ['currency', 'Currency symbol'], ['chance', 'Chance deck name'], ['chest', 'Community Chest deck name'],
];

function LooksPanel() {
  return (
    <section className="adm-grid" aria-label="Looks">
      {THEMES.map(t => (
        <div key={t.id} className="adm-card cn-entity">
          <h3>{t.name} <span className="muted small">({t.id})</span></h3>
          {EDITION_LABELS.map(([field, label, multi]) => (
            <label key={field} className="cn-labelled">
              <span className="small muted">{label}</span>
              <Field item={{ kind: 'edition', id: t.id, field }} label={`${t.name}: ${label}`} multiline={multi} />
            </label>
          ))}
        </div>
      ))}
    </section>
  );
}

function CharactersPanel() {
  return (
    <section className="adm-grid" aria-label="Characters">
      {CHARACTER_DEFS.map(c => (
        <div key={c.id} className="adm-card cn-entity">
          <h3><span aria-hidden>{c.emoji}</span> {c.name} <span className="muted small">({c.id})</span></h3>
          <label className="cn-labelled"><span className="small muted">Name</span><Field item={{ kind: 'character', id: c.id, field: 'name' }} label={`${c.id}: name`} /></label>
          <label className="cn-labelled"><span className="small muted">Blurb</span><Field item={{ kind: 'character', id: c.id, field: 'blurb' }} label={`${c.id}: blurb`} multiline /></label>
        </div>
      ))}
    </section>
  );
}

function MinigamesPanel() {
  return (
    <section className="adm-grid" aria-label="Mini-games">
      {MINIGAME_KINDS.map(k => (
        <div key={k} className="adm-card cn-entity">
          <h3><span aria-hidden>{MINIGAME_INFO[k].icon}</span> {MINIGAME_INFO[k].title} <span className="muted small">({k})</span></h3>
          <label className="cn-labelled"><span className="small muted">Title</span><Field item={{ kind: 'minigame', id: k, field: 'title' }} label={`${k}: title`} /></label>
          <label className="cn-labelled"><span className="small muted">Rules blurb</span><Field item={{ kind: 'minigame', id: k, field: 'blurb' }} label={`${k}: blurb`} multiline /></label>
        </div>
      ))}
    </section>
  );
}

function SiteTextPanel() {
  const { config } = useAuth();
  const nav = useNavigate();
  return (
    <section className="adm-card cn-entity" aria-label="Site text">
      <h3>Site text</h3>
      <p className="small">
        Buttons, headings and help text on the site pages are edited in place: open the site, click any text and rewrite it.
        Names of spaces, cards, looks, characters and mini-games belong in the other sections here, so they change in the game too.
      </p>
      {config.demoMode ? (
        <button type="button" className="btn primary" onClick={() => { setTextEditing(true); nav('/'); toast('Click any text to rewrite it'); }}>
          ✏️ Open the site text editor
        </button>
      ) : (
        <p className="adm-alert warn">The site text editor is only available while the server runs with DEMO_MODE=1.</p>
      )}
    </section>
  );
}
