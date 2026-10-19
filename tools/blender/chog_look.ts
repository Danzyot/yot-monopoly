// Dumps the resolved look (shared/chogs/traits.ts) of some Chog Genesis tokens
// as JSON, for chog_traits.py's preview renders. Run by that script:
//   node --import tsx tools/blender/chog_look.ts out.json 1 186 1517
import { writeFileSync } from 'node:fs';
import { chogLook } from '../../shared/chogs/traits.ts';

const [out, ...ids] = process.argv.slice(2);
const looks = Object.fromEntries(ids.map(id => [id, chogLook(Number(id))]));
writeFileSync(out, JSON.stringify(looks, null, 1));
