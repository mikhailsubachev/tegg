// Slice AND-3, L5p (projects `phone-webkit`, `phone-chromium`): docs/acceptance/android-edit.md, the note on the phone:
// - FR-EDT-01 AC-15 (a note is the editor), AC-16 (opening shows no keyboard; a tap places the caret), AC-17 (what the
//   phone's editor leaves out), AC-18 (the title is fixed once the file exists), AC-19 (keyboard input gives the
//   desktop's result), AC-20 (Czech from the keyboard is NFC);
// - FR-EDT-10 AC-12 (the read view only where the phone can't write);
// - FR-MMP-02 AC-37 (the map stays read-only in the phone's editor).
// Contract docs/contracts/android-edit.md §7 (the note: mode, title, save state, focus), §8, §9 (keyboard input), §5.2,
// §15.1, §17.1 (`ime`, the fake core's `android_ime`, `desktopEditorResult`). Fixture: editor/ + new-empty/.tegg/ +
// phone-edit/ at 2026-10-14 12:00 Prague.
// Red-test readings (reported, D-2543…): "the same block structure and text as the desktop editor" compares the Note
// body's top-level elements (tag and text) on both layouts; RA16's cases compare the saved file with the desktop's saved
// file after the same document, caret and real key presses; "the keyboard shows" at L5p is the emulated keyboard push
// after the tap (the plugin's `keyboard: true`), and a script focus without a tap is recorded as `android_ime(true)`.
// Chromium is authoritative for keyboard input (D-2540); every case runs on both engines unless WebKit can't send it.
// Written from the ACs and the contract only (D-61).
import { test, type Browser, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  EDIT_NOW, PE, appBar, assertZeroWrites, barButton, desktopEditorResult, bodyBlocks, bodyFocused, caretInfo, desktopPage, editVault, editorText, eventually, fileStateOf, flat, formatBar,
  goNote, h1Is, h1Text, keyboard, longPressOn, main, moreButton, moreMenu, must, needBody, nfc, noteBody, panel, phonePage, runById, saveState, savedText,
  searchField, seen, setCaret, settledWriteCalls, sleep, startDesktop, startPhone, systemBack, tapText, tapToEdit, textRect, titleField, typeSheet, writeCalls, writesSeen,
  type PhoneHandle,
} from './phone-helpers';
import { ime, type ImeStep } from './phone-ime';
import { absent } from './helpers';

test.use({ timezoneId: 'Europe/Prague' });

