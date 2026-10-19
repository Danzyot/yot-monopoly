import { useEffect, useRef, useState } from 'react';
import { api, type GraphicRow } from '../api';
import { useToast } from '../toast';

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

// Operator image library for custom table looks: felt backgrounds and center
// logos. Upload here, then pick them in any create/settings theme section.
export default function GraphicsManager() {
  const toast = useToast();
  const [graphics, setGraphics] = useState<GraphicRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => api.graphicsList().then(r => setGraphics(r.graphics)).catch(() => {});
  useEffect(() => { void refresh(); }, []);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const name = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
      try {
        await api.graphicUpload(file, name);
        toast('success', `Added "${name}"`);
      } catch (e) {
        toast('error', e instanceof Error ? e.message : `Could not upload ${file.name}`);
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
    await refresh();
  };

  const remove = async (g: GraphicRow) => {
    if (!window.confirm(`Delete "${g.name}"? Tables using it will show the default look.`)) return;
    try {
      await api.graphicDelete(g.id);
      await refresh();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not delete');
    }
  };

  return (
    <div className="panel music-admin">
      <p className="field-hint">
        Images for custom table looks (png, jpg, webp, gif — up to 8 MB). Pick them as a
        <strong> center logo</strong> or <strong>felt background</strong> in the theme
        section when creating or editing any table or tournament.
      </p>
      <div>
        <button className="btn btn-primary" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? 'Uploading…' : 'Upload images'}
        </button>
        <input
          ref={fileRef} type="file" accept="image/*,.png,.jpg,.jpeg,.webp,.gif" multiple
          style={{ display: 'none' }}
          onChange={e => void upload(e.target.files)}
        />
      </div>
      {graphics.length > 0 && (
        <div className="graphics-grid">
          {graphics.map(g => (
            <div key={g.id} className="graphic-card">
              <img src={`/graphics/lib/${g.file}`} alt={g.name} loading="lazy" />
              <div className="graphic-meta">
                <span className="graphic-name">{g.name}</span>
                <span className="ma-size">{mb(g.size)}</span>
                <button className="btn btn-ghost btn-sm ma-del" title="Delete image"
                  onClick={() => void remove(g)}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {graphics.length === 0 && <p className="field-hint">No images yet.</p>}
    </div>
  );
}
