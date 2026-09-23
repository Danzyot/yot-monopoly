import { useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken } from '../../api.ts';
import { loadLibrary } from '../../music.ts';
import { toast, toastError } from '../../toast.tsx';

// The operator's music library, for the dashboard's Music tab: upload files,
// group them into playlists, rename, move and delete. Everything here reaches
// players through /music/manifest.json; the built-in generative playlist is
// always there besides, so an empty library still has music.
//
// A playlist is only the name its songs carry, so renaming one renames it on
// every song, and a playlist with no songs left stops existing.

interface SongRow { id: string; name: string; playlist: string; file: string; size: number; addedAt: number }
interface Library { songs: SongRow[]; playlists: { name: string; count: number }[]; maxBytes: number }

interface Upload { key: number; name: string; progress: number; state: 'queued' | 'sending' | 'done' | 'error'; error?: string }

const NEW = '__new__';
const AUDIO_EXT = /\.(mp3|m4a|mp4|aac|ogg|oga|opus|wav)$/i;
const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
const titleFromFile = (f: string) => f.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 80) || 'Untitled';

// fetch() cannot report upload progress, so uploads use XHR. The body is the
// raw file; name and playlist ride in the query string.
function sendFile(file: File, name: string, playlist: string, onProgress: (f: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const q = new URLSearchParams({ name, playlist });
    xhr.open('POST', `/api/admin/music?${q}`);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    // Never "application/json": the site-wide JSON parser would claim the body.
    xhr.setRequestHeader('Content-Type', file.type && file.type.startsWith('audio/') ? file.type : 'application/octet-stream');
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { resolve(); return; }
      let msg = `Upload failed (${xhr.status})`;
      try { msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg; } catch { /* not JSON */ }
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error('Network error — the upload did not finish'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    xhr.send(file);
  });
}

/** Text that becomes an input on click; Enter or blur saves, Escape cancels. */
function EditableText({ value, onSave, label }: { value: string; onSave: (v: string) => void; label: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!editing) {
    return (
      <button className="btn tiny ghost" title={`Rename ${label}`} onClick={() => { setDraft(value); setEditing(true); }}>
        Rename
      </button>
    );
  }
  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== value) onSave(v);
  };
  return (
    <input
      autoFocus value={draft} maxLength={80} aria-label={`New name for ${label}`}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}

