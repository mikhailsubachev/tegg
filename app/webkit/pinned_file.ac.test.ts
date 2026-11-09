// Slice PIN, L5 (WebKit + fake core): the pins file. Unreadable and newer files, skipped entries, many pins with one
// read, saved-query items, conflicts and external changes, minimal writes, NFC: docs/acceptance/pinned.md FR-HOM-02
// AC-22…AC-26, FR-SYN-03 AC-26, AC-27, FR-SYN-06 AC-43, FR-FMT-12 AC-8 (R131; AP-1228, AP-1233, AP-1236, AP-1237,
// AP-1245). Interface docs/contracts/v1-pinned.md §1.4, §2 (errors, UI handling, events), §5 (`pinCalls`, `pinsFail`,
// `setFile` silent, `sameBytesTouch`). Written from the ACs and the contract only (D-61). Lookups go through `must`
// (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  CHANGED_OUTSIDE, FIX_FILE, ID, NEWER, P, PINS, VALID_ROWS, alertBox, click, contextMenu, description, drag, emptyArea, eventually, flat,
  gapAfter, header, list, menuItem, moreBtn, moreMenu, must, mustBeOn, nfc, notice, openPinned, otherWrites, pinnedVault, pinsFx, pinsText, rowAt,
  rowMenu, rows, rowsAre, runCommand, searchRow, section, seen, sleep, typesEntry, typeEntryMenu, unreadableVariants,
} from './pinned-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const PIN = 'Pin to sidebar';
const UNPIN = 'Unpin from sidebar';
const reasonOf = async (loc: Parameters<typeof description>[0]) => `${await description(loc).catch(() => '')} ${await loc.first().getAttribute('title').catch(() => '')}`;

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-22

test('fr_hom_02_ac22_unreadable_pins_file_is_never_rewritten', async ({ page }) => {
  for (const v of unreadableVariants()) {
    const ctx = await page.context().browser()!.newContext({ timezoneId: 'Europe/Prague' });
    const p = await ctx.newPage();
    const core = await openPinned(p, { route: `note/${P.rozpocet}`, vault: pinnedVault() });
    await core.setFile(PINS, v.text);
    const want = v.line ? `The pins file can't be read (line ${v.line}).` : 'The pins file can\'t be read.';
    assert.equal(flat(await eventually(() => notice(p).first().innerText().catch(() => ''), (t) => flat(t) === want, 3000)), want, `${v.name}: the notice`);
    assert.match(flat(await header(p).innerText()), /^pinned$/i, `${v.name}: header without a count`);
    assert.equal(await rows(p).then((r) => r.length), 0, `${v.name}: no rows`);
    const before = await core.version(PINS);
    await click(moreBtn(p), 'More');
    const pin = await must(menuItem(moreMenu(p), PIN), PIN);
    assert.equal(await pin.getAttribute('aria-disabled'), 'true', `${v.name}: Pin to sidebar aria-disabled`);
    assert.match(await reasonOf(pin), new RegExp(FIX_FILE.replace(/\./g, '\\.')), `${v.name}: \`${FIX_FILE}\``);
    await p.keyboard.press('Escape');
    await p.keyboard.press('Meta+k');
    await p.getByRole('combobox', { name: 'Command query' }).fill(PIN);
    await sleep(150);
    const opt = p.getByRole('option').filter({ hasText: PIN }).first();
    assert.equal(await opt.getAttribute('aria-disabled'), 'true', `${v.name}: the palette command is aria-disabled`);
    await p.keyboard.press('Escape');
    await p.keyboard.press('Meta+Shift+f');
    await p.getByRole('searchbox', { name: 'Search query' }).fill('Čajovna');
    await drag(p, searchRow(p, 'Čajovna'), section(p), { hold: true, what: 'drag-in' });
    assert.equal(await section(p).evaluate((s) => s.hasAttribute('data-drop-over')), false, `${v.name}: no highlight`);
    await p.mouse.up();
    await sleep(200);
    assert.deepEqual(await core.pinCalls(), [], `${v.name}: drops do nothing`);
    assert.deepEqual(await core.version(PINS), before, `${v.name}: the file keeps its bytes`);
    await ctx.close();
  }
  const core = await openPinned(page, { pins: 'invalid-yaml.yml', route: 'inbox' });
  await must(notice(page), 'the notice');
  await core.setFile(PINS, pinsFx('valid.yml'));
  assert.deepEqual(await rowsAre(page, VALID_ROWS, 2000), VALID_ROWS, 'fixed by another program: the rows appear within 2 s');
});