const PSANI = nfc(PE.psani);
const original = (path: string) => editVault().files[nfc(path)];
/** Psaní with `from` replaced by `to` once, and `modified` at the clock (the expected saved file). */
function edited(from: string, to: string, path: string = PE.psani): string {
  const o = original(path);
  assert.ok(o && o.includes(from), `fixture ${path} holds ${JSON.stringify(from)}`);
  return o.replace(from, () => to).replace(/^modified: .*$/m, `modified: ${EDIT_NOW}`);
}
async function openPsani(page: Page, o: { nfdNames?: string[] } = {}): Promise<PhoneHandle> {
  const core = await startPhone(page, { vault: editVault(), route: `note/${PE.psani}`, now: EDIT_NOW, ...o });
  await needBody(page, 'Psaní');
  return core;
}
async function openMore(page: Page) {
  await (await must(moreButton(page), 'More actions')).click();
  return must(moreMenu(page), 'menu "More actions"');
}
const activeIsH1 = (page: Page) => page.evaluate(() => {
  const a = document.activeElement;
  return !!a && a.tagName === 'H1' && !!a.closest('header, [role="banner"]');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-01 AC-15

async function deskBlocks(browser: Browser, path: string): Promise<string[]> {
  const { page, context } = await desktopPage(browser);
  try {
    await startDesktop(page, { vault: editVault(), route: `note/${path}`, now: EDIT_NOW });
    await must(page.getByRole('textbox', { name: 'Note body' }), `desktop: ${path}'s editor`, 8000);
    return await bodyBlocks(page);
  } finally {
    await context.close();
  }
}
async function isReadOnly(page: Page, what: string) {
  assert.equal(await page.locator('main [contenteditable="true"]').count(), 0, `${what}: the read view, no contenteditable`);
  assert.equal(flat(await (await must(saveState(page), `${what}: status "Save state"`)).innerText()), 'Read-only', `${what}: Save state Read-only`);
}

test('fr_edt_01_ac15_note_is_the_editor_on_the_phone', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const core = await openPsani(page);
  const before = await fileStateOf(core);
  const body = noteBody(page);
  assert.equal(await body.getAttribute('contenteditable'), 'true', 'Note body is contenteditable="true"');
  assert.equal(await body.getAttribute('aria-multiline'), 'true', 'aria-multiline="true"');
  assert.equal(await h1Text(page), 'Psaní', 'the app bar\'s h1 is Psaní');
  assert.deepEqual(await bodyBlocks(page), await deskBlocks(browser, PE.psani), 'Psaní: the desktop editor\'s blocks and text');
  await goNote(page, 'Deset bloků');
  await needBody(page, 'Deset bloků');
  assert.deepEqual(await bodyBlocks(page), await deskBlocks(browser, PE.deset), 'Deset bloků: the desktop editor\'s blocks and text');
  // the read-only cases
  await goNote(page, 'Chyba uvozovky');
  await isReadOnly(page, 'Chyba uvozovky (invalid frontmatter)');
  await core.setFile('Pages/Neplatné UTF-8.md', new Uint8Array([...new TextEncoder().encode('---\ntype: page\n---\nPřed chybou '), 0xff, ...new TextEncoder().encode(' za chybou.\n')]));
  await goNote(page, 'Neplatné UTF-8');
  await isReadOnly(page, 'Neplatné UTF-8.md');
  // every note of the fixture opened and left writes nothing (the runtime file above excepted from "before")
  const now = await fileStateOf(core);
  for (const title of ['Psaní', 'Mapa v textu', 'Tabulka', 'Deset bloků', 'Cíl', 'Úkoly', 'Prázdná', 'Bez hlavičky', 'Seznamy', 'Štítky', 'Odstavce', 'Surové bloky', 'Cizí hlavička', 'Odsazený kód', 'C# tips']) {
    await goNote(page, title);
    await sleep(200);
    await systemBack(page);
  }
  await assertZeroWrites(core, { files: { ...before.files, 'Pages/Neplatné UTF-8.md': now.files['Pages/Neplatné UTF-8.md'] }, bin: now.bin }, 'opening and leaving every note');
  // the editor-load failure hook and the NFD-named note
  const p2 = await phonePage(browser);
  await p2.addInitScript(() => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), faults: { editorLoad: true } }; });
  const c2 = await startPhone(p2, { vault: editVault(), route: `note/${PE.deset}`, now: EDIT_NOW });
  await isReadOnly(p2, 'the editor-load failure');
  assert.deepEqual(await writesSeen(c2), [], 'no write after the editor-load failure');
  await p2.close();
  const p3 = await phonePage(browser);
  const c3 = await startPhone(p3, { vault: editVault(), route: `note/${PE.cil}`, now: EDIT_NOW, nfdNames: [PE.cil] });
  await isReadOnly(p3, 'the NFD-named note');
  assert.deepEqual(await writesSeen(c3), [], 'no write on the NFD-named note');
  await p3.close();
});

// ------------------------------------------------------------------------------------------------ FR-EDT-01 AC-16

