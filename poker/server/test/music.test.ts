// Operator music library: uploads are sniffed, stored, listed, edited and
// removed; the public manifest rows point at server-minted filenames only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'wawa-music-'));
const {
  addSong, listSongs, loadSongs, manifestRows, removeSong, sniffAudio,
  songFilePath, updateSong,
} = await import('../src/music.ts');

const mp3 = () => Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64, 7)]);

test('audio sniffing accepts real containers and rejects junk', () => {
  assert.equal(sniffAudio(mp3()), 'mp3');
  assert.equal(sniffAudio(Buffer.concat([Buffer.from([0xff, 0xfb]), Buffer.alloc(32)])), 'mp3');
  assert.equal(sniffAudio(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(32)])), 'ogg');
  assert.equal(sniffAudio(Buffer.concat([Buffer.from('RIFFxxxxWAVE'), Buffer.alloc(32)])), 'wav');
  assert.equal(sniffAudio(Buffer.concat([Buffer.from('xxxxftypM4A '), Buffer.alloc(32)])), 'm4a');
  assert.equal(sniffAudio(Buffer.from('<!doctype html><html>hello</html>')), null);
  assert.equal(sniffAudio(Buffer.from('PK\x03\x04zipfile-not-audio')), null);
});

test('add, edit, list and remove a song', () => {
  loadSongs();
  const row = addSong('  Tavern Anthem  ', 'LARP', mp3());
  assert.equal(row.name, 'Tavern Anthem');
  assert.equal(row.vibe, 'LARP');
  assert.match(row.file, /^[0-9a-f]{16}\.mp3$/);

  assert.equal(listSongs().length, 1);
  assert.ok(songFilePath(row.file), 'stored file resolves to a real path');
  assert.equal(songFilePath('../../etc/passwd'), null, 'path traversal is refused');
  assert.equal(songFilePath('0123456789abcdef.mp3'), null, 'unknown ids are refused');

  const rows = manifestRows();
  assert.deepEqual(rows, [{ name: 'Tavern Anthem', url: `/music/lib/${row.file}`, vibe: 'LARP' }]);

  updateSong(row.id, { name: 'Renamed', vibe: 'Chill' });
  assert.equal(listSongs()[0].name, 'Renamed');
  assert.equal(listSongs()[0].vibe, 'Chill');

  assert.equal(removeSong(row.id), true);
  assert.equal(listSongs().length, 0);
  assert.equal(songFilePath(row.file), null, 'removed file no longer resolves');
});

test('bad uploads are refused with a reason', () => {
  assert.throws(() => addSong('x', 'y', Buffer.from('')), /empty/);
  assert.throws(() => addSong('x', 'y', Buffer.from('just some text')), /Not a recognized audio file/);
});

test('the index survives a reload', () => {
  const row = addSong('Persistent', 'LARP', mp3());
  loadSongs(); // simulate a server restart re-reading the index
  assert.equal(listSongs().length, 1);
  assert.equal(listSongs()[0].id, row.id);
  removeSong(row.id);
});
