// The image library hosts pick from in the lobby's "Table style" section:
// board-centre logos and scene backdrops. Upload, rename, copy the URL, delete.
import { useRef, useState } from 'react';
import { api } from '../../api.ts';
import { toast, toastError } from '../../toast.tsx';
import { act, ago, del, kb, usePoll, type GraphicRow } from './adminApi.ts';

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export default function GraphicsManager() {
  const { data, error, reload } = usePoll<GraphicRow[]>('/api/admin/graphics');
  const [uploading, setUploading] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const upload = async (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []);
    for (const file of list) {
      // Checked here for a quick answer; the server checks again by content.
      if (file.size > MAX_BYTES) { toast(`${file.name} is over 8 MB`, 'error'); continue; }
      if (file.type && !TYPES.includes(file.type)) { toast(`${file.name}: only png, jpg, webp or gif`, 'error'); continue; }
      const name = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
      setUploading(file.name);
      try {
        await api(`/api/admin/graphics?name=${encodeURIComponent(name)}`, {
          method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' },
        });
        toast(`Uploaded “${name}”`);
      } catch (e) { toastError(e); }
    }
    setUploading(null);
    if (input.current) input.current.value = '';
    if (list.length) await reload();
  };

  return (
    <div className="adm-stack">
      <div
        className={`adm-drop ${dragging ? 'on' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files); }}
      >
        <div>
          <b>Table graphics</b>
          <p className="muted small">
            PNG, JPG, WebP or GIF up to 8 MB. Hosts pick these in the lobby under <b>Table style</b> as a
            board-centre logo (square, transparent PNG works best) or a backdrop behind the board (wide, 2048px+).
          </p>
        </div>
        <button className="btn primary" disabled={!!uploading} onClick={() => input.current?.click()}>
          {uploading ? `Uploading ${uploading}…` : 'Upload images'}
        </button>
        <input ref={input} type="file" accept={TYPES.join(',')} multiple hidden onChange={e => void upload(e.target.files)} />
      </div>
      {error && <p className="warn">{error}</p>}
      {data?.length === 0 && <p className="muted">No images yet — upload one, or drop files on the box above.</p>}
      <div className="adm-gallery">
        {data?.map(g => <GraphicCard key={g.id} g={g} reload={reload} />)}
      </div>
    </div>
  );
}

function GraphicCard({ g, reload }: { g: GraphicRow; reload: () => unknown }) {
  const [name, setName] = useState(g.name);
  const dirty = name.trim() !== g.name && !!name.trim();
  const rename = () => act(() => api(`/api/admin/graphics/${g.id}`, { method: 'PATCH', json: { name } }), { ok: 'Renamed', after: reload });
  const copy = () => {
    const url = `${location.origin}${g.url}`;
    navigator.clipboard?.writeText(url).then(() => toast('URL copied'), () => toast(url));
  };
  return (
    <div className="adm-graphic">
      <a href={g.url} target="_blank" rel="noreferrer" className="adm-thumb"><img src={g.url} alt={g.name} loading="lazy" /></a>
      <form className="row" onSubmit={e => { e.preventDefault(); if (dirty) void rename(); }}>
        <input value={name} maxLength={80} aria-label="Name" onChange={e => setName(e.target.value)} />
        {dirty && <button className="btn tiny primary">Save</button>}
      </form>
      <div className="muted small">{g.type.toUpperCase()} · {kb(g.size)} · {ago(g.addedAt)}{g.addedBy ? ` · ${g.addedBy}` : ''}</div>
      <div className="row">
        <button className="btn tiny" onClick={copy}>Copy URL</button>
        <button className="btn tiny ghost adm-danger-text" onClick={() => act(() => del(`/api/admin/graphics/${g.id}`), {
          confirm: `Delete “${g.name}”? Rooms using it go back to their theme's own look.`, ok: 'Deleted', after: reload,
        })}>Delete</button>
      </div>
    </div>
  );
}