test('fr_edt_01_ac16_open_without_keyboard_tap_to_edit', async ({ page }) => {
  const core = await openPsani(page);
  assert.ok(await eventually(() => activeIsH1(page), (v) => v, 2000), 'opening puts the focus on the app bar\'s h1 (D-130)');
  assert.equal(await bodyFocused(page), false, 'no caret in the body after opening');
  assert.deepEqual(await core.imeCalls(), [], 'opening asks for no keyboard (no android_ime)');
  // a tap on chléb: the caret inside it, the keyboard with the bar
  await tapText(page, 'chléb');
  const c = await caretInfo(page);
  assert.ok(c.inBody && c.block === 'chléb' && c.offset >= 1 && c.offset <= 4, `the caret is inside chléb: ${JSON.stringify(c)}`);
  await keyboard(page, true);
  await must(formatBar(page), 'RA15\'s bar with the keyboard', 500);
  const at = c.offset;
  await ime(page, [{ text: 'X' }]);
  const saved = await savedText(core, PE.psani, 3000);
  assert.equal(saved, edited('- chléb', `- ${'chléb'.slice(0, at)}X${'chléb'.slice(at)}`), 'X is saved at the caret, and nothing else changes but modified');
  await keyboard(page, false);
  // Today (a virtual day) and a day with a file: no caret, no keyboard; a tap places the caret
  for (const how of ['virtual', 'file'] as const) {
    if (how === 'file') await core.setFile('Daily/2026-10-14.md', '---\nid: 01JBAN3000000000000000D001\ntype: daily-note\ntitle: 2026-10-14\ndate: 2026-10-14\nreview: unreviewed\ncreated: 2026-10-14T08:00:00+02:00\nmodified: 2026-10-14T08:00:00+02:00\n---\nRáno.\n');
    const n = (await core.imeCalls()).length;
    assert.equal(await runById(page, 'daily.today'), 'ok', `${how}: daily.today`);
    await needBody(page, `Today (${how})`);
    assert.ok(await eventually(() => activeIsH1(page), (v) => v, 2000), `Today (${how}): the focus on the h1`);
    assert.equal(await bodyFocused(page), false, `Today (${how}): no caret`);
    assert.equal((await core.imeCalls()).length, n, `Today (${how}): no android_ime`);
    const box = await noteBody(page).boundingBox();
    assert.ok(box, 'the body has a box');
    await page.touchscreen.tap(box!.x + 20, box!.y + 10);
    assert.ok(await eventually(() => bodyFocused(page), (v) => v, 1000), `Today (${how}): a tap places the caret`);
  }
  // a draft from New: the caret in Title and the keyboard asked for
  const calls = (await core.imeCalls()).length;
  assert.equal(await runById(page, 'object.new'), 'ok', 'object.new opens the type sheet');
  const sheet = await must(typeSheet(page), 'the type sheet "New object"');
  await (await must(sheet.getByRole('option', { name: /^Page\b/ }), 'Page')).click();
  const title = await must(titleField(page), 'the draft\'s Title');
  assert.ok(await eventually(() => title.evaluate((e) => e === document.activeElement || e.contains(document.activeElement)), (v) => v, 1500), 'the caret is in Title');
  assert.deepEqual((await core.imeCalls()).slice(calls), [true], 'android_ime(true) after focusing Title (CP-5)');
  const writes = await writeCalls(core);
  assert.deepEqual(writes.map((w) => w.cmd), ['note_write'], 'placing the caret and showing the keyboard write nothing (only the X)');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-01 AC-17

test('fr_edt_01_ac17_what_the_phone_editor_leaves_out', async ({ page }) => {
  const core = await startPhone(page, { vault: editVault(), route: `note/${PE.deset}`, now: EDIT_NOW });
  const before = await fileStateOf(core);
  await needBody(page, 'Deset bloků');
  await tapToEdit(page, 'Pátý');
  const hidden = async (what: string) => {
    for (const name of ['Add block below', 'Drag to move, click for block menu', 'Turn into object', 'Copy link to block', 'Page width']) {
      assert.equal(await page.getByRole('button', { name }).count() + await page.getByRole('menuitem', { name }).count(), 0, `${what}: no "${name}"`);
    }
    for (const name of ['Block actions', 'Selection']) assert.equal(await page.getByRole('menu', { name }).count(), 0, `${what}: no menu "${name}"`);
    assert.equal(await page.getByRole('dialog', { name: 'Command palette' }).count(), 0, `${what}: no command palette`);
    assert.equal(await page.getByRole('navigation', { name: 'Outline' }).count() + await page.locator('[data-outline-rail]').count(), 0, `${what}: no outline rail`);
    assert.equal(await noteBody(page).locator('[draggable="true"]').count(), 0, `${what}: no block is draggable`);
    assert.ok((await page.getByRole('toolbar', { name: 'Formatting' }).count()) <= 1, `${what}: no floating Formatting toolbar besides RA15's bar`);
  };
  await hidden('caret in block 5');
  await setCaret(page, 'blok', 0, { select: true });
  await hidden('blok selected');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+ArrowDown');
  await hidden('after Esc and ⇧↓');
  // ⇧-tap: a tap with Shift held (a hardware keyboard) makes no block selection either
  await page.keyboard.down('Shift');
  await tapText(page, 'Citace');
  await page.keyboard.up('Shift');
  await hidden('after ⇧-tap');
  const sel = await caretInfo(page);
  assert.ok(sel.inBody, 'the selection stays a text selection in the body');
  // long press: the body's text keeps the system's selection; chips, tags, rows and the app bar don't
  const r = await textRect(page, 'blok');
  assert.ok(r, 'blok has a box');
  const prevented = await page.evaluate((p) => {
    const t = document.elementFromPoint(p.x, p.y) ?? document.body;
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y });
    t.dispatchEvent(e);
    return e.defaultPrevented;
  }, { x: r!.x + r!.width / 2, y: r!.y + r!.height / 2 });
  assert.equal(prevented, false, 'a long press on blok: the contextmenu in the body isn\'t prevented (the system\'s selection and menu)');
  assert.equal(await longPressOn(page, noteBody(page).locator('[data-wikilink], .chip').filter({ hasText: 'Cíl' }).first(), 'the [[Cíl]] chip'), true, 'on a link chip it still is');
  assert.equal(await longPressOn(page, noteBody(page).getByText('#projekt').first(), 'the tag #projekt'), true, 'on a tag it still is');
  assert.equal(await longPressOn(page, appBar(page).getByRole('heading', { level: 1 }), 'the app bar'), true, 'on the app bar it still is');
  await keyboard(page, false);
  // Psaní: a tap on [[Cíl]] opens Cíl; a long press on it does nothing
  await goNote(page, 'Psaní');
  const chip = noteBody(page).locator('[data-wikilink], .chip').filter({ hasText: 'Cíl' }).first();
  assert.equal(await longPressOn(page, chip, 'Psaní\'s [[Cíl]] chip'), true, 'a long press on the chip is prevented');
  assert.equal(await h1Text(page), 'Psaní', 'and does nothing');
  await (await must(chip, 'the chip')).tap();
  assert.ok(await h1Is(page, 'Cíl'), 'a tap on the [[Cíl]] chip opens Cíl (D-140)');
  // an object list row (the Inbox) keeps its prevention
  assert.equal(await runById(page, 'goto.inbox'), 'ok', 'goto.inbox');
  const row = main(page).getByRole('link').first();
  if (await seen(row, 2000)) assert.equal(await longPressOn(page, row, 'an Inbox row'), true, 'on a list row it still is');
  await assertZeroWrites(core, before, 'what the phone\'s editor leaves out');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-01 AC-18

test('fr_edt_01_ac18_title_fixed_once_the_file_exists', async ({ page, browser }) => {
  const core = await openPsani(page);
  const h1 = appBar(page).getByRole('heading', { level: 1 });
  assert.equal(await h1.getAttribute('aria-description'), 'Rename this note on the Mac.', 'the h1\'s description');
  assert.equal(await titleField(page).count(), 0, 'no textbox Title on an existing note');
  await h1.tap();
  assert.deepEqual(await core.imeCalls(), [], 'a tap on the h1 shows no keyboard');
  assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.isContentEditable ?? false), false, 'nothing editable has the focus');
  // the draft new/page: typing writes nothing; Enter commits one note_create
  const p2 = await phonePage(browser);
  const c2 = await startPhone(p2, { vault: editVault(), route: 'new/page', now: EDIT_NOW });
  const title = await must(titleField(p2), 'the draft\'s Title');
  await title.tap();
  await ime(p2, [{ compose: 'V' }, { compose: 'Vý' }, { compose: 'Výlet' }, { commit: 'Výlet' }]);
  await sleep(1500);
  assert.deepEqual(await writesSeen(c2), [], 'typing Výlet into Title writes nothing (D-522)');
  await ime(p2, [{ enter: true, via: '229' }]);
  const made = await settledWriteCalls(c2, 1, 3000);
  assert.deepEqual(made, [{ cmd: 'note_create', path: 'Pages/Výlet.md' }], 'Enter commits it: one note_create of Pages/Výlet.md');
  assert.match((await c2.files())['Pages/Výlet.md'] ?? '', /^title: Výlet$/m, 'title: Výlet (D-522)');
  assert.ok(await h1Is(p2, 'Výlet'), 'the title becomes the fixed h1');
  assert.equal(await titleField(p2).count(), 0, 'no Title field any more');
  assert.ok(await eventually(() => bodyFocused(p2), (v) => v, 1500), 'the caret moves to the body');
  const ci = await caretInfo(p2);
  assert.equal(ci.offset, 0, 'at the start of the body');
  // a body change with an empty title: Pages/Untitled.md, title Untitled, fixed
  const p3 = await phonePage(browser);
  const c3 = await startPhone(p3, { vault: editVault(), route: 'new/page', now: EDIT_NOW });
  await (await needBody(p3, 'the draft')).tap();
  await ime(p3, [{ text: 'Obsah' }]);
  const m3 = await settledWriteCalls(c3, 1, 3000);
  assert.deepEqual(m3.slice(0, 1), [{ cmd: 'note_create', path: 'Pages/Untitled.md' }], 'a body change first writes Pages/Untitled.md (D-523)');
  assert.match((await c3.files())['Pages/Untitled.md'] ?? '', /^title: Untitled$/m, 'title: Untitled');
  assert.ok(await h1Is(p3, 'Untitled'), 'its title is the fixed h1');
  assert.equal(await titleField(p3).count(), 0, 'and not editable');
  // the calls are read before the pages close (D-2555)
  for (const c of [core, c2, c3]) assert.ok(!(await c.calls()).some((x) => x.cmd === 'note_rename'), 'no phone surface sends note_rename');
  await p2.close();
  await p3.close();
});

