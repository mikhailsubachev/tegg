import { defineConfig, devices } from '@playwright/test'

// S2-QA AC-3: WebKit (the engine of Tauri's WKWebView on macOS) with a fake core over mocked IPC.
// S2-QA AC-4: the perf probe runs on WebKit and Chromium; both expose the Event Timing API,
// which cross-checks the app's typing-latency proxy.
// Under ./verify (VERIFY_GATE set) a per-run port is used and a running dev server is never
// reused, so the gate tests the worktree's code, not the main checkout (QA review finding 8).
const gate = !!process.env.VERIFY_GATE
// Under the gate the port comes from the runner (VERIFY_PORT_BASE, CONTRACT §3.2.1), one per run, so two gates of the
// same repository can run at the same time (D-343).
const port = gate ? Number(process.env.VERIFY_PORT_BASE) : 5174
if (gate && !Number.isInteger(port)) throw new Error('VERIFY_GATE is set but VERIFY_PORT_BASE is not a port')

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}` },
  projects: [
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testMatch: /perf\.spec\.ts$/ },
  ],
  webServer: { command: `npm run dev -- --port ${port}`, port, reuseExistingServer: !gate },
})
