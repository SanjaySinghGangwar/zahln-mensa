import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

// In development the browser talks to /api and Vite forwards it to the Zahln
// test server. The deployed build calls https://dev.zahln.de directly: the
// server allows any origin and exposes the Date and Idempotent-Replayed headers.
const apiProxy = {
  '/api': {
    target: 'https://dev.zahln.de',
    changeOrigin: true,
    secure: true,
    rewrite: (path: string) => path.replace(/^\/api/, ''),
  },
};

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5173, proxy: apiProxy },
  preview: { port: 4173, proxy: apiProxy },
  build: { sourcemap: true },
});
