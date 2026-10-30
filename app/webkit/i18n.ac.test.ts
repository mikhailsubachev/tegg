// MS3 slice 3A, L5 (WebKit + fake core): NFR-OTH-02 AC-3, every visible UI text comes from the catalog
// (pseudo-locale ⟦ ⟧). Written from docs/acceptance/app-shell.md and docs/contracts/ms3-shell.md §3.1 only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { R1, R2 } from '../test/shell-tables';
import {
  absent, gotoTagPage, must, onPage, openNote, panel, paletteDialog, pseudoLocale, seen, shellVaultWithTag, sidebar, sleep, start,
  switcherDialog, settled,
  searchQueryField,
} from './helpers';

/** Visible text outside ⟦ ⟧ that isn't user content, whitespace, digits, punctuation or symbols. */
async function unmarked(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    let all = '';
    const walk = (n: Node) => {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const el = n as HTMLElement;
        if (el.hasAttribute('data-user-content')) { all += ' '; return; }
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
        if (el.getClientRects().length === 0 && el.tagName !== 'BODY') return;
        if (getComputedStyle(el).visibility === 'hidden') return;
      }
      if (n.nodeType === Node.TEXT_NODE) { all += n.textContent; return; }
      for (const c of n.childNodes) walk(c);
    };
    walk(document.body);
    const outside = all.replace(/⟦[^⟦⟧]*⟧/g, ' ');
    return (outside.match(/[\p{L}][\p{L}'’]*/gu) ?? []).filter((w, i, a) => a.indexOf(w) === i);
  });
}

async function go(page: Page, query: string) {
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), `palette (${query})`);
  await page.getByRole('combobox', { name: 'Command query' }).fill(query);
  await settled(page, 'Commands', query);
  await page.keyboard.press('Enter');
  await sleep(150);
}

test('nfr_oth_02_ac3_pseudo_locale_marks_every_visible_ui_text', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page, { prelude: pseudoLocale, placeholders: 3, vault: shellVaultWithTag() }); // AP-685 (D-747): a tag for tag/<key>
  const failures: string[] = [];
  const check = async (what: string) => { const u = await unmarked(page); if (u.length) failures.push(`${what}: ${u.slice(0, 12).join(' ')}`); };
  await must(sidebar(page), 'frame');
  await check('frame with placeholder banner');
  for (const row of R1) {
    if (row.id === 'chooser') { await go(page, 'Open vault'); await check('chooser'); await page.keyboard.press('Escape'); continue; }
    if (row.id === 'type/<type>') { await go(page, 'Go to type Quick Notes'); await check('type page'); continue; }
    if (row.id === 'tag/<key>') { // AP-685 (D-747): tag/účty through Go to Tags and its row
      const name = await gotoTagPage(page).catch(() => { failures.push('tag/<key>: not opened'); return ''; });
      if (name && !(await onPage(page, name, 2000))) failures.push(`tag/<key>: not reached`);
      await check('tag page');
      continue;
    }
    if (row.id === 'note/<path>') { await openNote(page, '2026-10-07 Porada').catch(() => failures.push('note: not opened')); await check('note page'); continue; }
    if (row.id === 'graph/<path>') { // Slice G1 (D-1022): the full view of a note, opened with ⌘⇧G
      await openNote(page, '2026-10-07 Porada').catch(() => failures.push('graph: note not opened'));
      await page.keyboard.press('Meta+Shift+g');
      if (!(await seen(page.locator('main [data-graph-node]').first(), 3000))) failures.push('graph/<path>: not reached');
      await check('graph');
      continue;
    }
    if (row.id === 'new/<type>') { // D-520: New object (⌘N) opens an unsaved draft instead of a dialog
      await page.keyboard.press('Meta+n');
      if (await seen(page.getByRole('textbox', { name: /^⟦?Title⟧?$/ }), 1500)) { await sleep(300); await check('New object draft'); } else failures.push('new/<type>: no draft');
      continue;
    }
    if (row.id === 'type-settings/<type>') {
      await go(page, 'Go to type Quick Notes');
      // D-519: an icon-only button, found by its accessible name (aria-label/title), wrapped in the pseudo-locale.
      await page.getByRole('main').getByRole('button', { name: /^⟦?Type settings⟧?$/ }).first().click().catch(() => failures.push('type-settings: control missing'));
      await check('type settings');
      continue;
    }
    await go(page, row.goto!);
    if (!(await onPage(page, `⟦${row.page}⟧`, 1000)) && !(await onPage(page, row.page, 200))) failures.push(`${row.id}: not reached`);
    await check(row.id);
  }
  await openNote(page, '2026-10-07 Porada').catch(() => {});
  await page.keyboard.press('Meta+Backslash');
  if (await seen(panel(page), 1000)) {
    for (const t of R2) {
      await panel(page).getByRole('tab').filter({ hasText: t.tab }).first().click().catch(() => failures.push(`tab ${t.tab} missing`));
      await check(`panel tab ${t.tab}`);
    }
  } else failures.push('panel did not open');
  await page.keyboard.press('Meta+k'); await check('palette'); await page.keyboard.press('Escape');
  // D-760: the Search page (and its Go to list) replaces the ⌘O switcher.
  await page.keyboard.press('Meta+Shift+f');
  if (await seen(searchQueryField(page), 1000)) await check('search page'); else failures.push('search page missing');
  assert.deepEqual(failures, []);
});

