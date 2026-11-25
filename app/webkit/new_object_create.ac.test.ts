// New objects from `/` and `+`, L5 (WebKit + fake core): creating and linking (docs/acceptance/new-object-menu.md R236…
// R238; contract docs/contracts/new-object-menu.md §3, §4). FR-EDT-03 AC-14 (N1…N8: the new file, the link chip, the
// caret after it, no navigation, the link resolves), AC-15 (one undo step, the object stays, no autosave of the trigger),
// AC-16 (N9 CRLF host, N10 no frontmatter, N11 virtual Daily Note, a Task card's body, a template; nothing in the read
// view), AC-17 (a failed create, a double ⏎, a stem taken meanwhile), FR-VLT-05 AC-18 (the bytes of every create path,
// no `source`, the row ignores the default type), FR-CNV-01 AC-9 (`/task` no longer converts; ⇧⌘T, ⇧⌘O and
// `Turn into object…` do). The tasks fixture with the conversion notes, clock 2026-10-14T12:00 Europe/Prague, region cs.
// Written from the ACs and the contract only (D-61); every missing element fails an assertion (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { cmdD } from './daily-helpers';
import { linkSuggestions } from './editor-helpers';
import { chips } from './links-helpers';
import {
  addBelow, alertWith, callsOf, caretAt, editorBody, embedBody, main, mainName, needCard, needPopover, openConvert, popover, popoverAt, saved, writeLog,
} from './convert-helpers';
import {
  BLOKY, C, NOW, caretAfter, convertVault, created, dialogCreate, eventually, fileExists, fileText, masked, must, needDialog, needMenu, newBytes, newDialog,
  nfc, original, seen, sleep, slashMenu, swap, type FakeCoreHandle,
} from './new-object-helpers';
import { navs } from './mindmap-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const B0 = original(BLOKY);
const noMod = (t: string | undefined) => (t ?? '').replace(/^modified: .*$/m, 'modified: <x>');
const touched = (t: string) => t.replace(/^modified: .*$/m, `modified: ${NOW}`);
const line1 = (typed: string) => swap(B0, 'Úvodní odstavec.\n', `Úvodní odstavec.${typed}\n`);

/** Types `trigger` after `after` (or in a new empty paragraph after line 1), ⏎ on the first row, the title, ⏎. */
async function createVia(page: Page, o: { after?: string; emptyParagraph?: boolean; trigger: string; type: string; title: string; nfd?: boolean }) {
  if (o.emptyParagraph) {
    await caretAfter(page, 'Úvodní odstavec.');
    await (await must(addBelow(page), 'button "Add block below"')).click();
    await sleep(100);
  } else await caretAfter(page, o.after ?? 'Úvodní odstavec.');
  await page.keyboard.type(o.trigger);
  await needMenu(page, o.trigger);
  await page.keyboard.press('Enter');
  await needDialog(page, o.type, `${o.trigger} ⏎`);
  if (o.nfd) await page.keyboard.insertText(o.title.normalize('NFD'));
  else await page.keyboard.insertText(o.title);
  await page.keyboard.press('Enter');
}

