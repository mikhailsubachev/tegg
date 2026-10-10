// S2-QA AC-3: open → type → save through the real app UI on WebKit, with a fake core behind
// mocked Tauri IPC (`window.__TAURI_INTERNALS__.invoke`). Asserts the exact saved bytes.
import { expect, test } from '@playwright/test'

const NOTE = '﻿---\r\ntitle: Demo\r\ntags: [a]\r\n---\r\n# Title\r\n\r\nSome *styled* paragraph.\r\n\r\n<div>kept raw</div>\r\n\r\n* star list\r\n'
const EXPECTED = NOTE.replace('Some *styled* paragraph.', 'Some *styled* paragraph typed.')

test('s2_qa_ac3_webkit_open_type_save_writes_expected_bytes', async ({ page }) => {
  await page.addInitScript((note: string) => {
    const files: Record<string, number[]> = { 'notes/Demo.md': Array.from(new TextEncoder().encode(note)) }
    const w = window as unknown as { __writes: { path: string; bytes: number[] }[]; __TAURI_INTERNALS__: unknown }
    w.__writes = []
    w.__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: { path: string; bytes: number[] }) => {
        if (cmd === 'list_notes') return Object.keys(files)
        if (cmd === 'read_note') return files[args.path]
        if (cmd === 'write_note') { files[args.path] = args.bytes; w.__writes.push(args); return null }
        throw new Error(`unknown command ${cmd}`)
      },
    }
  }, NOTE)

  await page.goto('/')
  await page.getByRole('button', { name: 'Demo' }).click()
  await expect(page.locator('.tegg-editor')).toContainText('Some styled paragraph.')
  await expect(page.locator('.badge')).toContainText('Byte-identical')

  // Opening must not write (FR-FMT-07 AC-2).
  await page.waitForTimeout(600)
  expect(await page.evaluate(() => (window as unknown as { __writes: unknown[] }).__writes.length)).toBe(0)

  // Click at the end of the paragraph and type.
  const para = page.locator('.tegg-editor p', { hasText: 'Some' })
  const box = (await para.boundingBox())!
  await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2)
  await page.keyboard.press('End')
  await page.keyboard.press('Backspace') // remove the '.'
  await page.keyboard.type(' typed.')

  await expect.poll(() => page.evaluate(() => (window as unknown as { __writes: unknown[] }).__writes.length)).toBeGreaterThan(0)
  const saved = await page.evaluate(() => {
    const w = (window as unknown as { __writes: { bytes: number[] }[] }).__writes
    return w[w.length - 1].bytes
  })
  const expected = Array.from(new TextEncoder().encode(EXPECTED))
  expect(saved).toEqual(expected) // BOM, CRLF, frontmatter, raw HTML and `*` list marker untouched
})
