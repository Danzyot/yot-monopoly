import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:8080', ws: true, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
