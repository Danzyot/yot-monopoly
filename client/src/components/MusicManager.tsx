import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type SongRow } from '../api';
import { loadCustomTracks } from '../music';
import { useToast } from '../toast';
import InlineEdit from './InlineEdit';

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
const NEW_PLAYLIST = '__new__';

// The music library: files the operator uploaded, grouped into playlists.
//
// There is no built-in catalogue any more — the room plays the room's own
// music and nothing else — so every playlist here exists because somebody put
// a file in it. A playlist is just the name its songs carry, which is why
// renaming one moves every song at once rather than editing a separate record.
export default function MusicManager() {
  const toast = useToast();
  const [songs, setSongs] = useState<SongRow[] | null>(null);
  const [playlistChoice, setPlaylistChoice] = useState(NEW_PLAYLIST);
  const [newPlaylist, setNewPlaylist] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);
  const [importFrom, setImportFrom] = useState('');
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => api.musicList().then(r => setSongs(r.songs)).catch(() => {});
  useEffect(() => { void refresh(); }, []);

  // Grouped for display, in the order the player will see them.
  const groups = useMemo(() => {
    const by = new Map<string, SongRow[]>();
    for (const s of songs ?? []) {
      if (!by.has(s.vibe)) by.set(s.vibe, []);
      by.get(s.vibe)!.push(s);
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [songs]);

  const names = groups.map(([n]) => n);
  const target = playlistChoice === NEW_PLAYLIST ? newPlaylist.trim() : playlistChoice;

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!target) { toast('error', 'Name the playlist first'); return; }
    for (const file of Array.from(files)) {
      const name = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
      setUploading(name);
      try {
        await api.musicUpload(file, name, target);
        toast('success', `Added “${name}” to ${target}`);
      } catch (e) {
        toast('error', e instanceof Error ? e.message : `Could not add ${name}`);
      }
    }
    setUploading(null);
    if (fileRef.current) fileRef.current.value = '';
    setNewPlaylist('');
    setPlaylistChoice(target);
    await refresh();
    // Players pick the new library up without reloading.
    void loadCustomTracks();
  };

  // Copy a whole library across from a sibling site. The server does the
  // fetching, so this works regardless of what the operator's own machine has
  // in front of its network — a security suite rewriting CORS headers or
  // swapping TLS certificates makes the same copy impossible from a browser.
  const runImport = async () => {
    const from = importFrom.trim();
    if (!from) { toast('error', 'Paste the address of the site to copy from'); return; }
    setImporting(true);
    try {
      const r = await api.musicImport(from);
      const bits = [`${r.added} copied`];
      if (r.skipped) bits.push(`${r.skipped} already here`);
      if (r.failed.length) bits.push(`${r.failed.length} failed`);
      toast(r.added ? 'success' : 'error', bits.join(', '));
      if (r.failed.length) console.warn('Music import failures:', r.failed);
      setImportFrom('');
      await refresh();
      void loadCustomTracks();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const rename = async (from: string, to: string) => {
    const clean = to.trim();
    if (!clean || clean === from) return;
    try {
      const r = await api.playlistRename(from, clean);
      toast('success', `Renamed to ${clean} — ${r.moved} track${r.moved === 1 ? '' : 's'} moved`);
      if (playlistChoice === from) setPlaylistChoice(clean);
      await refresh();
      void loadCustomTracks();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not rename');
    }
  };

  const retitle = async (id: string, name: string) => {
    try {
      await api.musicUpdate(id, { name });
      await refresh();
      void loadCustomTracks();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not rename');
    }
  };

  const move = async (id: string, vibe: string) => {
    try {
      await api.musicUpdate(id, { vibe });
      await refresh();
      void loadCustomTracks();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not move');
    }
  };

  const remove = async (s: SongRow) => {
    if (!window.confirm(`Delete “${s.name}”? The file is removed from the server.`)) return;
    try {
      await api.musicDelete(s.id);
      toast('success', `Deleted “${s.name}”`);
      await refresh();
      void loadCustomTracks();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not delete');
    }
  };

  return (
    <div className="music-admin">
      <div className="panel music-upload">
        <h3>Add music</h3>
        <div className="music-upload-grid">
          <div className="field">
            <label htmlFor="mu-playlist">Playlist</label>
            <select
              id="mu-playlist" className="input" value={playlistChoice}
              onChange={e => setPlaylistChoice(e.target.value)}
            >
              {names.map(n => <option key={n} value={n}>{n}</option>)}
              <option value={NEW_PLAYLIST}>New playlist…</option>
            </select>
          </div>
          {playlistChoice === NEW_PLAYLIST && (
            <div className="field">
              <label htmlFor="mu-new">Name it</label>
              <input
                id="mu-new" className="input" maxLength={40} value={newPlaylist}
                placeholder="e.g. Final table" onChange={e => setNewPlaylist(e.target.value)}
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="mu-files">Files</label>
            <input
              id="mu-files" ref={fileRef} className="input" type="file" multiple
              accept="audio/mpeg,audio/mp4,audio/ogg,audio/wav,.mp3,.m4a,.ogg,.wav"
              onChange={e => void upload(e.target.files)}
            />
            <span className="field-hint">MP3, M4A, OGG or WAV — up to 40 MB each.</span>
          </div>
        </div>
        {uploading && <p className="tag">Uploading “{uploading}”…</p>}
        <div className="field music-import">
          <label htmlFor="mu-import">Or copy the whole library from another site</label>
          <div className="music-import-row">
            <input
              id="mu-import" className="input" value={importFrom} disabled={importing}
              placeholder="https://poker.example.com"
              onChange={e => setImportFrom(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void runImport(); }}
            />
            <button className="btn btn-primary" disabled={importing} onClick={() => void runImport()}>
              {importing ? 'Copying…' : 'Copy'}
            </button>
          </div>
          <span className="field-hint">
            Pulls every song and playlist name straight from that site's server.
            Songs already here by name are skipped, so it is safe to run twice.
          </span>
        </div>
        <p className="tag">
          Uploads go to the server's disk and reach every player straight away.
          Only add music you hold the rights to play to a room.
        </p>
      </div>

      {songs === null && <p className="tag">Loading…</p>}
      {songs !== null && groups.length === 0 && (
        <div className="panel music-empty">
          <strong>No music yet</strong>
          <span>Add a file above and it becomes the first playlist.</span>
        </div>
      )}

      {groups.map(([name, list]) => (
        <div key={name} className="panel playlist-card">
          <div className="pl-head">
            <div className="pl-title">
              <InlineEdit value={name} onSave={v => void rename(name, v)} />
              <span className="pl-count">{list.length} track{list.length === 1 ? '' : 's'}</span>
            </div>
          </div>
          <div className="pl-tracks">
            {list.map(s => (
              <div key={s.id} className="pl-track">
                <span className="plt-name">
                  <InlineEdit value={s.name} onSave={v => void retitle(s.id, v)} />
                </span>
                <span className="plt-size">{mb(s.size)}</span>
                <select
                  className="input plt-move" value={s.vibe}
                  onChange={e => void move(s.id, e.target.value)}
                  title="Move to another playlist"
                >
                  {names.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <button className="btn btn-sm" onClick={() => void remove(s)}>Delete</button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
