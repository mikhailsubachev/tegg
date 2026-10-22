// MS3 slice 3C, L5 (WebKit + fake core): autosave, undo, block selection and the file-format checks through the UI.
// FR-EDT-08 AC-4, AC-6…AC-13; FR-EDT-09 AC-1, AC-3…AC-6; FR-EDT-13 AC-1…AC-5; FR-FMT-07 AC-8, AC-9, AC-12;
// FR-FMT-02 AC-5…AC-7; FR-FMT-12 AC-5; FR-SYN-06 AC-7 (write count), AC-8; FR-EDT-10 AC-9; NFR-REL-03 AC-6…AC-9;
// FR-UX-03 AC-13, AC-14; NFR-OTH-02 AC-6; FR-UX-05 AC-8. Written from docs/acceptance/editor.md and
// docs/contracts/ms3-shell.md §13 only (D-61). Clock and time zone are injected (Playwright `clock`, `timezoneId`).
import { test, type Browser, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { loadFixtureVault, newEmptyVault, type CallRecord, type FakeVault } from '../ui/test/fake-core';
import { absent, mustBeDraft, mustBeOn, nonReadCalls, openNote, paletteDialog, pseudoLocale, runCommand, sidebar, start, switcherDialog } from './helpers';
import { axeContrast, colourLeaks, sourceRegion, ui } from './read-helpers';
import {
  E, REPO, TITLES, argText, block, blockMenu, blocksOf, bodyOf, caretIn, copyOrCut, deletedAlert, editorBody, editorVault,
  eventually, fileText, idOf, keyTimes, kindsOf, linkSuggestions, mergeDialog, must, mustBeSaved, noModified, openEditor,
  original, paste, recordKeys, saveState, seen, selectIn, sleep, slashMenu, stateIs, tagSuggestions, titleField, toolbar,
  writes, type FakeCoreHandle,
} from './editor-helpers';

const B5 = 'Pátý blok, který test upraví.';
const TOGGLE = 'Alt+Meta+KeyU';

async function saved(page: Page, core: FakeCoreHandle, path: string, ms = 3000): Promise<string> {
  await sleep(150);
  await mustBeSaved(page, ms);
  return (await fileText(core, path))!;
}
const frontOf = (t: string) => { const m = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(t); return m ? m[0] : ''; };

/** Expected body after re-ordering blocks (as in editor.ac.test.ts, ADR 0002 §4). */
async function reordered(text: string, order: number[]): Promise<string> {
  const { parse } = await import('@tegg/doc');
  const d = parse(text);
  const b = d.blocks;
  const raw = (i: number) => text.slice(b[i - 1].range[0], b[i - 1].range[1]);
  const gap = (i: number) => text.slice(b[i - 1].range[1], b[i].range[0]);
  let out = text.slice(d.bodyStart, b[0].range[0]);
  order.forEach((n, k) => {
    out += raw(n);
    if (k < order.length - 1) out += order[k + 1] === n + 1 ? gap(n) : '\n\n';
  });
  return out + text.slice(b[b.length - 1].range[1]);
}

// ------------------------------------------------------------------------------------------------ FR-EDT-08

test('fr_edt_08_ac4_autosave_timing_with_injected_clock', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-13T12:00:00Z') });
  const core = await openEditor(page, E.deset);
  await caretIn(page, 5);
  await page.clock.pauseAt(new Date('2026-10-13T12:00:10Z'));
  await recordKeys(page);
  await page.keyboard.press('a');
  await page.clock.runFor(1000);
  await sleep(100);
  let ws = await writes(core, E.deset);
  const k0 = (await keyTimes(page))[0];
  assert.ok(ws.length >= 1 && ws[0].at! - k0 <= 1000, `one note_write starts ≤ 1,000 ms after the keystroke (writes: ${ws.map((w) => w.at! - k0).join(', ')})`);
  await page.clock.runFor(2000);
  const n0 = ws.length;
  const typed = 'bcdefghijk'.repeat(10);
  const t0 = Date.now();
  for (const ch of typed) {
    await page.keyboard.press(ch);
    await page.clock.runFor(100);
  }
  await page.clock.runFor(1100);
  await sleep(100);
  void t0;
  ws = (await writes(core, E.deset)).slice(n0);
  const keys = (await keyTimes(page)).slice(1);
  assert.ok(ws.length <= 11, `at most 10 calls while typing (+1 trailing), got ${ws.length}`);
  for (let k = 0; k < typed.length; k++) {
    const prefix = 'upraví.a' + typed.slice(0, k + 1);
    const hit = ws.find((w) => argText(w).includes(prefix));
    assert.ok(hit, `keystroke ${k + 1} is in some note_write`);
    assert.ok(hit!.at! - keys[k] <= 1000, `keystroke ${k + 1}: its first write starts ${hit!.at! - keys[k]} ms after it (≤ 1,000)`);
  }
});

test('fr_edt_08_ac6_one_write_in_flight_with_the_base_version', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await core.writeControl({ delayMs: 500 });
  await caretIn(page, 5);
  const end = Date.now() + 3000;
  while (Date.now() < end) { await page.keyboard.type('x'); await sleep(100); }
  await sleep(2500);
  const calls = await core.calls();
  const read = calls.filter((c) => c.cmd === 'note_read' && (c.args as any).path === E.deset).pop()!;
  const ws = calls.filter((c) => c.cmd === 'note_write');
  assert.ok(ws.length >= 2, `several writes: ${ws.length}`);
  let prevVersion = (read.result as any)?.version;
  for (const [i, w] of ws.entries()) {
    if (i > 0) assert.ok(w.seq! > ws[i - 1].endSeq!, `write ${i + 1} starts after write ${i} resolved`);
    assert.deepEqual((w.args as any).base, prevVersion, `write ${i + 1}: base = previous version`);
    assert.equal(w.ok, true, `write ${i + 1} succeeded (no Conflict)`);
    prevVersion = (w.result as any)?.version;
  }
});

