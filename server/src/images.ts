// Small image helpers for server-rendered pictures (the share card,
// playerCard.ts). The renderer (resvg) reads PNG and JPEG but not WebP, and
// the site's art is WebP (the NFT Chogs, the brand mark), so WebP is decoded
// here (libwebp compiled to WebAssembly: no native build, the same on every
// platform) and written back out as a plain PNG.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { crc32, deflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);

/** RGBA pixels, row by row. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

function chunk(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tb) >>> 0);
  return Buffer.concat([len, tb, crc]);
}

/** An RGBA PNG of `img` (no filtering: these are small pictures, and size is not the point). */
export function encodePng(img: Pixels): Buffer {
  const { width, height, data } = img;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

type Decode = (buf: ArrayBuffer) => Promise<Pixels>;
let decoder: Promise<Decode> | null = null;

/** The WebP decoder, loaded once on first use. */
function webpDecoder(): Promise<Decode> {
  decoder ??= (async () => {
    // The decoder hands back an ImageData, which Node does not have: a plain stand-in is all it needs.
    const g = globalThis as { ImageData?: unknown };
    g.ImageData ??= class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} };
    const mod = await import('@jsquash/webp/decode.js');
    // (The server's TypeScript libs leave out the WebAssembly global; Node has it.)
    const wa = (globalThis as unknown as { WebAssembly: { compile(b: Uint8Array): Promise<unknown> } }).WebAssembly;
    const wasm = await wa.compile(readFileSync(require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm')));
    await (mod.init as (m: unknown) => Promise<void>)(wasm);
    return (buf: ArrayBuffer) => mod.default(buf) as Promise<Pixels>;
  })();
  decoder.catch(() => { decoder = null; });
  return decoder;
}

export async function decodeWebp(buf: Buffer): Promise<Pixels> {
  const decode = await webpDecoder();
  // A copy into a fresh ArrayBuffer: a Buffer may be a slice of a larger pool.
  return decode(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

/** A WebP file as a PNG. */
export async function webpToPng(buf: Buffer): Promise<Buffer> {
  return encodePng(await decodeWebp(buf));
}

export const dataUri = (mime: string, buf: Buffer) => `data:${mime};base64,${buf.toString('base64')}`;

/** What a picture is, by its first bytes: only the kinds the renderer reads. */
export function sniff(buf: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
