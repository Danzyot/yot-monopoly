// Lobby "Table style": the host (or an operator) picks a table finish and,
// from the operators' graphics library, a board-centre logo and a backdrop.
// Everyone else sees the current choice, read-only.
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { call } from '../net.ts';
import { toastError } from '../toast.tsx';
import { TABLE_PRESETS, type TableStyle } from '../../../shared/tableStyles.ts';

interface LibraryImage { id: string; name: string; url: string }

export default function TableStylePicker({ style, canEdit }: { style: TableStyle; canEdit: boolean }) {
  const [library, setLibrary] = useState<LibraryImage[] | null>(null);
  useEffect(() => {
    api<LibraryImage[]>('/api/graphics').then(setLibrary).catch(() => setLibrary([]));
  }, []);

  // Only the changed field is sent; the server merges it into the current style.
  const set = (patch: Partial<TableStyle>) => call('room:style', patch).catch(toastError);

  const imagePick = (label: string, key: 'boardLogoUrl' | 'backgroundUrl', none: string) => {
    const current = style[key];
    const known = library?.some(g => g.url === current);
    return (
      <label className="tstyle-pick">
        <span className="small muted">{label}</span>
        <span className="row">
          {current && <img className="tstyle-thumb" src={current} alt="" />}
          <select disabled={!canEdit || !library} value={current ?? ''} onChange={e => set({ [key]: e.target.value || null })}>
            <option value="">{none}</option>
            {/* A URL set some other way (or an image since renamed) still shows as chosen. */}
            {current && !known && <option value={current}>Custom image</option>}
            {library?.map(g => <option key={g.id} value={g.url}>{g.name}</option>)}
          </select>
        </span>
      </label>
    );
  };

  return (
    <div className="tstyle">
      <div className="tstyle-swatches" role="radiogroup" aria-label="Table finish">
        {TABLE_PRESETS.map(p => (
          <button key={p.id} type="button" role="radio" aria-checked={style.table === p.id} title={p.name} disabled={!canEdit}
            className={`tstyle-swatch ${style.table === p.id ? 'on' : ''}`} style={{ background: p.swatch }}
            onClick={() => set({ table: p.id })}>
            <span>{p.name}</span>
          </button>
        ))}
      </div>
      {imagePick('Board logo', 'boardLogoUrl', "None — the theme's own")}
      {imagePick('Backdrop', 'backgroundUrl', "None — the board's own")}
      {library?.length === 0 && canEdit && (
        <p className="muted small">Operators can add logos and backdrops under Dashboard → Graphics.</p>
      )}
    </div>
  );
}
