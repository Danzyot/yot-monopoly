// Undo gltfpack's meshopt compression so Blender can import a shipped model:
// every bufferView with EXT_meshopt_compression is decoded (with the
// meshoptimizer package's decoder, already a dependency) and written back as
// plain data in a single buffer.
//   node tools/trailer/unpack-glb.mjs client/public/models/chog/room.glb /tmp/room-raw.glb
import { readFileSync, writeFileSync } from 'node:fs';
import { MeshoptDecoder } from 'meshoptimizer';

const [src, dst] = process.argv.slice(2);
const glb = readFileSync(src);
const jsonLen = glb.readUInt32LE(12);
const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
const bin = glb.subarray(binStart, binStart + glb.readUInt32LE(20 + jsonLen));
await MeshoptDecoder.ready;

const parts = [];
let offset = 0;
for (const bv of json.bufferViews) {
  const ext = bv.extensions?.EXT_meshopt_compression;
  let data;
  if (ext) {
    const source = new Uint8Array(bin.buffer, bin.byteOffset + (ext.byteOffset || 0), ext.byteLength);
    const target = new Uint8Array(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(target, ext.count, ext.byteStride, source, ext.mode, ext.filter || 'NONE');
    data = Buffer.from(target);
    delete bv.extensions.EXT_meshopt_compression;
    if (!Object.keys(bv.extensions).length) delete bv.extensions;
    if (ext.byteStride && ext.mode === 'ATTRIBUTES') bv.byteStride = ext.byteStride;
  } else {
    data = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  }
  const pad = (4 - (offset % 4)) % 4;
  if (pad) { parts.push(Buffer.alloc(pad)); offset += pad; }
  bv.buffer = 0;
  bv.byteOffset = offset;
  bv.byteLength = data.length;
  parts.push(data);
  offset += data.length;
}
json.buffers = [{ byteLength: offset }];
for (const k of ['extensionsUsed', 'extensionsRequired']) {
  if (json[k]) json[k] = json[k].filter(e => e !== 'EXT_meshopt_compression');
  if (json[k] && !json[k].length) delete json[k];
}
let body = Buffer.concat(parts);
const tail = (4 - (body.length % 4)) % 4;
if (tail) body = Buffer.concat([body, Buffer.alloc(tail)]);
let js = Buffer.from(JSON.stringify(json), 'utf8');
const jpad = (4 - (js.length % 4)) % 4;
if (jpad) js = Buffer.concat([js, Buffer.alloc(jpad, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + js.length + 8 + body.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(body.length, 0); bh.writeUInt32LE(0x004e4942, 4);
writeFileSync(dst, Buffer.concat([header, jh, js, bh, body]));
console.log('wrote', dst, (12 + 16 + js.length + body.length) >> 10, 'KB', 'extensions:', json.extensionsUsed || []);