type Leave = { name: string; setup?: (page: Page) => Promise<void>; act: (page: Page) => Promise<void>; next: (c: CallRecord) => boolean; opts?: Parameters<typeof openEditor>[2] };
const LEAVES: Leave[] = [
  { name: 'switcher', act: (p) => openNote(p, 'Cíl'), next: (c) => c.cmd === 'note_read' && (c.args as any).path === E.cil },
  { name: 'link', act: async (p) => { await editorBody(p).getByRole('link', { name: 'Cíl' }).first().click(); }, next: (c) => c.cmd === 'note_read' && (c.args as any).path === E.cil },
  { name: 'type_page', act: (p) => runCommand(p, 'Go to type: Pages'), next: (c) => c.cmd === 'index_list' },
  // D-520: ⌘N leaves the note for an unsaved draft, which prepares the new object's bytes (`type_template`).
  { name: 'new_object', act: async (p) => { await p.keyboard.press('Meta+n'); }, next: (c) => c.cmd === 'type_template' },
  { name: 'back', setup: async (p) => { await openNote(p, 'Cíl'); await openNote(p, 'Deset bloků'); await must(editorBody(p), 'editor'); }, act: (p) => p.keyboard.press('Meta+BracketLeft'), next: (c) => c.cmd === 'note_read' && (c.args as any).path === E.cil },
  { name: 'route', act: (p) => runCommand(p, 'Go to Search'), next: (c) => c.cmd === 'index_search' || (c.cmd === 'nav_opened') },
  { name: 'open_vault', act: async (p) => { await runCommand(p, 'Open vault…'); await p.getByRole('main', { name: 'Choose a vault' }).getByRole('button', { name: 'Open existing folder' }).click({ timeout: 3000 }).catch(() => {}); }, next: (c) => c.cmd === 'vault_open', opts: { pickDir: '/fake/Druhý', dirs: { '/fake/Druhý': newEmptyVault('Druhý') } } },
  { name: 'create_vault', act: (p) => runCommand(p, 'Create new vault…'), next: (c) => c.cmd === 'vault_pick_dir' || c.cmd === 'vault_create', opts: { pickDir: '/fake' } },
];

for (const l of LEAVES) {
  test(`fr_edt_08_ac7_flush_before_leaving_${l.name}`, async ({ page }) => {
    const core = await openEditor(page, E.deset, l.opts ?? {});
    if (l.setup) await l.setup(page);
    await core.writeControl({ delayMs: 300 });
    await caretIn(page, 5);
    const n0 = (await core.calls()).length;
    await page.keyboard.type('Z');
    await l.act(page);
    await sleep(1500);
    const calls = (await core.calls()).slice(n0);
    const w = calls.find((c) => c.cmd === 'note_write' && (c.args as any).path === E.deset);
    assert.ok(w && argText(w).includes(`${B5}Z`), 'the edit is written');
    const nx = calls.find(l.next);
    if (nx) assert.ok(w!.endSeq! < nx.seq!, `the write resolved before ${nx.cmd}`);
  });
}

test('fr_edt_08_ac7_flush_before_source_toggle', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await core.writeControl({ delayMs: 300 });
  await caretIn(page, 5);
  await page.keyboard.type('Z');
  await page.keyboard.press(TOGGLE);
  const region = await must(sourceRegion(page), 'source view');
  const ws = await writes(core, E.deset);
  assert.ok(ws.length === 1 && ws[0].endSeq !== undefined, 'saved before the source view shows');
  assert.ok((await region.innerText()).includes(`${B5}Z`), 'the source view shows the edit');
});

test('fr_edt_08_ac8_never_into_the_wrong_note', async ({ page }) => {
  test.setTimeout(180_000);
  const core = await openEditor(page, E.deset);
  let a = '', c = '';
  for (let n = 1; n <= 20; n++) {
    await openNote(page, 'Deset bloků');
    await must(editorBody(page), 'editor');
    await caretIn(page, 5);
    await page.keyboard.type(`A${n}`);
    a += `A${n}`;
    await openNote(page, 'Cíl');
    await must(editorBody(page), 'editor');
    await caretIn(page, 2);
    await page.keyboard.type(`C${n}`);
    c += `C${n}`;
  }
  await openNote(page, 'Odstavce');
  await sleep(2000);
  const f = await core.files();
  assert.ok(f[E.deset].includes(`${B5}${a}`) && !/C\d/.test(f[E.deset].replace(original(E.deset), '')), 'Deset bloků has exactly the A strings in order');
  assert.ok(f[E.cil].includes(`Cílová stránka pro odkazy.${c}`) && !f[E.cil].includes('A1'), 'Cíl has exactly the C strings in order');
  assert.deepEqual([...new Set(await core.writesTo())].sort(), [E.cil, E.deset].sort(), 'no other file written');
});

test('fr_edt_08_ac9_no_save_button_and_cmd_s', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  assert.equal(await page.getByRole('button', { name: /^Save$/ }).count(), 0, 'no control named Save');
  assert.equal(await page.locator('[aria-label="Save"], [title="Save"]').count(), 0, 'no control labelled Save');
  await caretIn(page, 5);
  await recordKeys(page);
  await page.keyboard.type('Q');
  await page.keyboard.press('Meta+s');
  await sleep(300);
  const keys = await keyTimes(page);
  const ws = await writes(core, E.deset);
  assert.ok(ws.length === 1 && ws[0].at! - keys[1] < 200, '⌘S writes at once');
  assert.equal(await page.getByRole('dialog').count(), 0, 'no dialog');
  await mustBeSaved(page);
  await page.keyboard.press('Meta+s');
  await sleep(500);
  assert.equal((await writes(core, E.deset)).length, 1, 'nothing pending: no write');
});

test('fr_edt_08_ac10_save_state_transitions', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  assert.ok(await stateIs(page, 'Saved'), 'Saved on open');
  await core.writeControl({ delayMs: 800 });
  await caretIn(page, 5);
  await page.keyboard.type('x');
  assert.ok(await stateIs(page, 'Saving…', 500), 'Saving… from the first keystroke');
  assert.ok(await stateIs(page, 'Saved', 3000), 'then Saved');
  await core.writeControl({ delayMs: 0, fail: 'Io' });
  await page.keyboard.type('y');
  assert.ok(await stateIs(page, 'Not saved', 3000), 'Not saved after a failed write');
  await core.writeControl({ fail: null });
  assert.ok(await stateIs(page, 'Saved', 7000), 'Saved after the retry');
  await core.setFile(E.deset, original(E.deset).replace('Přehled', 'Jinde'), { silent: true });
  await page.keyboard.type('z');
  await must(mergeDialog(page), 'merge dialog');
  assert.ok(await stateIs(page, 'Changed outside Tegg'), 'Changed outside Tegg while the dialog is open');
  const role = await page.evaluate(() => document.activeElement?.getAttribute('role'));
  assert.notEqual(role, 'status', 'Save state never takes the focus');
  const live = await saveState(page).first().getAttribute('aria-live');
  assert.ok(live === null || live === 'polite', 'polite live region');
});

test('fr_edt_08_ac10_read_only_state', async ({ page }) => {
  await start(page, { vault: editorVault(), last: { path: E.uvozovky, id: null } });
  assert.ok(await stateIs(page, 'Read-only', 5000), 'Read-only on a file with invalid frontmatter');
});

