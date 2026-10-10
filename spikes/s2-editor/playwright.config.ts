import { defineConfig, devices } from '@playwright/test'

// S2-QA AC-3: WebKit (the engine of Tauri's WKWebView on macOS) with a fake core over mocked IPC.
// S2-QA AC-4: the perf probe also runs on Chromium, whose Event Timing API cross-checks the
// typing-latency proxy (WebKit has no Event Timing API).
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5174' },
  projects: [
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testMatch: /perf\.spec\.ts$/ },
  ],
  webServer: { command: 'npm run dev', port: 5174, reuseExistingServer: true },
})
