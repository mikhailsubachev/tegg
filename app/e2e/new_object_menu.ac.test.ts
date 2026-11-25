// New objects from `/` and `+`, real-app tests (L6, Appium mac2 on the built test app, D-382, TS-I7):
// docs/acceptance/new-object-menu.md. FR-EDT-03 AC-11 (the capture window: `+` opens no menu and is saved as typed,
// AP-2125) and FR-SYN-06 AC-59 (N1 on a copy of the fixture changes exactly `Pages/Nový plán.md` (new) and
// `Pages/Bloky.md` (temp file renamed: a new inode); every other vault file is untouched). TEGG_TEST=1 with TEGG_NOW,
// a temporary Application Support and a temporary copy of the synthetic tasks fixture plus new-empty/.tegg (D-62).
// Interface: docs/contracts/new-object-menu.md §4 (the listbox `Insert block`, the dialog `New <type>`), ms5-capture.md
// (the capture window, `Capture text`), ms3-shell §1 (TEGG_ROUTE, `route-ready:` marks). Keys through helpers/osa.ts
// (D-758); non-ASCII text through the pasteboard (S3 P1). Written from the ACs and the contracts only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  FX, MARK_TIMEOUT, NOW, activateFinder, appiumDown, captureOpen, captureValue, changedPaths, end, hotkey, need, paste, press, read, ready, session, shown,
  sleep, support, testEnv, tmp, tree, typeAscii, waitFile, waitFor, waitMark, type Driver,
} from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

const BLOKY = 'Pages/Bloky.md';

function tasksCopy(base: string): string {
  const v = join(base, 'Úkoly');
  const src = join(FX, 'tasks');
  cpSync(src, v, { recursive: true, filter: (s) => relative(src, s) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true, force: false });
  return v;
}

test('fr_syn_06_ac59_n1_changes_exactly_two_files_in_the_real_app', { timeout: 600_000 }, async () => {
  await ready();
  const base = tmp('nom-ac57');
  const vault = tasksCopy(base);
  const sup = support(base);
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    const log = join(base, 'perf.jsonl');
    d = await session(testEnv(sup, log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${BLOKY}`, TEGG_NOW: NOW }));
    assert.ok(await waitMark(log, `route-ready:note/${BLOKY}`, MARK_TIMEOUT), 'Bloky shown');
    await (await need(d, 'Úvodní odstavec.', 5000)).click();
    press('end');
    typeAscii(' +pa');
    assert.ok(await shown(d, 'Insert block', 3000), '` +pa` opens the listbox Insert block');
    press('enter');
    assert.ok(await shown(d, 'New Page', 3000), 'the dialog New Page');
    paste('Nový plán');
    await sleep(300);
    press('enter');
    const host = await waitFile(join(vault, BLOKY), (t) => !!t?.includes('Úvodní odstavec. [[Nový plán]]\n'), 8000);
    assert.ok(host?.includes('Úvodní odstavec. [[Nový plán]]\n'), 'Bloky gains the link');
    assert.ok(read(vault, 'Pages/Nový plán.md')?.includes('\ntitle: Nový plán\n'), 'Pages/Nový plán.md');
    await sleep(2500);
  } finally {
    await end(d);
  }
  const after = tree(vault);
  assert.deepEqual(changedPaths(before, after), [BLOKY, 'Pages/Nový plán.md'], 'exactly the new object and the host change; every other vault file untouched');
  const [b0, b1] = [before[BLOKY], after[BLOKY]];
  assert.ok(b0 !== 'dir' && b1 !== 'dir' && b0.ino !== b1.ino, 'the host was written through a temp file renamed into place (a new inode, FR-SYN-02)');
  rmSync(base, { recursive: true, force: true });
});

test('fr_edt_03_ac11_plus_in_the_capture_window_is_text', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('nom-ac11');
  const vault = tasksCopy(base);
  const sup = support(base);
  let d: Driver | undefined;
  try {
    const log = join(base, 'perf.jsonl');
    d = await session(testEnv(sup, log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${BLOKY}`, TEGG_NOW: NOW }));
    assert.ok(await waitMark(log, `route-ready:note/${BLOKY}`, MARK_TIMEOUT), 'Bloky shown');
    await activateFinder();
    hotkey('quick');
    assert.ok(await waitFor(() => captureOpen(d!), 3000), 'the capture window opens');
    typeAscii('Zkouska +pa a + b');
    await sleep(500);
    assert.ok(!(await shown(d, 'Insert block', 500)), 'no menu opens for `+` in the capture window (AP-2125)');
    assert.equal(await captureValue(d), 'Zkouska +pa a + b', 'the text as typed');
    press('enter', ['command']);
    const file = await waitFile(join(vault, 'Quick Notes/Zkouska +pa a + b.md'), (t) => t !== null, 5000)
      ?? await waitFile(join(vault, 'Quick Notes/Zkouska.md'), (t) => t !== null, 1000);
    assert.ok(file?.includes('+pa a + b'), `the capture saved \`+pa a + b\` as typed: ${JSON.stringify(file)}`);
  } finally {
    await end(d);
  }
  rmSync(base, { recursive: true, force: true });
});