test('fr_edt_08_ac11_write_failure_alert_and_retry', async ({ page }) => {
  test.setTimeout(60_000);
  const core = await openEditor(page, E.deset);
  await core.writeControl({ fail: 'Io' });
  await caretIn(page, 5);
  await page.keyboard.type(' Neuloženo.');
  assert.ok(await stateIs(page, 'Not saved', 3000), 'Not saved');
  const alert = await must(page.getByRole('alert').filter({ has: page.getByRole('button', { name: 'Try again' }) }), 'non-modal alert with Try again');
  void alert;
  assert.ok((await editorBody(page).first().innerText()).includes('Neuloženo.'), 'the edits stay');
  const t0 = (await writes(core, E.deset)).length;
  await sleep(11_000);
  const ws = (await writes(core, E.deset)).slice(t0 - 1);
  assert.ok(ws.length >= 3, `retried every 5 s: ${ws.length - 1} retries in 11 s`);
  const gaps = ws.slice(1).map((w, i) => w.at! - ws[i].at!);
  assert.ok(gaps.every((g) => g >= 4000 && g <= 6500), `retry gaps ~5 s: ${gaps.join(', ')}`);
  await page.keyboard.type(' Pak.');
  await core.writeControl({ fail: null });
  assert.ok(await stateIs(page, 'Saved', 7000), 'Saved after the first successful retry');
  assert.ok((await fileText(core, E.deset))!.includes(`${B5} Neuloženo. Pak.`), 'the current editor content is saved');
});

test('fr_edt_08_ac12_composition_is_not_saved', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await caretIn(page, 5);
  const el = editorBody(page).first();
  await el.evaluate((e) => {
    e.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
    e.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'ˇ', bubbles: true }));
    document.execCommand('insertText', false, 'ˇ');
  });
  await sleep(1800);
  assert.ok((await writes(core)).every((w) => !argText(w).includes('ˇ')), 'no write contains the uncommitted text');
  await el.evaluate((e) => {
    const sel = window.getSelection()!;
    sel.modify('extend', 'backward', 'character');
    e.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'č', bubbles: true }));
    document.execCommand('insertText', false, 'c\u030C');
    e.dispatchEvent(new CompositionEvent('compositionend', { data: 'č', bubbles: true }));
  });
  const t = await saved(page, core, E.deset, 1500);
  assert.ok(t.includes(`${B5}č`), 'the committed č is saved in NFC within 1 s');
  assert.ok(!t.includes('c\u030C'), 'not NFD');
});

test('fr_edt_08_ac13_back_to_saved_text_writes_nothing', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await caretIn(page, 5);
  await page.keyboard.type('x');
  await page.keyboard.press('Meta+z');
  await sleep(2000);
  assert.equal((await writes(core)).length, 0, 'x then ⌘Z before the autosave: no write');
  await page.keyboard.type('x');
  await saved(page, core, E.deset);
  await page.keyboard.press('Backspace');
  await sleep(1500);
  const ws = await writes(core, E.deset);
  assert.equal(ws.length, 2, 'one more save');
  assert.equal(await bodyOf(argText(ws[1])), await bodyOf(original(E.deset)), 'body equal to the original');
  assert.notEqual(/^modified: .*$/m.exec(argText(ws[1]))?.[0], /^modified: .*$/m.exec(original(E.deset))?.[0], 'new modified (D-55)');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-09

test('fr_edt_09_ac1_keys_and_palette_undo_redo', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await caretIn(page, 5);
  await page.keyboard.type(' Věta.');
  await saved(page, core, E.deset);
  await page.keyboard.press('Meta+z');
  let t = await saved(page, core, E.deset);
  assert.ok(!t.includes(' Věta.'), '⌘Z undoes');
  await page.keyboard.press('Meta+Shift+z');
  t = await saved(page, core, E.deset);
  assert.ok(t.includes(`${B5} Věta.`), '⇧⌘Z redoes');
  await runCommand(page, 'Undo');
  t = await saved(page, core, E.deset);
  assert.ok(!t.includes(' Věta.'), 'palette Undo');
  await runCommand(page, 'Redo');
  t = await saved(page, core, E.deset);
  assert.ok(t.includes(`${B5} Věta.`), 'palette Redo');
});

test('fr_edt_09_ac3_undo_across_autosave', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  const orig = original(E.deset);
  await caretIn(page, 5);
  await page.keyboard.type('Nová věta.');
  await saved(page, core, E.deset);
  await dragBlock(page, 3, 8); // one move = one undo step
  const second = await bodyOf(await saved(page, core, E.deset));
  await page.keyboard.press('Meta+z');
  await page.keyboard.press('Meta+z');
  await sleep(1000);
  let t = (await fileText(core, E.deset))!;
  assert.equal(await bodyOf(t), await bodyOf(orig), 'body byte-identical to the original within 1 s');
  assert.equal(noModified(frontOf(t)), noModified(frontOf(orig)), 'frontmatter differs only in modified; created unchanged');
  await page.keyboard.press('Meta+Shift+z');
  await page.keyboard.press('Meta+Shift+z');
  t = await saved(page, core, E.deset);
  assert.equal(await bodyOf(t), second, '⇧⌘Z twice → the second save\'s body');
  assert.deepEqual([...new Set(await core.writesTo())], [E.deset], 'FR-SYN-06 AC-8: every write goes to Deset bloků only');
});

test('fr_syn_06_ac8_one_file_per_save_during_undo_flow', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await caretIn(page, 5);
  await page.keyboard.type('Nová věta.');
  await saved(page, core, E.deset);
  await caretIn(page, 3, null, true);
  await page.keyboard.press('Meta+Shift+ArrowDown');
  await saved(page, core, E.deset);
  await page.keyboard.press('Meta+z');
  await page.keyboard.press('Meta+z');
  await saved(page, core, E.deset);
  assert.deepEqual([...new Set(await core.writesTo())], [E.deset], 'only Deset bloků is written');
  assert.deepEqual((await nonReadCalls(core)).filter((c) => c !== 'note_write'), [], 'no other write command');
});

test('fr_edt_09_ac4_identity_stays_after_undo', async ({ page }) => {
  const core = await openEditor(page, E.bez);
  await caretIn(page, 1);
  await page.keyboard.type(' Doplněno.');
  const t1 = await saved(page, core, E.bez);
  const id = idOf(t1);
  assert.match(id ?? '', /^[0-9A-HJKMNP-TV-Z]{26}$/, 'id added on the first edit');
  await page.keyboard.press('Meta+z');
  const t2 = await saved(page, core, E.bez);
  assert.equal(idOf(t2), id, 'undo never removes the id');
  assert.equal(await bodyOf(t2), original(E.bez), 'body back to the original');
  assert.notEqual(/^modified: .*$/m.exec(t2)?.[0], undefined, 'modified present');
});