// ------------------------------------------------------------------------------------------------ FR-EDT-01 AC-19

type Caret = { text: string; offset?: number | 'end'; select?: boolean };
/** `deskCaret`: the desktop's caret when it differs from the phone's (the phone's composition replaces a selection). */
type Case = { caret: Caret; deskCaret?: Caret; phone: ImeStep[]; desk: (p: Page) => Promise<void>; what: string };
/** Runs `c` on a fresh phone page and on the desktop; asserts equal saved files and returns the phone's. */
async function sameAsDesktop(browser: Browser, c: Case, prep?: (page: Page) => Promise<void>): Promise<string | null> {
  const page = await phonePage(browser);
  try {
    const core = await openPsani(page);
    await tapToEdit(page, 'Konec');
    await prep?.(page);
    await setCaret(page, c.caret.text, c.caret.offset ?? 'end', { select: c.caret.select });
    await ime(page, c.phone);
    const phone = await savedText(core, PE.psani, 3000);
    const desk = await desktopEditorResult(browser, editVault(), PE.psani, c.deskCaret ?? c.caret, c.desk);
    assert.ok(phone !== null, `${c.what}: the phone saves`);
    assert.equal(phone, desk, `${c.what}: the saved file equals the desktop's`);
    return phone;
  } finally {
    await page.close();
  }
}

