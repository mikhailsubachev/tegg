// Bug #64 (D-689, D-456; follow-up of #61): keeping the content on screen while embeds load stops once something else
// scrolls the note. It must not take a scroll to the position an *earlier, finished* correction left for its own.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { C, eventually, fileText, openConvert } from './convert-helpers';

test.use({ timezoneId: 'Europe/Prague', viewport: { width: 1440, height: 600 } });

const ZAS = 'Pages/Zasedačka.md';
const top = (page: Page) => page.evaluate(() => document.querySelector('main')?.scrollTop ?? -1);
const scrollTo = (page: Page, y: number) => page.evaluate((v) => { document.querySelector('main')!.scrollTop = v; }, y);
/** Every `embed_load` of Zasedačka is counted; while `hold` is on, the next one waits for `release`. */
async function watchLoads(page: Page) {
  await page.evaluate((zas) => {
    const w = window as any;
    w.__loads = 0;
    const inv = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, a: any, o: unknown) => {
      if (cmd === 'embed_load' && Array.isArray(a?.paths) && a.paths.some((p: string) => p.normalize('NFC') === zas)) {
        if (w.__hold) await new Promise<void>((r) => { w.__release = r; });
        const r = await inv(cmd, a, o);
        w.__loads++;
        return r;
      }
      return inv(cmd, a, o);
    };
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb: FrameRequestCallback) => (w.__slowRaf ? (setTimeout(() => raf(cb), 400) as unknown as number) : raf(cb));
  }, ZAS.normalize('NFC'));
}
const loads = (page: Page) => page.evaluate(() => (window as any).__loads as number);
async function changeZasedacka(core: any, line: string) {
  const t = (await fileText(core, ZAS)) ?? '';
  await core.setFile(ZAS, new TextEncoder().encode(`${t}${line}\n`));
}

test('bug_64_fr_emb_02_a_scroll_to_where_an_earlier_correction_left_the_note_stays', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await watchLoads(page);
  const max = await page.evaluate(() => { const m = document.querySelector('main')!; return m.scrollHeight - m.clientHeight; });
  assert.ok(max > 400, `the note scrolls (${max})`);
  // 1. A first correction runs and finishes at 200: Zasedačka changes while the note is scrolled there.
  await scrollTo(page, 200);
  const n0 = await loads(page);
  await changeZasedacka(core, 'První změna.');
  assert.ok((await eventually(() => loads(page), (n) => n > n0, 5000)) > n0, 'the embeds reload');
  await page.waitForTimeout(600); // that correction's frames and its 150 ms check have run
  assert.equal(await top(page), 200, 'still at 200');
  // 2. The user scrolls down; Zasedačka changes again and its correction waits for slow frames.
  await scrollTo(page, 200 + 250);
  await page.evaluate(() => { const w = window as any; w.__hold = true; });
  await changeZasedacka(core, 'Druhá změna.');
  await page.waitForFunction(() => typeof (window as any).__release === 'function');
  await page.evaluate(() => { const w = window as any; w.__hold = false; w.__slowRaf = true; w.__release(); });
  await page.waitForFunction((n) => (window as any).__loads > n, n0 + 1);
  // 3. Before that correction runs, the user scrolls back to exactly 200.
  await scrollTo(page, 200);
  await page.waitForTimeout(1500); // the slow frames have run; nothing may move the note now
  await page.evaluate(() => { (window as any).__slowRaf = false; });
  assert.equal(await top(page), 200, 'the user\'s scroll stays');
});
