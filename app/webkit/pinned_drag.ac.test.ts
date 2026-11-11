// Slice PIN, L5 (WebKit + fake core): pointer reorder, dragging in, chips that never edit their note, Reduce motion:
// docs/acceptance/pinned.md FR-HOM-02 AC-10, AC-12, AC-13, FR-UX-08 AC-17 (R135; boards C, D; AP-1238 = D-1381).
// Interface docs/contracts/v1-pinned.md §3.1 (`drag.ts`, `DragLayer.tsx`, `editorDrag.ts`), §3.2 (`data-pinned-drop`,
// `data-drop-over`, `data-pin-drop-line`, `data-pin-placeholder`, `data-pin-lifted`, `data-pin-drag-chip`). Written from
// the ACs and the contract only (D-61). Every lookup goes through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  ID, P, QUERY_PIN, VALID_ROWS, backlinkEntry, box, chip, click, drag, dragChip, dropLine, editorBody, eventually, gapAfter, inboxEntry, kanbanCard, lifted,
  main, must, mustBeOn, openPinned, otherWrites, pinsFx, pinsText, placeholder, rowAt, rows, rowsAre, runCommand, searchRow, section, seen, sleep,
  tagRow, tagsEntry, typeRow, typesEntry, typesList,
} from './pinned-helpers';

test.use({ timezoneId: 'Europe/Prague' });

// Slice Q (FR-HOM-02 AC-29): valid.yml's query item is drawn, the last row.
const AFTER_MOVE = ['Rozpočet 2027', '2026-10-07 Týdenní porada', '#offsite', 'Výjezd Lisabon 2026', 'Projekty', QUERY_PIN];
const overSection = (page: Page) => section(page).evaluate((s) => s.hasAttribute('data-drop-over')).catch(() => false);

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-10

