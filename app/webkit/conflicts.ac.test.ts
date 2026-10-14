// MS3 slice 3C, L5 (WebKit + fake core): the Conflicts view on the `conflicts` fixture. FR-SYN-04 AC-5…AC-12 (verifying
// FR-SYN-04 AC-3 and the confirmation of AC-4, FR-SYN-05). Written from docs/acceptance/editor.md and
// docs/contracts/ms3-shell.md §13.2, §13.4, §13.5 only (D-61). Resolutions are composed from `note_write` and
// `note_trash` (D-177).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { mustBeOn, nonReadCalls, pseudoLocale, runCommand, sidebar } from './helpers';
import { axeContrast, colourLeaks, ui } from './read-helpers';
import {
  compareRegion, conflictsList, conflictsVault, eventually, must, seen, sleep, type FakeCoreHandle,
} from './editor-helpers';
import { start } from './helpers';

const P = {
  plan: 'Pages/Plán.md',
  planCopy: 'Pages/Plán (conflicted copy 2026-10-07).md',
  rozpocet: 'Pages/Rozpočet.md',
  kopie: 'Pages/Rozpočet kopie.md',
  zapis: 'Pages/Zápis.md',
  zapis1: 'Pages/Zápis (1).md',
  schuzka2: 'Pages/Schůzka (2).md',
  odkazuje: 'Pages/Odkazuje.md',
};
const PLAN_ID = '01JB0K0000000000000000K001';

async function openConflicts(page: Page, o: Parameters<typeof start>[1] = {}): Promise<FakeCoreHandle> {
  const core = await start(page, { vault: conflictsVault(), last: { path: P.odkazuje, id: '01JB0K0000000000000000K007' }, ...o });
  await mustBeOn(page, 'Odkazuje', 'landing', 5000);
  await runCommand(page, 'Go to Conflicts');
  await mustBeOn(page, 'Conflicts', 'Go to Conflicts');
  await must(conflictsList(page), 'list "Conflicts"');
  return core;
}
const rows = (page: Page) => conflictsList(page).getByRole('link');
async function rowFor(page: Page, path: string) {
  return must(rows(page).filter({ hasText: path.slice('Pages/'.length, -3) }).first(), `row for ${path}`);
}
async function resolve(page: Page, target: string): Promise<string | null> {
  const r = await page.evaluate(async ([from, t]) => (window as any).__TAURI_INTERNALS__.invoke('link_resolve', { from, targets: [t] }), [P.odkazuje, target] as const);
  return r[0]?.path ?? null;
}
const sidebarEntry = (page: Page) => sidebar(page).locator('[data-command="goto.conflicts"]');

