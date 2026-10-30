// v0.52 feedback, real-app test (L6, Appium mac2 on the built test app, D-382): docs/acceptance/capture.md FR-CAP-01
// AC-19, the L6 part ("once for the click", D-602): in the built capture window opened by ⌃⌥T, a click on `Due: No date`
// opens the dialog `Pick a due date`, a click on `This week` sets the first Friday on or after today (v0.94, D-1286,
// D-1289), and ⌘↩ writes `due:` with that date.
// Interface: docs/contracts/ms5-capture.md §1 (the `capture` window `Quick Capture`, hotkeys), §16.3 (strings
// `capture.dueTitle` `Pick a due date`, `capture.noDate` `No date`, `due.thisWeek` `This week`), §11.1 (test hooks). Always
// TEGG_TEST=1 with TEGG_NOW = 2026-10-14T12:00:00+02:00 (a Wednesday, D-504), a temporary Application Support and a
// temporary copy of the synthetic inbox fixture (D-62). Kept in its own file so the existing AC test files stay unchanged
// (TS-I3). Written from the AC and the contracts only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  activateFinder, appiumDown, captureOpen, end, hotkey, inboxCopy, need, paste, press, read, ready, session, sleep, support, testEnv, tmp,
  waitFor, waitMark, type Driver,
} from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

test('fr_cap_01_ac19_a_click_on_due_opens_the_calendar_and_this_week_is_saved', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('cap01ac19');
  const vault = inboxCopy(base);
  const sup = support(base);
  const log = join(base, 'perf.jsonl');
  let d: Driver | undefined;
  try {
    d = await session(testEnv(sup, log, { TEGG_VAULT: vault, TEGG_ROUTE: 'inbox' }));
    assert.ok(await waitMark(log, 'route-ready:inbox'), 'inbox shown');
    await activateFinder();
    hotkey('task');
    assert.ok(await waitFor(() => captureOpen(d!), 3000), 'the capture window opens as Task (⌃⌥T)');
    paste('Zavolat kominíkovi');
    await sleep(300);
    const due = await need(d, 'Due: No date');
    await due.click();
    await need(d, 'Pick a due date');
    const thisWeek = await need(d, 'This week');
    await thisWeek.click();
    assert.ok(await waitFor(async () => !(await need(d!, 'Pick a due date', 200).then(() => true, () => false)), 2000), 'This week closes the dialog');
    press('enter', ['command']);
    const text = await waitFor(() => (read(vault, 'Tasks/Zavolat kominíkovi.md') ?? '').includes('\ndue: '), 3000);
    assert.ok(text, 'the task is written');
    assert.match(read(vault, 'Tasks/Zavolat kominíkovi.md') ?? '', /^due: 2026-10-16$/m, 'due: 2026-10-16 (the Friday after Wed 14 Oct)');
  } finally {
    await end(d);
    rmSync(base, { recursive: true, force: true });
  }
});
