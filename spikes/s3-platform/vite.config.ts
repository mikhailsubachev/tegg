import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Two pages: the main window and the pre-warmed capture window (FR-CAP-01, FR-CAP-03).
export default defineConfig({
  clearScreen: false,
  server: { port: 5175, strictPort: true },
  build: {
    target: 'safari16',
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), capture: resolve(__dirname, 'capture.html') },
    },
  },
});