test('fr_syn_04_ac5_the_conflicts_route', async ({ page }) => {
  const core = await openConflicts(page);
  const texts = (await rows(page).allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
  assert.equal(texts.length, 3, `three rows: ${texts.join(' | ')}`);
  assert.equal(texts.filter((t) => t.includes('Same id')).length, 2, 'two Same id rows');
  assert.equal(texts.filter((t) => t.includes('Possible copy')).length, 1, 'one Possible copy row');
  assert.ok(texts.some((t) => t.includes('Plán.md') && t.includes('Plán (conflicted copy 2026-10-07).md')), 'Plán + its Dropbox copy');
  assert.ok(texts.some((t) => t.includes('Rozpočet.md') && t.includes('Rozpočet kopie.md')), 'Rozpočet + kopie');
  assert.ok(texts.some((t) => t.includes('Zápis.md') && t.includes('Zápis (1).md')), 'Zápis + Zápis (1)');
  assert.ok(!texts.some((t) => t.includes('Schůzka (2)')), 'Schůzka (2) is not a conflict');
  assert.deepEqual(await nonReadCalls(core), [], 'opening it writes nothing');
  await core.setConflicts([]);
  await core.emit('vault:changed', { paths: [P.plan] });
  await eventually(() => rows(page).count(), (n) => n === 0, 2000);
  assert.equal(await rows(page).count(), 0, 'no rows');
  const main = await page.getByRole('main').first().innerText();
  assert.ok(main.replace('Conflicts', '').trim().length > 0, 'an empty state is shown');
});

test('fr_syn_04_ac6_sidebar_entry_with_count', async ({ page }) => {
  const core = await start(page, { vault: conflictsVault(), last: { path: P.odkazuje, id: null } });
  const entry = await must(sidebarEntry(page), 'sidebar entry Conflicts (data-command="goto.conflicts")');
  assert.match(await entry.innerText(), /Conflicts\s*3/, 'with the count');
  const isLink = await entry.evaluate((e) => e.getAttribute('role') === 'link' || (e.tagName === 'A' && e.hasAttribute('href')) || e.getAttribute('role') === null && e.tagName === 'A');
  assert.ok(isLink, 'the entry is a link');
  const one = (await page.evaluate(async () => (window as any).__TAURI_INTERNALS__.invoke('index_conflicts'))).slice(0, 1);
  await core.setConflicts(one);
  await core.emit('vault:changed', { paths: [P.plan] });
  const t = await eventually(async () => ((await seen(sidebarEntry(page), 100)) ? await sidebarEntry(page).first().innerText() : ''), (x) => /Conflicts\s*1\b/.test(x), 2000);
  assert.match(t, /Conflicts\s*1\b/, 'updated within 2 s');
  await core.setConflicts([]);
  await core.emit('vault:changed', { paths: [P.plan] });
  const gone = await eventually(() => sidebarEntry(page).count(), (n) => n === 0, 2000);
  assert.equal(gone, 0, 'absent with no conflicts');
});

test('fr_syn_04_ac7_compare_marks_exactly_the_changed_lines', async ({ page }) => {
  await openConflicts(page);
  await (await rowFor(page, P.planCopy)).click();
  const r = await must(compareRegion(page), 'region "Compare versions"');
  const txt = await r.innerText();
  assert.ok(txt.indexOf('Pages/Plán.md') >= 0 && txt.indexOf('Pages/Plán.md') < txt.indexOf('conflicted copy'), 'the file links resolve to is on the left');
  const changed = (await r.locator('[data-diff="changed"]').allInnerTexts()).map((x) => x.trim());
  const expected = ['modified: 2026-10-06T18:00:00+02:00', 'Řádek 3 plánu.', 'Řádek 8 plánu.', 'modified: 2026-10-07T08:15:00+02:00', 'Řádek 3 změněný na druhém Macu.', 'Řádek 8 změněný na druhém Macu.'];
  assert.deepEqual([...changed].sort(), [...expected].sort(), 'exactly body lines 3 and 8 and modified are marked on both sides');
  assert.equal(await r.locator('[contenteditable="true"], textarea').count(), 0, 'read-only');
  for (const b of ['Keep left', 'Keep right', 'Merge…']) await must(page.getByRole('button', { name: b, exact: true }), b);
});

test('fr_syn_04_ac8_keep_left_trashes_the_copy_links_intact', async ({ page }) => {
  const core = await openConflicts(page);
  await (await rowFor(page, P.planCopy)).click();
  await page.getByRole('button', { name: 'Keep left', exact: true }).click();
  const confirm = await must(page.getByRole('dialog').filter({ hasText: 'conflicted copy' }), 'confirmation naming the file that goes to the trash');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await sleep(300);
  assert.deepEqual(await nonReadCalls(core), [], 'cancel writes nothing');
  await page.getByRole('button', { name: 'Keep left', exact: true }).click();
  const c2 = await must(page.getByRole('dialog').filter({ hasText: 'conflicted copy' }), 'confirmation');
  await c2.getByRole('button').filter({ hasNotText: 'Cancel' }).first().click();
  await sleep(500);
  const files = await core.files();
  assert.equal(files[P.planCopy], undefined, 'copy gone from Pages/');
  assert.ok(files['.trash/Pages/Plán (conflicted copy 2026-10-07).md'] !== undefined, 'copy in .trash/Pages/');
  assert.deepEqual((await nonReadCalls(core)), ['note_trash'], 'nothing else written');
  assert.equal(await resolve(page, 'Plán'), P.plan, '[[Plán]] resolves to Pages/Plán.md');
  assert.equal(/^id: (\S+)/m.exec(files[P.plan])?.[1], PLAN_ID, 'with its id');
  assert.equal(await eventually(() => rows(page).count(), (n) => n === 2, 2000), 2, 'the row disappears');
  assert.match(await sidebarEntry(page).first().innerText(), /Conflicts\s*2/, 'the count drops');
});

test('fr_syn_04_ac8_keep_right_writes_copy_bytes_into_primary', async ({ page }) => {
  const core = await openConflicts(page);
  const v = conflictsVault().files;
  const base = await core.version(P.plan);
  await (await rowFor(page, P.planCopy)).click();
  await page.getByRole('button', { name: 'Keep right', exact: true }).click();
  const c = await must(page.getByRole('dialog').filter({ hasText: 'conflicted copy' }), 'confirmation');
  await c.getByRole('button').filter({ hasNotText: 'Cancel' }).first().click();
  await sleep(500);
  const files = await core.files();
  assert.equal(files[P.plan], v[P.planCopy], 'the copy\'s bytes in Pages/Plán.md');
  const w = (await core.calls()).find((x) => x.cmd === 'note_write');
  assert.deepEqual((w?.args as any)?.base, base, 'base = its version');
  assert.ok(files['.trash/Pages/Plán (conflicted copy 2026-10-07).md'] !== undefined, 'copy trashed');
  assert.deepEqual(await nonReadCalls(core), ['note_write', 'note_trash'], 'write then trash');
  assert.equal(await resolve(page, 'Plán'), P.plan, '[[Plán]] still resolves');
  assert.equal(/^id: (\S+)/m.exec(files[P.plan])?.[1], PLAN_ID, 'same id');
});

test('fr_syn_04_ac9_manual_merge', async ({ page }) => {
  const core = await openConflicts(page);
  await (await rowFor(page, P.planCopy)).click();
  await page.getByRole('button', { name: 'Merge…', exact: true }).click();
  const draft = await must(page.getByRole('textbox').filter({ hasText: 'Řádek 3 plánu.' }), 'editable draft of the left version');
  await draft.click();
  await page.keyboard.press('Meta+End');
  await page.keyboard.type('\nSloučeno.');
  await sleep(1500);
  assert.deepEqual(await nonReadCalls(core), [], 'nothing written until Done');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await sleep(500);
  const files = await core.files();
  assert.ok(files[P.plan].includes('Sloučeno.'), 'draft written into the left file');
  assert.equal(files[P.planCopy], undefined, 'right file trashed');
  assert.deepEqual(await nonReadCalls(core), ['note_write', 'note_trash'], 'base-checked write, then trash');
});

test('fr_syn_04_ac9_merge_cancel_writes_nothing', async ({ page }) => {
  const core = await openConflicts(page);
  await (await rowFor(page, P.planCopy)).click();
  await page.getByRole('button', { name: 'Merge…', exact: true }).click();
  await must(page.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await sleep(500);
  assert.deepEqual(await nonReadCalls(core), [], 'Cancel writes nothing');
});

test('fr_syn_04_ac10_give_the_copy_a_new_id', async ({ page }) => {
  const core = await openConflicts(page);
  const before = conflictsVault().files[P.kopie];
  await (await rowFor(page, P.kopie)).click();
  await (await must(page.getByRole('button', { name: 'Give the copy a new id', exact: true }), 'Give the copy a new id')).click();
  const c = await must(page.getByRole('dialog'), 'confirmation');
  await c.getByRole('button').filter({ hasNotText: 'Cancel' }).first().click();
  await sleep(500);
  assert.deepEqual(await core.writesTo(), [P.kopie], 'only Pages/Rozpočet kopie.md is written');
  const after = (await core.files())[P.kopie];
  const newId = /^id: (\S+)$/m.exec(after)?.[1] ?? '';
  assert.match(newId, /^[0-9A-HJKMNP-TV-Z]{26}$/, 'a new ULID');
  assert.equal(after.replace(/^id: .*$/m, 'id: X'), before.replace(/^id: .*$/m, 'id: X'), 'only the id line changes');
  assert.equal(await resolve(page, 'Rozpočet'), P.rozpocet, '[[Rozpočet]] → Rozpočet.md');
  assert.equal(await resolve(page, 'Rozpočet kopie'), P.kopie, '[[Rozpočet kopie]] → kopie');
  assert.equal(await eventually(() => rows(page).count(), (n) => n === 2, 2000), 2, 'the row disappears');
});

test('fr_syn_04_ac11_stale_versions_never_win', async ({ page }) => {
  const core = await openConflicts(page);
  await (await rowFor(page, P.planCopy)).click();
  const r = await must(compareRegion(page), 'compare');
  const changedCopy = conflictsVault().files[P.planCopy].replace('Řádek 9 plánu.', 'Řádek 9 změněný mezitím.');
  await core.setFile(P.planCopy, changedCopy);
  await eventually(async () => (await r.innerText()).includes('změněný mezitím'), (v) => v, 2000);
  assert.ok((await r.innerText()).includes('změněný mezitím'), 'the compare view reloads');
  const v = await core.version(P.planCopy);
  await page.getByRole('button', { name: 'Keep left', exact: true }).click();
  const c = await must(page.getByRole('dialog').filter({ hasText: 'conflicted copy' }), 'confirmation');
  await c.getByRole('button').filter({ hasNotText: 'Cancel' }).first().click();
  await sleep(500);
  const tr = (await core.calls()).find((x) => x.cmd === 'note_trash');
  assert.deepEqual((tr?.args as any)?.base, v, 'Keep uses the new version');
  assert.equal(tr?.ok, true, 'no Conflict');
});

test('fr_syn_04_ac12_unicode_form_pairs', async ({ page }) => {
  const core = await start(page, { vault: conflictsVault(), last: { path: P.odkazuje, id: null } });
  await core.setConflicts([{ kind: 'nameNormalization', primary: P.zapis, others: ['Pages/Zápis.md'], versions: {} }]);
  await core.emit('vault:changed', { paths: [P.zapis] });
  await runCommand(page, 'Go to Conflicts');
  await mustBeOn(page, 'Conflicts', 'route');
  const row = await must(rows(page).filter({ hasText: 'Names differ only in Unicode form' }), 'row with the kind');
  await row.click();
  for (const b of ['Keep left', 'Keep right']) await must(page.getByRole('button', { name: b, exact: true }), b);
  assert.ok(await seen(compareRegion(page)), 'Compare as in AC-7');
});

test('nfr_oth_02_ac6_pseudo_locale_conflicts_view', async ({ page }) => {
  await start(page, { vault: conflictsVault(), last: { path: P.odkazuje, id: null }, prelude: pseudoLocale });
  await runCommand(page, 'Conflicts'); // titles are wrapped in ⟦ ⟧; the palette still matches the inner text
  await must(page.getByRole('main').getByRole('list').getByRole('link').first(), 'Conflicts rows (pseudo-locale)');
  const main = await must(page.getByRole('main'), 'main');
  const words = await main.evaluate((root) => {
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
  assert.deepEqual(words, [], 'all chrome text of the Conflicts view is in ⟦ ⟧ (paths are user content)');
});

for (const th of ['light', 'dark'] as const) {
  test(`fr_ux_05_ac8_conflicts_view_with_compare_in_${th}`, async ({ page }) => {
    await openConflicts(page, { uiState: ui(th) });
    await (await rowFor(page, P.planCopy)).click();
    await must(compareRegion(page), 'compare open');
    assert.deepEqual(await axeContrast(page), [], 'contrast');
    assert.deepEqual(await colourLeaks(page, th), [], 'only theme tokens');
  });
}
