// Preview v0.55 panel feedback, real-app test (L6, Appium mac2 on the built test app, D-382): docs/acceptance/app-shell.md
// FR-UX-02 AC-21, relaunch part (D-634, FR-STO-07): after setting the right panel to 400 px, quitting and relaunching the
// built app opens the panel at 400 px; the width is in `ui-state.json` under the Application Support root
// (`rightPanel.width`), and the vault's files are byte-identical with unchanged mtimes (as AC-10). Interface
// docs/contracts/ms4-links.md §9.3 (the separator `Resize panel`, ←/→ ±16 px; the stored width is written when a key
// changes it), ms3-shell.md §1 (TEGG_TEST, TEGG_APP_SUPPORT, TEGG_VAULT, TEGG_ROUTE, `route-ready:` marks).
// Written from the ACs and the contracts only (D-61). Always TEGG_TEST=1 with a temporary Application Support and a
// temporary copy of the synthetic shell fixture (D-62). Shared helpers: app/e2e/helpers/capture.ts.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUNDLE_ID, FX, MARK_TIMEOUT, appiumDown, end, need, osa, press, ready, session, sleep, support, testEnv, tmp, tree, waitFor, waitMark, type Driver,
} from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

const EVA = 'Tasks/Zavolat Evě.md';

/** A temp copy of tests/fixtures/vaults/shell plus new-empty/.tegg. */
function shellCopy(base: string): string {
  const v = join(base, 'Trezor');
  cpSync(join(FX, 'shell'), v, { recursive: true });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  return v;
}
/** A 1440 × 900 main window, so the 400 px panel isn't limited by the centre pane's 400 px minimum (AC-21). */
function bigWindow() {
  try { osa(`tell application "System Events" to tell (first process whose bundle identifier is "${BUNDLE_ID}") to set size of window 1 to {1440, 900}`); } catch { /* refused */ }
}
function storedPanel(sup: string): Record<string, unknown> | null {
  const f = join(sup, 'ui-state.json');
  if (!existsSync(f)) return null;
  try { return (JSON.parse(readFileSync(f, 'utf8')) as { rightPanel?: Record<string, unknown> }).rightPanel ?? null; } catch { return null; }
}
async function panelWidth(d: Driver): Promise<number> {
  const p = await need(d, 'Context panel', MARK_TIMEOUT);
  return (await p.getSize()).width as number;
}

test('fr_ux_02_ac21_panel_width_restored_after_relaunch', { timeout: 240_000 }, async () => {
  await ready();
  const base = tmp('6-panel');
  const vault = shellCopy(base);
  const sup = support(base, { ui: { rightPanel: { open: true, tab: 'backlinks' } } });
  const log = join(base, 'perf.jsonl');
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    d = await session(testEnv(sup, log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${EVA}` }));
    assert.ok(await waitMark(log, `route-ready:note/${EVA}`), 'Zavolat Evě shown');
    bigWindow();
    await sleep(500);
    const w0 = await panelWidth(d);
    assert.ok(Math.abs(w0 - 288) <= 2, `the panel opens at the default 288 px (${w0})`);
    const sep = await need(d, 'Resize panel', 5000);
    await sep.click();
    for (let i = 0; i < 7; i++) press('left');
    await sleep(500);
    const w1 = await panelWidth(d);
    assert.ok(Math.abs(w1 - 400) <= 2, `seven ← make the panel 400 px (${w1})`);
    assert.ok(await waitFor(() => storedPanel(sup)?.width === 400, 3000), `ui-state.json stores rightPanel.width 400: ${JSON.stringify(storedPanel(sup))}`);
    await end(d);
    d = undefined;
    assert.equal(storedPanel(sup)?.width, 400, 'still 400 after quitting');
    const log2 = join(base, 'perf2.jsonl');
    d = await session(testEnv(sup, log2, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${EVA}` }));
    assert.ok(await waitMark(log2, `route-ready:note/${EVA}`), 'Zavolat Evě shown after the relaunch');
    bigWindow();
    await sleep(500);
    const w2 = await panelWidth(d);
    assert.ok(Math.abs(w2 - 400) <= 2, `after the relaunch the panel opens at 400 px (${w2})`);
  } finally {
    await end(d);
  }
  assert.deepEqual(tree(vault), before, 'vault byte-identical with unchanged mtimes and inodes');
  rmSync(base, { recursive: true, force: true });
});
