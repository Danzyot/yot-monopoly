import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AURA_MAP, BACKGROUND_COLORS, CHOG_EYES_VARIANTS, CHOG_MOUTH_VARIANTS, CHOG_SUPPLY, CHOG_TOKEN_IDS, EYES_MAP, MOUTH_MAP, SKIN_COLORS,
  chogArtUrl, chogLook, isChogTokenId, traitsOf,
} from '../../shared/chogs/traits.ts';
import { Registry, Room, type RoomHooks } from '../src/rooms.ts';
import { CHOG_SEASON, SEASON_BOT_NAMES, SEASON_THEME_ID, characterShared } from '../../shared/season.ts';

const hooks = (holds: (user: string, token: number) => boolean): RoomHooks => ({
  onChange() {}, onEvent(_r: Room, _t: string) {}, onFinished() {}, holdsChog: holds,
});
const m = (id: string) => ({ id, name: id, avatar: '🙂' });

test('chogs: every token is in the table, with a picture and a resolvable look', () => {
  assert.equal(CHOG_TOKEN_IDS.length, CHOG_SUPPLY);
  assert.equal(CHOG_TOKEN_IDS[0], 1);
  assert.equal(CHOG_TOKEN_IDS.at(-1), CHOG_SUPPLY);
  for (const id of CHOG_TOKEN_IDS) {
    const t = traitsOf(id)!;
    assert.ok(t.Tier && t.Base, `#${id} has a tier and base`);
    if (t.Skin) assert.ok(SKIN_COLORS[t.Skin], `#${id} skin ${t.Skin} has colours`);
    if (t.Eyes) assert.ok(EYES_MAP[t.Eyes], `#${id} eyes ${t.Eyes} map to a part`);
    if (t.Mouth) assert.ok(MOUTH_MAP[t.Mouth], `#${id} mouth ${t.Mouth} maps to a part`);
    if (t.Aura) assert.ok(AURA_MAP[t.Aura], `#${id} aura ${t.Aura} has an effect`);
    if (t.Background) assert.ok(BACKGROUND_COLORS[t.Background], `#${id} background ${t.Background} has a colour`);
    assert.match(chogArtUrl(id), /^https:\/\/i2c\.seadn\.io\/monad\/0x[0-9a-f]{40}\/[0-9a-f]{30}\/[0-9a-f]{32}\.webp$/);
    const look = chogLook(id)!;
    assert.ok(CHOG_EYES_VARIANTS.includes(look.eyes));
    if (look.mouth) assert.ok(CHOG_MOUTH_VARIANTS.includes(look.mouth));
    assert.equal(look.fallback, look.fallbacks.length > 0);
  }
  assert.equal(traitsOf(0), null);
  assert.equal(traitsOf(CHOG_SUPPLY + 1), null);
  assert.equal(chogLook(5000), null);
  assert.ok(isChogTokenId(1969));
  assert.ok(!isChogTokenId(0) && !isChogTokenId(1.5) && !isChogTokenId('1') && !isChogTokenId(1970));
});

test('chogs: real tokens resolve to the right parts', () => {
  // #1: Pink / BTC Glass / Flat / Fwog, Deep Aqua background, no aura.
  const one = chogLook(1)!;
  assert.equal(one.form, 'chog');
  assert.equal(one.base, 'origin');
  assert.equal(one.skin, 'Pink');
  assert.equal(one.eyes, 'btcGlass');
  assert.equal(one.mouth, 'flat');
  assert.equal(one.aura, null);
  assert.equal(one.background, BACKGROUND_COLORS['Deep Aqua']);
  assert.equal(one.colors.hair, SKIN_COLORS.Pink.mane);
  assert.equal(one.colors.skin, SKIN_COLORS.Pink.face);
  assert.equal(one.colors.glass, '#f4a21a', 'the BTC lenses are orange');
  assert.equal(one.lids, false);
  assert.equal(one.fallback, false);
  assert.equal(one.accessory, null, 'accessories are pass 2');

  // #186: a White Skull with purple lasers and a Burning Aura; skulls have no mouth.
  const skull = chogLook(186)!;
  assert.equal(skull.form, 'skull');
  assert.equal(skull.eyes, 'laser');
  assert.equal(skull.colors.glow, '#c04cff');
  assert.equal(skull.mouth, null);
  assert.deepEqual(skull.aura, { kind: 'fire', color: '#ff7a24' });
  assert.equal(skull.colors.skin, SKIN_COLORS.White.face);

  // #1517: Radioactive, Green, Green Happy eyes.
  const radio = chogLook(1517)!;
  assert.equal(radio.base, 'radioactive');
  assert.equal(radio.eyes, 'happy');
  assert.equal(radio.skin, 'Green');
  assert.equal(radio.background, BACKGROUND_COLORS.Radioactive);

  // #1881: a 1:1 Legendary with no traits: the base Chog, badged.
  const legend = chogLook(1881)!;
  assert.equal(legend.legendary, true);
  assert.equal(legend.tier, 'Legendary');
  assert.equal(legend.eyes, 'normal');
  assert.equal(legend.mouth, null);
  assert.equal(legend.colors.hair, SKIN_COLORS.Origin.mane);
  assert.equal(legend.fallback, false, 'a 1:1 has nothing to fall back from');

  // A value with no part of its own falls back to the nearest and says so.
  const smirk = CHOG_TOKEN_IDS.find(id => traitsOf(id)!.Eyes === 'Smirk')!;
  const fb = chogLook(smirk)!;
  assert.equal(fb.eyes, 'side');
  assert.equal(fb.fallback, true);
  assert.deepEqual(fb.fallbacks, ['Eyes: Smirk']);

  // The base eyes blink with the base lids; a skull's or any other eyes do not.
  const normal = CHOG_TOKEN_IDS.find(id => traitsOf(id)!.Eyes === 'Normal Eye' && traitsOf(id)!.Form === 'Chog')!;
  assert.equal(chogLook(normal)!.lids, true);
});

