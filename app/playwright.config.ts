import { defineConfig, devices } from '@playwright/test';

// L5 (test-strategy §4): the real UI on WebKit (the engine of Tauri's WKWebView) with the fake core over mocked IPC
// (ui/test/fake-core.ts, docs/contracts/ms3-shell.md §5). Under ./verify (VERIFY_GATE set) a per-run port is used
// and a running dev server is never reused, so the gate tests the checkout's code.
const gate = !!process.env.VERIFY_GATE;
// Under the gate the port comes from the runner (VERIFY_PORT_BASE, CONTRACT §3.2.1), one per run, so two gates of the
// same repository can run at the same time (D-343).
const port = gate ? Number(process.env.VERIFY_PORT_BASE) : 5177;
if (gate && !Number.isInteger(port)) throw new Error('VERIFY_GATE is set but VERIFY_PORT_BASE is not a port');

export default defineConfig({
  testDir: 'webkit',
  testMatch: /\.ac\.test\.ts$|\/bug_[^/]+\.test\.ts$/, // AC tests and bug regressions (bug_<issue>_<req-id>_…)
  timeout: 60_000,
  // Tests inside a file run on parallel workers too (D-343): every test starts its own page and fake core, so none
  // shares state. Under ./verify 6 workers (12-core reference Mac; 8 saturated the machine once the gate ran its lanes
  // concurrently, D-609; 4 was tried and didn't help, D-688); otherwise Playwright's default.
  fullyParallel: true,
  workers: gate ? 6 : undefined,
  expect: { timeout: 3_000 },
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, actionTimeout: 3_000, viewport: { width: 1440, height: 900 } },
  projects: [{ name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } }],
  webServer: { command: `npx vite --port ${port} --strictPort`, port, reuseExistingServer: !gate },
});
