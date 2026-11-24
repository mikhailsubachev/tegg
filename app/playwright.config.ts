import { defineConfig, devices } from '@playwright/test';
import { gatePortBase } from '../tools/qa/src/port.ts';

// L5 (test-strategy §4): the real UI on WebKit (the engine of Tauri's WKWebView) with the fake core over mocked IPC
// (ui/test/fake-core.ts, docs/contracts/ms3-shell.md §5). Every run builds the UI and serves that bundle from memory
// (webkit/serve-built.ts, D-1880) on its own port and never reuses a running server, so it tests the checkout's code.
// Outside a gate TEGG_WEBKIT_DEV=1 serves the Vite dev server instead (source maps and unminified code while
// debugging a test); a gate ignores it, so a variable left in the shell can't make a gate test the dev build.
// The nightly step `app-webkit-dev` sets VERIFY_WEBKIT_DEV=1 (D-1882): once a night the suite runs on the dev
// server, a development build, where React's StrictMode runs effects twice; the bundle can't show a missing guard.
const gate = !!process.env.VERIFY_GATE;
const devServer = gate ? !!process.env.VERIFY_WEBKIT_DEV : !!process.env.TEGG_WEBKIT_DEV;
// Under the gate the port comes from the runner (VERIFY_PORT_BASE, CONTRACT §3.2.1), one per run, so two gates of the
// same repository can run at the same time (D-343).
// Outside the gate every run gets its own free port too, picked once in the runner (the workers load this config again
// and inherit it): Playwright starts the dev server before globalSetup waits for the gate lock (D-1330), so a run that
// reused another run's server would lose it, and test that run's checkout, when the other run ends.
if (!gate) process.env.TEGG_WEBKIT_PORT ??= String(gatePortBase(`${process.cwd()}:${process.pid}`));
const port = Number(gate ? process.env.VERIFY_PORT_BASE : process.env.TEGG_WEBKIT_PORT);
if (gate && !Number.isInteger(port)) throw new Error('VERIFY_GATE is set but VERIFY_PORT_BASE is not a port');

const PHONE = /(^|\/)(phone_[^/]+\.ac\.test\.ts|bug_[^/]+_phone\.test\.ts)$/;
const phone = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true };

export default defineConfig({
  testDir: 'webkit',
  testMatch: /\.ac\.test\.ts$|\/bug_[^/]+\.test\.ts$/, // AC tests and bug regressions (bug_<issue>_<req-id>_…)
  // D-1330: a run outside ./verify waits for the machine-wide gate lock, so it never overlaps a gate.
  globalSetup: './webkit/gate-lock.setup.ts',
  timeout: 60_000,
  // Tests inside a file run on parallel workers too (D-343): every test starts its own page and fake core, so none
  // shares state. Under ./verify 6 workers (D-1881, 12-core reference Mac). With the dev server 6 drove the load
  // average to ~24 next to the gate's other lanes, so D-1347 set 4; with the built bundle 6 workers load the machine
  // less than 4 did then, and finish in about 56% of the time; the nightly dev-server run keeps 4. Otherwise Playwright's default.
  fullyParallel: true,
  workers: gate ? (devServer ? 4 : 6) : undefined,
  // D-1833: under a gate a failed test runs once more. One that then passes doesn't fail the gate; the step's
  // reporter `webkit/flaky-reporter.ts` hands it to the gate, which counts it in the flaky list (CONTRACT §3.6).
  // Not outside a gate, where a failure should show at once, and not for the quarantined run.
  retries: gate && !process.env.VERIFY_FLAKY ? 1 : 0,
  // test-strategy §8.4: quarantined tests (`@flaky`, each with an issue) stay out of the gates' main run; the nightly
  // step `app-webkit-flaky` sets VERIFY_FLAKY=1 and runs only them.
  grepInvert: gate && !process.env.VERIFY_FLAKY ? /@flaky/ : undefined,
  expect: { timeout: 3_000 },
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, actionTimeout: 3_000, viewport: { width: 1440, height: 900 } },
  // Slice AND-2 (docs/contracts/android-phone.md §13.2; D-2009, D-2428): the L5p projects. Phone-layout tests
  // (`phone_*.ac.test.ts`, phone regressions `bug_<issue>_<req-id>_…_phone.test.ts`, CP-15) run on WebKit and on Chromium
  // (Android's WebView) at 412 × 915, device scale factor 2.625, touch and mobile; every other test stays on `webkit`.
  projects: [
    { name: 'webkit', testIgnore: PHONE, use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
    { name: 'phone-webkit', testMatch: PHONE, use: { browserName: 'webkit', ...phone } },
    { name: 'phone-chromium', testMatch: PHONE, use: { browserName: 'chromium', ...phone } },
  ],
  // The build takes a few seconds before the port answers; the limit is generous for a loaded machine.
  webServer: { command: devServer ? `npx vite --port ${port} --strictPort` : `node webkit/serve-built.ts ${port}`, port, reuseExistingServer: false, timeout: 180_000 },
});
