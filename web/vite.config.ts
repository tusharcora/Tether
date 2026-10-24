import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev: `npm run dev` (API on :4177) + `npx vite web` (UI on :5173, proxies /api).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:4177' } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      // Arc's files start with "use client" (a Next.js marker); it means nothing here.
      onwarn(w, warn) {
        if (w.code === 'MODULE_LEVEL_DIRECTIVE') return;
        warn(w);
      },
    },
  },
});
