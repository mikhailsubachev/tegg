import { defineConfig, devices } from '@playwright/test';

// L5 (test-strategy §4): the real UI on WebKit (the engine of Tauri's WKWebView) with the fake core over mocked IPC
// (ui/test/fake-core.ts, docs/contracts/ms3-shell.md §5). Under ./verify (VERIFY_GATE set) a separate port is used
// and a running dev server is never reused, so the gate tests the checkout's code.
const gate = !!process.env.VERIFY_GATE;
const port = gate ? 5197 : 5177;

export default defineConfig({
  testDir: 'webkit',
  testMatch: /\.ac\.test\.ts$|\/bug_[^/]+\.test\.ts$/, // AC tests and bug regressions (bug_<issue>_<req-id>_…)
  timeout: 60_000,
  expect: { timeout: 3_000 },
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, actionTimeout: 3_000, viewport: { width: 1440, height: 900 } },
  projects: [{ name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } }],
  webServer: { command: `npx vite --port ${port} --strictPort`, port, reuseExistingServer: !gate },
});