test('chogs: only a verified holder of the token may play as it', () => {
  const wallet: Record<string, number[]> = { alice: [1, 420, 1969] };
  const reg = new Registry(hooks((user, token) => wallet[user]?.includes(token) ?? false), 1e9);
  const r = reg.create('alice');
  r.join(m('alice')); r.join(m('bob'));

  assert.throws(() => r.pickCharacter('bob', 'chog', 1), /not in a wallet linked/, 'bob holds nothing');
  assert.equal(r.seat('bob')!.chogToken, undefined);
  assert.throws(() => r.pickCharacter('alice', 'chog', 2), /not in a wallet linked/, 'alice does not hold #2');
  assert.throws(() => r.pickCharacter('alice', 'chog', 0), /Unknown Chog token/);
  assert.throws(() => r.pickCharacter('alice', 'chog', 1.5), /Unknown Chog token/);
  assert.throws(() => r.pickCharacter('alice', 'chog', 99999), /Unknown Chog token/);
  assert.throws(() => r.pickCharacter('alice', 'spiky', 1), /Only Chog|Chog season/);

  r.pickCharacter('alice', 'chog', 420);
  assert.equal(r.seat('alice')!.character, 'chog');
  assert.equal(r.seat('alice')!.chogToken, 420);
  assert.equal(r.view().seats.find(s => s.id === 'alice')!.chogToken, 420, 'the token is in the room view');

  // The base Chog is still free for bob; alice's token is not.
  r.pickCharacter('bob', 'chog');
  assert.equal(r.seat('bob')!.chogToken, undefined);
  wallet.bob = [420];
  assert.throws(() => r.pickCharacter('bob', 'chog', 420), /taken/);

  // Going back to the base Chog drops the token (in the Chog season everyone may share the base Chog;
  // otherwise it is bob's now, so alice moves to another character instead).
  r.pickCharacter('alice', 'chog', 1969);
  assert.equal(r.seat('alice')!.chogToken, 1969);
  if (characterShared('chog')) r.pickCharacter('alice', 'chog');
  else r.pickCharacter('alice', 'robot');
  assert.equal(r.seat('alice')!.chogToken, undefined);

  // The token rides into the game and through a snapshot.
  r.pickCharacter('alice', 'chog', 1);
  r.start('alice', false);
  assert.equal(r.view().game!.players.find(p => p.id === 'alice')!.chogToken, 1);
  assert.equal(r.view().game!.players.find(p => p.id === 'bob')!.chogToken, undefined);
  const snap = JSON.parse(JSON.stringify(r.snapshot()));
  const back = Room.restore(snap, hooks(() => false));
  assert.equal(back.seat('alice')!.chogToken, 1);
  assert.equal(back.view().game!.players.find(p => p.id === 'alice')!.chogToken, 1);
  back.dispose();
  r.dispose();
  // A tampered snapshot loses a token that is not a real id.
  snap.seats.find((s: { id: string }) => s.id === 'bob').chogToken = 99999;
  snap.seats.find((s: { id: string }) => s.id === 'alice').chogToken = 'one';
  const fixed = Room.restore(snap, hooks(() => false));
  try {
    assert.equal(fixed.seat('bob')!.chogToken, undefined);
    assert.equal(fixed.seat('alice')!.chogToken, undefined);
  } finally {
    fixed.dispose();
  }

  // Without a verifier in the hooks nobody gets a token, whatever the client says.
  const bare = new Registry({ onChange() {}, onEvent() {}, onFinished() {} }, 1e9);
  const b = bare.create('alice');
  b.join(m('alice'));
  assert.throws(() => b.pickCharacter('alice', 'chog', 1), /not in a wallet linked/);
  b.dispose();
});