test('fr_edt_09_ac5_history_is_per_shown_note', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await caretIn(page, 5);
  await page.keyboard.type(' A');
  await saved(page, core, E.deset);
  await openNote(page, 'Cíl');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Deset bloků', 'back');
  await must(editorBody(page), 'editor');
  const n = (await writes(core)).length;
  await caretIn(page, 5);
  await page.keyboard.press('Meta+z');
  await sleep(1500);
  assert.equal((await writes(core)).length, n, 'after leaving and returning, ⌘Z writes nothing');
  await page.keyboard.type(' B');
  await saved(page, core, E.deset);
  const disk = (await fileText(core, E.deset))!.replace('## Přehled', '## Přehled změněný');
  await core.setFile(E.deset, disk);
  await eventually(async () => (await editorBody(page).first().innerText()).includes('Přehled změněný'), (v) => v, 3000);
  const m = (await writes(core)).length;
  await caretIn(page, 5);
  await page.keyboard.press('Meta+z');
  await sleep(1500);
  assert.equal((await writes(core)).length, m, 'after an external reload the history is empty');
});

test('fr_edt_09_ac6_nothing_to_undo', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await caretIn(page, 5);
  await page.keyboard.press('Meta+z');
  await page.keyboard.press('Meta+Shift+z');
  await sleep(1500);
  assert.equal((await writes(core)).length, 0, 'no write');
  assert.ok((await editorBody(page).first().innerText()).includes(B5), 'nothing changed');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-13

const selected = (page: Page) => page.evaluate(() => [...document.querySelectorAll('[aria-label="Note body"] > *')].map((e, i) => (e.hasAttribute('data-block-selected') ? i + 1 : 0)).filter(Boolean));

test('fr_edt_13_ac1_selecting_blocks', async ({ page }) => {
  await openEditor(page, E.deset);
  await caretIn(page, 2);
  await page.keyboard.press('Escape');
  assert.deepEqual(await selected(page), [2], 'Esc selects block 2');
  assert.ok(await absent(toolbar(page), 300), 'no formatting toolbar');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowDown');
  assert.deepEqual(await selected(page), [2, 3, 4, 5], '⇧↓ ×3 → 2–5');
  await page.keyboard.press('Shift+ArrowUp');
  assert.deepEqual(await selected(page), [2, 3, 4], '⇧↑ shrinks');
  await page.keyboard.press('Escape');
  assert.deepEqual(await selected(page), [], 'Esc ends the block selection');
  await caretIn(page, 2);
  await block(page, 7).click({ modifiers: ['Shift'] });
  assert.deepEqual(await selected(page), [2, 3, 4, 5, 6, 7], '⇧-click selects 2–7');
  await caretIn(page, 9);
  assert.deepEqual(await selected(page), [], 'a click in text ends it');
  const b2 = (await block(page, 2).boundingBox())!, b4 = (await block(page, 4).boundingBox())!;
  await page.mouse.move(b2.x + 30, b2.y + 5);
  await page.mouse.down();
  await page.mouse.move(b4.x + 30, b4.y + 5, { steps: 8 });
  await page.mouse.up();
  assert.deepEqual(await selected(page), [], 'a mouse drag is a text selection');
});

/** Drags the handle of block `from` to just below block `below` (one move by mouse). */
async function dragBlock(page: Page, from: number, below: number) {
  await block(page, from).hover();
  const h = await must(page.getByRole('button', { name: 'Drag to move, click for block menu', exact: true }), `handle of block ${from}`);
  const hb = (await h.boundingBox())!;
  const tb = (await block(page, below).boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + 20, tb.y + tb.height - 2, { steps: 10 });
  await page.mouse.move(tb.x + 20, tb.y + tb.height + 2, { steps: 4 });
  await page.mouse.up();
}

async function select2to5(page: Page) {
  await caretIn(page, 2);
  await page.keyboard.press('Escape');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowDown');
  assert.deepEqual(await selected(page), [2, 3, 4, 5], 'blocks 2–5 selected');
}

test('fr_edt_13_ac2_delete_selection_and_undo', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  const orig = original(E.deset);
  await select2to5(page);
  await page.keyboard.press('Backspace');
  const t = await saved(page, core, E.deset);
  assert.equal(await bodyOf(t), await reordered(orig, [1, 6, 7, 8, 9, 10]), 'blocks 1, 6…10 byte-identical, one blank line between 1 and 6');
  assert.equal(noModified(frontOf(t)), noModified(frontOf(orig)), 'only modified changes');
  await page.keyboard.press('Meta+z');
  const t2 = await saved(page, core, E.deset);
  assert.equal(await bodyOf(t2), await bodyOf(orig), 'one ⌘Z restores all four');
});

test('fr_edt_13_ac3_move_selection_as_a_group', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  const orig = original(E.deset);
  await select2to5(page);
  await page.keyboard.press('Meta+Shift+ArrowDown');
  const t = await saved(page, core, E.deset);
  assert.equal(await bodyOf(t), await reordered(orig, [1, 6, 2, 3, 4, 5, 7, 8, 9, 10]), 'the group moves one block down, bytes kept');
});

test('fr_edt_13_ac3_drag_moves_the_whole_group', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  const orig = original(E.deset);
  await select2to5(page);
  await block(page, 3).hover();
  const h = await must(page.getByRole('button', { name: 'Drag to move, click for block menu', exact: true }), 'handle');
  const hb = (await h.boundingBox())!;
  const tb = (await block(page, 8).boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + 20, tb.y + tb.height + 2, { steps: 12 });
  await page.mouse.up();
  const t = await saved(page, core, E.deset);
  assert.equal(await bodyOf(t), await reordered(orig, [1, 6, 7, 8, 2, 3, 4, 5, 9, 10]), 'dragging a selected block moves the group');
});

