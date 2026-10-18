import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// L0 static rules and L1 unit tests of the UI modules (docs/contracts/ms3-shell.md §3). The node --test files in
// test/ (bug_*.test.ts) and the Playwright suite in webkit/ are run by their own steps.
export default defineConfig({
  root: __dirname,
  resolve: {
    alias: [
      { find: '@tegg/doc', replacement: resolve(__dirname, '../packages/doc/src/index.ts') },
      { find: '@tegg/schema', replacement: resolve(__dirname, '../packages/schema/src/index.ts') },
      // A runtime `import('../../packages/…')` from test/ resolves against the server root (app/) as `/packages/…`.
      { find: /^\/packages\//, replacement: `${resolve(__dirname, '../packages')}/` },
    ],
  },
  // `*.contract.test.ts`: checks that a fake follows a shared corpus (D-512), not AC tests. `test/regress/`: regression
  // tests (bug_*) of UI modules that need vitest's resolution and mocks.
  test: { include: ['test/**/*.ac.test.ts', 'test/**/*.contract.test.ts', 'test/regress/**/*.test.ts'], environment: 'node' },
});
