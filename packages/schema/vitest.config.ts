import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// L1 tests of @tegg/schema (docs/contracts/ms3-shell.md §14.4, §14.9): pure TypeScript, no DOM. The shared corpora in
// tests/fixtures/types/ keep it equal to the Rust crate tegg-schema (D-241). @tegg/doc is the real engine (never mocked).
export default defineConfig({
  root: __dirname,
  resolve: { alias: { '@tegg/doc': resolve(__dirname, '../doc/src/index.ts') } },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
