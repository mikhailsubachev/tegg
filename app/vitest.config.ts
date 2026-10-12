import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// L0 static rules and L1 unit tests of the UI modules (docs/contracts/ms3-shell.md §3). The node --test files in
// test/ (bug_*.test.ts) and the Playwright suite in webkit/ are run by their own steps.
export default defineConfig({
  root: __dirname,
  resolve: { alias: { '@tegg/doc': resolve(__dirname, '../packages/doc/src/index.ts') } },
  test: { include: ['test/**/*.ac.test.ts'], environment: 'node' },
});
