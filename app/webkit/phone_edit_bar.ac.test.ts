// Slice AND-3, L5p (projects `phone-webkit`, `phone-chromium`): docs/acceptance/android-edit.md, the formatting bar:
// - FR-UX-04 AC-8 (L5p: the bar sits on the keyboard; landscape; not shown for other fields), AC-9 (the caret stays in
//   view), AC-10 (taps on the bar and panels keep the focus and the selection), AC-11 (touch targets while editing);
// - FR-EDT-02 AC-27 (the block buttons write R6's forms), FR-EDT-05 AC-8 (Bold and Italic), AC-9 (Link), FR-EDT-09 AC-7
//   (Undo and Redo), FR-EDT-04 AC-5 (Markdown shortcuts from a phone keyboard).
// Contract docs/contracts/android-edit.md §8 (FormatBar: 48 px, fixed at the bottom, the side insets, the buttons and
// their states, the `Block type` row), §9.3 (`keepCaretInView`), §10.1, §10.2 (the link panel), §17.1.
// Red-test readings (reported): "the bar's bottom equals the viewport's bottom" is checked on the emulated keyboard
// (412 × 520); a button's tap is a touchscreen tap at its centre; every saved file is compared byte for byte with the
// fixture's text where the AC names the written form.
// Written from the ACs and the contract only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  EDIT_NOW, LANDSCAPE, PE, SMALL, appBar, barButton, bottomBar, goNote, hitArea, blockTypeGroup, bodyFocused, caretInfo, controls, editVault, editorText, eventually, fileStateOf, flat, formatBar,
  formatButton, injectInsets, keyboard, main, must, needBody, nfc, noteBody, panel, propsSheet, rect, runById, savedText, searchField, seen, setCaret, sleep,
  startPhone, systemBack, tap, tapText, tapToEdit, textRect, titleField, typeSheet, writeCalls, writesSeen, type PhoneHandle, assertZeroWrites, phoneVault, PH,
} from './phone-helpers';
import { ime } from './phone-ime';
import { absent } from './helpers';

test.use({ timezoneId: 'Europe/Prague' });

const BUTTONS = ['Heading', 'Bold', 'Italic', 'Link', 'Tag', 'Bulleted list', 'Checklist', 'Indent', 'Outdent', 'Undo', 'Redo'];
const original = (path: string) => editVault().files[nfc(path)];
function edited(path: string, from: string, to: string): string {
  const o = original(path);
  assert.ok(o && o.includes(from), `fixture ${path} holds ${JSON.stringify(from)}`);
  return o.replace(from, () => to).replace(/^modified: .*$/m, `modified: ${EDIT_NOW}`);
}
async function open(page: Page, path: string, o: { viewport?: { width: number; height: number } } = {}): Promise<PhoneHandle> {
  const core = await startPhone(page, { vault: editVault(), route: `note/${path}`, now: EDIT_NOW, ...o });
  await needBody(page, path);
  return core;
}
/** Taps an RA15 button (the Heading row's radios too) by its name. */
async function press(page: Page, name: string) {
  const b = formatBar(page).getByRole('button', { name, exact: true }).or(formatBar(page).getByRole('radio', { name, exact: true }));
  await tap(page, b.first(), `the bar's ${name}`);
  await sleep(80);
}
/** Waits for the next save of `path` (count `n`) and returns the file. */
const saved = (core: PhoneHandle, path: string, n = 1) => savedText(core, path, 3000, n);

// ------------------------------------------------------------------------------------------------ FR-UX-04 AC-8

