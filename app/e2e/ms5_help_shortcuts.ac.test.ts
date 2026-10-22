// v0.52 feedback real-app test (L6, Appium mac2 on the built test app, D-382): docs/acceptance/app-shell.md FR-UX-03
// AC-14, the menu-item part (D-608): the menu bar's `Help` menu has `Keyboard Shortcuts`, which opens `help/shortcuts`
// (heading `Keyboard shortcuts`) in the main window; ⇧⌘/ opens it too (checked on the window's content: the `route-ready:` mark is written once per route per
// process, ms3-shell §1). Interface: docs/contracts/ms3-shell.md §16.6
// (native Help item id `tegg-shortcuts`, `Keyboard Shortcuts`, `CmdOrCtrl+Shift+/`; shows `main`, emits
// `shell:route { route: 'help/shortcuts' }`), §1 (TEGG_TEST, `route-ready:<route>` marks). Always TEGG_TEST=1 with
// TEGG_NOW, a temporary Application Support and a temporary copy of the synthetic inbox fixture (D-62). Written from
// the AC and the contract only (D-61). Shared helpers: app/e2e/helpers/capture.ts.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUNDLE_ID, appiumDown, end, inboxCopy, marks, osa, press, ready, session, shown, sleep, support, testEnv, tmp, waitFor, waitMark, type Driver,
} from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

const ROUTE = 'help/shortcuts';
const MARK = `route-ready:${ROUTE}`;
const count = (log: string, m: string) => marks(log).filter((x) => x === m).length;

/** Clicks `item` of the menu bar menu `menu` of the app; returns the error text, or null when the click went through. */
function clickMenu(menu: string, item: string): string | null {
  try {
    osa(`tell application id "${BUNDLE_ID}" to activate`);
    osa(`tell application "System Events" to tell (first process whose bundle identifier is "${BUNDLE_ID}") to click menu item "${item}" of menu "${menu}" of menu bar 1`);
    return null;
  } catch (e) {
    return String((e as Error).message ?? e);
  }
}

test('fr_ux_03_ac14_help_menu_keyboard_shortcuts_opens_the_page', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('ux03ac14');
  const vault = inboxCopy(base, 'Nápověda');
  const log = join(base, 'perf.jsonl');
  let d: Driver | undefined;
  try {
    d = await session(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'inbox' }));
    assert.ok(await waitMark(log, 'route-ready:inbox'), 'launched on inbox');
    assert.equal(count(log, MARK), 0, 'the shortcuts page is not shown at launch');

    // 1. Help › Keyboard Shortcuts in the menu bar.
    const err = clickMenu('Help', 'Keyboard Shortcuts');
    assert.equal(err, null, `the Help menu has "Keyboard Shortcuts": ${err}`);
    assert.ok(await waitFor(() => count(log, MARK) === 1, 5000), `${MARK} after the menu item (marks: ${marks(log).slice(-5).join(', ')})`);
    assert.ok(await shown(d, 'Keyboard shortcuts', 3000), 'the heading "Keyboard shortcuts" in the main window');

    // 2. Elsewhere (back to the inbox), then ⇧⌘/. `route-ready:` is written once per route per process (ms3-shell §1),
    // so the second visit is checked on the window's content.
    press('lbracket', ['command']);
    assert.ok(await shown(d, 'Mark all reviewed', 5000), 'back on the inbox');
    assert.ok(await waitFor(async () => !(await shown(d!, 'Keyboard shortcuts', 200)), 3000), 'the shortcuts page is gone');
    osa(`tell application id "${BUNDLE_ID}" to activate`);
    await sleep(300);
    osa('tell application "System Events" to key code 44 using {command down, shift down}');
    assert.ok(await shown(d, 'Keyboard shortcuts', 5000), 'the heading "Keyboard shortcuts" again after ⇧⌘/');
    assert.ok(!(await shown(d, 'Mark all reviewed', 300)), 'the inbox is no longer shown');
  } finally {
    await end(d);
    rmSync(base, { recursive: true, force: true });
  }
});