type N = { n: string; trigger: string; type: string; title: string; file: string; host: (b: string) => string; nfd?: boolean; emptyParagraph?: boolean; check?: (t: string) => string | null };
const NS: N[] = [
  { n: 'N1', trigger: ' +pa', type: 'Page', title: 'Nový plán', file: 'Pages/Nový plán.md', host: () => line1(' [[Nový plán]]') },
  { n: 'N2', trigger: '/task', type: 'Task', title: 'Zavolat Petrovi', file: 'Tasks/Zavolat Petrovi.md', emptyParagraph: true, host: () => swap(B0, 'Úvodní odstavec.\n\nZavolat', 'Úvodní odstavec.\n\n[[Zavolat Petrovi]]\n\nZavolat') },
  { n: 'N3', trigger: ' +pa', type: 'Page', title: 'Koupit lepidlo', file: 'Pages/Koupit lepidlo (2).md', host: () => line1(' [[Koupit lepidlo (2)|Koupit lepidlo]]') },
  { n: 'N4', trigger: ' +pa', type: 'Page', title: 'Q4: plán/rozpočet', file: 'Pages/Q4 plán rozpočet.md', host: () => line1(' [[Q4 plán rozpočet|Q4: plán/rozpočet]]'), check: (t) => (t.includes('\ntitle: "Q4: plán/rozpočet"\n') ? null : 'title: "Q4: plán/rozpočet"') },
  { n: 'N5', trigger: ' +pa', type: 'Page', title: 'C# poznámky', file: 'Pages/C poznámky.md', host: () => line1(' [[C poznámky|C# poznámky]]') },
  { n: 'N6', trigger: ' +pa', type: 'Page', title: 'Dvojník', file: 'Pages/Dvojník (2).md', host: () => line1(' [[Dvojník (2)|Dvojník]]') },
  { n: 'N7', trigger: ' +pa', type: 'Page', title: 'Čtení knih', nfd: true, file: 'Pages/Čtení knih.md', host: () => line1(' [[Čtení knih]]'), check: (t) => (t.includes('\ntitle: Čtení knih\n') ? null : 'title in NFC') },
  { n: 'N8', trigger: ' +pro', type: 'Projekt', title: 'Spuštění webu', file: 'Projekty/Spuštění webu.md', host: () => line1(' [[Spuštění webu]]'), check: (t) => (t.includes('\ntype: projekt\n') ? null : 'type: projekt') },
];

async function runN(page: Page, cases: N[]) {
  const bad: string[] = [];
  for (const c of cases) {
    const core = await openConvert(page, BLOKY);
    const navs0 = (await navs(core)).length;
    await createVia(page, c);
    const t = await fileExists(core, c.file);
    if (t === undefined) { bad.push(`${c.n}: ${c.file} not created (${JSON.stringify(await created(core))})`); continue; }
    if (nfc(c.file) !== c.file || !(c.file in (await core.files()))) bad.push(`${c.n}: the file name is not NFC`);
    const extra = c.check?.(t);
    if (extra) bad.push(`${c.n}: ${extra}`);
    if (c.n === 'N1' && masked(t) !== newBytes('page', 'Nový plán')) bad.push(`N1: bytes ${JSON.stringify(t)}`);
    if (c.n === 'N2' && masked(t) !== newBytes('task', 'Zavolat Petrovi')) bad.push(`N2: bytes ${JSON.stringify(t)}`);
    const h = await saved(page, core, BLOKY, (x) => noMod(x) === noMod(c.host(B0)), 3000);
    if (noMod(h) !== noMod(c.host(B0))) { bad.push(`${c.n}: host ${JSON.stringify(h)}`); continue; }
    // D-2658: only embeds that are new compared with the host before count (Bloky already holds `![[Zasedačka]]`).
    const embeds = (x: string) => (x.match(/!\[\[[^\]]*\]\]/g) ?? []).join('\n');
    if (embeds(h ?? '') !== embeds(B0)) bad.push(`${c.n}: an embed in the host`);
    const linkText = c.host(B0).match(/\[\[([^\]]+)\]\]/g)!.find((l) => !B0.includes(l))!.slice(2, -2);
    const shown = linkText.includes('|') ? linkText.split('|')[1] : linkText;
    if ((await chips(editorBody(page), nfc(shown)).count()) !== 1) bad.push(`${c.n}: no link chip "${shown}"`);
    if ((await chips(editorBody(page), nfc(shown)).first().getAttribute('data-link-kind')) === 'unresolved') bad.push(`${c.n}: the link doesn't resolve (link_resolve, FR-LNK-14)`);
    if ((await created(core)).length !== 1) bad.push(`${c.n}: created ${JSON.stringify(await created(core))}`);
    await page.keyboard.type('X');
    const x = await saved(page, core, BLOKY, (y) => !!y?.includes(`[[${linkText}]]X`), 3000);
    if (!x?.includes(`[[${linkText}]]X`)) bad.push(`${c.n}: the caret isn't right after the link`);
    if ((await mainName(page)) !== 'Bloky') bad.push(`${c.n}: the route changed to ${await mainName(page)}`);
    if ((await navs(core)).length !== navs0) bad.push(`${c.n}: a navigation (history entry)`);
  }
  assert.deepEqual(bad, [], 'R237: exactly the new file, a link chip in place of the trigger and query, the caret after it, no navigation (D-2603)');
}