test('fr_edt_01_ac19_keyboard_input_matches_the_desktop_typing', async ({ browser }) => {
  test.setTimeout(180_000);
  // (a) each word composed and committed by a space
  const a = await sameAsDesktop(browser, {
    what: '(a) Ahoj světe', caret: { text: 'Konec.', offset: 0 },
    phone: [{ compose: 'A' }, { compose: 'Ah' }, { compose: 'Aho' }, { compose: 'Ahoj' }, { commit: 'Ahoj' }, { text: ' ' }, { compose: 's' }, { compose: 'sv' }, { compose: 'svě' }, { compose: 'svět' }, { compose: 'světe' }, { commit: 'světe' }, { text: ' ' }],
    desk: (p) => p.keyboard.type('Ahoj světe '),
  });
  assert.equal(a, edited('\nKonec.', '\nAhoj světe Konec.'), '(a) `Ahoj světe ` once, no letter doubled or lost');
  // (b) the composing `zari` replaced by the suggestion `září`
  const b = await sameAsDesktop(browser, {
    what: '(b) zari → září', caret: { text: 'Konec.', offset: 0 },
    phone: [{ compose: 'z' }, { compose: 'za' }, { compose: 'zar' }, { compose: 'zari' }, { commit: 'září' }, { text: ' ' }],
    desk: (p) => p.keyboard.type('září '),
  });
  assert.equal(b, edited('\nKonec.', '\nzáří Konec.'), '(b) `září`');
  // (c) autocorrect of `pirvní` to `první` on space
  const c = await sameAsDesktop(browser, {
    what: '(c) pirvní → první', caret: { text: 'Konec.', offset: 0 },
    phone: [{ compose: 'pirvní' }, { commit: 'pirvní' }, { replace: 'první', over: 6 }, { text: ' ' }],
    desk: (p) => p.keyboard.type('první '),
  });
  assert.equal(c, edited('\nKonec.', '\nprvní Konec.'), '(c) only that word changes');
});