test('fr_edt_13_ac4_turn_paragraphs_into_one_list', async ({ page }) => {
  const core = await openEditor(page, E.odstavce);
  await caretIn(page, 1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Meta+/');
  await (await must(blockMenu(page).getByRole('menuitem', { name: 'Turn into', exact: true }), 'Turn into')).click();
  await (await must(page.getByRole('menuitem', { name: 'Bulleted list', exact: true }), 'Bulleted list')).click();
  const t = await saved(page, core, E.odstavce);
  assert.equal(await bodyOf(t), '- První odstavec.\n- Druhý odstavec.\n- Třetí odstavec.\n', 'one list of three items');
  assert.deepEqual(await kindsOf(t), ['list'], 'parses as one list');
});

test('fr_edt_13_ac4_turn_into_disabled_with_source_block', async ({ page }) => {
  await openEditor(page, E.surove);
  await caretIn(page, 1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Meta+/');
  const ti = await must(blockMenu(page).getByRole('menuitem', { name: 'Turn into', exact: true }), 'Turn into');
  assert.equal(await ti.getAttribute('aria-disabled'), 'true', 'disabled when a source block is selected');
});

test('fr_edt_13_ac5_copy_cut_and_paste_blocks', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  const orig = original(E.deset);
  const raw = (await blocksOf(orig)).slice(1, 5);
  await select2to5(page);
  const c = await copyOrCut(page, 'copy');
  assert.equal(c.plain, raw.join('\n\n'), 'text/plain: the four sources, one blank line, LF');
  assert.ok(c.html.length > 0 && /<(p|ul|ol|h\d)/.test(c.html), 'text/html with the rendered blocks');
  const x = await copyOrCut(page, 'cut');
  assert.equal(x.plain, raw.join('\n\n'), 'cut puts the same text');
  const t = await saved(page, core, E.deset);
  assert.equal(await bodyOf(t), await reordered(orig, [1, 6, 7, 8, 9, 10]), 'then deletes (AC-2)');
  await openNote(page, 'Prázdná');
  await editorBody(page).first().click();
  await paste(page, { plain: c.plain });
  const p = await saved(page, core, E.prazdna);
  const { parse } = await import('@tegg/doc');
  assert.deepEqual(parse(p).blocks.map((b) => b.kind), parse(raw.join('\n\n')).blocks.map((b) => b.kind), 'same block kinds');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-07, FR-SYN-06

/** One reading tour step on the current note: three caret clicks, arrows, select all, copy, scroll to end. */
async function tour(page: Page) {
  const n = await editorBody(page).locator(':scope > *').count();
  for (const k of [1, Math.ceil(n / 2), n]) if (k >= 1) await block(page, k).click({ position: { x: 5, y: 5 } }).catch(() => {});
  for (const key of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft']) await page.keyboard.press(key);
  await page.keyboard.press('Meta+a');
  await copyOrCut(page, 'copy');
  await page.keyboard.press('Meta+ArrowDown');
  await page.mouse.wheel(0, 5000);
}

test('fr_fmt_07_ac8_open_and_close_writes_nothing_editor_fixture', async ({ page }) => {
  test.setTimeout(120_000);
  const core = await openEditor(page, E.deset);
  const titles = [...new Set(Object.values(TITLES))].filter((t) => !['Dvojník', 'Senior Product Manager'].includes(t));
  for (const t of titles) {
    await openNote(page, t);
    await must(editorBody(page), `editor for ${t}`);
    await tour(page);
  }
  await openNote(page, 'Deset bloků');
  await sleep(1500);
  assert.equal((await writes(core)).length, 0, 'zero note_write calls');
  assert.deepEqual(await nonReadCalls(core), [], 'zero write commands');
});

function corpusVault(): FakeVault {
  const root = resolve(REPO, 'tests/fixtures/format/roundtrip');
  const files: Record<string, string> = { ...loadFixtureVault('tests/fixtures/vaults/new-empty/.tegg').files };
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith('.md') && n !== 'README.md') files[`Pages/${relative(root, p).replace(/\//g, ' - ')}`.normalize('NFC')] = readFileSync(p, 'utf8');
    }
  };
  walk(root);
  return { name: 'Korpus', files };
}

test('fr_fmt_07_ac8_open_and_close_writes_nothing_roundtrip_corpus', async ({ browser }: { browser: Browser }) => {
  test.setTimeout(600_000);
  const v = corpusVault();
  const paths = Object.keys(v.files).filter((p) => p.startsWith('Pages/'));
  const bad: string[] = [];
  for (const p of paths) {
    const page = await browser.newPage();
    const core = await start(page, { vault: v, last: { path: p, id: idOf(v.files[p]) } });
    if (!(await seen(editorBody(page), 4000))) {
      // Read-only files (NFR-REL-03 AC-6…AC-8) have no editor; they are toured as read views.
      if (!(await seen(saveState(page).filter({ hasText: 'Read-only' }), 500))) bad.push(`${p}: neither editor nor read-only`);
    } else await tour(page);
    await page.keyboard.press('Meta+o');
    await sleep(800);
    if ((await writes(core)).length > 0) bad.push(`${p}: note_write`);
    await page.close();
  }
  assert.deepEqual(bad, [], 'every corpus file: zero note_write on open/close');
});

test('fr_fmt_07_ac9_one_edit_changes_one_block', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  const orig = original(E.deset);
  await caretIn(page, 5);
  await page.keyboard.type(' Doplněno.');
  const t = await saved(page, core, E.deset);
  assert.equal(noModified(t), noModified(orig).replace(B5, `${B5} Doplněno.`), 'only block 5 and modified differ');
  for (const keep of ['_kurzívou_', '__tučným__', 'textem.  \n', '* první', '\n\n\n1) jedna', '2) dvě', '\n   \n', '>\n\n```', 'const x = 1;   ', '| :--- | ---: |', 'a \\| b', '# komentář v hlavičce zůstane', '# komentář za hodnotou', 'vlastní-klíč: [a, b]']) {
    assert.ok(t.includes(keep), `byte-identical: ${JSON.stringify(keep)}`);
  }
});

const ENVELOPE: [string, (t: string) => boolean, string][] = [
  ['CRLF line endings.md', (t) => !/[^\r]\n/.test(t) && t.includes('Paragraph. Ž\r\n\r\nNový odstavec.\r\n'), 'CRLF on every line, new lines too'],
  ['BOM.md', (t) => t.startsWith('\uFEFF') && t.includes('Body after BOM. Ž\n\nNový odstavec.\n'), 'BOM kept'],
  ['No final newline.md', (t) => t.endsWith('Last line without newline Ž\n\nNový odstavec.'), 'no final newline kept'],
  ['Many trailing newlines.md', (t) => t.endsWith('Text. Ž\n\nNový odstavec.\n\n\n\n'), 'trailing newlines kept'],
];
for (const [name, ok, what] of ENVELOPE) {
  test(`fr_fmt_07_ac12_file_envelope_${name.replace(/\W+/g, '_').toLowerCase()}`, async ({ page }) => {
    const v = editorVault();
    const path = `Pages/${name}`;
    v.files[path] = readFileSync(resolve(REPO, 'tests/fixtures/format/roundtrip/edge', name), 'utf8');
    const core = await openEditor(page, path, { vault: v });
    const n = await editorBody(page).locator(':scope > *').count();
    await caretIn(page, n);
    await page.keyboard.type(' Ž');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Nový odstavec.');
    const t = await saved(page, core, path);
    assert.ok(ok(t), `${what}: ${JSON.stringify(t.slice(-80))}`);
  });
}