test('fr_ux_04_ac8_formatting_bar_on_the_keyboard', async ({ page }) => {
  const core = await open(page, PE.psani);
  const before = await fileStateOf(core);
  assert.equal(await formatBar(page).count(), 0, 'no bar before the body has the focus and the keyboard shows');
  await tapToEdit(page, 'Konec');
  const bar = await must(formatBar(page), 'toolbar "Formatting"', 500);
  const r = await rect(bar);
  assert.ok(r && Math.abs(r.bottom - 520) <= 1, `the bar's bottom is the viewport's bottom (± 1 px): ${r?.bottom}`);
  assert.ok(r && Math.abs(r.height - 48) <= 0.5, `48 px high: ${r?.height}`);
  assert.deepEqual((await bar.getByRole('button').evaluateAll((bs) => bs.map((b) => (b.getAttribute('aria-label') ?? (b as HTMLElement).innerText).trim()))), BUTTONS, 'RA15\'s buttons in order');
  const fit = await bar.getByRole('button').evaluateAll((bs) => bs.slice(0, 8).every((b) => b.getBoundingClientRect().right <= innerWidth + 0.5));
  assert.ok(fit, 'buttons 1…8 fit at 412 px');
  assert.equal(await bar.evaluate((e) => getComputedStyle(e).overflowX), 'auto', 'the row scrolls sideways');
  assert.equal(await bottomBar(page).count(), 0, 'the bottom bar isn\'t rendered while the keyboard shows');
  await keyboard(page, false);
  assert.ok(await absent(formatBar(page), 500), 'hiding the keyboard removes the bar');
  await must(bottomBar(page), 'the bottom bar comes back', 500);
  // landscape: above the keyboard, no button under a side cutout
  await page.setViewportSize(LANDSCAPE);
  await injectInsets(page, { top: 0, bottom: 0, left: 48, right: 24 });
  await tapText(page, 'Konec');
  await page.evaluate(() => (window as any).__TEGG_TEST__.keyboard(true));
  await page.setViewportSize({ width: 915, height: 200 });
  const lb = await must(formatBar(page), 'the bar in landscape', 2000);
  const lr = await rect(lb);
  assert.ok(lr && Math.abs(lr.bottom - 200) <= 1, `landscape: the bar is above the keyboard (${lr?.bottom})`);
  const lefts = await lb.getByRole('button').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect()).filter((x) => x.right > 0 && x.left < innerWidth).map((x) => [x.left, x.right]));
  assert.ok(lefts.every(([l, rr]) => l >= 48 - 0.5 && rr <= 915 - 24 + 0.5), `no button under a side inset: ${JSON.stringify(lefts)}`);
  await page.evaluate(() => (window as any).__TEGG_TEST__.keyboard(false));
  await page.setViewportSize({ width: 412, height: 915 });
  await injectInsets(page, { top: 36, bottom: 24, left: 0, right: 0 });
  // not shown for a Properties field, Search query, a draft's Title, the type picker's field, the link panel's field
  await keyboard(page, true);
  assert.equal(await runById(page, 'phone.properties'), 'ok', 'phone.properties');
  const sheet = await must(propsSheet(page), 'the Properties sheet');
  const field = sheet.getByRole('textbox').first();
  if (await seen(field, 1000)) { await field.tap(); assert.equal(await formatBar(page).count(), 0, 'no bar for a Properties field'); }
  await page.keyboard.press('Escape');
  await systemBack(page);
  await barButton(page, 'Search').click().catch(() => undefined);
  if (await seen(searchField(page), 1000)) { await searchField(page).tap(); assert.equal(await formatBar(page).count(), 0, 'no bar for Search query'); }
  assert.equal(await runById(page, 'object.new'), 'ok', 'object.new');
  const ts = await must(typeSheet(page), 'the type sheet');
  await ts.getByRole('combobox').first().tap();
  assert.equal(await formatBar(page).count(), 0, 'no bar for the type picker\'s field');
  await ts.getByRole('option', { name: /^Page\b/ }).click();
  await must(titleField(page), 'the draft\'s Title');
  assert.equal(await formatBar(page).count(), 0, 'no bar for a draft\'s Title');
  assert.deepEqual((await writesSeen(core)), [], 'showing and hiding the bar writes nothing');
  void before;
});

// ------------------------------------------------------------------------------------------------ FR-UX-04 AC-9

