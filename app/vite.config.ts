import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { versionLabel } from './ui/src/version';

/** D-597: the version label from the commit subjects (no git, or not a checkout: `v0.dev`). */
function buildVersion(): string {
  try {
    return versionLabel(execFileSync('git', ['log', '--format=%s', '-n', '2000'], { cwd: __dirname, encoding: 'utf8' }).split('\n'));
  } catch {
    return versionLabel([]);
  }
}

// The UI lives in ui/; @tegg/doc is the one text engine (D-82), imported from packages/doc; @tegg/editor from
// packages/editor (D-83).
export default defineConfig({
  root: resolve(__dirname, 'ui'),
  plugins: [react()],
  define: { __TEGG_VERSION__: JSON.stringify(buildVersion()) },
  clearScreen: false,
  resolve: { alias: { '@tegg/doc': resolve(__dirname, '../packages/doc/src/index.ts'), '@tegg/editor': resolve(__dirname, '../packages/editor/src/index.ts'), '@tegg/schema': resolve(__dirname, '../packages/schema/src/index.ts') } },
  server: { port: 5176, strictPort: true, fs: { allow: [resolve(__dirname, '..')] } },
  // SVG assets stay files, byte for byte, instead of minified data: URLs.
  build: { target: 'safari16', outDir: resolve(__dirname, 'dist'), emptyOutDir: true,
    // ms5-capture §4: the capture window is a second page.
    rollupOptions: { input: { main: resolve(__dirname, 'ui/index.html'), capture: __dirname + '/ui/capture.html' } }, assetsInlineLimit: (file: string) => (file.endsWith('.svg') ? false : undefined) },
});
