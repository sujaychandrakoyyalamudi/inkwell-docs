import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `--mode static` builds the browser-only edition for GitHub Pages: the API runs
// in the browser (client/src/static), and asset URLs are relative so the site
// works from any sub-path such as https://<user>.github.io/<repo>/.
export default defineConfig(({ mode }) => ({
  root: 'client',
  base: mode === 'static' ? './' : '/',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // The editor (ProseMirror + TipTap) is the bulk of the bundle; one chunk is fine here.
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': `http://localhost:${process.env.API_PORT ?? 3001}`,
    },
  },
}));