test('fr_edt_01_ac19_keyboard_input_matches_the_desktop_enter', async ({ browser }) => {
  test.setTimeout(180_000);
  // (d) Enter at the end of chléb while chléb is composing; Enter on the empty item; Enter in the middle of Konec.
  await sameAsDesktop(browser, {
    what: '(d) Enter after a composing chléb, twice', caret: { text: 'chléb', select: true },
    // the desktop: the caret after chléb, no selection (WebKit's ArrowRight + Enter replaced the selection; D-2554)
    deskCaret: { text: 'chléb', offset: 'end' },
    phone: [{ compose: 'chléb' }, { enter: true }, { enter: true, via: '229' }],
    desk: async (p) => { await p.keyboard.press('Enter'); await p.keyboard.press('Enter'); },
  });
  const d2 = await sameAsDesktop(browser, {
    what: '(d) Enter in the middle of Konec.', caret: { text: 'Konec.', offset: 3 },
    phone: [{ enter: true, via: '229' }],
    desk: (p) => p.keyboard.press('Enter'),
  });
  assert.equal(d2, edited('\nKonec.', '\nKon\n\nec.'), '(d) Enter in the middle of Konec. splits it');
  // (e) Enter at the end of Zavolat: a new `- [ ] ` item
  await sameAsDesktop(browser, {
    what: '(e) Enter after Zavolat', caret: { text: 'Zavolat' },
    phone: [{ enter: true }, { text: 'Nové' }],
    desk: async (p) => { await p.keyboard.press('Enter'); await p.keyboard.type('Nové'); },
  }).then((t) => assert.match(t ?? '', /- \[ \] Zavolat\n\n?- \[ \] Nové\n/, '(e) a new `- [ ] ` item (the Psaní list is loose)'));
});

test('fr_edt_01_ac19_keyboard_input_matches_the_desktop_backspace', async ({ browser }) => {
  test.setTimeout(240_000);
  // (f) Backspace at the start of Konec., after the [[Cíl]] chip, at the start of první, chléb and Nákup, bottom up
  // after [[Cíl]]: the text ` a ` right after the chip (after the join at Konec., the tag is its own node; D-2554)
  const spots: [string, number][] = [['Konec.', 0], [' a ', 0], ['první', 0], ['chléb', 0], ['Nákup', 0]];
  for (const via of ['key', '229', 'surrounding'] as const) {
    const page = await phonePage(browser);
    const core = await openPsani(page);
    await tapToEdit(page, 'Konec');
    for (const [t, o] of spots) {
      await setCaret(page, t, o);
      await ime(page, [via === 'surrounding' ? { deleteSurrounding: { before: 1, after: 0 } } : { backspace: true, via }]);
    }
    const phone = await savedText(core, PE.psani, 3000);
    await page.close();
    const desk = await desktopEditorResult(browser, editVault(), PE.psani, { text: 'Konec.', offset: 0 }, async (p) => {
      for (const [t, o] of spots) { await setCaret(p, t, o); await p.keyboard.press('Backspace'); }
    });
    assert.equal(phone, desk, `(f) Backspace via ${via}: the desktop's joins and lifts, and the chip removed in one step`);
    assert.ok(phone && !phone.includes('[[Cíl]]'), `(f) via ${via}: the chip is gone as a whole`);
  }
});

test('fr_edt_01_ac19_keyboard_input_matches_the_desktop_triggers', async ({ page }) => {
  const core = await openPsani(page);
  const before = await fileStateOf(core);
  await tapToEdit(page, 'Konec');
  const cases: [string, ImeStep[], 'Link suggestions' | 'Tag suggestions' | 'Insert block'][] = [
    ['[[ by insertText', [{ text: ' [[' }], 'Link suggestions'], ['[[ in a composition', [{ text: ' ' }, { compose: '[[' }, { commit: '[[' }], 'Link suggestions'],
    ['@ by insertText', [{ text: ' @' }], 'Link suggestions'], ['@ in a composition', [{ text: ' ' }, { compose: '@' }, { commit: '@' }], 'Link suggestions'],
    ['#p by insertText', [{ text: ' #p' }], 'Tag suggestions'], ['#p in a composition', [{ text: ' ' }, { compose: '#p' }, { commit: '#p' }], 'Tag suggestions'],
  ];
  for (const [what, steps, name] of cases) {
    await setCaret(page, 'Konec.', 'end');
    await ime(page, steps);
    assert.ok(await seen(panel(page, name), 1500), `(g) ${what} opens ${name}`);
    await page.keyboard.press('Escape');
    assert.ok(await absent(panel(page, name), 1500), `${what}: Esc closes it`);
  }
  // `/` at a block start opens Insert block
  await setCaret(page, 'Konec.', 'end');
  await ime(page, [{ enter: true }, { text: '/' }]);
  assert.ok(await seen(panel(page, 'Insert block'), 1500), '(g) / by insertText opens Insert block');
  await page.keyboard.press('Escape');
  await ime(page, [{ backspace: true }, { compose: '/' }, { commit: '/' }]);
  assert.ok(await seen(panel(page, 'Insert block'), 1500), '(g) / inside a composition opens Insert block');
  await sleep(1200);
  assert.deepEqual((await writeCalls(core)).filter((w) => w.path !== PSANI), [], 'only Psaní is written');
  void before;
});

