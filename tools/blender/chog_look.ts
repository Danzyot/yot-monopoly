// Dumps the resolved look (shared/chogs/traits.ts) of some Chog Genesis tokens
// as JSON, for chog_traits.py's preview renders. Run by that script:
//   node --import tsx tools/blender/chog_look.ts out.json 1 186 1517
// CHOG_EYES_STYLE / CHOG_SKULL_STYLE resolve them for face versions other than the built ones.
import { writeFileSync } from 'node:fs';
import { CHOG_FACE_STYLE, chogLook, chogParts, type ChogFaceStyle } from '../../shared/chogs/traits.ts';

const style = {
  eyes: process.env.CHOG_EYES_STYLE ?? CHOG_FACE_STYLE.eyes,
  skull: process.env.CHOG_SKULL_STYLE ?? CHOG_FACE_STYLE.skull,
} as ChogFaceStyle;

const [out, ...ids] = process.argv.slice(2);
const looks = Object.fromEntries(ids.map(id => {
  const look = chogLook(Number(id), style)!;
  return [id, { ...look, parts: chogParts(look, true) }];
}));
writeFileSync(out, JSON.stringify(looks, null, 1));
