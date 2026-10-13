import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// The UI lives in ui/; @tegg/doc is the one text engine (D-82), imported from packages/doc; @tegg/editor from
// packages/editor (D-83).
export default defineConfig({
  root: resolve(__dirname, 'ui'),
  plugins: [react()],
  clearScreen: false,
  resolve: { alias: { '@tegg/doc': resolve(__dirname, '../packages/doc/src/index.ts'), '@tegg/editor': resolve(__dirname, '../packages/editor/src/index.ts') } },
  server: { port: 5176, strictPort: true, fs: { allow: [resolve(__dirname, '..')] } },
  // SVG assets (the logo, D-164) stay files, byte for byte, instead of minified data: URLs.
  build: { target: 'safari16', outDir: resolve(__dirname, 'dist'), emptyOutDir: true, assetsInlineLimit: (file: string) => (file.endsWith('.svg') ? false : undefined) },
});
