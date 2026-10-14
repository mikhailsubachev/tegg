import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// L1/L2 tests of @tegg/editor (docs/contracts/ms3-shell.md §13.8): real ProseMirror transactions in a DOM environment,
// the save path through the real @tegg/doc (never mocked).
export default defineConfig({
  root: __dirname,
  resolve: { alias: { '@tegg/doc': resolve(__dirname, '../doc/src/index.ts') } },
  test: { include: ['test/**/*.test.ts'], environment: 'jsdom', testTimeout: 120_000 },
});