export default function MusicManager() {
  const [lib, setLib] = useState<Library | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [target, setTarget] = useState<string>(NEW);
  const [newName, setNewName] = useState('');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const refresh = async () => {
    try {
      const r = await api<Library>('/api/admin/music');
      setLib(r);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => { void refresh(); }, []);

  // On the first load, default the upload target to an existing playlist
  // rather than "new"; after that the operator's choice stands.
  const defaulted = useRef(false);
  useEffect(() => {
    if (!lib || defaulted.current) return;
    defaulted.current = true;
    if (target === NEW && !newName && lib.playlists.length) setTarget(lib.playlists[0].name);
  }, [lib, target, newName]);

  // Players (including this operator's own widget) see changes without a reload.
  const changed = async () => { await refresh(); void loadLibrary(true); };

  const groups = useMemo(() => {
    const by = new Map<string, SongRow[]>();
    for (const s of lib?.songs ?? []) {
      const key = s.playlist;
      if (!by.has(key)) by.set(key, []);
      by.get(key)!.push(s);
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [lib]);
  const playlistNames = lib?.playlists.map(p => p.name) ?? [];
  const destination = target === NEW ? newName.trim() : target;
  const maxBytes = lib?.maxBytes ?? 40 * 1048576;

  const patch = (key: number, p: Partial<Upload>) =>
    setUploads(list => list.map(u => (u.key === key ? { ...u, ...p } : u)));

  const upload = async (files: File[]) => {
    if (!files.length || busy) return;
    if (!destination) { toast('Choose a playlist or name a new one first', 'error'); return; }
    const batch = files.map(f => ({ file: f, row: { key: ++seq.current, name: f.name, progress: 0, state: 'queued' as const } }));
    setUploads(list => [...list.filter(u => u.state !== 'done'), ...batch.map(b => b.row)]);
    setBusy(true);
    let ok = 0;
    // One at a time: a 40 MB file is already a long request, and parallel
    // uploads would only race each other for the operator's upstream.
    for (const { file, row } of batch) {
      if (file.size > maxBytes) { patch(row.key, { state: 'error', error: `Too large (max ${mb(maxBytes)})` }); continue; }
      if (file.type && !file.type.startsWith('audio/') && !AUDIO_EXT.test(file.name)) {
        patch(row.key, { state: 'error', error: 'Not an audio file' });
        continue;
      }
      patch(row.key, { state: 'sending' });
      try {
        await sendFile(file, titleFromFile(file.name), destination, f => patch(row.key, { progress: f }));
        patch(row.key, { state: 'done', progress: 1 });
        ok += 1;
      } catch (e) {
        patch(row.key, { state: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
    if (ok) {
      toast(`Added ${ok} song${ok === 1 ? '' : 's'} to ${destination}`);
      setTarget(destination);
      setNewName('');
      await changed();
    }
  };

  const retitle = (s: SongRow, name: string) =>
    api(`/api/admin/music/${s.id}`, { method: 'PATCH', json: { name } }).then(changed).catch(toastError);

  const move = (s: SongRow, choice: string) => {
    const to = choice === NEW ? (prompt('Name the new playlist', '') ?? '').trim() : choice;
    if (!to || to === s.playlist) return;
    api(`/api/admin/music/${s.id}`, { method: 'PATCH', json: { playlist: to } })
      .then(() => { toast(`Moved “${s.name}” to ${to}`); return changed(); })
      .catch(toastError);
  };

  const remove = (s: SongRow) => {
    if (!confirm(`Delete “${s.name}”? The file is removed from the server.`)) return;
    api(`/api/admin/music/${s.id}`, { method: 'DELETE' })
      .then(() => { toast(`Deleted “${s.name}”`); return changed(); })
      .catch(toastError);
  };

  const renamePlaylist = (from: string, to: string) =>
    api<{ moved: number }>('/api/admin/music/playlists', { method: 'PATCH', json: { from, to } })
      .then(r => {
        toast(`Renamed ${from} to ${to} (${r.moved} song${r.moved === 1 ? '' : 's'})`);
        if (target === from) setTarget(to);
        return changed();
      })
      .catch(toastError);

  return (
    <div className="music-admin">
      <section className="panel">
        <h3>Add music</h3>
        <div className="row wrap">
          <label className="grow">
            <span className="muted small">Playlist</span>
            <select value={target} onChange={e => setTarget(e.target.value)} disabled={busy}>
              {playlistNames.map(n => <option key={n} value={n}>{n}</option>)}
              <option value={NEW}>New playlist…</option>
            </select>
          </label>
          {target === NEW && (
            <label className="grow">
              <span className="muted small">New playlist name</span>
              <input value={newName} maxLength={40} placeholder="e.g. Game night" disabled={busy}
                onChange={e => setNewName(e.target.value)} />
            </label>
          )}
        </div>
        <div
          className={`music-drop${over ? ' over' : ''}`}
          style={{ marginTop: 12 }}
          onDragOver={e => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); void upload(Array.from(e.dataTransfer.files)); }}
        >
          <p style={{ margin: '0 0 8px' }}>Drop audio files here, or</p>
          <button className="btn small primary" disabled={busy} onClick={() => fileRef.current?.click()}>
            Choose files…
          </button>
          <input
            ref={fileRef} type="file" multiple hidden
            accept="audio/mpeg,audio/mp4,audio/ogg,audio/wav,.mp3,.m4a,.ogg,.wav"
            onChange={e => void upload(Array.from(e.target.files ?? []))}
          />
          <p className="muted small" style={{ margin: '8px 0 0' }}>
            MP3, M4A, OGG or WAV, up to {mb(maxBytes)} each. Only upload music you have the rights to play.
          </p>
        </div>
        {uploads.length > 0 && (
          <div className="music-uploads" style={{ marginTop: 12 }}>
            {uploads.map(u => (
              <div key={u.key} className="music-upload-row">
                <span className="name" title={u.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
                <progress max={1} value={u.progress} />
                <span className={u.state === 'error' ? 'err' : 'muted'}>
                  {u.state === 'queued' && 'waiting'}
                  {u.state === 'sending' && `${Math.round(u.progress * 100)}%`}
                  {u.state === 'done' && 'added'}
                  {u.state === 'error' && u.error}
                </span>
              </div>
            ))}
            {!busy && (
              <div><button className="btn tiny ghost" onClick={() => setUploads([])}>Clear list</button></div>
            )}
          </div>
        )}
      </section>

      {loadError && <p className="warn">{loadError} <button className="btn tiny" onClick={() => void refresh()}>Retry</button></p>}
      {!lib && !loadError && <p className="muted">Loading…</p>}
      {lib && groups.length === 0 && (
        <section className="panel">
          <b>No uploaded music yet</b>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Players hear the built-in lounge playlist until you add some. Uploaded playlists appear beside it.
          </p>
        </section>
      )}

      {groups.map(([name, songs]) => (
        <section key={name} className="panel">
          <div className="music-pl-head">
            <h3 style={{ margin: 0 }}>{name} <span className="muted small">· {songs.length} song{songs.length === 1 ? '' : 's'}</span></h3>
            <EditableText value={name} label={`playlist ${name}`} onSave={v => void renamePlaylist(name, v)} />
          </div>
          <div style={{ marginTop: 8 }}>
            {songs.map(s => (
              <div key={s.id} className="music-song">
                <span className="name" title={s.name}>{s.name}</span>
                <span className="size muted small">{mb(s.size)}</span>
                <select value={s.playlist} title="Move to another playlist" aria-label={`Move ${s.name} to playlist`}
                  onChange={e => move(s, e.target.value)}>
                  {playlistNames.map(n => <option key={n} value={n}>{n}</option>)}
                  <option value={NEW}>New playlist…</option>
                </select>
                <span className="row">
                  <EditableText value={s.name} label={s.name} onSave={v => void retitle(s, v)} />
                  <button className="btn tiny ghost" onClick={() => remove(s)}>Delete</button>
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
