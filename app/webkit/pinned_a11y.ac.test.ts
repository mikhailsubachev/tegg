// Slice PIN, L5 (WebKit + fake core): keyboard, VoiceOver, themes, strings and the sidebar order:
// docs/acceptance/pinned.md FR-UX-03 AC-39, AC-40, FR-UX-08 AC-16, FR-UX-05 AC-19, NFR-OTH-02 AC-16, FR-NAV-04 AC-9,
// AC-10, AC-11 (R132, R133, R136, R137; AP-1232, AP-1242, AP-1243; D-1430 for AC-11). Interface docs/contracts/v1-pinned.md §3.2…§3.4 (and §7 =
// D-1392 for the Types entry menu name). Written from the ACs and the contract only (D-61). Lookups go through `must`
// (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  ID, P, VALID_ROWS, alertBox, box, click, contextMenu, description, drag, emptyArea, eventually, flat, focusName, gapAfter, header, list, live,
  liveSays, liveText, mainName, menuItem, moreBtn, moreMenu, must, mustBeOn, openPinned, paletteOptions, pinnedVault, pinsFx, pinsText, rowAt,
  rowMenu, rows, rowsAre, runCommand, searchRow, section, seen, sidebar, sleep, typeEntryMenu, typesEntry, ui,
} from './pinned-helpers';
import { pseudoLocale } from './helpers';
import { axeContrast, colourLeaks, tokenColour } from './read-helpers';

test.use({ timezoneId: 'Europe/Prague' });

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-39

test('fr_ux_03_ac39_pin_commands_and_shortcuts', async ({ page }) => {
  await openPinned(page, { pins: 'valid.yml', route: `note/${P.rozpocet}` });
  await rowsAre(page, VALID_ROWS);
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Move');
  await sleep(150);
  const outside = await paletteOptions(page);
  await page.keyboard.press('Escape');
  assert.ok(!outside.some((o) => /^Move (up|down)/.test(o)), 'Move up / down not listed with the focus outside the section');
  await (await must(rowAt(page, 1), 'row Lisabon')).focus();
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Move');
  await sleep(150);
  const inside = await paletteOptions(page);
  assert.ok(inside.some((o) => o.startsWith('Move up') && o.includes('⌥⌘↑')), `Move up ⌥⌘↑ listed from a pinned row (${inside.join(' | ')})`);
  assert.ok(inside.some((o) => o.startsWith('Move down') && o.includes('⌥⌘↓')), 'Move down ⌥⌘↓ listed');
  await page.keyboard.press('Escape');
  // ⇧⌘↑ still moves blocks in the editor, not pins (R4).
  await (await must(page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ }), 'Note body')).click();
  await page.keyboard.press('Alt+Meta+ArrowDown');
  await sleep(200);
  assert.deepEqual(await rows(page).then((r) => r.map((x) => x.label)), VALID_ROWS, '⌥⌘↓ in the editor leaves the pins alone');
  // FR-UX-03 AC-8: every control of the section is keyboard-reachable, expanded, collapsed and empty.
  for (const state of ['expanded', 'collapsed']) {
    const names = new Set<string>();
    await (await must(header(page), 'header')).focus();
    for (let i = 0; i < 14; i++) { names.add((await focusName(page)).name); await page.keyboard.press('Tab'); }
    assert.ok(names.has('Pinned'), `${state}: the header is a Tab stop`);
    if (state === 'expanded') for (const l of VALID_ROWS) assert.ok([...names].some((n) => n.startsWith(l)) && names.has(`Unpin ${l}`), `${state}: ${l} and its Unpin`);
    await click(header(page), 'collapse');
  }
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-40

