// Helpers for FR-SYN-03 AC-21 (v0.52 feedback H9, H10; docs/acceptance/editor.md): typing in bursts into Úpravy while the
// fake core reports every `note_write` as `vault:changed` for the note, once while the write is pending and once after
// it returned (docs/contracts/ms3-shell.md §16.8 `echoWrites`). No AC assertions here except `must` (re-exported
// through embeds-helpers), which turns a missing element into an AssertionError (TS-I1).
import type { Page } from '@playwright/test';
import { M, editorBody, hostBlock, mergeDialog, mustCaret, openEmbeds, sleep, type FakeCoreHandle } from './embeds-helpers';

export const TYPED_SOURCE = ' Příliš žluťoučký kůň úpěl ďábelské ódy, zatímco Šárka čte řeč o lásce.';

export type BurstRun = {
  core: FakeCoreHandle;
  typed: string;
  /** Times (ms from the start) at which the merge dialog was seen. */
  dialogSeen: number[];
  /** The editor root (the `Note body` element) was replaced (the editor was rebuilt). */
  rebuilt: boolean;
  /** `__TEGG_TEST__.editor.historyDepth()` after each burst: a reload empties the history (AP-122), so it never drops. */
  depths: number[];
  /** The text before the caret in its block at the end, and whether the caret is still in `Hostitel před.`'s block. */
  caret: { inBlock: boolean; before: string };
};

/** Opens Úpravy with `echoWrites`, puts the caret at the end of `Hostitel před.` and types `bursts` bursts of `perBurst`
 *  characters (keystrokes `delay` ms apart, `pause` ms between bursts), watching for the merge dialog, a replaced editor
 *  root and the undo history. Each write stays pending for `writeMs` (a slow disk, `writeControl({ delayMs })`), so the
 *  "pending" report can arrive after more text was typed, as with the watcher in the built app. */
export async function typeInBursts(page: Page, o: { bursts: number; perBurst: number; delay?: number; pause?: number; writeMs?: number }): Promise<BurstRun> {
  const core = await openEmbeds(page, M.upravy, { echoWrites: true, clock: false });
  await core.writeControl({ delayMs: o.writeMs ?? 400 });
  await mustCaret(hostBlock(page, 'Hostitel před.'), null, 'end of "Hostitel před."');
  await editorBody(page).first().evaluate((b) => { (window as any).__v052root = b; });
  const depth = () => page.evaluate(() => Number((window as any).__TEGG_TEST__?.editor?.historyDepth?.() ?? -1));
  const depths: number[] = [];
  const total = o.bursts * o.perBurst;
  const typed = TYPED_SOURCE.repeat(Math.ceil(total / TYPED_SOURCE.length)).slice(0, total);
  const dialogSeen: number[] = [];
  const t0 = Date.now();
  for (let b = 0; b < o.bursts; b++) {
    await page.keyboard.type(typed.slice(b * o.perBurst, (b + 1) * o.perBurst), { delay: o.delay ?? 30 });
    const end = Date.now() + (o.pause ?? 600);
    while (Date.now() < end) {
      if ((await mergeDialog(page).count()) > 0) dialogSeen.push(Date.now() - t0);
      await sleep(50);
    }
    depths.push(await depth());
  }
  await sleep(1500);
  if ((await mergeDialog(page).count()) > 0) dialogSeen.push(Date.now() - t0);
  const rebuilt = await page.evaluate(() => !((window as any).__v052root as Element).isConnected);
  const caret = await page.evaluate(() => {
    const s = window.getSelection();
    const a = s?.anchorNode;
    const el = a ? (a.nodeType === 3 ? a.parentElement : (a as Element)) : null;
    const blk = el?.closest('[aria-label="Note body"] > *') as HTMLElement | null;
    if (!s || !a || !blk) return { inBlock: false, before: '' };
    const r = document.createRange();
    r.setStart(blk, 0);
    r.setEnd(a, s.anchorOffset);
    return { inBlock: (blk.innerText ?? '').startsWith('Hostitel před.'), before: r.toString().normalize('NFC') };
  });
  return { core, typed, dialogSeen, rebuilt, depths, caret };
}
