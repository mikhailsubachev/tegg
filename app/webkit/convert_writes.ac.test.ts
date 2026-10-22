// MS5 slice 5A-2, L5 (WebKit + fake core): writes of a conversion. docs/acceptance/conversion.md FR-SYN-06 AC-23 (every
// conversion writes exactly the new object and the source note; opening and cancelling R50, choosing types and browsing
// the Task cards of Porada, Dvě karty and Obal write nothing). Writes are counted per path with the fake core's
// `writesTo()` (successful writes in order) and every non-read IPC call (ms5-tasks §11.7). Written from the ACs and the
// contracts only (D-61). The bytes-mtime-inode check is the L6 part (app/e2e/ms5_convert.ac.test.ts).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  C, absent, cancelButton, caretAfter, checkedType, click, confirm, eventually, main, needCard, needPopover, newPaths, nfc, openConvert,
  popover, popoverAt, selectBlocks, selectText, sleep, toolbar, typeRadio, writeLog, type FakeCoreHandle,
  switchTo,
} from './convert-helpers';

test.use({ timezoneId: 'Europe/Prague' });

/** Runs one conversion and returns the paths written since `from` (after the save and a 1.3 s autosave window). */
async function oneConversion(page: Page, core: FakeCoreHandle, host: string, act: () => Promise<void>): Promise<{ written: string[]; created: string }> {
  const from = (await core.writesTo()).length;
  const before = await newPaths(core);
  await act();
  const created = (await eventually(() => newPaths(core), (p) => p.length > before.length, 3000)).filter((p) => !before.includes(p));
  assert.equal(created.length, 1, `one new file: ${JSON.stringify(created)}`);
  await eventually(async () => (await core.writesTo()).slice(from).map(nfc), (w) => w.includes(nfc(host)), 3000);
  await sleep(1300);
  return { written: (await core.writesTo()).slice(from).map(nfc), created: created[0] };
}

test('fr_syn_06_ac23_every_conversion_in_bloky_writes_exactly_two_files', async ({ page }) => {
  test.setTimeout(120_000);
  const core = await openConvert(page, C.bloky);
  const steps: [string, () => Promise<void>][] = [
    ['paragraph → Task', async () => { await popoverAt(page, 'Zavolat do servisu kvůli kolu'); await confirm(page); }],
    ['heading + paragraph → Page', async () => { await selectBlocks(page, 'Připravit podklady', 1); await page.keyboard.press('Meta+Shift+o'); await needPopover(page, 'two blocks'); await confirm(page, { type: 'Page' }); }],
    ['checklist item with children → Task', async () => { await popoverAt(page, 'projektor pro'); await confirm(page); }],
    ['numbered item → Page', async () => { await popoverAt(page, 'Druhý bod', 'Meta+Shift+o'); await confirm(page, { type: 'Page' }); }],
    ['quote → Quick Note', async () => {
      await selectText(page, 'Citace');
      await click(toolbar(page).getByRole('button', { name: 'Turn into object', exact: true }), 'Formatting › Turn into object');
      await needPopover(page, 'quote');
      await confirm(page, { type: 'Quick Note' });
    }],
    ['Q3 → Task', async () => { await popoverAt(page, 'Q3: rozpočet'); await confirm(page); }],
    ['fence → Projekt', async () => { await popoverAt(page, 'kód();', 'Meta+Shift+o'); await confirm(page, { title: 'Skript', type: 'Projekt' }); }],
  ];
  const results: [string, string[]][] = [];
  const want: [string, string[]][] = [];
  for (const [what, act] of steps) {
    const r = await oneConversion(page, core, C.bloky, act);
    results.push([what, [...new Set(r.written)].sort()]);
    want.push([what, [r.created, C.bloky].map(nfc).sort()]);
  }
  assert.deepEqual(results, want, 'each conversion writes the new object and Bloky, nothing else');
});

test('fr_syn_06_ac23_conversions_in_other_hosts_write_two_files', async ({ page }) => {
  test.setTimeout(120_000);
  const results: [string, string[]][] = [];
  const want: [string, string[]][] = [];
  for (const [host, text] of [[C.nfdHost, 'Úkol v NFD'], [C.crlfHost, 'Úkol s CRLF'], [C.bezHost, 'Úkol bez hlavičky'], [C.ctips, 'Úkol z tipů'], [C.porada, 'Zavolat dodavateli']] as const) {
    const p = await page.context().newPage();
    const core = await openConvert(p, host);
    const r = await oneConversion(p, core, host, async () => {
      await caretAfter(p, text); // NFD host: the helper compares the text nodes in NFC
      await p.keyboard.press('Meta+Shift+t');
      await needPopover(p, host);
      await confirm(p);
    });
    results.push([host, [...new Set(r.written)].sort()]);
    want.push([host, [r.created, host].map(nfc).sort()]);
    await p.close();
  }
  assert.deepEqual(results, want, 'each conversion writes exactly the new object and its source note');
});

test('fr_syn_06_ac23_opening_cancelling_and_choosing_types_write_nothing', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await popoverAt(page, 'Úvodní odstavec.', 'Meta+Shift+o');
  for (const t of ['Page', 'Quick Note', 'Projekt', 'Task']) {
    await click(typeRadio(page, t), `radio ${t}`);
    assert.equal(await checkedType(page), t, `${t} chosen`);
  }
  await click(cancelButton(page), 'Cancel');
  assert.ok(await absent(popover(page), 1000), 'Cancel closes R50');
  await popoverAt(page, 'Odstavec pod', 'Meta+Shift+t');
  await page.keyboard.press('Escape');
  assert.ok(await absent(popover(page), 1000), 'Esc closes R50');
  await sleep(1500);
  assert.deepEqual(await writeLog(core), [], 'nothing written');
  assert.deepEqual(await core.writesTo(), [], 'no file written');
});

test('fr_syn_06_ac23_browsing_task_cards_writes_nothing', async ({ page }) => {
  const core = await openConvert(page, C.porada);
  const card = await needCard(main(page), 'Zavolat Janě', 'Porada: the Task card');
  await card.hover();
  await card.getByRole('button', { name: /^Status: / }).click();
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: /^Priority: / }).click();
  await page.keyboard.press('Escape');
  await switchTo(page, 'Dvě karty');
  await needCard(main(page), 'Zavolat Janě', 'Dvě karty: the second card', 1);
  await switchTo(page, 'Obal');
  await needCard(main(page), 'Zavolat Janě', 'Obal: the card at depth 2');
  await sleep(1500);
  assert.deepEqual(await writeLog(core), [], 'browsing the Task cards writes nothing');
  assert.deepEqual(await core.writesTo(), [], 'no file written');
});