test('fr_fmt_02_ac5_first_edit_of_a_file_without_id', async ({ page }) => {
  const core = await openEditor(page, E.bez);
  await sleep(1000);
  assert.equal((await writes(core)).length, 0, 'opening Bez hlavičky writes nothing');
  await caretIn(page, 1);
  await page.keyboard.type(' Doplněno.');
  const t = await saved(page, core, E.bez);
  const m = /^---\nid: ([0-9A-HJKMNP-TV-Z]{26})\ntype: page\nmodified: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d\n---\n/.exec(t);
  assert.ok(m, `id, type: page, modified only: ${JSON.stringify(t.slice(0, 120))}`);
  assert.equal(t.slice(m![0].length), original(E.bez).replace('jen text.', 'jen text. Doplněno.'), 'original body with the edit');
  await page.keyboard.type(' Znovu.');
  const t2 = await saved(page, core, E.bez);
  assert.equal(idOf(t2), m![1], 'same id in later saves');
  await openNote(page, 'Cizí hlavička');
  await must(editorBody(page), 'editor');
  await caretIn(page, 1);
  await page.keyboard.type(' Doplněno.');
  const c = await saved(page, core, E.cizi);
  const orig = original(E.cizi);
  const fmEnd = orig.indexOf('\n---\n', 4) + 1;
  assert.ok(c.startsWith(orig.slice(0, fmEnd)), 'existing keys byte-identical');
  assert.match(c.slice(fmEnd), /^id: [0-9A-HJKMNP-TV-Z]{26}\ntype: page\nmodified: \S+\n---\n/, 'id, type, modified appended');
});

const TZ: [string, string, string][] = [
  ['Europe/Prague', '2026-10-13T12:00:00Z', '2026-10-13T14:00:00+02:00'],
  ['America/Los_Angeles', '2026-10-13T12:00:00Z', '2026-10-13T05:00:00-07:00'],
  ['Asia/Tokyo', '2026-10-13T12:00:00Z', '2026-10-13T21:00:00+09:00'],
  ['Europe/Prague', '2026-10-25T00:30:00Z', '2026-10-25T02:30:00+02:00'],
  ['Europe/Prague', '2026-10-25T01:30:00Z', '2026-10-25T02:30:00+01:00'],
];
for (const [tz, at, want] of TZ) {
  test.describe(`modified in ${tz} at ${at}`, () => {
    test.use({ timezoneId: tz });
    test(`fr_fmt_02_ac6_modified_value_${tz.replace(/\W/g, '_')}_${at.slice(0, 16).replace(/\W/g, '')}`, async ({ page }) => {
      await page.clock.install({ time: new Date(at) });
      await page.clock.pauseAt(new Date(at));
      const core = await openEditor(page, E.deset);
      await caretIn(page, 5);
      await page.keyboard.type('x');
      await page.clock.runFor(1500);
      await sleep(200);
      const ws = await writes(core, E.deset);
      assert.ok(ws.length >= 1, 'saved');
      const t = argText(ws[ws.length - 1]);
      assert.match(t, new RegExp(`^modified: ${want.replace(/\+/g, '\\+')}$`, 'm'), `modified: ${want}`);
      assert.match(t, /^created: 2026-10-01T09:00:00\+02:00$/m, 'created never changes');
    });
  });
}

test('fr_fmt_02_ac7_no_change_no_modified', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await caretIn(page, 2);
  for (const k of ['ArrowDown', 'ArrowRight', 'End', 'Home']) await page.keyboard.press(k);
  await selectIn(page, 5, 'blok');
  await page.mouse.wheel(0, 800);
  const fold = editorBody(page).getByRole('button', { name: /^(Collapse|Expand) Tip$/ }); // D-159; Deset's [!tip] isn't foldable (see AP list)
  if (await seen(fold, 500)) await fold.click();
  await caretIn(page, 5);
  await page.keyboard.press('Meta+/');
  await must(blockMenu(page), 'block menu');
  await page.keyboard.press('Escape');
  await page.keyboard.press(TOGGLE);
  await must(sourceRegion(page), 'source view');
  await page.keyboard.press(TOGGLE);
  await must(editorBody(page), 'editor again');
  await caretIn(page, 5);
  await page.keyboard.type('q');
  await page.keyboard.press('Meta+z');
  await sleep(2000);
  assert.equal((await writes(core)).length, 0, 'no write');
  assert.equal(await fileText(core, E.deset), original(E.deset), 'file untouched, modified included');
});

test('fr_fmt_12_ac5_edited_text_is_nfc_and_nfd_bytes_elsewhere_stay', async ({ page }) => {
  const v = editorVault();
  const odkazy = readFileSync(resolve(REPO, 'tests/fixtures/vaults/read-view/Pages/Odkazy.md'), 'utf8');
  v.files['Pages/Odkazy.md'] = odkazy;
  const core = await openEditor(page, E.deset, { vault: v });
  await caretIn(page, 5);
  await page.keyboard.insertText(' Čeština'.normalize('NFD'));
  const t = await saved(page, core, E.deset);
  assert.ok(t.includes(`${B5} Čeština`), 'typed NFD saved in NFC');
  await openNote(page, 'Odkazy');
  await must(editorBody(page), 'editor on Odkazy');
  await caretIn(page, 1);
  await page.keyboard.type(' Ž');
  const o = await saved(page, core, 'Pages/Odkazy.md');
  const nfd = (odkazy.match(/\p{M}/gu) ?? []).length;
  assert.ok(nfd > 0, 'setup: Odkazy has NFD bytes');
  assert.equal((o.match(/\p{M}/gu) ?? []).length, nfd, 'NFD bytes in other blocks unchanged');
});

