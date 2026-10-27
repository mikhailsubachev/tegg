// Slice PW (page width, Normal / Wide) real-app test (L6, Appium mac2 on the built test app, D-382, TS-I7):
// docs/acceptance/page-width.md FR-STO-07 AC-6: on a temporary copy of the shell fixture with TEGG_APP_SUPPORT in a
// temporary folder, open Porada, choose `Wide`, open Úvodní (left at the default), quit with ⌘Q, relaunch: Úvodní (the
// launch landing, FR-UX-02 AC-16) shows `Normal`; Porada shows `Wide`; `<temp dir>/ui-state.json` holds the key
// `01JA0H0000000000000000H005` with `wide`; every vault file's bytes, mtimes and inodes are identical to the snapshot
// taken before the first launch (`.tegg/vault.yml` included) and nothing was created in the vault. Interface:
// docs/contracts/page-width.md §1, §3; ms3-shell §1, §6 (TEGG_TEST, TEGG_APP_SUPPORT, TEGG_VAULT, TEGG_ROUTE,
// TEGG_PERF_LOG; `route-ready:<route>`). The accessibility tree has no DOM attributes, so `.note-column[data-width]` is
// read through the `Note body` element's width (wide is wider than normal; normal is at most 760 px). Keys go to Tegg only
// through the helpers' `press` / `osa` (D-758, D-799). Written from the AC and the contracts only (D-61). Shared helpers:
// app/e2e/helpers/capture.ts. Prerequisites as in ms3_shell.ac.test.ts: `npm run app:build`, `npm run e2e:setup`,
// Accessibility and Automation permission.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  FX, appPids, appiumDown, end, firstShown, need, osa, paste, press, ready, session, shown, sleep, support, testEnv, tmp, tree, waitFor, waitMark,
  type Driver,
} from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

const PORADA_PATH = 'Schůzky/2026-10-07 Porada.md';
const UVODNI_PATH = 'Pages/Úvodní stránka.md';
const PORADA_ID = '01JA0H0000000000000000H005';

/** A temp copy of tests/fixtures/vaults/shell plus new-empty/.tegg (page-width.md "Fixtures"). */
function shellCopy(base: string): string {
  const v = join(base, 'Trezor');
  cpSync(join(FX, 'shell'), v, { recursive: true });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  return v;
}
/** ⇧⌘F, the title pasted into `Search query`, ⏎ (D-760). */
async function goTo(title: string) {
  osa('tell application "System Events" to key code 3 using {command down, shift down}');
  await sleep(500);
  paste(title);
  await sleep(700);
  press('enter');
  await sleep(1200);
}
/** The `value` of the radio with `label` (XCUITest reports a checked radio as `1`), or null when it isn't shown. */
async function radioValue(d: Driver, label: string): Promise<string | null> {
  const e = await firstShown(d, label);
  return e ? String(await e.getAttribute('value')) : null;
}
/** The drawn width of the `Note body` element (stands in for `.note-column[data-width]`). */
async function bodyWidth(d: Driver): Promise<number | null> {
  const e = await firstShown(d, 'Note body');
  if (!e) return null;
  const r = await d.getElementRect(e.elementId);
  return r.width;
}

test('fr_sto_07_ac6_relaunch_keeps_the_width_and_the_vault_is_unchanged', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('pw-sto07ac6');
  const vault = shellCopy(base);
  const sup = support(base); // ui-state.json without noteWidth (a 3A-era shape)
  const before = tree(vault);
  const log1 = join(base, 'perf1.jsonl');
  const log2 = join(base, 'perf2.jsonl');
  let d: Driver | undefined;
  try {
    d = await session(testEnv(sup, log1, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${PORADA_PATH}` }));
    assert.ok(await waitMark(log1, `route-ready:note/${PORADA_PATH}`), 'Porada shown');
    assert.ok(await shown(d, 'Note body', 5000), 'the editor is shown');
    assert.equal(await radioValue(d, 'Normal'), '1', 'Porada opens with Normal checked (no entry, the vault default)');
    const normalWidth = await bodyWidth(d);
    await (await need(d, 'Wide')).click();
    await sleep(500);
    assert.equal(await radioValue(d, 'Wide'), '1', 'Wide checked after the click');
    const wideWidth = await bodyWidth(d);
    assert.ok(normalWidth !== null && wideWidth !== null && wideWidth > normalWidth + 50, `the column widens (${normalWidth} → ${wideWidth})`);
    await goTo('Úvodní stránka');
    assert.ok(await waitMark(log1, `route-ready:note/${UVODNI_PATH}`), 'Úvodní shown');
    assert.equal(await radioValue(d, 'Normal'), '1', 'Úvodní is left at the default');
    press('q', ['command']); // ⌘Q to Tegg only (D-758 guard, D-799)
    assert.ok(await waitFor(() => appPids().length === 0, 15_000), '⌘Q quits the app');
    await d.deleteSession().catch(() => {});
    d = undefined;
    const stored = JSON.parse(readFileSync(join(sup, 'ui-state.json'), 'utf8')) as { noteWidth?: Record<string, string> };
    assert.equal(stored.noteWidth?.[PORADA_ID], 'wide', `ui-state.json holds ${PORADA_ID}: wide (got ${JSON.stringify(stored.noteWidth)})`);
    // Relaunch without TEGG_ROUTE: the launch landing is the last opened note, Úvodní (FR-UX-02 AC-16).
    d = await session(testEnv(sup, log2, { TEGG_VAULT: vault }));
    assert.ok(await waitMark(log2, `route-ready:note/${UVODNI_PATH}`), 'the relaunch lands on Úvodní');
    assert.ok(await shown(d, 'Note body', 5000), 'the editor after the relaunch');
    assert.equal(await radioValue(d, 'Normal'), '1', 'Úvodní shows Normal after the relaunch');
    const w1 = await bodyWidth(d);
    assert.ok(w1 !== null && w1 <= 760, `Úvodní's column is the Normal one, at most 760 px (${w1})`);
    await goTo('2026-10-07 Porada');
    assert.ok(await waitMark(log2, `route-ready:note/${PORADA_PATH}`), 'Porada after the relaunch');
    assert.equal(await radioValue(d, 'Wide'), '1', 'Porada shows Wide after the relaunch');
    const w2 = await bodyWidth(d);
    assert.ok(w1 !== null && w2 !== null && w2 > w1 + 50, `Porada's column is the Wide one (${w1} → ${w2})`);
  } finally {
    await end(d);
  }
  const after = tree(vault);
  assert.deepEqual(after, before, 'every vault file: bytes, mtimes and inodes identical to the snapshot before the first launch, .tegg/vault.yml included; nothing created');
  rmSync(base, { recursive: true, force: true });
});
