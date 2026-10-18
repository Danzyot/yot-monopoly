import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

/**
 * Brotli and gzip copies of everything worth compressing in the build (the
 * scripts, styles and 3D models; images and fonts are compressed already),
 * which the server sends to browsers that take them (server/src/staticFiles.ts).
 */
function precompress(): Plugin {
  const EXTS = new Set(['.js', '.css', '.html', '.svg', '.json', '.glb', '.txt']);
  let outDir = 'dist';
  return {
    name: 'yot-precompress',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
        .flatMap(d => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
      for (const file of walk(outDir)) {
        if (!EXTS.has(extname(file)) || statSync(file).size < 1024) continue;
        const raw = readFileSync(file);
        // Top quality for the scripts; a notch down for the big models keeps the build quick.
        const quality = raw.length > 512 * 1024 ? 10 : 11;
        const br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: quality, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
        const gz = gzipSync(raw, { level: 9 });
        // Only where it pays (a few per cent is not worth the decode).
        if (br.length < raw.length * 0.95) writeFileSync(`${file}.br`, br);
        if (gz.length < raw.length * 0.95) writeFileSync(`${file}.gz`, gz);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), precompress()],
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/music': { target: 'http://localhost:8080', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:8080', ws: true, changeOrigin: true },
      // Operator-uploaded table graphics (server/src/routes/graphics.ts).
      '/graphics': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    // three.js is most of the bundle and changes rarely; cache it separately.
    // Only three and its React bindings go in that chunk: React itself stays
    // with the app, so pages without a 3D scene (the home page's first paint,
    // the leaderboard, profiles, admin) never wait for three.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](three|three-stdlib|@react-three)[\\/]/.test(id)) return 'three';
          // Named, or Rollup would pull React into 'three' (fiber imports it).
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) return 'react';
          // Bundler helpers (Vite's lazy-import preloader…) ride with React,
          // so importing them never drags 'three' into the first load.
          if (id.startsWith('\0')) return 'react';
          return undefined;
        },
      },
    },
  },
});