test('fr_ux_04_ac9_caret_stays_in_view', async ({ page }) => {
  const core = await startPhone(page, { vault: phoneVault(), route: `note/${PH.dlouha}` });
  await needBody(page, 'Dlouhá poznámka');
  const band = async () => {
    const top = (await rect(appBar(page)))!.bottom;
    const cover = await rect(formatBar(page).or(panel(page, 'Link suggestions')).first());
    return { top, bottom: (cover?.top ?? 520) - 8 };
  };
  const caretRect = () => page.evaluate(() => {
    const s = getSelection();
    if (!s || !s.rangeCount) return null;
    const r = s.getRangeAt(0).getBoundingClientRect();
    return { top: r.top, bottom: r.bottom };
  });
  // the last paragraph's end, 30 new lines
  const last = await noteBody(page).locator('p').last().innerText();
  await tapToEdit(page, last.trim().split(/\s+/)[0]);
  await setCaret(page, last.trim(), 'end');
  for (let n = 1; n <= 30; n++) {
    await ime(page, [{ enter: true, via: '229' }, { text: `Řádek ${n}` }]);
    await sleep(40);
    const c = await caretRect();
    const b = await band();
    assert.ok(c && c.top >= b.top - 0.5 && c.bottom <= b.bottom + 0.5, `line ${n}: the caret ${JSON.stringify(c)} lies in ${JSON.stringify(b)}`);
  }
  await keyboard(page, false);
  // a tap on a word in the lowest visible line, then the keyboard: scrolled into the band within 500 ms of the resize
  const lowest = await page.evaluate(() => {
    const body = document.querySelector('[role="textbox"][aria-label="Note body"]')!;
    const ps = [...body.querySelectorAll('p')].filter((p) => { const r = p.getBoundingClientRect(); return r.bottom > 0 && r.bottom <= innerHeight - 60; });
    const p = ps[ps.length - 1] as HTMLElement | undefined;
    if (!p || !p.innerText.trim()) return null;
    // the whole lowest visible line's text (its words recur higher up, so a lookup by word would tap an earlier line)
    const r = document.createRange();
    r.selectNodeContents(p);
    const b = [...r.getClientRects()].filter((x) => x.width > 0 && x.bottom > 0 && x.bottom <= innerHeight - 60).pop();
    return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
  });
  assert.ok(lowest, 'a word in the lowest visible line');
  await page.touchscreen.tap(lowest!.x, lowest!.y);
  await keyboard(page, true);
  const ok = await eventually(async () => { const c = await caretRect(); const b = await band(); return !!c && c.top >= b.top - 0.5 && c.bottom <= b.bottom + 0.5; }, (v) => v, 500);
  assert.ok(ok, 'after the keyboard shows, the caret is in the band within 500 ms');
  // with Link suggestions open, the caret's line stays above the panel
  await ime(page, [{ text: ' [[' }]);
  const p = await must(panel(page, 'Link suggestions'), 'Link suggestions');
  const pr = await rect(p);
  const c = await caretRect();
  assert.ok(pr && c && c.bottom <= pr.top + 0.5, `the caret's line (${c?.bottom}) stays above the panel (${pr?.top})`);
  void core;
});

// ------------------------------------------------------------------------------------------------ FR-UX-04 AC-10

test('fr_ux_04_ac10_bar_taps_keep_keyboard_and_selection', async ({ page }) => {
  const core = await open(page, PE.deset);
  await tapToEdit(page, 'Pátý');
  for (const name of BUTTONS) {
    await setCaret(page, 'blok', 0, { select: true });
    const b = formatButton(page, name);
    if ((await b.getAttribute('aria-disabled')) === 'true') {
      await tap(page, b, name);
      assert.ok(await bodyFocused(page), `${name} (disabled): the focus stays in Note body`);
      continue;
    }
    await tap(page, b, name);
    await sleep(100);
    if (name === 'Heading') {
      await must(blockTypeGroup(page), 'the Block type row');
      await press(page, 'Heading 2');
    }
    if (name === 'Link') { await page.keyboard.press('Escape'); continue; }
    assert.ok(await bodyFocused(page), `${name}: document.activeElement is still Note body`);
    assert.deepEqual((await core.imeCalls()).filter((s) => !s), [], `${name}: nothing hides the keyboard`);
    if (name === 'Bold') assert.equal((await caretInfo(page)).selected, 'blok', 'after Bold on blok, blok is still selected');
    await press(page, 'Undo').catch(() => undefined);
  }
  // a row of Link suggestions
  await setCaret(page, 'Pátý', 'end');
  await ime(page, [{ text: ' [[C' }]);
  const p = await must(panel(page, 'Link suggestions'), 'Link suggestions');
  await tap(page, p.getByRole('option').first(), 'a link row');
  assert.ok(await bodyFocused(page), 'after a link row the focus is in Note body');
});

// ------------------------------------------------------------------------------------------------ FR-UX-04 AC-11