test('chog season: Chogs only, shared by colour, a Chog table, bots as real tokens', { skip: !CHOG_SEASON && 'the Chog season is off' }, () => {
  const wallet: Record<string, number[]> = { alice: [1] };
  const reg = new Registry(hooks((user, token) => wallet[user]?.includes(token) ?? false), 1e9);
  const r = reg.create('alice');
  try {
    assert.equal(r.themeId, SEASON_THEME_ID, 'a new table wears the season look');
    assert.equal(r.rules.freeParkingPot, true, 'with the house rules it brings');
    r.join(m('alice')); r.join(m('bob')); r.join(m('carol'));
    assert.deepEqual(r.seats.map(s => s.character), ['chog', 'chog', 'chog'], 'everyone sits down as Chog');
    assert.equal(new Set(r.seats.map(s => s.color)).size, 3, 'told apart by colour');
    assert.throws(() => r.pickCharacter('bob', 'snacky'), /Chog season/);
    assert.throws(() => r.pickCharacter('bob', 'robot'), /Chog season/);
    r.pickCharacter('bob', 'chog');

    r.configure('alice', false, { themeId: 'classic' });
    assert.equal(r.themeId, SEASON_THEME_ID, 'another look is not on offer');
    r.configure('alice', false, { themeId: 'tptv', mapId: 'speed' });
    assert.equal(r.themeId, SEASON_THEME_ID);
    assert.equal(r.mapId, 'speed', 'the board is still the host\'s choice');
    r.configure('alice', false, { mapId: 'classic' });

    while (r.seats.length < r.rules.maxPlayers) r.addBot('alice', false);
    const bots = r.seats.filter(s => s.isBot);
    assert.ok(bots.every(b => b.character === 'chog'));
    assert.ok(bots.every(b => SEASON_BOT_NAMES.some(n => b.name.startsWith(n))), 'Chog-flavoured bot names');
    const tokens = bots.map(b => b.chogToken!);
    assert.equal(new Set(tokens).size, bots.length, 'each bot is a different real Chog');
    for (const t of tokens) {
      const look = chogLook(t)!;
      assert.ok(look && !look.legendary && !look.fallback, `#${t} has every trait modelled`);
    }
    assert.ok(bots.every(b => !b.outfit?.eyes), 'no glasses over a token\'s own eyes');

    // A holder takes their token from a bot that drew it.
    const bot = bots[0];
    wallet.alice.push(bot.chogToken!);
    const theirs = bot.chogToken!;
    r.pickCharacter('alice', 'chog', theirs);
    assert.equal(r.seat('alice')!.chogToken, theirs);
    assert.notEqual(bot.chogToken, theirs, 'the bot plays another Chog');
    assert.ok(bot.chogToken);

    r.start('alice', false);
    const players = r.view().game!.players;
    assert.ok(players.filter(p => p.isBot).every(p => p.chogToken), 'bots carry their token into the game');
  } finally {
    r.dispose();
  }
});

test('chog season: a lobby saved before the season comes back as Chogs; a game in progress keeps its cast', { skip: !CHOG_SEASON && 'the Chog season is off' }, () => {
  const reg = new Registry(hooks(() => false), 1e9);
  const r = reg.create('a');
  r.join(m('a')); r.join(m('b'));
  r.addBot('a', false);
  const lobby = JSON.parse(JSON.stringify(r.snapshot()));
  lobby.themeId = 'classic';
  lobby.seats[0].character = 'snacky';
  lobby.seats[0].outfit = { neck: 'cuban_chain', body: 'wawa_tee' };
  lobby.seats[1].character = 'robot';
  lobby.seats[2].character = 'pirate';
  delete lobby.seats[2].chogToken;
  const back = Room.restore(lobby, hooks(() => false));
  try {
    assert.equal(back.themeId, SEASON_THEME_ID);
    assert.deepEqual(back.seats.map(s => s.character), ['chog', 'chog', 'chog']);
    assert.deepEqual(back.seat('a')!.outfit, {}, 'CJ WAWA\'s own clothes come off');
    assert.ok(back.seats[2].chogToken, 'the bot draws a token');
  } finally {
    back.dispose();
  }

  r.start('a', false);
  const game = JSON.parse(JSON.stringify(r.snapshot()));
  r.dispose();
  game.themeId = 'classic';
  game.seats[0].character = 'snacky';
  game.game.players.find((p: { id: string }) => p.id === 'a').character = 'snacky';
  const playing = Room.restore(game, hooks(() => false));
  try {
    assert.equal(playing.themeId, 'classic', 'a game already under way keeps its look');
    assert.equal(playing.game!.view().players.find(p => p.id === 'a')!.character, 'snacky', 'and its characters');
  } finally {
    playing.dispose();
  }
});
