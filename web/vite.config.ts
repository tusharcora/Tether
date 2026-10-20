import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

// Dev: `npm run dev` (API on :4177) + `npx vite web` (UI on :5173, proxies /api).
export default defineConfig({
  plugins: [solid()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:4177' } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