test('fr_ux_03_ac40_pins_without_the_pointer', async ({ page }) => {
  const core = await openPinned(page, { route: 'inbox' });
  await page.keyboard.press('Meta+Shift+f');
  await page.keyboard.insertText('Čajovna');
  await sleep(500);
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Čajovna', 'opened by keyboard');
  await runCommand(page, 'Pin to sidebar');
  await rowsAre(page, ['Čajovna']);
  await (await must(typesEntry(page, 'Schůzky'), 'Types entry')).focus();
  await page.keyboard.press('Shift+F10');
  await must(typeEntryMenu(page, 'Schůzka'), 'menu `Schůzka actions`');
  await page.keyboard.press('ArrowDown');
  const sel = flat(await page.evaluate(() => document.activeElement?.textContent ?? ''));
  if (sel !== 'Pin to sidebar') await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await rowsAre(page, ['Čajovna', 'Schůzky']);
  await (await must(rowAt(page, 1), 'row Schůzky')).focus();
  await page.keyboard.press('Alt+Meta+ArrowUp');
  await rowsAre(page, ['Schůzky', 'Čajovna']);
  const want = `${pinsFx('expected/created.yml').split('  - id:')[0]}  - type: schůzka\n  - id: ${ID('04')}\n    path: Pages/Čajovna.md\n`;
  assert.equal(await eventually(() => pinsText(core), (t) => t === want), want, 'the file after pin, pin, ⌥⌘↑');
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Schůzky', '⏎ opens the row');
  await (await must(rowAt(page, 1), 'row Čajovna')).focus();
  await page.keyboard.press('Shift+F10');
  await must(rowMenu(page), 'row menu by ⇧F10');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.getAttribute('title')?.split('\n')[0]), 'Čajovna', 'Esc returns the focus to the row');
  await page.keyboard.press('Tab');
  assert.equal((await focusName(page)).name, 'Unpin Čajovna', 'Tab to Unpin');
  await page.keyboard.press('Space');
  await rowsAre(page, ['Schůzky']);
  await (await must(header(page), 'header')).focus();
  await page.keyboard.press('Space');
  assert.equal(await header(page).getAttribute('aria-expanded'), 'false', 'Space collapses');
  await page.keyboard.press('Space');
  assert.equal(await header(page).getAttribute('aria-expanded'), 'true', 'and expands');
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-16

test('fr_ux_08_ac16_pins_for_voiceover', async ({ page }) => {
  const core = await openPinned(page, { pins: { text: `${pinsFx('valid.yml')}  - id: ${ID('08')}\n    path: Pages/Starý plán.md\n` }, route: 'inbox' });
  await rowsAre(page, [...VALID_ROWS, 'Starý plán']);
  await sleep(500);
  assert.equal(await liveText(page), '', 'nothing announced on load');
  const h = header(page);
  // Slice Q (FR-HOM-02 AC-29): valid.yml's query item is a row too (the sixth), so Starý plán is the seventh.
  assert.deepEqual([await h.getAttribute('aria-expanded'), await description(h)], ['true', '7 pinned items'], 'header: expanded, `7 pinned items`');
  assert.equal(await list(page).getByRole('listitem').count(), 7, 'list `Pinned` with 7 items');
  const r = await rows(page);
  assert.deepEqual([r[1].label, r[1].description], ['Výjezd Lisabon 2026', 'Projekt'], '`Výjezd Lisabon 2026, link, Projekt`');
  assert.deepEqual([r[6].label, r[6].description], ['Starý plán', 'Page, In the trash'], '`Starý plán, link, Page, In the trash`');
  assert.equal(await rowAt(page, 1).evaluate((a) => a.tagName), 'A', 'the row is a link');
  assert.equal(await section(page).locator('.pin-grip[aria-hidden="true"]').count(), await section(page).locator('.pin-grip').count(), 'the grip is hidden from the accessibility tree');
  assert.equal(await rowAt(page, 1).evaluate((a) => a.querySelector('.sr-only')?.textContent?.trim() ?? ''), 'Projekt', 'span.sr-only repeats the description');
  await (await must(rowAt(page, 1), 'row')).focus();
  await page.keyboard.press('Alt+Meta+ArrowDown');
  assert.ok(await liveSays(page, 'Moved to position 3 of 7'), 'moved announced (seven rows with the query pin, slice Q)');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  assert.ok(await liveSays(page, 'Unpinned Výjezd Lisabon 2026'), 'unpinned announced');
  await runCommand(page, 'Go to type: Schůzky');
  await runCommand(page, 'Pin to sidebar');
  assert.ok(await liveSays(page, 'Pinned Schůzky'), 'pinned announced');
  const said = await liveText(page);
  await core.setFile('.tegg/pinned.yml', `${String(await pinsText(core))}  - tag: účty\n`);
  await sleep(800);
  assert.equal(await liveText(page), said, 'nothing new on an external reload');
  assert.equal(await live(page).getAttribute('aria-live'), 'polite', 'a polite live region');
  await click(h, 'collapse');
  assert.equal(await h.getAttribute('aria-expanded'), 'false', 'header reads collapsed');
});