test('fr_syn_06_ac7_reading_tour_sends_no_write', async ({ page }) => {
  test.setTimeout(120_000);
  const core = await openEditor(page, E.deset);
  for (const t of ['Deset bloků', 'Cíl', 'Úkoly', 'Surové bloky', 'Seznamy', 'Odstavce', 'Prázdná', 'Bez hlavičky', 'Cizí hlavička']) {
    await openNote(page, t);
    await must(editorBody(page), `editor ${t}`);
    const n = await editorBody(page).locator(':scope > *').count();
    for (let k = 1; k <= n; k++) await block(page, k).click({ position: { x: 4, y: 4 } }).catch(() => {});
  }
  await openNote(page, 'Deset bloků');
  await selectIn(page, 5, 'blok');
  await must(toolbar(page), 'toolbar shows');
  await caretIn(page, 5);
  await page.keyboard.press('Meta+/');
  await must(blockMenu(page), 'block menu');
  await page.keyboard.press('Escape');
  await page.keyboard.press(TOGGLE);
  await page.keyboard.press(TOGGLE);
  const fold = editorBody(page).getByRole('button', { name: /^(Collapse|Expand) Tip$/ }); // D-159; Deset's [!tip] isn't foldable (see AP list)
  if (await seen(fold, 500)) await fold.click();
  await editorBody(page).getByRole('link', { name: 'Cíl' }).first().click();
  await mustBeOn(page, 'Cíl', 'follow [[Cíl]]');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Deset bloků', 'Back');
  await caretIn(page, 2);
  await page.keyboard.press('Meta+z');
  await sleep(1500);
  assert.deepEqual(await nonReadCalls(core), [], 'zero write calls');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-10, NFR-REL-03

test('fr_edt_10_ac9_source_toggle_saves_first', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await core.writeControl({ delayMs: 400 });
  await caretIn(page, 5);
  await page.keyboard.type(' Uloženo.');
  await page.keyboard.press(TOGGLE);
  const r = await must(sourceRegion(page), 'source view');
  assert.ok((await r.innerText()).includes(`${B5} Uloženo.`), 'source view shows the file with the edit');
  const w = (await writes(core, E.deset))[0];
  assert.ok(w && w.ok, 'saved first');
  assert.equal(await r.getAttribute('contenteditable'), null, 'source view stays read-only (D-146)');
});

test('nfr_rel_03_ac6_invalid_frontmatter_stays_read_only', async ({ page }) => {
  const core = await start(page, { vault: editorVault(), last: { path: E.uvozovky, id: null } });
  await must(sourceRegion(page), 'source view with warning');
  await must(page.getByRole('alert'), 'warning');
  await page.keyboard.press(TOGGLE);
  assert.ok(await absent(editorBody(page), 1000), 'the toggle shows the read view, not the editor');
  await page.locator('main').first().click();
  await page.keyboard.type('xyz');
  await paste(page, { plain: 'vloženo' });
  assert.ok(await stateIs(page, 'Read-only'), 'Save state Read-only');
  await sleep(1500);
  assert.deepEqual(await nonReadCalls(core), [], 'nothing is written');
});

test('nfr_rel_03_ac7_invalid_utf8_opens_read_only', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  const bytes = new Uint8Array([...new TextEncoder().encode('---\ntype: page\n---\nPřed chybou '), 0xff, ...new TextEncoder().encode(' za chybou.\n')]);
  await core.setFile('Pages/Neplatné UTF-8.md', bytes);
  await openNote(page, 'Neplatné UTF-8');
  await must(page.getByRole('alert').filter({ hasText: "This file isn't valid UTF-8" }), 'alert');
  assert.ok(await absent(editorBody(page), 500), 'no editor');
  assert.ok((await page.locator('main').first().innerText()).includes('Před chybou \uFFFD za chybou.'), 'text with U+FFFD');
  await page.keyboard.press(TOGGLE);
  await openNote(page, 'Cíl');
  await sleep(1000);
  assert.equal((await core.calls()).filter((c) => c.cmd === 'note_write' && (c.args as any).path === 'Pages/Neplatné UTF-8.md').length, 0, 'never written');
});

test('nfr_rel_03_ac8_editor_load_failure_falls_back_to_read_view', async ({ page }) => {
  const core = await openEditor(page, E.cil);
  await page.evaluate(() => { const w = window as any; w.__TEGG_TEST__ = w.__TEGG_TEST__ ?? {}; w.__TEGG_TEST__.faults = { editorLoad: true }; });
  await openNote(page, 'Deset bloků');
  await must(page.getByRole('alert').filter({ hasText: "This note opened read-only because the editor couldn't load it" }), 'alert');
  await must(page.getByRole('article', { name: 'Deset bloků' }), 'read view');
  await sleep(1000);
  assert.deepEqual(await nonReadCalls(core), [], 'nothing written');
  await must(sidebar(page), 'sidebar works');
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'palette works');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+o');
  await must(switcherDialog(page), 'switcher works');
});

test('nfr_rel_03_ac9_save_refused_by_verification', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await page.evaluate(() => { const w = window as any; w.__TEGG_TEST__ = w.__TEGG_TEST__ ?? {}; w.__TEGG_TEST__.faults = { verify: true }; });
  await caretIn(page, 5);
  await page.keyboard.type(' Neověřeno.');
  assert.ok(await stateIs(page, 'Not saved', 3000), 'Not saved');
  const al = await must(page.getByRole('alert').filter({ hasText: "Tegg couldn't save this change safely" }), 'alert');
  await must(al.getByRole('button', { name: 'Undo' }), 'Undo action');
  assert.equal((await writes(core)).length, 0, 'no note_write sent');
  assert.ok((await editorBody(page).first().innerText()).includes('Neověřeno.'), 'edits stay');
  assert.equal(await fileText(core, E.deset), original(E.deset), 'file unchanged');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03

test('fr_ux_03_ac13_editor_commands_in_palette_run_on_selection', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await selectIn(page, 5, 'blok');
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'palette');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Bold');
  const opts = await page.getByRole('listbox', { name: 'Commands' }).getByRole('option').allInnerTexts();
  assert.ok(opts.some((o) => o.startsWith('Bold') && o.includes('⌘B')), `Bold listed with ⌘B: ${opts.join(' | ')}`);
  await page.keyboard.press('Enter');
  const t = await saved(page, core, E.deset);
  assert.ok(t.includes('Pátý **blok**, který'), 'palette restored the selection and ran Bold');
  await runCommand(page, 'Go to Search');
  await runCommand(page, 'Bold');
  await sleep(800);
  assert.equal(await page.getByRole('alert').count(), 0, 'no error on another route');
  assert.equal((await writes(core)).length, 1, 'not run elsewhere');
});