// ------------------------------------------------------------------------------------------------ FR-EDT-01 AC-20

test('fr_edt_01_ac20_czech_from_the_keyboard_is_nfc', async ({ page }) => {
  const nfdDruhy = 'druhý';
  const core = await startPhone(page, { vault: editVault((f) => { f[PSANI] = f[PSANI].replace('2. druhý', `2. ${nfdDruhy}`); }), route: `note/${PE.psani}`, now: EDIT_NOW });
  await needBody(page, 'Psaní');
  await tapToEdit(page, 'Konec');
  await setCaret(page, 'Konec.', 'end');
  const zl = 'Žluťoučký';
  await ime(page, [{ text: ' č' }, { text: ' ř' }, { text: ' ' }, { compose: zl }, { commit: zl }]);
  const ci = await caretInfo(page);
  assert.equal(ci.block, 'Konec. č ř Žluťoučký', 'the text is in NFC in the editor');
  assert.equal(ci.offset, ci.block.length, 'the caret is after the inserted text');
  const saved = await savedText(core, PE.psani, 3000);
  assert.ok(saved, 'saved');
  assert.ok(saved!.includes('Konec. č ř Žluťoučký\n'), `saved in NFC: ${JSON.stringify(saved!.slice(-40))}`);
  assert.ok(saved!.includes(`2. ${nfdDruhy}`), 'the block not edited keeps its NFD bytes (FR-FMT-12 AC-5)');
  // the emoji with a skin-tone modifier: saved unchanged; one Backspace removes it whole
  await ime(page, [{ text: ' 👍🏽' }]);
  assert.ok(((await editorText(page)) ?? '').includes('Žluťoučký 👍🏽\n'), 'the emoji is kept unchanged');
  await ime(page, [{ backspace: true }]);
  const afterBs = (await editorText(page)) ?? '';
  // the editor drops a paragraph's trailing space, on the desktop too (D-2554)
  assert.ok(afterBs.includes('Žluťoučký\n'), 'one Backspace removes the whole emoji');
  assert.ok(!afterBs.includes('👍'), 'no part of the emoji stays');
  // Search for zlutoucky lists Psaní within 2 s of the save
  await keyboard(page, false);
  await barButton(page, 'Search').click();
  const q = await must(searchField(page), 'Search query');
  await q.fill('zlutoucky');
  assert.ok(await seen(main(page).getByRole('list', { name: 'Search results' }).getByText('Psaní'), 2000), 'Search for zlutoucky lists Psaní');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-10 AC-12

test('fr_edt_10_ac12_read_view_only_where_the_phone_cant_write', async ({ page, browser }) => {
  // a read-only case: the NFD-named Úkoly (checkboxes) — every write control aria-disabled with its reason
  const core = await startPhone(page, { vault: editVault(), route: `note/${PE.ukoly}`, now: EDIT_NOW, nfdNames: [PE.ukoly] });
  const before = await fileStateOf(core);
  await must(saveState(page).filter({ hasText: 'Read-only' }), 'Save state Read-only');
  const boxes = main(page).getByRole('checkbox');
  assert.ok((await boxes.count()) >= 3, 'the checkboxes are shown');
  for (const b of await boxes.all()) {
    assert.equal(await b.getAttribute('aria-disabled'), 'true', 'each checkbox is aria-disabled');
    assert.ok((await b.getAttribute('aria-description')) ?? '', 'with its reason');
    await b.tap({ force: true });
  }
  const menu = await openMore(page);
  const items = (await menu.getByRole('menuitem').allInnerTexts()).map(flat).filter((t) => !/^(Pin|Unpin)$/.test(t));
  assert.deepEqual(items, ['Properties', 'Show Markdown source'], 'More actions lists Properties and Show Markdown source only (Pin aside for nfdName)');
  await page.keyboard.press('Escape');
  await sleep(500);
  await assertZeroWrites(core, before, 'taps in the read view');
  // an editable note: Show Markdown source saves pending edits first, shows the file read-only, and comes back with the caret
  const p2 = await phonePage(browser);
  const c2 = await openPsani(p2);
  await tapToEdit(p2, 'Konec');
  await setCaret(p2, 'Konec.', 3);
  await ime(p2, [{ text: 'Z' }]);
  const m = await openMore(p2);
  await (await must(m.getByRole('menuitem', { name: 'Show Markdown source' }), 'Show Markdown source')).click();
  const w = await writeCalls(c2);
  assert.deepEqual(w.map((x) => x.cmd), ['note_write'], 'the pending edit is saved first (editor FR-EDT-10 AC-9)');
  const src = await must(p2.getByRole('region', { name: 'Markdown source' }), 'the source view');
  assert.ok((await src.innerText()).includes('KonZec.'), 'the file\'s text with the edit');
  assert.equal(await src.locator('[contenteditable="true"], textarea').count(), 0, 'read-only');
  const m2 = await openMore(p2);
  await (await must(m2.getByRole('menuitem', { name: 'Show formatted note' }), 'Show formatted note')).click();
  await needBody(p2, 'back to the editor');
  const ci = await caretInfo(p2);
  assert.deepEqual([ci.block, ci.offset], ['KonZec.', 4], 'the caret where it was');
  await p2.close();
});

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-37

test('fr_mmp_02_ac37_map_stays_read_only_in_the_phone_editor', async ({ page }) => {
  const core = await startPhone(page, { vault: editVault(), route: `note/${PE.mapa}`, now: EDIT_NOW });
  const before = await fileStateOf(core);
  const body = await needBody(page, 'Mapa v textu');
  const block = body.locator('[contenteditable="false"]').filter({ has: page.getByRole('button', { name: /^(Map|List)$/ }) }).first();
  await must(block, 'the mindmap block, contenteditable="false", with Map / List');
  const map = await block.boundingBox();
  assert.ok(map, 'the block has a box');
  await page.touchscreen.tap(map!.x + map!.width / 2, map!.y + map!.height / 2);
  const ci = await caretInfo(page);
  assert.ok(!ci.inBody || !['Cesta', 'Vlak', 'Jízdenky'].includes(ci.block), 'a tap on it puts no caret in its list');
  assert.deepEqual(await core.imeCalls(), [], 'and shows no keyboard');
  await (await must(block.getByRole('button', { name: 'List' }), 'List')).tap();
  assert.equal(await block.locator('[contenteditable="true"]').count(), 0, 'in List the items aren\'t editable');
  const jizdenky = block.getByRole('checkbox').first();
  if (await seen(jizdenky, 1000)) await jizdenky.tap({ force: true });
  await sleep(1200);
  await assertZeroWrites(core, before, 'taps on the map and on Jízdenky');
  // edits next to and across the block change only the paragraphs
  await tapToEdit(page, 'Po mapě');
  await setCaret(page, 'Po mapě.', 0);
  await ime(page, [{ backspace: true }]);
  await setCaret(page, 'Před mapou.', 'end');
  await page.evaluate(() => {
    const body = document.querySelector('[role="textbox"][aria-label="Note body"]')!;
    const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let start: Text | null = null; let end: Text | null = null;
    for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
      if (!start && n.data.includes('Před')) start = n;
      if (n.data.includes('Po mapě')) end = n;
    }
    if (!start || !end) return;
    const r = document.createRange();
    r.setStart(start, start.data.indexOf('Před'));
    r.setEnd(end, end.data.indexOf('Po') + 2);
    const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await ime(page, [{ text: 'x' }]);
  const saved = await savedText(core, PE.mapa, 3000);
  const callout = '> [!mindmap] Plán\n> - Cesta\n>   - Vlak\n>   - [ ] Jízdenky\n';
  assert.ok(saved && saved.includes(callout), `the callout's lines stay byte for byte: ${JSON.stringify(saved)}`);
  assert.ok(saved && !saved.includes('Před mapou.'), 'the edit changed only the paragraphs');
  // the bar's block buttons with the caret next to the block
  await setCaret(page, ' mapě.', 'end');
  await (await must(formatBar(page).getByRole('button', { name: 'Bulleted list' }), 'Bulleted list')).tap();
  await sleep(1200);
  assert.ok(((await core.files())[nfc(PE.mapa)] ?? '').includes(callout), 'the bar\'s block button leaves the callout\'s lines');
  // Mindmap isn't in the slash panel
  await ime(page, [{ enter: true }, { text: '/' }]);
  const p = await must(panel(page, 'Insert block'), 'Insert block');
  assert.equal(await p.getByRole('option', { name: /^Mindmap/ }).count(), 0, 'no Mindmap in the slash panel');
});