// ------------------------------------------------------------------------------------------------ FR-UX-05 AC-19

test('fr_ux_05_ac19_pins_in_both_themes', async ({ page }) => {
  for (const theme of ['light', 'dark'] as const) {
    const ctx = await page.context().browser()!.newContext({ timezoneId: 'Europe/Prague' });
    const p = await ctx.newPage();
    await openPinned(p, { pins: { text: `${pinsFx('valid.yml')}  - id: ${ID('08')}\n    path: Pages/Starý plán.md\n  - path: Pages/Smazaný.md\n` }, route: 'inbox', theme });
    await rowsAre(p, [...VALID_ROWS, 'Starý plán', 'Smazaný']);
    const axe = async (what: string) => {
      assert.deepEqual(await axeContrast(p), [], `${theme}: ${what}: zero color-contrast violations`);
      assert.deepEqual(await colourLeaks(p, theme), [], `${theme}: ${what}: only theme tokens (FR-UX-05 AC-5)`);
    };
    await axe('the section');
    await (await must(rowAt(p, 1), 'row')).hover();
    await axe('a hovered row');
    await p.keyboard.press('Tab');
    await (await must(rowAt(p, 1), 'row')).focus();
    await p.keyboard.press('Tab');
    const outline = await p.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle);
    assert.notEqual(outline, 'none', `${theme}: a focused Unpin has the focus outline (D-594)`);
    await axe('a focused Unpin');
    await drag(p, rowAt(p, 1), await gapAfter(p, 3), { hold: true, what: 'reorder' });
    await axe('a reorder drag');
    await p.keyboard.press('Escape'); await p.mouse.up();
    await click(rowAt(p, 7), 'missing row'); // slice Q: Smazaný is the eighth row, after valid.yml's query item
    await must(alertBox(p), 'alert');
    await axe('the alert');
    await contextMenu(rowAt(p, 0), 'row menu');
    await axe('the row menu');
    await p.keyboard.press('Escape');
    await click(header(p), 'collapse');
    await axe('collapsed');
    const faint = await p.evaluate(() => { const e = document.createElement('span'); e.style.color = 'var(--faint)'; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; });
    const usesFaint = await section(p).evaluate((s, f) => [...s.querySelectorAll('*')].filter((e) => e.children.length === 0 && getComputedStyle(e).color === f && !e.closest('.pin-grip')).map((e) => (e.textContent ?? '').trim()), faint);
    assert.ok(usesFaint.every((t) => /^\d+$/.test(t) || t === ''), `${theme}: --faint only for the count and the grip (${usesFaint.join(', ')})`);
    await ctx.close();
  }
  await openPinned(page, { route: 'inbox', theme: 'dark' });
  await click(header(page), 'open the empty section (D-1429)');
  await must(emptyArea(page), 'empty area');
  assert.deepEqual(await axeContrast(page), [], 'dark: the empty area passes color-contrast');
});

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-16