// ------------------------------------------------------------------------------------------------ FR-EDT-03 AC-14, FR-VLT-05 AC-18

test('fr_edt_03_ac14_create_inserts_a_link_n1_to_n4', async ({ page }) => {
  test.setTimeout(150_000);
  await runN(page, NS.slice(0, 4));
});

test('fr_edt_03_ac14_create_inserts_a_link_n5_to_n8', async ({ page }) => {
  test.setTimeout(150_000);
  await runN(page, NS.slice(4));
});

test('fr_vlt_05_ac18_the_same_bytes_as_every_create_path', async ({ page }) => {
  test.setTimeout(150_000);
  const bad: string[] = [];
  for (const [trigger, type, title, folder] of [[' +quick', 'Quick Note', 'Nápad na víkend', 'Quick Notes'], [' +pro', 'Projekt', 'Spuštění webu', 'Projekty']] as const) {
    let core = await openConvert(page, BLOKY);
    await createVia(page, { trigger, type, title });
    const viaMenu = await fileExists(core, `${folder}/${title}.md`);
    core = await openConvert(page, BLOKY);
    await caretAfter(page, 'Úvodní odstavec.');
    await page.keyboard.type(` [[${title}`);
    await (await must(linkSuggestions(page).getByRole('option', { name: `Create "${title}" as…`, exact: true }), `Create "${title}" as…`)).click();
    await (await must(page.getByRole('menu', { name: 'Type', exact: true }).getByRole('menuitemradio', { name: type, exact: true }), `Type › ${type}`)).click();
    const viaLink = await fileExists(core, `${folder}/${title}.md`);
    if (!viaMenu || !viaLink || masked(viaMenu) !== masked(viaLink)) bad.push(`New ${type} › ${title}: ${JSON.stringify(viaMenu)} ≠ ${JSON.stringify(viaLink)}`);
    if (/^source:/m.test(viaMenu ?? '')) bad.push(`New ${type}: a source key (AP-2128)`);
  }
  const core = await openConvert(page, BLOKY, { vault: convertVault((f) => { f['.tegg/vault.yml'] = f['.tegg/vault.yml'].replace(/^default-type: .*$/m, 'default-type: task'); }) });
  await createVia(page, { trigger: ' +pa', type: 'Page', title: 'Nový plán' });
  const t = await fileExists(core, 'Pages/Nový plán.md');
  if (!t || masked(t) !== newBytes('page', 'Nový plán')) bad.push(`default-type: task, New Page: ${JSON.stringify(t)}`);
  assert.equal(await page.getByRole('menu', { name: 'Type', exact: true }).count(), 0, 'nothing asks for a type: the row is the type');
  assert.deepEqual(bad, [], 'R238: the bytes of `Create "<title>" as…`, no `source`, the default type ignored');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-03 AC-15

test('fr_edt_03_ac15_one_undo_step_and_the_object_stays', async ({ page }) => {
  const core = await openConvert(page, BLOKY);
  await caretAfter(page, 'Úvodní odstavec.');
  await page.keyboard.type(' +pa');
  await needMenu(page, ' +pa');
  await sleep(1500);
  assert.deepEqual(await writeLog(core), [], 'the menu open: the trigger and query are not autosaved');
  await page.keyboard.press('Enter');
  await needDialog(page, 'Page', '⏎');
  await page.keyboard.insertText('Nový plán');
  await sleep(1500);
  assert.deepEqual(await writeLog(core), [], 'the dialog open: nothing autosaved');
  await page.keyboard.press('Enter');
  const n1 = line1(' [[Nový plán]]');
  assert.equal(noMod(await saved(page, core, BLOKY, (x) => noMod(x) === noMod(n1))), noMod(n1), 'N1');
  const hostWrites = (await callsOf(core, 'note_write')).filter((c) => nfc(String((c.args as { path?: string }).path)) === BLOKY);
  assert.ok(hostWrites.length >= 1 && hostWrites.every((c) => String((c.args as { text?: string }).text).includes('[[Nový plán]]')), 'the host\'s only writes contain the link');
  await page.keyboard.press('Meta+z');
  // D-2657: the trailing space typed before `+` is not saved (paragraph edges are normalized).
  const u = await saved(page, core, BLOKY, (x) => noMod(x) === noMod(line1('')));
  assert.equal(noMod(u), noMod(line1('')), '⌘Z removes the link in one step and leaves `Úvodní odstavec.` (AP-2130, D-2657)');
  assert.ok((await fileText(core, 'Pages/Nový plán.md')) !== undefined, 'Pages/Nový plán.md stays (undo never deletes a file)');
  await page.keyboard.press('Meta+Shift+z');
  assert.equal(noMod(await saved(page, core, BLOKY, (x) => noMod(x) === noMod(n1))), noMod(n1), '⇧⌘Z puts the same link back');
  assert.equal((await callsOf(core, 'note_create')).length, 1, 'without a second note_create');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-03 AC-16

test('fr_edt_03_ac16_crlf_and_no_frontmatter_hosts_n9_n10', async ({ page }) => {
  let core = await openConvert(page, C.crlfHost);
  await createVia(page, { after: 'Úkol s CRLF', trigger: ' +pa', type: 'Page', title: 'Nový plán' });
  const crlf = original(C.crlfHost);
  const n9 = touched(swap(crlf, 'Úkol s CRLF', 'Úkol s CRLF [[Nový plán]]'));
  assert.equal(noMod(await saved(page, core, C.crlfHost, (x) => noMod(x) === noMod(n9))), noMod(n9), 'N9: CRLF on every line, still no final newline');
  const nf = await fileExists(core, 'Pages/Nový plán.md');
  assert.ok(nf && !nf.includes('\r'), 'the new file has `\\n` line endings');
  core = await openConvert(page, C.bezHost);
  await createVia(page, { after: 'Úkol bez hlavičky', trigger: ' +pa', type: 'Page', title: 'Nový plán' });
  const h = await eventually(() => fileText(core, C.bezHost), (x) => !!x?.includes('[[Nový plán]]'), 3000);
  assert.ok(h?.startsWith('---\n') && /\nid: [0-9A-HJKMNP-TV-Z]{26}\n/.test(h) && h.includes('\ntype: page\n') && /\nmodified: /.test(h), `N10: the first-edit frontmatter (editor.md FR-FMT-02 AC-5): ${JSON.stringify(h)}`);
  assert.ok(h?.includes('Úkol bez hlavičky [[Nový plán]]\n'), 'and the link');
});

test('fr_edt_03_ac16_a_virtual_daily_note_n11', async ({ page }) => {
  const core = await openConvert(page, BLOKY);
  await cmdD(page, '2026-10-14');
  const body = await must(editorBody(page), 'the Daily Note editor');
  await body.click();
  await page.keyboard.type('/quick');
  await needMenu(page, '/quick');
  await page.keyboard.press('Enter');
  await needDialog(page, 'Quick Note', '/quick ⏎');
  await page.keyboard.insertText('Nápad na víkend');
  await page.keyboard.press('Enter');
  const d = await fileExists(core, 'Daily/2026-10-14.md', 4000);
  assert.ok(d?.endsWith('---\n[[Nápad na víkend]]\n'), `the Daily Note's first write holds the link: ${JSON.stringify(d)}`);
  await sleep(1300);
  assert.deepEqual(await created(core), ['Daily/2026-10-14.md', 'Quick Notes/Nápad na víkend.md'], 'exactly two files');
  assert.deepEqual((await core.writesTo()).map(nfc), ['Quick Notes/Nápad na víkend.md', 'Daily/2026-10-14.md'], 'the Quick Note first, then the Daily Note (create-exclusive)');
});

test('fr_edt_03_ac16_a_task_card_body_a_template_and_read_views', async ({ page }) => {
  let core = await openConvert(page, C.porada);
  const card = await needCard(main(page), 'Zavolat Janě');
  assert.ok(await caretAt(embedBody(card), 'Domluvit schůzku na příští týden.'), 'caret in the card\'s body');
  await page.keyboard.type(' +pa');
  await needMenu(page, 'in a Task card');
  await page.keyboard.press('Enter');
  await needDialog(page, 'Page', 'in a Task card');
  await page.keyboard.insertText('Nový plán');
  await page.keyboard.press('Enter');
  const t = await eventually(() => fileText(core, C.t01), (x) => !!x?.includes('[[Nový plán]]'), 3000);
  assert.ok(t?.includes('Domluvit schůzku na příští týden. [[Nový plán]]'), 'the link goes into Tasks/Zavolat Janě.md');
  await sleep(1300);
  assert.equal(await fileText(core, C.porada), original(C.porada), 'Porada is untouched');
  core = await openConvert(page, C.sablona, { route: `note/${C.sablona}` });
  await must(editorBody(page), 'the template\'s editor', 5000);
  await createVia(page, { after: 'Úkol v šabloně', trigger: ' +pa', type: 'Page', title: 'Nový plán' });
  const s = await eventually(() => fileText(core, C.sablona), (x) => !!x?.includes('[[Nový plán]]'), 3000);
  assert.ok(s?.includes('Úkol v šabloně [[Nový plán]]'), 'in a template the New rows work (AP-2125)');
  // D-2658: the read view and the read-only note each start on a fresh page, so the template's route init script (and
  // the read view's flag) don't persist into them.
  for (const readView of [true]) {
    const rv = await page.context().newPage();
    await openConvert(rv, BLOKY, { readView });
    await main(rv).getByText('Úvodní odstavec.').first().click().catch(() => {});
    await rv.keyboard.type('+');
    await rv.keyboard.type('/');
    assert.equal(await seen(slashMenu(rv), 400), false, 'the read view: `+` and `/` open nothing');
    await rv.close();
  }
  const ro = await page.context().newPage();
  await openConvert(ro, BLOKY, { vault: convertVault((f) => { f[BLOKY] = f[BLOKY].replace('title: Bloky\n', 'title: "Bloky\n'); }), noEditor: true });
  await main(ro).getByText('Úvodní odstavec.').first().click().catch(() => {});
  await ro.keyboard.type('+');
  assert.equal(await seen(slashMenu(ro), 400), false, 'a note opened read-only (NFR-REL-03): nothing opens');
  await ro.close();
});

// ------------------------------------------------------------------------------------------------ FR-EDT-03 AC-17

test('fr_edt_03_ac17_a_failed_create_changes_nothing', async ({ page }) => {
  const core = await openConvert(page, BLOKY);
  await core.writeControl({ fail: 'Io', path: 'Pages/Nový plán.md' });
  await createVia(page, { trigger: ' +pa', type: 'Page', title: 'Nový plán' });
  await must(alertWith(page, 'Couldn’t create "Nový plán". Nothing was changed.'), 'the alert (AP-2131)');
  assert.equal(await seen(newDialog(page, 'Page'), 300), false, 'the dialog closes');
  await core.writeControl({ fail: null, path: null });
  const t = await saved(page, core, BLOKY, (x) => noMod(x) === noMod(line1(' +pa')), 3000);
  assert.equal(noMod(t), noMod(line1(' +pa')), '` +pa` stays as typed text; no link');
  assert.deepEqual(await created(core), [], 'nothing created');
});

test('fr_edt_03_ac17_double_enter_and_a_stem_taken_meanwhile', async ({ page }) => {
  let core = await openConvert(page, BLOKY);
  await caretAfter(page, 'Úvodní odstavec.');
  await page.keyboard.type(' +pa');
  await needMenu(page, ' +pa');
  await page.keyboard.press('Enter');
  await needDialog(page, 'Page', '⏎');
  await page.keyboard.insertText('Nový plán');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  const h = await saved(page, core, BLOKY, (x) => !!x?.includes('[[Nový plán]]'), 3000);
  await sleep(1000);
  assert.deepEqual(await created(core), ['Pages/Nový plán.md'], '⏎ twice within 50 ms: exactly one file');
  assert.equal((h?.match(/\[\[Nový plán/g) ?? []).length, 1, 'and one link');
  core = await openConvert(page, BLOKY);
  await caretAfter(page, 'Úvodní odstavec.');
  await page.keyboard.type(' +pa');
  await needMenu(page, ' +pa');
  await page.keyboard.press('Enter');
  const d = await needDialog(page, 'Page', '⏎');
  await page.keyboard.insertText('Nový plán');
  await core.setFile('Pages/Nový plán.md', '---\nid: 01JB5A0000000000000000X001\ntype: page\ntitle: Nový plán\n---\nCizí.\n');
  await sleep(300);
  await (await must(dialogCreate(d), 'Create')).click();
  const want = line1(' [[Nový plán (2)|Nový plán]]');
  assert.equal(noMod(await saved(page, core, BLOKY, (x) => noMod(x) === noMod(want), 3000)), noMod(want), 'the link names the file actually created (FR-CNV-03 AC-5\'s rule)');
  assert.ok((await fileText(core, 'Pages/Nový plán (2).md')) !== undefined, 'Pages/Nový plán (2).md created');
  assert.equal(await fileText(core, 'Pages/Nový plán.md'), '---\nid: 01JB5A0000000000000000X001\ntype: page\ntitle: Nový plán\n---\nCizí.\n', 'the other program\'s file is untouched');
});

// ------------------------------------------------------------------------------------------------ FR-CNV-01 AC-9

test('fr_cnv_01_ac9_slash_task_no_longer_converts', async ({ page }) => {
  let core = await openConvert(page, BLOKY, { convert: { lastType: 'page', skipRemoveConfirm: false } });
  await caretAfter(page, 'Úvodní odstavec.');
  await page.keyboard.type(' /task');
  const { names } = await needMenu(page, ' /task');
  assert.deepEqual(names, ['New Task'], '/task finds New Task');
  await page.keyboard.press('Enter');
  const d = await needDialog(page, 'Task', '/task ⏎');
  assert.equal(await seen(popover(page), 300), false, 'never R50');
  assert.equal(await d.getByRole('textbox', { name: 'Title', exact: true }).inputValue(), '', 'an empty title: the paragraph\'s text is not taken');
  await page.keyboard.insertText('X');
  await page.keyboard.press('Enter');
  const want = line1(' [[X]]');
  assert.equal(noMod(await saved(page, core, BLOKY, (x) => noMod(x) === noMod(want), 3000)), noMod(want), '`Úvodní odstavec. [[X]]`');
  assert.ok((await fileText(core, 'Tasks/X.md'))?.includes('\ntype: task\n'), 'Tasks/X.md');
  core = await openConvert(page, BLOKY);
  await popoverAt(page, 'Úvodní odstavec.', 'Meta+Shift+t');
  await page.keyboard.press('Enter');
  const conv = await saved(page, core, BLOKY, (x) => !!x?.includes('![[Úvodní odstavec]]'), 3000);
  assert.ok(conv?.includes('![[Úvodní odstavec]]\n'), '⇧⌘T ⏎ still converts the paragraph into a Task with its embed');
  await openConvert(page, BLOKY);
  await popoverAt(page, 'Úvodní odstavec.', 'Meta+Shift+o');
  await page.keyboard.press('Escape');
  await caretAfter(page, 'Úvodní odstavec.');
  await page.keyboard.type(' /turn');
  await needMenu(page, ' /turn');
  await page.keyboard.press('Enter');
  await needPopover(page, '/turn ⏎');
});
