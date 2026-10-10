import { defineConfig, devices } from '@playwright/test'

// S2-QA AC-3: WebKit (the engine of Tauri's WKWebView on macOS) with a fake core over mocked IPC.
// S2-QA AC-4: the perf probe runs on WebKit and Chromium; both expose the Event Timing API,
// which cross-checks the app's typing-latency proxy.
// Under ./verify (VERIFY_GATE set) a separate port is used and a running dev server is never
// reused, so the gate tests the worktree's code, not the main checkout (QA review finding 8).
const gate = !!process.env.VERIFY_GATE
const port = gate ? 5194 : 5174

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