test('nfr_oth_02_ac16_pins_strings', async ({ page }) => {
  await openPinned(page, { pins: { text: `${pinsFx('valid.yml')}  - path: Pages/Smazaný.md\n` }, route: `note/${P.cajovna}`, prelude: pseudoLocale });
  await eventually(() => rows(page), (r) => r.length === 7); // slice Q: valid.yml's query item is a row (FR-HOM-02 AC-29)
  const wrapped = (s: string) => /^⟦[\s\S]*⟧$/.test(s.trim());
  assert.ok(wrapped(await header(page).getAttribute('aria-label') ?? ''), 'header name in ⟦ ⟧');
  assert.ok(wrapped(await description(header(page))), 'header description in ⟦ ⟧');
  assert.ok(wrapped(await list(page).getAttribute('aria-label') ?? ''), 'list name in ⟦ ⟧');
  const r = await rows(page);
  assert.ok(r.every((x) => !wrapped(x.label)), 'labels aren\'t wrapped (user content)');
  // AP-1271 (D-1414): a row description's type Name comes from the vault's type file (user content, like plurals); its
  // kind and state words are catalog strings and stay wrapped.
  const typeNames = new Set(Object.entries(pinnedVault().files).filter(([k]) => /^\.tegg\/types\/[^/]+\.yml$/.test(k))
    .map(([, v]) => /^name: (.+)$/m.exec(v)?.[1]?.trim()).filter((x): x is string => !!x).map((x) => x.normalize('NFC')));
  const unwrappedParts = (d: string) => d.replace(/⟦[^⟧]*⟧/g, ',').split(',').map((x) => x.trim()).filter(Boolean);
  for (const x of r.filter((y) => y.description)) {
    assert.deepEqual(unwrappedParts(x.description).filter((w) => !typeNames.has(w.normalize('NFC'))), [], `${x.label}: description words outside ⟦ ⟧ are only type names (${x.description})`);
  }
  assert.ok(r.filter((x) => x.state !== 'ok' || x.label.startsWith('#') || x.label === 'Projekty').every((x) => /⟦/.test(x.description)), 'kind and state words wrapped');
  await click(rowAt(page, 6), 'missing row'); // slice Q: Smazaný, after valid.yml's query item
  assert.match(await (await must(alertBox(page), 'alert')).innerText(), /⟦/, 'the alert is wrapped');
  await contextMenu(rowAt(page, 0), 'row menu');
  const items = await page.getByRole('menu').last().getByRole('menuitem').allInnerTexts();
  assert.ok(items.every((t) => wrapped(t.replace(/\s+/g, ' '))), `row menu items wrapped (${items.join(' | ')})`);
  await page.keyboard.press('Escape');
  await click(moreBtn(page), 'More');
  assert.ok(wrapped(flat(await moreMenu(page).getByRole('menuitem').first().innerText())), 'Pin to sidebar wrapped');
});

// ------------------------------------------------------------------------------------------------ FR-NAV-04 AC-9

test('fr_nav_04_ac9_order_with_pinned_section', async ({ page }) => {
  await openPinned(page, { pins: 'valid.yml', route: 'inbox' });
  const sb = sidebar(page);
  const parts = [
    ['New object', sb.getByRole('button', { name: /^New object/ })], ['Search', sb.getByRole('button', { name: 'Search', exact: true })],
    ['Inbox', sb.getByText('Inbox', { exact: true })], ['Today', sb.getByText('Today', { exact: true })], ['Tasks', sb.getByText('Tasks', { exact: true }).first()],
    ['Pinned', header(page)], ['Types', sb.getByRole('list', { name: 'Types', exact: true })], ['Tags', sb.getByRole('link', { name: 'Tags', exact: true })],
    // Slice Q (queries.md FR-NAV-04 AC-12, AP-1304 = D-1447): `Saved queries` became the built `Queries` entry.
    ['Queries', sb.getByRole('link', { name: 'Queries', exact: true })], ['Trash', sb.getByText('Trash', { exact: true })],
  ] as const;
  const ys: number[] = [];
  for (const [name, loc] of parts) { const b = await box(loc); assert.ok(b, `${name} shown`); ys.push(b!.y); }
  assert.ok(Math.abs(ys[0] - ys[1]) <= 1, 'New object and Search share the first row');
  for (let i = 2; i < ys.length; i++) assert.ok(ys[i] > ys[i - 1], `${parts[i][0]} below ${parts[i - 1][0]}`);
  const tbd = sb.locator('a, button, [role="link"], [role="button"]').filter({ hasText: /Pinned/ });
  for (let i = 0; i < await tbd.count(); i++) assert.doesNotMatch(await description(tbd.nth(i)), /Coming in v1\.0/, 'no `Pinned` entry with `Coming in v1.0`');
  assert.doesNotMatch(await description(sb.getByRole('link', { name: 'Queries', exact: true })), /Coming in v1\.0/, 'Queries is built (slice Q), no longer TBD v1.0');
});