test('fr_ux_04_ac11_touch_targets_while_editing', async ({ page }) => {
  const core = await open(page, PE.ukoly, { viewport: SMALL });
  const small = async (what: string, scope?: import('@playwright/test').Locator) => {
    const bad = (await controls(page, scope)).filter((c) => !c.exempt && !c.text && !c.inert && (c.hitW < 48 - 0.5 || c.hitH < 48 - 0.5)).map((c) => `${c.role} "${c.name}" ${c.hitW}×${c.hitH}`);
    assert.deepEqual(bad, [], `${what}: every control's hit area is at least 48 × 48 px`);
  };
  const boxes = noteBody(page).getByRole('checkbox');
  assert.ok((await boxes.count()) >= 3, 'Úkoly\'s checklist checkboxes');
  for (const b of await boxes.all()) {
    const r = await hitArea(b);
    assert.ok(r.width >= 48 - 0.5 && r.height >= 48 - 0.5, `a checklist checkbox's hit area is ≥ 48 × 48 (${r.width} × ${r.height})`);
  }
  await tapToEdit(page, 'Koupit');
  await page.setViewportSize({ width: 360, height: 420 });
  await small('the bar', formatBar(page));
  await press(page, 'Heading');
  await small('the Block type row', blockTypeGroup(page));
  await press(page, 'Close').catch(() => undefined);
  for (const [trigger, name] of [[' [[', 'Link suggestions'], [' #p', 'Tag suggestions']] as const) {
    await setCaret(page, 'Koupit mléko', 'end');
    await ime(page, [{ text: trigger }]);
    await small(name, panel(page, name));
    await page.keyboard.press('Escape');
  }
  await keyboard(page, false, SMALL);
  assert.equal(await runById(page, 'object.new'), 'ok', 'object.new');
  await small('the type sheet', await must(typeSheet(page), 'the type sheet'));
  await systemBack(page);
  assert.equal(await runById(page, 'phone.properties'), 'ok', 'phone.properties');
  await small('the Properties sheet', await must(propsSheet(page), 'the Properties sheet'));
  void core;
});

// ------------------------------------------------------------------------------------------------ FR-EDT-02 AC-27

