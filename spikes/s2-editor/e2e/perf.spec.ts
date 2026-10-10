// Performance probe on the generated 5,000-word note (NFR-PERF-05, NFR-PERF-06, S2-QA AC-4).
// Types at a realistic pace (one key per 40 ms) so events don't queue behind each other.
// On Chromium, the Event Timing API (input → next paint, measured by the browser itself) is
// recorded next to the app's proxy (keydown → next animation frame) for the same keystrokes.
import { expect, test } from '@playwright/test'

const q = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y)
  return s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1) : null
}

test('perf_probe_large_note_open_typing_save', async ({ page, browserName }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __evt: number[] }
    w.__evt = []
    try {
      // Every keydown that takes ≥ 16 ms from input to next paint (the API's minimum threshold).
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (e.name === 'keydown') w.__evt.push(e.duration)
      }).observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit)
    } catch { /* WebKit: no Event Timing API */ }
  })
  await page.goto('/')
  await page.getByRole('button', { name: /Generated 5,000-word note/ }).click()
  const metrics = page.locator('.metrics')
  await expect(metrics).toContainText(/Open \(parse → painted\)\s*[\d.]+ ms/)
  const openMs = Number((await metrics.innerText()).match(/Open \(parse → painted\)\s*([\d.]+)/)![1])

  const para = page.locator('.tegg-editor p').nth(40)
  await para.scrollIntoViewIfNeeded()
  await para.click()
  await page.keyboard.press('End')
  await page.evaluate(() => { (window as unknown as { __teggLatency: number[] }).__teggLatency = [] })
  const keys = 80
  await page.keyboard.type('x'.repeat(keys), { delay: 40 })
  await page.waitForTimeout(1500) // let autosave (reconcile + verify) run
  const r = await page.evaluate(() => ({
    proxy: (window as unknown as { __teggLatency: number[] }).__teggLatency,
    evt: (window as unknown as { __evt: number[] }).__evt,
    eventTiming: PerformanceObserver.supportedEntryTypes.includes('event'),
  }))
  const saveMs = Number((await metrics.innerText()).match(/Save \(reconcile \+ verify\)\s*([\d.]+)/)![1])
  const over16 = r.proxy.filter((x) => x >= 16).length
  const result = {
    browser: browserName,
    openMs,
    proxy: { n: r.proxy.length, p50: q(r.proxy, 0.5), p95: q(r.proxy, 0.95), max: q(r.proxy, 1), over16 },
    eventTiming: r.eventTiming ? { keydownsOver16ms: r.evt.length, of: keys, max: r.evt.length ? Math.max(...r.evt) : 0 } : 'not supported',
    saveMs,
  }
  console.log('PERF', JSON.stringify(result))
  expect(r.proxy.length).toBe(keys)
})