// ------------------------------------------------------------------------------------------------ FR-NAV-04 AC-10

test('fr_nav_04_ac10_pinned_route_removed', async ({ page }) => {
  await openPinned(page, { pins: 'valid.yml', route: 'inbox' });
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Go to Pinned');
  await sleep(150);
  assert.ok(!(await paletteOptions(page)).some((o) => o.startsWith('Go to Pinned')), 'no `Go to Pinned`');
  await page.keyboard.press('Escape');
  const names: (string | null)[] = [];
  for (const route of ['pinned', 'no-such-route-pin']) {
    const ctx = await page.context().browser()!.newContext({ timezoneId: 'Europe/Prague' });
    const p = await ctx.newPage();
    await openPinned(p, { pins: 'valid.yml', route });
    await sleep(500);
    names.push(await mainName(p));
    await ctx.close();
  }
  assert.equal(names[0], names[1], `\`pinned\` lands like an unknown route (${names.join(' / ')})`);
});

// ------------------------------------------------------------------------------------------------ FR-NAV-04 AC-11

/** The computed style of the element that holds the sidebar header text `label` (case-insensitive match of the source
 *  text, so an uppercase rendering is still found), with its rendered text (`innerText` applies `text-transform`). */
async function sectionHeader(page: Parameters<typeof sidebar>[0], label: string) {
  return sidebar(page).evaluate((sb, want) => {
    const walk = document.createTreeWalker(sb, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if ((n.textContent ?? '').trim().toLowerCase() !== want.toLowerCase()) continue;
      const el = n.parentElement!;
      if (el.getClientRects().length === 0) continue;
      // Not an entry or a list item (the `Types` list's entries, `Tags`): a section header.
      if (el.closest('li, a, [role="link"], [role="listitem"], [role="menu"]')) continue;
      const s = getComputedStyle(el);
      return { text: el.innerText.trim(), transform: s.textTransform, spacing: s.letterSpacing, size: s.fontSize, weight: s.fontWeight, color: s.color };
    }
    return null;
  }, label);
}

for (const theme of ['light', 'dark'] as const) {
  test(`fr_nav_04_ac11_section_headers_in_sentence_case: ${theme}`, async ({ page }) => {
    await openPinned(page, { pins: 'valid.yml', route: 'inbox', theme });
    assert.equal(await eventually(() => page.evaluate(() => document.documentElement.dataset.theme), (t) => t === theme), theme, `theme ${theme}`);
    const muted = await tokenColour(page, 'muted');
    assert.ok(muted, 'the theme has a --muted token');
    for (const label of ['Pinned', 'Types']) {
      const h = await sectionHeader(page, label);
      assert.ok(h, `${theme}: the sidebar's ${label} section header is shown`);
      assert.deepEqual(
        { text: h!.text, transform: h!.transform, spacing: h!.spacing, size: h!.size, weight: h!.weight, color: h!.color },
        { text: label, transform: 'none', spacing: 'normal', size: '12px', weight: '600', color: muted },
        `${theme}: ${label} reads "${label}" (not ${label.toUpperCase()}), 12 px, 600, --muted, no letter spacing (D-1430)`,
      );
    }
  });
}