test('fr_edt_02_ac27_block_buttons_on_the_bar', async ({ page }) => {
  const core = await open(page, PE.prazdna);
  const body = await needBody(page, 'Prázdná');
  await body.tap();
  await keyboard(page, true);
  await must(formatBar(page), 'the bar', 500);
  assert.equal(await formatButton(page, 'Indent').getAttribute('aria-disabled'), 'true', 'Indent is aria-disabled in a paragraph');
  assert.equal(await formatButton(page, 'Outdent').getAttribute('aria-disabled'), 'true', 'Outdent is aria-disabled in a paragraph');
  assert.equal(await formatButton(page, 'Undo').getAttribute('aria-disabled'), 'true', 'Undo is aria-disabled with an empty history');
  await press(page, 'Heading');
  const row = await must(blockTypeGroup(page), 'radiogroup "Block type"');
  assert.deepEqual((await row.getByRole('radio').allInnerTexts()).map(flat), ['Text', 'Heading 1', 'Heading 2', 'Heading 3'], 'Text, Heading 1…3');
  await must(row.getByRole('button', { name: 'Close' }).or(formatBar(page).getByRole('button', { name: 'Close' })), 'Close');
  await press(page, 'Heading 2');
  await must(formatButton(page, 'Bold'), 'the row comes back after the choice');
  await ime(page, [{ text: 'Řádek' }]);
  assert.equal(await saved(core, PE.prazdna), `${original(PE.prazdna).replace(/^modified: .*$/m, `modified: ${EDIT_NOW}`)}## Řádek\n`, 'saves `## Řádek`');
  assert.equal(await formatButton(page, 'Heading').getAttribute('aria-pressed'), 'true', 'Heading is aria-pressed in a heading');
  await press(page, 'Heading');
  await press(page, 'Text');
  assert.equal(await saved(core, PE.prazdna, 2), `${original(PE.prazdna).replace(/^modified: .*$/m, `modified: ${EDIT_NOW}`)}Řádek\n`, 'Heading › Text: the paragraph `Řádek` again');
  // a bulleted list, Enter, dvě; Indent and Outdent; Bulleted list in an item
  await setCaret(page, 'Řádek', 'end');
  await ime(page, [{ enter: true }]);
  await press(page, 'Bulleted list');
  assert.equal(await formatButton(page, 'Indent').getAttribute('aria-disabled'), 'true', 'Indent is aria-disabled on a list\'s first item');
  await ime(page, [{ text: 'jedna' }, { enter: true }, { text: 'dvě' }]);
  await sleep(1200);
  assert.ok(((await core.files())[nfc(PE.prazdna)] ?? '').endsWith('Řádek\n\n- jedna\n- dvě\n'), 'saves `- jedna` / `- dvě`');
  assert.equal(await formatButton(page, 'Bulleted list').getAttribute('aria-pressed'), 'true', 'Bulleted list is aria-pressed in an item');
  await press(page, 'Indent');
  await sleep(1200);
  const nested = (await core.files())[nfc(PE.prazdna)] ?? '';
  assert.ok(/- jedna\n(  |\t|    )- dvě\n$/.test(nested), `Indent nests dvě (editor FR-EDT-02 AC-17): ${JSON.stringify(nested.slice(-30))}`);
  await press(page, 'Outdent');
  await sleep(1200);
  assert.ok(((await core.files())[nfc(PE.prazdna)] ?? '').endsWith('- jedna\n- dvě\n'), 'Outdent un-nests it');
  await press(page, 'Undo');
  await sleep(1200);
  assert.equal((await core.files())[nfc(PE.prazdna)], nested, 'Outdent was one undo step');
  await press(page, 'Redo');
  await press(page, 'Bulleted list');
  await sleep(1200);
  assert.ok(((await core.files())[nfc(PE.prazdna)] ?? '').endsWith('- jedna\n\ndvě\n'), 'Bulleted list pressed in an item makes it a paragraph');
  // Checklist, then úkol; again a paragraph
  await setCaret(page, 'dvě', 'end');
  await ime(page, [{ enter: true }]);
  await press(page, 'Checklist');
  await ime(page, [{ text: 'úkol' }]);
  await sleep(1200);
  assert.ok(((await core.files())[nfc(PE.prazdna)] ?? '').endsWith('- [ ] úkol\n'), 'saves `- [ ] úkol`');
  assert.equal(await formatButton(page, 'Checklist').getAttribute('aria-pressed'), 'true', 'Checklist is aria-pressed');
  await press(page, 'Checklist');
  await sleep(1200);
  assert.ok(((await core.files())[nfc(PE.prazdna)] ?? '').endsWith('\núkol\n'), 'Checklist again makes it a paragraph');
  assert.ok(!Object.keys(await core.files()).some((p) => p.startsWith('Tasks/') && !Object.keys(editVault().files).includes(p)), 'no Task file is created (FR-TSK-11)');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-05 AC-8

test('fr_edt_05_ac8_bold_and_italic_from_the_bar', async ({ page }) => {
  const core = await open(page, PE.deset);
  await tapToEdit(page, 'Pátý');
  await setCaret(page, 'blok', 0, { select: true });
  await press(page, 'Bold');
  assert.equal(await saved(core, PE.deset), edited(PE.deset, 'Pátý blok, který', 'Pátý **blok**, který'), 'Bold saves `Pátý **blok**, který test upraví.`; only block 5 and modified change');
  assert.equal(await formatButton(page, 'Bold').getAttribute('aria-pressed'), 'true', 'Bold is aria-pressed on blok');
  await press(page, 'Bold');
  assert.equal(await saved(core, PE.deset, 2), edited(PE.deset, 'Pátý blok', 'Pátý blok'), 'Bold again removes the mark');
  await setCaret(page, 'blok', 0, { select: true });
  await press(page, 'Italic');
  assert.equal(await saved(core, PE.deset, 3), edited(PE.deset, 'Pátý blok, který', 'Pátý *blok*, který'), 'Italic saves `*blok*`');
  await press(page, 'Italic');
  await saved(core, PE.deset, 4);
  // a collapsed caret after `Pátý `: Bold, then nové
  await setCaret(page, 'Pátý ', 'end');
  await press(page, 'Bold');
  assert.equal(await formatButton(page, 'Bold').getAttribute('aria-pressed'), 'true', 'Bold is aria-pressed for what is typed next');
  await ime(page, [{ text: 'nové' }]);
  assert.equal(await saved(core, PE.deset, 5), edited(PE.deset, 'Pátý blok', 'Pátý **nové**blok'), 'Bold then nové saves `**nové**`');
  assert.equal(await formatButton(page, 'Bold').getAttribute('aria-pressed'), 'true', 'Bold is aria-pressed while the caret is inside it');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-05 AC-9

test('fr_edt_05_ac9_link_from_the_bar', async ({ page }) => {
  const core = await open(page, PE.deset);
  await tapToEdit(page, 'Pátý');
  const linkPanel = page.getByRole('dialog', { name: 'Link' });
  const field = linkPanel.getByRole('textbox', { name: 'Link' });
  // choosing Cíl
  await setCaret(page, 'blok', 0, { select: true });
  await press(page, 'Link');
  await must(linkPanel, 'the link panel (dialog "Link")');
  assert.ok(await eventually(() => field.evaluate((e) => e === document.activeElement), (v) => v, 1000), 'the field Link has the focus');
  assert.equal(await field.getAttribute('enterkeyhint'), 'done', 'enterkeyhint="done"');
  await field.fill('Cíl');
  await tap(page, linkPanel.getByRole('listbox', { name: 'Link suggestions' }).getByRole('option', { name: /Cíl/ }).first(), 'Cíl');
  assert.equal(await saved(core, PE.deset), edited(PE.deset, 'Pátý blok,', 'Pátý [[Cíl|blok]],'), 'choosing Cíl saves `[[Cíl|blok]]`');
  await press(page, 'Undo');
  await saved(core, PE.deset, 2);
  // a URL and Done
  await setCaret(page, 'blok', 0, { select: true });
  await press(page, 'Link');
  await field.fill('https://example.com/a?b=c');
  await field.press('Enter');
  assert.equal(await saved(core, PE.deset, 3), edited(PE.deset, 'Pátý blok,', 'Pátý [blok](https://example.com/a?b=c),'), 'the URL and Done save `[blok](https://example.com/a?b=c)`');
  // with the caret in a link, Link offers Remove link
  await setCaret(page, 'blok', 2);
  await press(page, 'Link');
  await must(linkPanel.getByRole('button', { name: 'Remove link' }), 'Remove link (AC-5)');
  await page.keyboard.press('Escape');
  await press(page, 'Undo');
  const n = (await core.writesTo()).length;
  // refused schemes
  for (const bad of ['javascript:alert(1)', 'file:///etc/hosts']) {
    await setCaret(page, 'blok', 0, { select: true });
    await press(page, 'Link');
    await field.fill(bad);
    await field.press('Enter');
    await must(linkPanel.getByText(/web address|https?:\/\//).or(page.getByRole('alert')), `${bad} is refused with editor FR-EDT-05 AC-4's message`);
    await page.keyboard.press('Escape');
  }
  await sleep(1200);
  const after = await core.files();
  assert.ok(!after[nfc(PE.deset)]?.includes('javascript:') && !after[nfc(PE.deset)]?.includes('file:///'), 'nothing changes for a refused URL');
  // without a selection: [[ and Link suggestions
  await setCaret(page, 'Pátý ', 'end');
  await press(page, 'Link');
  await must(panel(page, 'Link suggestions'), 'without a selection Link opens Link suggestions');
  // an unclosed `[[` is kept escaped in Markdown, as on the desktop (D-2554, D-2555)
  assert.ok(((await editorText(page)) ?? '').includes('Pátý \\[\\['), 'and inserts `[[` (kept escaped: `\\[\\[`)');
  void n;
});

// ------------------------------------------------------------------------------------------------ FR-EDT-09 AC-7

test('fr_edt_09_ac7_undo_and_redo_on_the_bar', async ({ page }) => {
  const core = await open(page, PE.deset);
  await tapToEdit(page, 'Pátý');
  const undo = formatButton(page, 'Undo');
  const redo = formatButton(page, 'Redo');
  assert.equal(await undo.getAttribute('aria-disabled'), 'true', 'Undo is aria-disabled with an empty history');
  assert.equal(await redo.getAttribute('aria-disabled'), 'true', 'Redo is aria-disabled with nothing to redo');
  await tap(page, undo, 'Undo');
  await sleep(1200);
  assert.deepEqual(await writesSeen(core), [], 'a disabled Undo sends nothing');
  // AC-3's sequence (editor.md): a typing burst, a save, a second burst, a save; a composed word is part of its burst
  await setCaret(page, 'upraví.', 'end');
  await ime(page, [{ text: ' Nová' }, { compose: 'věta' }, { commit: 'věta' }, { text: '.' }]);
  const first = await saved(core, PE.deset);
  await setCaret(page, 'Odstavec', 0);
  await ime(page, [{ text: 'Druhá změna. ' }]);
  const second = await saved(core, PE.deset, 2);
  assert.ok(first && second && first !== second, 'two saves');
  await press(page, 'Undo');
  await press(page, 'Undo');
  // two Undo taps 80 ms apart give one debounced save, as on the desktop (FR-EDT-09 AC-3; D-2555)
  assert.equal(withoutModified(await saved(core, PE.deset, 3)), withoutModified(original(PE.deset)), 'two Undos save the original body');
  await press(page, 'Redo');
  await press(page, 'Redo');
  assert.equal(await saved(core, PE.deset, 4), second, 'two Redos save the second save\'s body');
  // after Back and reopening, Undo is aria-disabled (AC-5)
  await keyboard(page, false);
  await systemBack(page);
  await goNote(page, 'Deset bloků');
  await tapToEdit(page, 'Pátý');
  assert.equal(await formatButton(page, 'Undo').getAttribute('aria-disabled'), 'true', 'after Back and reopening, Undo is aria-disabled');
});
const withoutModified = (s: string | null | undefined) => (s ?? '').replace(/^modified: .*\n/m, '');

// ------------------------------------------------------------------------------------------------ FR-EDT-04 AC-5

test('fr_edt_04_ac5_shortcuts_from_a_phone_keyboard', async ({ page }) => {
  const core = await open(page, PE.prazdna);
  await (await needBody(page, 'Prázdná')).tap();
  await keyboard(page, true);
  const forms: [string, string, string][] = [
    // [what is sent, the text after it, the written form]
    ['- ', 'odrážka', '- odrážka'], ['1. ', 'číslo', '1. číslo'], ['[] ', 'úkol', '- [ ] úkol'], ['> ', 'citát', '> citát'], ['## ', 'Nadpis', '## Nadpis'],
  ];
  const fm = original(PE.prazdna).replace(/^modified: .*$/m, `modified: ${EDIT_NOW}`);
  let n = 0;
  for (const via of ['text', 'compose'] as const) {
    for (const [trigger, text, form] of forms) {
      await ime(page, via === 'text' ? [{ text: trigger }, { text }] : [{ compose: trigger.trim() }, { commit: trigger.trim() }, { text: ' ' }, { text }]);
      const out = await saved(core, PE.prazdna, ++n);
      assert.ok(out && out.startsWith(fm) && out.slice(fm.length).trimEnd().endsWith(form), `${via}: ${JSON.stringify(trigger)} converts and saves ${JSON.stringify(form)}: ${JSON.stringify(out?.slice(fm.length))}`);
      await press(page, 'Undo');
      await press(page, 'Undo');
      await sleep(1100);
      n = (await core.writesTo()).length;
    }
  }
  // inline marks: **tučné**, ==zvýraznění==, `kód` (the closing character commits)
  for (const [typed, form] of [['**tučné**', '**tučné**'], ['==zvýraznění==', '==zvýraznění=='], ['`kód`', '`kód`']]) {
    await ime(page, [{ text: 'a ' }, { compose: typed }, { commit: typed }, { text: ' ' }]);
    const out = await saved(core, PE.prazdna, ++n);
    assert.ok(out && out.includes(`a ${form}`), `${typed} converts to the mark and saves ${form}`);
    n = (await core.writesTo()).length;
  }
  // a mid-paragraph trigger doesn't convert; Undo right after a conversion restores the literal text in one step
  await ime(page, [{ enter: true }, { text: 'slovo - ' }, { text: 'dál' }]);
  const mid = await saved(core, PE.prazdna, ++n);
  assert.ok(mid && mid.includes('slovo - dál'), 'a mid-paragraph `- ` doesn\'t convert');
  n = (await core.writesTo()).length;
  await ime(page, [{ enter: true }, { text: '- ' }]);
  assert.equal(await noteBody(page).evaluate((b) => b.lastElementChild?.tagName.toLowerCase()), 'ul', 'the `- ` converted to a list');
  await press(page, 'Undo');
  const last = await noteBody(page).evaluate((b) => ({ tag: b.lastElementChild?.tagName.toLowerCase(), text: (b.lastElementChild as HTMLElement | null)?.innerText ?? '' }));
  assert.deepEqual([last.tag, last.text.trimEnd()], ['p', '-'], 'Undo right after the conversion restores the literal `- ` in one step');
  void n;
});
