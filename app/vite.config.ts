import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { versionLabel } from './ui/src/version';

// The UI lives in ui/; @tegg/doc is the one text engine (D-82), imported from packages/doc; @tegg/editor from
// packages/editor (D-83).
export default defineConfig({
  root: resolve(__dirname, 'ui'),
  plugins: [react()],
  // D-1512: the release version from `npm run app:release -- <version>`, else `dev`.
  define: { __TEGG_VERSION__: JSON.stringify(versionLabel(process.env.TEGG_VERSION)) },
  clearScreen: false,
  resolve: { alias: { '@tegg/doc': resolve(__dirname, '../packages/doc/src/index.ts'), '@tegg/editor': resolve(__dirname, '../packages/editor/src/index.ts'), '@tegg/schema': resolve(__dirname, '../packages/schema/src/index.ts') } },
  server: { port: 5176, strictPort: true, fs: { allow: [resolve(__dirname, '..')] } },
  // SVG assets stay files, byte for byte, instead of minified data: URLs.
  build: { target: 'safari16', outDir: resolve(__dirname, 'dist'), emptyOutDir: true,
    // ms5-capture §4: the capture window is a second page.
    rollupOptions: { input: { main: resolve(__dirname, 'ui/index.html'), capture: __dirname + '/ui/capture.html' } }, assetsInlineLimit: (file: string) => (file.endsWith('.svg') ? false : undefined) },
});
