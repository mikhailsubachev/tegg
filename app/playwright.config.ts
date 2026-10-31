import { defineConfig, devices } from '@playwright/test';
import { gatePortBase } from '../tools/qa/src/port.ts';

// L5 (test-strategy §4): the real UI on WebKit (the engine of Tauri's WKWebView) with the fake core over mocked IPC
// (ui/test/fake-core.ts, docs/contracts/ms3-shell.md §5). Every run uses its own port and never reuses a running dev
// server, so it tests the checkout's code.
const gate = !!process.env.VERIFY_GATE;
// Under the gate the port comes from the runner (VERIFY_PORT_BASE, CONTRACT §3.2.1), one per run, so two gates of the
// same repository can run at the same time (D-343).
// Outside the gate every run gets its own free port too, picked once in the runner (the workers load this config again
// and inherit it): Playwright starts the dev server before globalSetup waits for the gate lock (D-1330), so a run that
// reused another run's server would lose it, and test that run's checkout, when the other run ends.
if (!gate) process.env.TEGG_WEBKIT_PORT ??= String(gatePortBase(`${process.cwd()}:${process.pid}`));
const port = Number(gate ? process.env.VERIFY_PORT_BASE : process.env.TEGG_WEBKIT_PORT);
if (gate && !Number.isInteger(port)) throw new Error('VERIFY_GATE is set but VERIFY_PORT_BASE is not a port');

export default defineConfig({
  testDir: 'webkit',
  testMatch: /\.ac\.test\.ts$|\/bug_[^/]+\.test\.ts$/, // AC tests and bug regressions (bug_<issue>_<req-id>_…)
  // D-1330: a run outside ./verify waits for the machine-wide gate lock, so it never overlaps a gate.
  globalSetup: './webkit/gate-lock.setup.ts',
  timeout: 60_000,
  // Tests inside a file run on parallel workers too (D-343): every test starts its own page and fake core, so none
  // shares state. Under ./verify 6 workers (12-core reference Mac; 8 saturated the machine once the gate ran its lanes
  // concurrently, D-609; 4 was tried and didn't help, D-688); otherwise Playwright's default.
  fullyParallel: true,
  workers: gate ? 6 : undefined,
  // test-strategy §8.4: quarantined tests (`@flaky`, each with an issue) stay out of the gates' main run; the nightly
  // step `app-webkit-flaky` sets VERIFY_FLAKY=1 and runs only them.
  grepInvert: gate && !process.env.VERIFY_FLAKY ? /@flaky/ : undefined,
  expect: { timeout: 3_000 },
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, actionTimeout: 3_000, viewport: { width: 1440, height: 900 } },
  projects: [{ name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } }],
  webServer: { command: `npx vite --port ${port} --strictPort`, port, reuseExistingServer: false },
});
