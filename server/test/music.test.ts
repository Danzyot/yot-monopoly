import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// DATA_DIR is read when paths.ts loads, so set it before importing.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-music-'));
const music = await import('../src/music.ts');
const {
  MUSIC_DIR, addSong, isSafeSongFile, listPlaylists, listSongs, loadSongs, manifestRows,
  removeSong, renamePlaylist, sniffAudio, songFilePath, updateSong,
} = music;

// Minimal but genuine container headers.
const pad = (head: Buffer, n = 64) => Buffer.concat([head, Buffer.alloc(n)]);
const MP3_ID3 = pad(Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00', 'latin1'));
const MP3_FRAME = pad(Buffer.from([0xff, 0xfb, 0x90, 0x64])); // MPEG-1 Layer III
const OGG = pad(Buffer.from('OggS\x00\x02\x00\x00', 'latin1'));
const WAV = (() => {
  const b = Buffer.alloc(64);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(56, 4);
  b.write('WAVEfmt ', 8, 'latin1');
  return b;
})();

test('sniffing accepts real audio headers', () => {
  assert.equal(sniffAudio(MP3_ID3), 'mp3');
  assert.equal(sniffAudio(MP3_FRAME), 'mp3');
  assert.equal(sniffAudio(OGG), 'ogg');
  assert.equal(sniffAudio(WAV), 'wav');
});

test('sniffing rejects everything else', () => {
  assert.equal(sniffAudio(Buffer.alloc(0)), null);
  assert.equal(sniffAudio(Buffer.from('ID3')), null, 'too short to be a file');
  assert.equal(sniffAudio(pad(Buffer.from('<!doctype html><html>'))), null);
  assert.equal(sniffAudio(pad(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))), null, 'PNG');
  assert.equal(sniffAudio(pad(Buffer.from('MZ\x90\x00', 'latin1'))), null, 'executable');
  assert.equal(sniffAudio(pad(Buffer.from('RIFF\x00\x00\x00\x00AVI ', 'latin1'))), null, 'RIFF but not WAVE');
  assert.equal(sniffAudio(pad(Buffer.from([0xff, 0xe0, 0x00, 0x00]))), null, 'frame sync with reserved layer');
  assert.throws(() => addSong('x', 'y', pad(Buffer.from('hello world'))), /audio/);
  assert.throws(() => addSong('x', 'y', Buffer.alloc(0)), /empty/);
});

test('add, list, rename, move, remove round trip', () => {
  const a = addSong('  First song ', 'Chill', MP3_ID3);
  const b = addSong('', 'chill', OGG);
  const c = addSong('Third', '', WAV);
  assert.equal(a.name, 'First song');
  assert.equal(b.name, 'Untitled');
  assert.equal(c.playlist, 'Music', 'no playlist falls back to a default');
  assert.match(a.file, /^[0-9a-f]{16}\.mp3$/);
  assert.match(b.file, /\.ogg$/);
  assert.match(c.file, /\.wav$/);
  assert.ok(existsSync(join(MUSIC_DIR, a.file)));
  assert.equal(listSongs().length, 3);

  // "Chill" and "chill" are one playlist.
  assert.deepEqual(listPlaylists(), [{ name: 'Chill', count: 2 }, { name: 'Music', count: 1 }]);

  assert.equal(updateSong(b.id, { name: 'Second' })?.name, 'Second');
  assert.equal(updateSong(c.id, { playlist: 'Party' })?.playlist, 'Party');
  assert.equal(updateSong(c.id, { name: '   ' })?.name, 'Third', 'blank names are ignored');
  assert.equal(updateSong('nope', { name: 'x' }), null);

  assert.equal(renamePlaylist('CHILL', 'Lounge'), 2);
  assert.deepEqual(listPlaylists().map(p => p.name), ['Lounge', 'Party']);
  assert.throws(() => renamePlaylist('Lounge', ''), /required/);

  const manifest = manifestRows();
  assert.equal(manifest.length, 3);
  assert.ok(manifest.every(r => r.url.startsWith('/music/lib/')));

  // Survives a restart: the index on disk is the source of truth.
  const onDisk = JSON.parse(readFileSync(join(MUSIC_DIR, 'index.json'), 'utf8'));
  assert.equal(onDisk.length, 3);
  loadSongs();
  assert.equal(listSongs().find(s => s.id === b.id)?.name, 'Second');

  assert.ok(songFilePath(a.file));
  assert.equal(removeSong(a.id)?.id, a.id);
  assert.equal(removeSong(a.id), null);
  assert.ok(!existsSync(join(MUSIC_DIR, a.file)), 'the file is deleted with the row');
  assert.equal(songFilePath(a.file), null);
  assert.equal(listSongs().length, 2);
});

test('only server-minted filenames are served', () => {
  const row = addSong('Safe', 'Test', MP3_FRAME);
  assert.ok(isSafeSongFile(row.file));
  assert.ok(songFilePath(row.file)?.startsWith(MUSIC_DIR));
  for (const bad of [
    '../index.json', 'index.json', '..%2Findex.json', '../../etc/passwd',
    `../music/${row.file}`, `${row.file}/`, `/${row.file}`, row.file.toUpperCase(),
    row.file.replace('.mp3', '.exe'), '0123456789abcdef.mp3\0.txt', '',
  ]) {
    assert.equal(isSafeSongFile(bad), false, bad);
    assert.equal(songFilePath(bad), null, bad);
  }
  // Well-formed but never minted by us: still refused.
  assert.equal(songFilePath('0123456789abcdef.mp3'), null);
});