test('fr_ux_03_ac14_writing_by_keyboard_only', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await page.evaluate(() => {
    const w = window as any;
    w.__pointerEvents = 0;
    for (const t of ['pointerdown', 'mousedown', 'click']) window.addEventListener(t, (e) => { if ((e as MouseEvent).detail > 0 || t === 'pointerdown') w.__pointerEvents++; }, true);
  });
  await page.keyboard.press('Meta+n');
  await mustBeDraft(page, 'New object'); // D-520: an unsaved draft with the caret in its empty title
  await page.keyboard.type('Klávesnice');
  await page.keyboard.press('Enter'); // ⏎ creates the note and moves the caret to the body (D-522)
  await mustBeOn(page, 'Klávesnice', 'new note');
  await page.keyboard.type('## Nadpis');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Odstavec s [[Cíl');
  await must(linkSuggestions(page), 'link suggestions');
  await page.keyboard.press('Enter');
  await page.keyboard.type(' a #proj');
  await must(tagSuggestions(page), 'tag suggestions');
  await page.keyboard.press('Enter');
  await page.keyboard.type(' a ');
  await page.keyboard.press('Meta+b');
  await page.keyboard.type('tučné');
  await page.keyboard.press('Meta+b');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[] Úkol');
  await page.keyboard.press('Meta+Enter');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Meta+Shift+ArrowDown');
  await page.keyboard.press('Meta+z');
  await page.keyboard.press('Meta+o');
  await must(switcherDialog(page), 'leave with ⌘O');
  await page.keyboard.press('Escape');
  await sleep(1500);
  const path = (await core.writesTo()).find((p) => p.includes('Klávesnice'));
  assert.ok(path, 'the note was written');
  const body = await bodyOf((await fileText(core, path!))!);
  const { markdownTree } = await import('@tegg/doc');
  const tr = markdownTree(body) as any;
  assert.deepEqual(tr.children.map((n: any) => n.type), ['heading', 'paragraph', 'list'], 'heading, paragraph, checklist in order');
  const types: string[] = [];
  const walk = (n: any) => { types.push(n.type); (n.children ?? []).forEach(walk); };
  walk(tr.children[1]);
  for (const ty of ['wikiLink', 'tag', 'strong']) assert.ok(types.includes(ty), `paragraph contains ${ty}`);
  assert.equal(tr.children[2].children[0].checked, true, 'checked checklist item');
  assert.deepEqual(await page.evaluate(() => (window as any).__pointerEvents ?? 0), 0, 'no pointer events');
});

// ------------------------------------------------------------------------------------------------ NFR-OTH-02, FR-UX-05

/** Words of `loc`'s visible text outside ⟦ ⟧ that aren't user content (`data-user-content`, as in the 3A i18n test). */
async function unmarkedIn(loc: import('@playwright/test').Locator): Promise<string[]> {
  return loc.first().evaluate((root) => {
    let all = '';
    const walk = (n: Node) => {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const el = n as HTMLElement;
        if (el.hasAttribute('data-user-content')) { all += ' '; return; }
        if (el.getClientRects().length === 0) return;
      }
      if (n.nodeType === Node.TEXT_NODE) { all += n.textContent; return; }
      for (const c of n.childNodes) walk(c);
    };
    walk(root);
    return (all.replace(/⟦[^⟦⟧]*⟧/g, ' ').match(/[\p{L}][\p{L}'’]*/gu) ?? []).filter((w, i, a) => a.indexOf(w) === i);
  });
}

// Under the pseudo-locale every accessible name is wrapped too, so lookups use non-exact names here.
test('nfr_oth_02_ac6_pseudo_locale_in_editor_surfaces', async ({ page }) => {
  const core = await start(page, { vault: editorVault(), last: { path: E.deset, id: idOf(original(E.deset)) }, prelude: pseudoLocale });
  const body = page.getByRole('textbox', { name: /Note body/ });
  await must(body, 'editor (pseudo-locale)', 5000);
  const bad: string[] = [];
  const check = async (what: string, loc: import('@playwright/test').Locator) => {
    await must(loc, what);
    const u = await unmarkedIn(loc);
    if (u.length) bad.push(`${what}: ${u.join(' ')}`);
  };
  await check('save state', page.getByRole('status', { name: /Save state/ }));
  await caretIn(page, 5, null, true);
  await page.keyboard.type('/');
  await check('slash menu', page.getByRole('listbox', { name: /Insert block/ }));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace');
  await selectIn(page, 5, 'blok');
  await check('toolbar', page.getByRole('toolbar', { name: /Formatting/ }));
  await caretIn(page, 5);
  await page.keyboard.press('Meta+/');
  await check('block menu', page.getByRole('menu', { name: /Block actions/ }));
  await page.keyboard.press('Escape');
  await page.keyboard.type(' [[Cí');
  await check('link suggestions', page.getByRole('listbox', { name: /Link suggestions/ }));
  await page.keyboard.press('Escape');
  await page.keyboard.type(' #pro');
  await check('tag suggestions', page.getByRole('listbox', { name: /Tag suggestions/ }));
  await page.keyboard.press('Escape');
  // Changed by 6A (D-186 changed): the MS6 paste notice is retired; a refused file shows `media.refused` (FR-ATT-01 AC-6).
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new TextEncoder().encode('Tohle není obrázek.')], 'text.png', { type: 'image/png' }));
    (document.activeElement as HTMLElement | null ?? document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await check('media refused alert', page.getByRole('alert').filter({ hasText: /text\.png|Pasted image/ }));
  await core.setFile(E.deset, original(E.deset).replace('Přehled', 'Jinde'), { silent: true });
  await page.keyboard.type('x');
  await check('merge dialog', page.getByRole('dialog', { name: /Note changed outside Tegg/ }));
  assert.deepEqual(bad, [], 'every chrome text is inside ⟦ ⟧');
});

test('nfr_oth_02_ac6_pseudo_locale_deleted_alert', async ({ page }) => {
  const core = await start(page, { vault: editorVault(), last: { path: E.deset, id: idOf(original(E.deset)) }, prelude: pseudoLocale });
  await must(page.getByRole('textbox', { name: /Note body/ }), 'editor (pseudo-locale)', 5000);
  await caretIn(page, 5);
  await core.writeControl({ hold: true });
  await page.keyboard.type('x');
  await core.setFile(E.deset, null);
  const a = await must(page.getByRole('alert').filter({ hasText: /deleted outside Tegg/ }), 'deleted alert in pseudo-locale');
  assert.deepEqual(await unmarkedIn(a), [], 'deleted alert strings wrapped');
});

for (const th of ['light', 'dark'] as const) {
  test(`fr_ux_05_ac8_editor_surfaces_in_${th}`, async ({ page }) => {
    const core = await openEditor(page, E.deset, { uiState: ui(th) });
    const problems: string[] = [];
    const audit = async (what: string) => {
      const c = await axeContrast(page);
      const l = await colourLeaks(page, th);
      if (c.length) problems.push(`${what}: contrast ${c.join(', ')}`);
      if (l.length) problems.push(`${what}: colours ${l.join(', ')}`);
    };
    await caretIn(page, 5, null, true);
    await page.keyboard.type('/');
    await must(slashMenu(page), 'slash menu');
    await audit('slash menu');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Backspace');
    await selectIn(page, 5, 'blok');
    await must(toolbar(page), 'toolbar');
    await audit('toolbar');
    await caretIn(page, 5);
    await page.keyboard.type(' [[Cí');
    await must(linkSuggestions(page), 'link suggestions');
    await audit('link suggestions');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+/');
    await must(blockMenu(page), 'block menu');
    await audit('block menu');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await audit('block selection');
    await core.setFile(E.deset, original(E.deset).replace('Přehled', 'Jinde'), { silent: true });
    await caretIn(page, 2);
    await page.keyboard.type('x');
    await must(mergeDialog(page), 'merge dialog');
    await mergeDialog(page).getByRole('button', { name: 'Compare', exact: true }).click();
    await must(page.getByRole('region', { name: 'Compare versions' }), 'compare');
    await audit('merge dialog with compare');
    assert.deepEqual(problems, [], `${th}: FR-UX-05 AC-4/AC-5 on the editor surfaces`);
  });
}

void titleField; void deletedAlert; void eventually;