test('fr_hom_02_ac10_reorder_by_pointer', async ({ page }) => {
  const core = await openPinned(page, { pins: 'valid.yml', route: 'inbox' });
  await rowsAre(page, VALID_ROWS);
  await drag(page, rowAt(page, 1), await gapAfter(page, 3), { hold: true, what: 'row Lisabon' });
  assert.ok(await seen(lifted(page), 1000), 'the row lifts (data-pin-lifted)');
  assert.ok(await seen(placeholder(page), 1000), 'a dashed placeholder in its old slot');
  assert.equal(await placeholder(page).evaluate((e) => getComputedStyle(e).borderTopStyle), 'dashed', 'the placeholder is dashed');
  assert.equal(await dropLine(page).first().getAttribute('data-pin-drop-line'), '3', 'the line between #offsite and Projekty (final position 3)');
  await page.mouse.up();
  assert.equal(await eventually(() => pinsText(core), (t) => t === pinsFx('expected/valid-after-move.yml')), pinsFx('expected/valid-after-move.yml'), 'expected/valid-after-move.yml');
  assert.deepEqual(await rowsAre(page, AFTER_MOVE), AFTER_MOVE, 'the new order');
  assert.equal((await core.pinCalls()).length, 1, 'one write');

  const calls = async () => (await core.pinCalls()).length;
  // A drop at the row's own place.
  await drag(page, rowAt(page, 2), rowAt(page, 2), { dy: 6, what: 'row #offsite' });
  // Esc during the drag.
  await drag(page, rowAt(page, 0), await gapAfter(page, 3), { esc: true, what: 'row Rozpočet' });
  // Drops outside the section.
  await drag(page, rowAt(page, 0), typesList(page), { what: 'row Rozpočet → Types' });
  await drag(page, rowAt(page, 0), main(page), { what: 'row Rozpočet → centre' });
  await drag(page, rowAt(page, 0), { x: 5, y: 895 }, { what: 'row Rozpočet → window edge' });
  await sleep(300);
  assert.equal(await calls(), 1, 'none of those writes');
  assert.deepEqual(await rowsAre(page, AFTER_MOVE), AFTER_MOVE, 'order unchanged');
  assert.equal(await seen(lifted(page), 200), false, 'the row went back');
  // A press-and-release under 5 px opens the row.
  const b = await box(rowAt(page, 0));
  await page.mouse.move(b!.x + 20, b!.y + b!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + 22, b!.y + b!.height / 2 + 2);
  await page.mouse.up();
  await mustBeOn(page, 'Rozpočet 2027', 'a 4 px press-and-release is a click');
  assert.equal(await calls(), 1, 'and writes nothing');
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-12

test('fr_hom_02_ac12_drag_in_from_search_at_the_line', async ({ page }) => {
  const core = await openPinned(page, { pins: 'valid.yml', route: 'search' });
  await rowsAre(page, VALID_ROWS);
  await page.getByRole('searchbox', { name: 'Search query' }).fill('Čajovna');
  await drag(page, searchRow(page, 'Čajovna'), await gapAfter(page, 0), { hold: true, what: 'Search result Čajovna' });
  assert.equal(await overSection(page), true, 'the section is highlighted (data-drop-over)');
  const c = await must(dragChip(page), 'the drag-in chip');
  assert.match((await c.innerText()).replace(/\s+/g, ' '), /Čajovna.*Pin/, 'the chip shows the label and the `Pin` badge');
  assert.equal(await dropLine(page).first().getAttribute('data-pin-drop-line'), '1', 'the line between rows 1 and 2');
  await page.mouse.up();
  assert.equal(await eventually(() => pinsText(core), (t) => t === pinsFx('expected/valid-after-pin-at-2.yml')), pinsFx('expected/valid-after-pin-at-2.yml'), 'expected/valid-after-pin-at-2.yml');
  assert.equal(await overSection(page), false, 'the highlight goes');
  // Dropping an already pinned target moves its row (AP-1236).
  await drag(page, searchRow(page, 'Čajovna'), await gapAfter(page, 4), { what: 'Čajovna again' });
  await eventually(async () => (await rows(page)).map((r) => r.label), (l) => l[4] === 'Čajovna');
  assert.deepEqual((await rows(page)).map((r) => r.label), ['Rozpočet 2027', 'Výjezd Lisabon 2026', '2026-10-07 Týdenní porada', '#offsite', 'Čajovna', 'Projekty', QUERY_PIN], 'moved, not added twice');
  assert.equal((String(await pinsText(core)).match(/Pages\/Čajovna\.md/g) ?? []).length, 1, 'one item for Čajovna');
  const n = (await core.pinCalls()).length;
  // AP-1267 (D-1410): Plán must be in the results first.
  await page.getByRole('searchbox', { name: 'Search query' }).fill('Plán');
  await must(searchRow(page, 'Plán'), 'Search result Plán');
  await drag(page, searchRow(page, 'Plán'), await gapAfter(page, 0), { esc: true, what: 'Esc' });
  await drag(page, searchRow(page, 'Plán'), main(page), { what: 'drop outside' });
  await sleep(300);
  assert.equal((await core.pinCalls()).length, n, 'Esc or a drop outside writes nothing');
});

test('fr_hom_02_ac12_every_source_pins_in_one_write', async ({ page }) => {
  const core = await openPinned(page, { pins: 'valid.yml', route: `note/${P.rozpocet}` });
  await rowsAre(page, VALID_ROWS);
  const pinsBy = async (what: string, from: () => ReturnType<typeof rowAt>, want: string) => {
    const n = (await core.pinCalls()).length;
    await drag(page, from(), await gapAfter(page, 0), { what });
    await eventually(() => pinsText(core), (t) => !!t && t.includes(want));
    assert.ok(String(await pinsText(core)).includes(want), `${what}: pins ${want}`);
    assert.equal((await core.pinCalls()).length, n + 1, `${what}: one write`);
    assert.equal((await rows(page))[1]?.label !== undefined, true, `${what}: a row at position 2`);
  };
  // Backlinks entry Odkazy on Rozpočet.
  await page.keyboard.press('Meta+Backslash');
  await pinsBy('Backlinks entry Odkazy', () => backlinkEntry(page, 'Odkazy'), `path: ${P.odkazy}`);
  await pinsBy('Types entry Schůzky', () => typesEntry(page, 'Schůzky'), 'type: schůzka');
  await runCommand(page, 'Go to type: Tasks');
  await pinsBy('type-page row Úkol', () => typeRow(page, 'Poslat návrh rozpočtu'), `path: ${P.ukol}`);
  await runCommand(page, 'Go to Tags');
  await pinsBy('All tags row #účty', () => tagRow(page, 'účty'), 'tag: účty');
  await click(rowAt(page, 1), 'unpin later');
  await page.keyboard.press('Meta+Shift+f');
  await page.getByRole('searchbox', { name: 'Search query' }).fill('Odkazy');
  await click(searchRow(page, 'Odkazy'), 'open Odkazy');
  await mustBeOn(page, 'Odkazy', 'Odkazy');
  await pinsBy('link chip [[Čajovna]]', () => chip(page, 'Čajovna'), `path: ${P.cajovna}`);
  // The Kanban card, by its title link only.
  await runCommand(page, 'Show Kanban');
  const card = kanbanCard(page, 'Poslat návrh rozpočtu');
  await must(card, 'Kanban card Úkol');
  const before = String(await pinsText(core));
  const unpinned = before.replace(`  - id: ${ID('05')}\n    path: ${P.ukol}\n`, '');
  await core.setFile('.tegg/pinned.yml', unpinned);
  await sleep(500);
  await pinsBy('Kanban card title link', () => card.getByRole('link').first(), `path: ${P.ukol}`);
  const n = (await core.pinCalls()).length;
  const cb = await box(card);
  await page.mouse.move(cb!.x + cb!.width - 8, cb!.y + cb!.height - 6);
  await page.mouse.down();
  const g = await gapAfter(page, 0);
  for (let i = 1; i <= 10; i++) await page.mouse.move(cb!.x + cb!.width - 8 + ((g.x - cb!.x - cb!.width + 8) * i) / 10, cb!.y + cb!.height - 6 + ((g.y - cb!.y - cb!.height + 6) * i) / 10);
  assert.equal(await overSection(page), false, 'a drag elsewhere on the card stays a status drag (no highlight)');
  await page.mouse.up();
  await sleep(300);
  assert.equal((await core.pinCalls()).length, n, 'and pins nothing');
  // Not sources: the sidebar's Tags and Inbox entries.
  for (const [what, loc] of [['Tags entry', tagsEntry(page)], ['Inbox entry', inboxEntry(page)]] as const) {
    await drag(page, loc, await gapAfter(page, 0), { hold: true, what });
    assert.equal(await overSection(page), false, `${what}: no highlight`);
    await page.mouse.up();
    await sleep(200);
    assert.equal((await core.pinCalls()).length, n, `${what}: dropping does nothing`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-13

test('fr_hom_02_ac13_dragging_a_chip_never_edits_the_note', async ({ page }) => {
  const core = await openPinned(page, { pins: 'valid.yml', route: `note/${P.odkazy}` });
  await mustBeOn(page, 'Odkazy', 'Odkazy in the editor');
  await rowsAre(page, VALID_ROWS);
  const body = await must(editorBody(page), 'the editor');
  const odkazy = (await core.files())[P.odkazy];
  for (const text of ['Plán (2)', '#offsite', 'Rozpočet 2027']) {
    await drag(page, chip(page, text), await gapAfter(page, 0), { what: `chip ${text} → section` });
    await drag(page, chip(page, text), typesList(page), { what: `chip ${text} → Types` });
    await drag(page, chip(page, text), body, { dy: 30, what: `chip ${text} → another line` });
  }
  await sleep(1500);
  assert.equal((await core.files())[P.odkazy], odkazy, 'Pages/Odkazy.md untouched');
  assert.deepEqual((await core.calls()).filter((c) => c.cmd === 'note_write').map((c) => (c.args as any)?.path), [], 'zero note_write calls (no autosave)');
  assert.deepEqual(await otherWrites(core), [], 'only pins writes');
  assert.ok(String(await pinsText(core)).includes(`id: ${ID('11')}`), 'the section drop of [[Plán (2)]] pinned Plán 2');
  await (await must(body, 'editor')).focus();
  await page.keyboard.press('Meta+z');
  await sleep(500);
  assert.equal((await core.files())[P.odkazy], odkazy, 'the undo history got no entry (⌘Z changes nothing)');
  const n = (await core.pinCalls()).length;
  await drag(page, chip(page, 'Neexistuje'), await gapAfter(page, 0), { hold: true, what: 'broken chip' });
  assert.equal(await seen(dragChip(page), 300), false, 'a broken chip shows no `Pin` badge');
  await page.mouse.up();
  await sleep(300);
  assert.equal((await core.pinCalls()).length, n, 'and pins nothing');
  // Text selection starting outside a chip still selects text.
  const line = body.getByText('Štítek', { exact: false }).first();
  const lb = await box(line);
  await page.mouse.move(lb!.x + 2, lb!.y + lb!.height / 2);
  await page.mouse.down();
  await page.mouse.move(lb!.x + 40, lb!.y + lb!.height / 2, { steps: 5 });
  await page.mouse.up();
  assert.ok((await page.evaluate(() => String(window.getSelection()))).length > 0, 'a pointer selection inside a paragraph selects text');
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-17

test('fr_ux_08_ac17_pins_reduce_motion', async ({ page }) => {
  await openPinned(page, { pins: 'valid.yml', route: 'search', reducedMotion: 'reduce' });
  await rowsAre(page, VALID_ROWS);
  await drag(page, rowAt(page, 1), await gapAfter(page, 3), { hold: true, what: 'row Lisabon' });
  const l = await must(lifted(page), 'the lifted row');
  assert.equal(await l.evaluate((e) => { const t = getComputedStyle(e).transform; return t === 'none' || /^matrix\(1, 0, 0, 1,/.test(t); }), true, 'no tilt under Reduce motion');
  assert.ok(await seen(dropLine(page)), 'the drop line is still drawn');
  const anim = await section(page).evaluate((s) => [...s.querySelectorAll('*')].some((e) => { const c = getComputedStyle(e); return parseFloat(c.transitionDuration) > 0 || parseFloat(c.animationDuration) > 0; }));
  assert.equal(anim, false, 'nothing animates');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.getByRole('searchbox', { name: 'Search query' }).fill('Čajovna');
  await drag(page, searchRow(page, 'Čajovna'), await gapAfter(page, 0), { hold: true, what: 'drag-in' });
  const c = await must(dragChip(page), 'the drag-in chip');
  assert.equal(await c.evaluate((e) => { const t = getComputedStyle(e).transform; return t === 'none' || /^matrix\(1, 0, 0, 1,/.test(t); }), true, 'the chip isn\'t tilted');
  assert.equal(await overSection(page), true, 'the section highlight is still drawn');
  await page.keyboard.press('Escape');
  await page.mouse.up();
});
