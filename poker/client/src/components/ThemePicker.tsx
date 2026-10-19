import { useEffect, useState } from 'react';
import type { TableTheme } from '../../../shared/types';
import { api, type GraphicRow } from '../api';
import { FELTS } from '../felts';

// Table look editor: felt color swatches plus optional uploaded images for
// the center logo and the felt background. Used in the create modals and in
// both settings modals; graphics come from Dashboard → Table graphics.
export default function ThemePicker({ value, onChange }: {
  value: TableTheme | null;
  onChange: (t: TableTheme | null) => void;
}) {
  const [graphics, setGraphics] = useState<GraphicRow[]>([]);
  useEffect(() => {
    api.graphicsList().then(r => setGraphics(r.graphics)).catch(() => {});
  }, []);

  const theme: TableTheme = value ?? { felt: 'chog', logoUrl: null, backgroundUrl: null };
  const set = (patch: Partial<TableTheme>) => {
    const next = { ...theme, ...patch };
    // The default look is "no theme" — keep payloads clean.
    onChange(next.felt === 'chog' && !next.logoUrl && !next.backgroundUrl ? null : next);
  };
  const urlOf = (g: GraphicRow) => `/graphics/lib/${g.file}`;

  return (
    <div className="theme-picker">
      <div className="field">
        <label>Table felt</label>
        <div className="felt-swatches">
          {FELTS.map(f => (
            <button
              key={f.id}
              type="button"
              className={`felt-swatch${theme.felt === f.id ? ' active' : ''}`}
              title={f.name}
              style={{ background: `radial-gradient(circle at 50% 40%, ${f.felt1}, ${f.felt2})`, borderColor: f.rail }}
              onClick={() => set({ felt: f.id })}
            />
          ))}
        </div>
      </div>
      {graphics.length > 0 && (
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Center logo <span className="label-opt">optional</span></label>
            <select
              className="input"
              value={theme.logoUrl ?? ''}
              onChange={e => set({ logoUrl: e.target.value || null })}
            >
              <option value="">None — text watermark</option>
              {graphics.map(g => <option key={g.id} value={urlOf(g)}>{g.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Felt image <span className="label-opt">optional</span></label>
            <select
              className="input"
              value={theme.backgroundUrl ?? ''}
              onChange={e => set({ backgroundUrl: e.target.value || null })}
            >
              <option value="">None — plain felt</option>
              {graphics.map(g => <option key={g.id} value={urlOf(g)}>{g.name}</option>)}
            </select>
          </div>
        </div>
      )}
      {graphics.length === 0 && (
        <p className="field-hint">
          Upload images under <strong>Dashboard → Table graphics</strong> to use a custom
          center logo or felt background here.
        </p>
      )}
    </div>
  );
}