test('fr_hom_02_ac22_jobs_leave_an_unreadable_file_alone', async ({ page }) => {
  const core = await openPinned(page, { pins: 'invalid-yaml.yml', route: `note/${P.rozpocet}` });
  await must(notice(page), 'the notice');
  const t = await must(page.getByRole('textbox', { name: 'Title', exact: true }), 'Title');
  await t.click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('Rozpočet 2028');
  await page.keyboard.press('Enter');
  const job = await eventually(async () => (await core.jobs()).find((j) => j.kind === 'note-rename'), (j) => j?.phase === 'done', 5000);
  assert.equal(job?.phase, 'done', 'the rename job succeeds');
  assert.equal(await pinsText(core), pinsFx('invalid-yaml.yml'), 'and leaves the file alone');
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-23

test('fr_hom_02_ac23_newer_and_missing_versions', async ({ page }) => {
  const core = await openPinned(page, { pins: 'newer-version.yml', route: `note/${P.cajovna}` });
  assert.deepEqual(await rowsAre(page, VALID_ROWS), VALID_ROWS, 'newer: the five rows are listed');
  await click(rowAt(page, 0), 'row 1');
  await mustBeOn(page, 'Rozpočet 2027', 'and open normally');
  await click(moreBtn(page), 'More');
  const unpin = await must(menuItem(moreMenu(page), UNPIN), UNPIN);
  assert.equal(await unpin.getAttribute('aria-disabled'), 'true', 'Unpin aria-disabled');
  assert.match(await reasonOf(unpin), new RegExp(NEWER.replace(/\./g, '\\.')), `\`${NEWER}\``);
  await page.keyboard.press('Escape');
  await contextMenu(rowAt(page, 1), 'row 2');
  for (const name of [UNPIN, 'Move up', 'Move down']) assert.equal(await menuItem(rowMenu(page), name).getAttribute('aria-disabled'), 'true', `row menu ${name} aria-disabled`);
  await page.keyboard.press('Escape');
  assert.deepEqual(await core.pinCalls(), [], 'nothing sent');
  assert.equal(await pinsText(core), pinsFx('newer-version.yml'), 'the file keeps its bytes');
});

test('fr_hom_02_ac23_a_missing_version_reads_as_1', async ({ page }) => {
  const noVersion = pinsFx('valid.yml').replace('version: 1\n', '');
  const core = await openPinned(page, { pins: { text: noVersion }, route: `note/${P.cajovna}` });
  assert.deepEqual(await rowsAre(page, VALID_ROWS), VALID_ROWS, 'listed as version 1');
  await sleep(300);
  assert.equal(await pinsText(core), noVersion, 'nothing written on open');
  await click(moreBtn(page), 'More');
  await click(menuItem(moreMenu(page), PIN), PIN);
  const want = `${pinsFx('valid.yml')}  - id: ${ID('04')}\n    path: Pages/Čajovna.md\n`;
  assert.equal(await eventually(() => pinsText(core), (t) => t === want), want, 'the first pin adds `version: 1` as line 2 and nothing else beyond the item');
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-24

test('fr_hom_02_ac24_skipped_entries_are_kept', async ({ page }) => {
  const steps: [string, (p: typeof page) => Promise<void>][] = [
    ['pin', async (p) => {
      await p.keyboard.press('Meta+Shift+f');
      await p.getByRole('searchbox', { name: 'Search query' }).fill('Čajovna');
      await drag(p, searchRow(p, 'Čajovna'), await gapAfter(p, 0), { what: 'Čajovna to position 2' });
    }],
    ['unpin', async (p) => { await (await must(rowAt(p, 1), '#offsite')).hover(); await click(section(p).getByRole('button', { name: 'Unpin #offsite', exact: true }), 'Unpin #offsite'); }],
    ['move', async (p) => { await (await must(rowAt(p, 2), 'Schůzky')).focus(); await p.keyboard.press('Alt+Meta+ArrowUp'); await sleep(300); await p.keyboard.press('Alt+Meta+ArrowUp'); }],
  ];
  for (const [name, act] of steps) {
    const ctx = await page.context().browser()!.newContext({ timezoneId: 'Europe/Prague' });
    const p = await ctx.newPage();
    const core = await openPinned(p, { pins: 'entries.yml', route: 'inbox' });
    assert.deepEqual(await rowsAre(p, ['Rozpočet 2027', '#offsite', 'Schůzky']), ['Rozpočet 2027', '#offsite', 'Schůzky'], 'three rows');
    assert.match(flat(await header(p).innerText()), /3$/, 'count 3');
    await act(p);
    const want = pinsFx(`expected/entries-after-${name}.yml`);
    assert.equal(await eventually(() => pinsText(core), (t) => t === want), want, `${name}: expected/entries-after-${name}.yml`);
    assert.deepEqual(await otherWrites(core), [], `${name}: only pinned.yml`);
    await ctx.close();
  }
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-25

test('fr_hom_02_ac25_many_pins_one_read', async ({ page }) => {
  const vault = pinnedVault();
  const lines = ['# Tegg sidebar pins (FR-HOM-02). Pin, unpin and reorder them in the sidebar.', 'version: 1', 'pins:'];
  const want: string[] = [];
  for (let i = 0; i < 200; i++) {
    const k = i % 4;
    if (k === 0) { const path = `Generated/Poznámka ${String(i).padStart(3, '0')}.md`; vault.files[path] = `---\nid: 01JB5PGEN0000000000000${String(i).padStart(4, '0')}\ntype: page\ntitle: Poznámka ${i}\n---\nText.\n`; lines.push(`  - id: 01JB5PGEN0000000000000${String(i).padStart(4, '0')}`, `    path: ${path}`); want.push(`Poznámka ${i}`); }
    else if (k === 1) { lines.push(`  - tag: štítek-${i}`); want.push(`#štítek-${i}`); }
    else if (k === 2) { lines.push(`  - type: druh-${i}`); want.push(`druh-${i}`); }
    else { const path = `Generated/Bez id ${i}.md`; vault.files[path] = `Text ${i}.\n`; lines.push(`  - path: ${path}`); want.push(`Bez id ${i}`); }
  }
  vault.files[PINS] = `${lines.join('\n')}\n`;
  // AP-1269 (D-1412): start on a route that reads no notes (Inbox reads the daily note for its card).
  const core = await openPinned(page, { vault, route: 'tags' });
  assert.equal((await eventually(() => rows(page), (r) => r.length === 200, 8000)).length, 200, 'all 200 rows, no cap');
  assert.deepEqual((await rows(page)).map((r) => r.label), want, 'in file order');
  assert.equal(await section(page).getByText(/Show (more|all)/).count(), 0, 'no `Show more`');
  const sb = await page.getByRole('navigation', { name: 'Sidebar' }).evaluate((n) => { const s = [n, ...n.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)); return !!s; });
  assert.ok(sb, 'the section scrolls inside the sidebar');
  const reads = (await core.calls()).filter((c) => c.cmd === 'pins_get');
  assert.equal(reads.length, 1, 'opening the sidebar makes exactly one pins_get');
  assert.deepEqual((await core.calls()).filter((c) => ['note_read', 'index_path_by_id', 'link_resolve'].includes(c.cmd)).length, 0, 'no per-row index call');
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-26

test('fr_hom_02_ac26_query_entries_are_kept_not_shown', async ({ page }) => {
  const core = await openPinned(page, { pins: 'valid.yml', route: 'inbox' });
  await rowsAre(page, VALID_ROWS);
  assert.equal(await section(page).getByText('Otevřené úkoly tento týden').count(), 0, 'the query item isn\'t drawn');
  assert.match(flat(await header(page).innerText()), /5$/, 'nor counted');
  await (await must(rowAt(page, 1), 'Lisabon')).focus();
  await page.keyboard.press('Alt+Meta+ArrowDown');
  await page.keyboard.press('Alt+Meta+ArrowDown');
  await (await must(rowAt(page, 4), 'Projekty')).hover();
  await click(section(page).getByRole('button', { name: 'Unpin Projekty', exact: true }), 'Unpin Projekty');
  const t = await eventually(() => pinsText(core), (x) => !!x && !x.includes('type: projekt'));
  assert.ok(String(t).endsWith('  - query: Otevřené úkoly tento týden\n'), 'the query item stays byte for byte, last');
  assert.equal(String(t).split('\n').filter((l) => l.includes('query:')).length, 1, 'exactly once');
  for (const m of [['Types entry', typesEntry(page, 'Schůzky')]] as const) {
    await contextMenu(m[1], m[0]);
    const items = (await typeEntryMenu(page, 'Schůzka').getByRole('menuitem').allInnerTexts()).map(flat);
    assert.ok(!items.some((i) => /query/i.test(i)), 'no menu offers to pin a query');
    await page.keyboard.press('Escape');
  }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-26

test('fr_syn_03_ac26_pins_writes_check_the_base', async ({ page }) => {
  for (const op of ['pin', 'unpin', 'move'] as const) {
    const ctx = await page.context().browser()!.newContext({ timezoneId: 'Europe/Prague' });
    const p = await ctx.newPage();
    const core = await openPinned(p, { pins: 'valid.yml', route: `note/${P.cajovna}` });
    await rowsAre(p, VALID_ROWS);
    const other = `${pinsFx('valid.yml')}  - tag: účty\n`;
    await core.setFile(PINS, other, { silent: true });
    if (op === 'pin') { await click(moreBtn(p), 'More'); await click(menuItem(moreMenu(p), PIN), PIN); }
    if (op === 'unpin') { await (await must(rowAt(p, 2), 'Porada')).hover(); await click(p.getByRole('button', { name: 'Unpin 2026-10-07 Týdenní porada', exact: true }), 'Unpin'); }
    if (op === 'move') await drag(p, rowAt(p, 1), await gapAfter(p, 3), { what: 'row Lisabon' });
    const calls = await eventually(() => core.pinCalls(), (c) => c.length === 1);
    assert.deepEqual(calls[0]?.base, (await core.calls()).filter((c) => c.cmd === 'pins_get').map((c) => (c.result as any)?.version).filter(Boolean)[0], `${op}: the base is the last pins_get's version`);
    assert.equal(await pinsText(core), other, `${op}: refused with Conflict, nothing written`);
    assert.equal(flat(await (await must(alertBox(p), 'alert')).innerText()), CHANGED_OUTSIDE, `${op}: the alert`);
    assert.deepEqual(await rowsAre(p, [...VALID_ROWS, '#účty']), [...VALID_ROWS, '#účty'], `${op}: the rows reload from disk`);
    await ctx.close();
  }
  const core = await openPinned(page, { pins: 'valid.yml', route: `note/${P.cajovna}` });
  await rowsAre(page, VALID_ROWS);
  await core.setFile(PINS, '', { sameBytesTouch: true });
  await click(moreBtn(page), 'More');
  await click(menuItem(moreMenu(page), PIN), PIN);
  assert.ok(String(await eventually(() => pinsText(core), (t) => !!t && t.includes('Čajovna'))).includes('Čajovna'), 'an mtime-only change isn\'t a conflict (D-175)');
  await core.setFile(PINS, null, { silent: true });
  await (await must(rowAt(page, 0), 'row')).hover();
  await click(section(page).getByRole('button', { name: 'Unpin Rozpočet 2027', exact: true }), 'Unpin');
  assert.equal(flat(await (await must(alertBox(page), 'alert')).innerText()), CHANGED_OUTSIDE, 'Gone shows the same alert');
  assert.equal(await pinsText(core), null, 'and nothing is created');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-27

test('fr_syn_03_ac27_external_and_synced_pins_changes', async ({ page }) => {
  const copies = { a: '.tegg/pinned (conflicted copy 2026-11-07).yml', b: '.tegg/pinned 2.yml' };
  const withCopies = pinnedVault({ pins: 'valid.yml', edit: (f) => { f[copies.a] = `${pinsFx('valid.yml')}  - tag: účty\n`; f[copies.b] = `${pinsFx('valid.yml')}  - tag: účty\n`; } });
  const core = await openPinned(page, { vault: withCopies, route: 'inbox' });
  assert.deepEqual(await rowsAre(page, VALID_ROWS), VALID_ROWS, 'conflict copies are never listed');
  const reordered = pinsFx('valid.yml').replace(`  - tag: offsite\n`, '').replace('pins:\n', 'pins:\n  - tag: offsite\n  - tag: účty\n');
  await core.setFile(PINS, reordered);
  const want = ['#offsite', '#účty', 'Rozpočet 2027', 'Výjezd Lisabon 2026', '2026-10-07 Týdenní porada', 'Projekty'];
  assert.deepEqual(await rowsAre(page, want, 2000), want, 'an atomic replace shows the new order and row within 2 s');
  await core.setFile(PINS, null);
  assert.equal(await eventually(() => header(page).getAttribute('aria-expanded'), (v) => v === 'false', 2000), 'false', 'deleting the file shows the section empty, collapsed (D-1429)');
  assert.equal(await list(page).count(), 0, 'no rows');
  await sleep(500);
  assert.equal(await pinsText(core), null, 'nothing is created');
  await core.setFile(PINS, pinsFx('valid.yml'), { silent: true });
  await runCommand(page, 'Go to type: Schůzky');
  await runCommand(page, PIN);
  const c = await eventually(() => core.pinCalls(), (x) => x.length === 1);
  assert.equal(c[0]?.base, null, 'the pin was sent with base none');
  assert.equal(await pinsText(core), pinsFx('valid.yml'), 'Conflict: no file is replaced (RENAME_EXCL)');
  assert.deepEqual(await rowsAre(page, VALID_ROWS, 2000), VALID_ROWS, 'the other file\'s rows show');
  const files = await core.files();
  assert.equal(files[copies.a], withCopies.files[copies.a], 'copy A untouched');
  assert.equal(files[copies.b], withCopies.files[copies.b], 'copy B untouched');
  assert.ok(!(await core.writesTo()).some((p) => p === copies.a || p === copies.b), 'never written');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-43

test('fr_syn_06_ac43_only_pin_actions_write_pinned_yml', async ({ page }) => {
  const core = await openPinned(page, { pins: 'valid.yml', route: 'inbox' });
  await rowsAre(page, VALID_ROWS);
  const files0 = await core.files();
  for (let i = 0; i < 5; i++) { await click(rowAt(page, i), `row ${i}`); await sleep(150); }
  await (await must(rowAt(page, 2), 'row')).hover();
  await click(header(page), 'collapse');
  await click(header(page), 'expand');
  await contextMenu(rowAt(page, 0), 'row menu');
  await page.keyboard.press('Escape');
  await drag(page, rowAt(page, 1), await gapAfter(page, 3), { esc: true, what: 'a cancelled drag' });
  await drag(page, rowAt(page, 1), rowAt(page, 1), { dy: 6, what: 'a drop at the same place' });
  await (await must(rowAt(page, 0), 'first row')).focus();
  await page.keyboard.press('Alt+Meta+ArrowUp');
  // AP-1268 (D-1411): count the collapse and expand writes before the reload, which clears the fake core's call log.
  const sets = (await core.calls()).filter((c) => c.cmd === 'ui_state_set').length;
  assert.ok(sets >= 2, 'collapsing wrote only ui-state.json (ui_state_set)');
  await page.reload();
  await rowsAre(page, VALID_ROWS);
  await sleep(300);
  assert.deepEqual(await core.pinCalls(), [], 'the tour sends no pins_apply');
  assert.deepEqual(await core.writesTo(), [], 'and writes no vault file');
  assert.deepEqual(await core.files(), files0, 'every vault file unchanged, nothing created');
  const ops: [string, () => Promise<void>][] = [
    ['move', async () => { await (await must(rowAt(page, 1), 'Lisabon')).focus(); await page.keyboard.press('Alt+Meta+ArrowDown'); }],
    ['unpin', async () => { await (await must(rowAt(page, 4), 'Projekty')).hover(); await click(section(page).getByRole('button', { name: 'Unpin Projekty', exact: true }), 'Unpin'); }],
    ['pin', async () => { await runCommand(page, 'Go to type: Schůzky'); await runCommand(page, PIN); }],
  ];
  for (const [name, act] of ops) {
    const n = (await core.writesTo()).length;
    await act();
    const w = await eventually(async () => (await core.writesTo()).slice(n), (x) => x.length > 0);
    await sleep(300);
    assert.deepEqual(w.length ? (await core.writesTo()).slice(n) : w, [PINS], `${name}: exactly one file, .tegg/pinned.yml, once`);
  }
  const after = await core.files();
  for (const k of Object.keys(files0)) if (k !== PINS) assert.equal(after[k], files0[k], `${k} untouched`);
});

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-8

test('fr_fmt_12_ac8_pins_are_nfc', async ({ page }) => {
  for (const region of ['cs', 'en-US']) {
    const ctx = await page.context().browser()!.newContext({ timezoneId: 'Europe/Prague' });
    const p = await ctx.newPage();
    const core = await openPinned(p, { pins: 'nfd.yml', route: 'inbox', region });
    assert.deepEqual(await rowsAre(p, VALID_ROWS), VALID_ROWS, `${region}: all five NFD rows resolve`);
    await click(rowAt(p, 1), 'Lisabon');
    await mustBeOn(p, 'Výjezd Lisabon 2026', `${region}: and open`);
    await click(moreBtn(p), 'More');
    assert.ok(await seen(menuItem(moreMenu(p), UNPIN)), `${region}: the NFD path matches as NFC: Unpin shown`);
    assert.equal(await menuItem(moreMenu(p), PIN).count(), 0, `${region}: Pin not offered`);
    await p.keyboard.press('Escape');
    await (await must(rowAt(p, 0), 'Rozpočet')).focus();
    await p.keyboard.press('Alt+Meta+ArrowDown');
    const nfd = pinsFx('nfd.yml').split('\n');
    const want = [...nfd.slice(0, 3), nfd[5], nfd[6], nfd[3], nfd[4], ...nfd.slice(7)].join('\n');
    assert.equal(await eventually(() => pinsText(core), (t) => t === want), want, `${region}: a move keeps every NFD byte`);
    await p.keyboard.press('Meta+Shift+f');
    await p.getByRole('searchbox', { name: 'Search query' }).fill('Čajovna');
    await click(searchRow(p, 'Čajovna'), 'Čajovna');
    await runCommand(p, PIN);
    const t = await eventually(() => pinsText(core), (x) => !!x && x.includes(`${ID('04')}`));
    assert.ok(String(t).endsWith(`    path: ${nfc('Pages/Čajovna.md')}\n`), `${region}: Čajovna's path written NFC`);
    await ctx.close();
  }
});
