import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The frontend lives in client/ and builds into dist/client, which the Worker
// serves as static assets (see wrangler.jsonc). env vars are read from the repo
// root so the client (VITE_*) and the Prisma CLI (DIRECT_URL) share one .env.
export default defineConfig({
  root: 'client',
  envDir: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
  server: {
    // `npm run dev:client` runs Vite with HMR and proxies API calls to the
    // Worker (`npm run dev`, on :8787). Run both for full-stack local dev.
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
