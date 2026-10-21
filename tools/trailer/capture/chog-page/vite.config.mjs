// Trailer film page for the 3D Chogs (not part of the app; client/.film is git-excluded).
import react from '@vitejs/plugin-react';
export default {
  root: '/home/user/yot-monopoly/client/.film/chog',
  publicDir: '/home/user/yot-monopoly/client/public',
  plugins: [react()],
  logLevel: 'warn',
  server: { fs: { strict: false, allow: ['/home/user/yot-monopoly'] }, hmr: false },
};
