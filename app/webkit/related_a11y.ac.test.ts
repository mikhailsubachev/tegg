// Slice REL, L5 (WebKit + fake core): keyboard, accessibility, themes and strings of the Related tab
// (docs/acceptance/related.md R178, R183): FR-UX-03 AC-48 (the palette's commands, FR-UX-03 AC-8's audit on the tab, the
// empty and the loading state), AC-49 (the keyboard-only tour), FR-UX-08 AC-23 (names, roles, no announcements, no
// motion), FR-UX-05 AC-23 (axe colour-contrast and theme tokens in light and dark) and NFR-OTH-02 AC-20 (the
// pseudo-locale wraps every string but titles and excerpts). Interface docs/contracts/v1-related.md §3.2, §3.3, §3.5.
// Written from the ACs and the contract only (D-61). Every lookup goes through `must`/`seen` and node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  R, ZONE, axeContrast, chipOf, click, colourLeaks, ctxPanel, emptyText, entryAt, eventually, flat, focusIndicator, focusName, goToQuery, hv,
  linkedSwitch, loadingStatus, must, navOpened, nfc, noteRoute, onlyEmpty, openRelated, paletteDialog, paletteOptions, pathsWhen, relList, relPanel, relTab,
  runCommand, sleep, startRelated, tokenRgb,
} from './related-helpers';

test.use({ timezoneId: ZONE, locale: 'en-US' });

const H_SHOWN = [hv(2), hv(1), ...[3, 4, 5, 6, 7, 8, 9, 10].map(hv)];

/** FR-UX-03 AC-8 on the tab: every control carries a registered command or is a Tab stop; excerpts are not controls. */
async function audit(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const panel = [...document.querySelectorAll('[role="tabpanel"]')].find((e) => /Related/.test(e.getAttribute('aria-label') ?? ''));
    const tab = [...document.querySelectorAll('[role="tab"]')].find((e) => /^⟦?Related/.test((e.getAttribute('aria-label') ?? e.textContent ?? '').trim()));
    if (!panel || !tab) return ['no Related tab panel'];
    if (tab.getAttribute('data-command') !== 'panel.related') out.push('the tab has no data-command="panel.related"');
    for (const el of panel.querySelectorAll('a, button, [role="switch"], [role="button"], [role="link"], [tabindex]')) {
      const cmd = el.getAttribute('data-command');
      const tabbable = (el as HTMLElement).tabIndex >= 0;
      if (!cmd && !tabbable) out.push(`${el.tagName} ${el.textContent?.trim().slice(0, 30)}: no command and no Tab stop`);
    }
    for (const p of panel.querySelectorAll('[data-related-excerpt]')) if (p.hasAttribute('tabindex') || p.hasAttribute('data-command')) out.push('an excerpt is a control');
    return out;
  });
}

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-48 (L5)

test('fr_ux_03_ac48_related_commands_palette', async ({ page }) => {
  const core = await startRelated(page, noteRoute(R.rozpocet), { open: false });
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'the palette');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Related:');
  await sleep(300);
  const opts = (await paletteOptions(page)).map(flat);
  assert.ok(opts.some((o) => o.startsWith('Related: Show linked notes')) && !opts.some((o) => o.startsWith('Related: Hide linked notes')), `off: Related: Show linked notes (${opts})`);
  await page.keyboard.press('Escape');
  await runCommand(page, 'Related: Show linked notes');
  assert.equal(await eventually(async () => (await core.uiState())?.related?.showLinked, (v) => v === true), true, 'running it flips the stored choice, with the panel closed');
  assert.equal(await relPanel(page).count(), 0, 'and doesn\'t open the panel');
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Related:');
  await sleep(300);
  assert.ok((await paletteOptions(page)).map(flat).some((o) => o.startsWith('Related: Hide linked notes')), 'on: Related: Hide linked notes');
  await page.keyboard.press('Escape');
  // FR-UX-03 AC-8: on Rozpočet with the tab on Related, the empty state and the loading state.
  const p = await page.context().newPage();
  const c = await openRelated(p, R.rozpocet);
  await pathsWhen(p, [R.den, R.ukol]);
  assert.deepEqual(await audit(p), [], 'Rozpočet: every control has a command or a Tab stop');
  assert.equal(await chipOf(p, R.den).getAttribute('data-command'), 'panel.related.open', 'chips carry panel.related.open');
  assert.equal(await linkedSwitch(p).getAttribute('data-command'), 'related.toggleLinked', 'the switch carries related.toggleLinked');
  await goToQuery(p, 'Svatba');
  await p.keyboard.press('Enter');
  assert.ok(await onlyEmpty(p), 'Svatba: the empty state');
  assert.deepEqual(await audit(p), [], 'the empty state passes the audit');
  await c.relatedDelay(5000);
  await click(linkedSwitch(p), 'the switch');
  await must(loadingStatus(p), 'the loading state', 2000);
  assert.deepEqual(await audit(p), [], 'the loading state passes the audit');
  await p.close();
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-49

test('fr_ux_03_ac49_related_keyboard_only', async ({ page }) => {
  const core = await startRelated(page, noteRoute(R.svatba));
  await page.evaluate(() => {
    const w = window as any;
    w.__pointer = 0;
    for (const t of ['pointerdown', 'mousedown'] as const) addEventListener(t, () => { w.__pointer++; }, true);
  });
  const ring = async (what: string) => assert.ok(await focusIndicator(page), `${what}: a visible focus indicator (app-shell FR-UX-03 AC-13 (b))`);
  // 1. Open Rozpočet from Search.
  await goToQuery(page, 'Rozpočet na offsite');
  await page.keyboard.press('Enter');
  await pathsWhen(page, [R.den, R.ukol]);
  // 2. ⌘K, Show related, ⏎.
  await runCommand(page, 'Show related');
  assert.equal((await eventually(() => focusName(page), (f) => f.name === '2026-09-30')).name, '2026-09-30', 'the focus is on Den 30. 9.\'s chip');
  await ring('Den 30. 9.\'s chip');
  // 3. Tab, ⇧Tab ⇧Tab, ⇧Tab.
  await page.keyboard.press('Tab');
  assert.equal((await focusName(page)).name, nfc('Poslat návrh rozpočtu financím'), 'Tab: Úkol\'s chip (no excerpt in between)');
  await ring('Úkol\'s chip');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  assert.deepEqual(await focusName(page), { role: 'switch', name: 'Show linked notes' }, '⇧Tab ⇧Tab: the switch');
  await ring('the switch');
  await page.keyboard.press('Shift+Tab');
  assert.equal((await focusName(page)).role, 'tab', '⇧Tab: the Related tab');
  assert.ok(/^Related/.test((await focusName(page)).name), 'the Related tab');
  await ring('the Related tab');
  // 4. Tab to the switch; Space turns it on.
  await page.keyboard.press('Tab');
  assert.equal((await focusName(page)).role, 'switch', 'Tab: back to the switch');
  await page.keyboard.press('Space');
  assert.equal(await eventually(() => linkedSwitch(page).getAttribute('aria-checked'), (v) => v === 'true'), 'true', 'Space turns it on');
  // 5. Tab to Den 30. 9.'s chip; ⏎ opens it (hover mode).
  await pathsWhen(page, [R.den, R.ukol]);
  await page.keyboard.press('Tab');
  assert.equal((await focusName(page)).name, '2026-09-30', 'Tab: Den 30. 9.\'s chip');
  const navs = (await navOpened(core)).length;
  await page.keyboard.press('Enter');
  assert.ok((await eventually(async () => (await navOpened(core)).slice(navs).map((a) => String(a?.route ?? a?.path ?? '')), (r) => r.some((x) => x.includes('2026-09-30')))).length >= 1, '⏎ opens Den 30. 9.');
  // 6. ⌘[ returns to Rozpočet.
  await page.keyboard.press('Meta+BracketLeft');
  await pathsWhen(page, [R.den, R.ukol]);
  // 7. ⌘\ closes the panel and returns the focus to the note body.
  await page.keyboard.press('Meta+Backslash');
  assert.equal(await eventually(() => ctxPanel(page).count(), (n) => n === 0), 0, 'the panel is closed');
  assert.ok(await eventually(() => page.evaluate(() => !!document.activeElement?.closest('.ProseMirror')), (x) => x), 'the focus is in the note body');
  assert.equal(await page.evaluate(() => (window as any).__pointer), 0, 'no pointer event');
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-23

test('fr_ux_08_ac23_related_voiceover_and_motion', async ({ page }) => {
  await openRelated(page, R.souhvezdi, { related: { showLinked: true } });
  await pathsWhen(page, H_SHOWN);
  const order = await relPanel(page).evaluate((p) => {
    const sw = p.querySelector('[role="switch"]');
    const list = p.querySelector('[role="list"], ul');
    return sw && list ? !!(sw.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING) : false;
  });
  assert.ok(order, 'the switch Show linked notes, then the list Related notes');
  assert.equal(await relList(page).getByRole('listitem').count(), 10, 'one listitem per entry');
  const read = await entryAt(page, hv(2)).evaluate((li) => [...li.children].map((c) => c.matches('a[data-link-kind="note"]') ? 'chip' : c.hasAttribute('data-related-linked') ? 'linked' : c.matches('p[data-related-excerpt]') ? 'excerpt' : c.tagName));
  assert.deepEqual(read, ['chip', 'linked', 'excerpt'], 'a listitem reads as the chip, then Linked, then the excerpt');
  const live = await relPanel(page).evaluate((p) => [...p.querySelectorAll('[aria-live], [role="status"], [role="alert"]')].map((e) => e.textContent?.trim() ?? ''));
  assert.deepEqual(live, [], 'no live region while the list is shown (updates make no announcement)');
  await click(linkedSwitch(page), 'the switch (off)');
  await sleep(500);
  const p2 = await page.context().newPage();
  await openRelated(p2, R.svatba);
  await must(emptyText(p2), 'No related notes');
  assert.equal(await emptyText(p2).evaluate((e) => !!e.closest('[aria-live], [role="status"], [role="alert"]')), false, 'the empty text is not a live region');
  await p2.close();
  // No motion when entries are added or removed, with and without Reduce motion.
  for (const reducedMotion of ['reduce', 'no-preference'] as const) {
    const p = await page.context().newPage();
    await openRelated(p, R.souhvezdi, { reducedMotion });
    await pathsWhen(p, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(hv));
    await p.evaluate(() => {
      const w = window as any;
      w.__anims = 0;
      const obs = new MutationObserver(() => {
        const panel = [...document.querySelectorAll('[role="tabpanel"]')].find((e) => /Related/.test(e.getAttribute('aria-label') ?? ''));
        if (panel && panel.getAnimations({ subtree: true }).length) w.__anims++;
      });
      obs.observe(document.body, { subtree: true, childList: true });
    });
    await click(linkedSwitch(p), 'the switch (entries added)');
    await pathsWhen(p, H_SHOWN);
    await click(linkedSwitch(p), 'the switch (entries removed)');
    await sleep(500);
    assert.equal(await p.evaluate(() => (window as any).__anims), 0, `${reducedMotion}: adding and removing entries runs no animation`);
    assert.equal(await relPanel(p).evaluate((e) => e.getAnimations({ subtree: true }).length), 0, `${reducedMotion}: getAnimations() empty`);
    await p.close();
  }
});

// ------------------------------------------------------------------------------------------------ FR-UX-05 AC-23

for (const theme of ['light', 'dark'] as const) {
  test(`fr_ux_05_ac23_related_in_light_and_dark_${theme}`, async ({ page }) => {
    const check = async (p: Page, what: string) => {
      await sleep(200);
      assert.deepEqual(await axeContrast(p), [], `${theme}, ${what}: axe color-contrast`);
      assert.deepEqual(await colourLeaks(p, theme), [], `${theme}, ${what}: only theme tokens (FR-UX-05 AC-5)`);
    };
    await openRelated(page, R.rozpocet, { theme });
    await pathsWhen(page, [R.den, R.ukol]);
    await check(page, 'Rozpočet');
    const p = await page.context().newPage();
    await openRelated(p, R.souhvezdi, { theme, related: { showLinked: true } });
    await pathsWhen(p, H_SHOWN);
    const li = entryAt(p, hv(1));
    await li.hover();
    await check(p, 'Souhvězdí with linked shown and an entry hovered');
    assert.equal(await li.evaluate((e) => getComputedStyle(e).backgroundColor), await tokenRgb(p, '--hover'), 'the hovered entry is --hover');
    const text = await p.evaluate(() => {
      const ratio = (a: string, b: string) => {
        const lum = (c: string) => {
          const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
          const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
          return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
        };
        const [x, y] = [lum(a), lum(b)].sort((u, v) => v - u);
        return (x + 0.05) / (y + 0.05);
      };
      const bgOf = (e: Element | null): string => {
        for (let x = e; x; x = x.parentElement) { const b = getComputedStyle(x).backgroundColor; if (b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') return b; }
        return getComputedStyle(document.body).backgroundColor;
      };
      return [...document.querySelectorAll('[data-related-excerpt], [data-related-linked], [role="switch"]')].map((e) => ratio(getComputedStyle(e).color, bgOf(e)));
    });
    assert.ok(text.length > 0 && text.every((r) => r >= 4.5), `excerpts, the Linked mark and the switch text ≥ 4.5:1 (D-129): ${text.map((r) => r.toFixed(2))}`);
    await p.close();
    const s = await page.context().newPage();
    await openRelated(s, R.svatba, { theme });
    await must(emptyText(s), 'No related notes');
    await check(s, 'Svatba');
    await s.close();
    const l = await page.context().newPage();
    const c = await openRelated(l, R.rozpocet, { theme });
    await pathsWhen(l, [R.den, R.ukol]);
    await c.relatedDelay(5000);
    await click(linkedSwitch(l), 'the switch');
    await must(loadingStatus(l), 'Loading…', 2000);
    await check(l, 'the loading state');
    await l.close();
  });
}

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-20 (L5)

test('nfr_oth_02_ac20_related_strings_in_the_catalog', async ({ page }) => {
  const wrapped = (s: string | null) => !!s && /^⟦.*⟧$/s.test(s.trim());
  const core = await openRelated(page, R.souhvezdi, { pseudo: true, related: { showLinked: true } });
  await pathsWhen(page, H_SHOWN);
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    const w = (s: string | null) => !s || /^⟦[\s\S]*⟧$/.test(s.trim());
    const panel = [...document.querySelectorAll('[role="tabpanel"]')].find((e) => /Related/.test(e.getAttribute('aria-label') ?? ''));
    if (!panel) return ['no tab panel'];
    for (const el of [panel, ...panel.querySelectorAll('*')]) {
      if (el.closest('[data-user-content]')) continue;
      for (const a of ['aria-label', 'title', 'aria-description']) {
        const v = el.getAttribute(a);
        if (v && !el.matches('a[data-link-kind="note"]') && !w(v)) out.push(`${el.tagName} ${a}=${v}`);
      }
      for (const n of el.childNodes) if (n.nodeType === 3 && (n.textContent ?? '').trim() && !w(n.textContent)) out.push(`${el.tagName} text ${n.textContent?.trim()}`);
    }
    for (const a of panel.querySelectorAll('a[data-link-kind="note"][aria-description]')) {
      const d = a.getAttribute('aria-description') ?? '';
      if (d.includes('Linked with this note') && !d.includes('⟦Linked with this note⟧')) out.push(`chip description ${d}`);
    }
    return out;
  });
  assert.deepEqual(bad, [], 'every visible text, tooltip and accessible name of the tab panel is inside ⟦ ⟧ (titles and excerpts aside)');
  assert.ok(wrapped(await relTab(page).getAttribute('aria-label') ?? await relTab(page).innerText()), 'the tab name is wrapped');
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill('related');
  await sleep(300);
  const opts = (await paletteOptions(page)).map(flat).filter((o) => /related|Related/.test(o));
  assert.ok(opts.length >= 2 && opts.every((o) => o.startsWith('⟦')), `the two commands are wrapped: ${opts}`);
  await page.keyboard.press('Escape');
  await core.relatedAnswer(R.souhvezdi, 'both', { entries: [], reason: null });
  await core.emit('vault:changed', { paths: [] });
  await must(emptyText(page), '⟦No related notes⟧', 3000);
  assert.ok(wrapped(await emptyText(page).innerText()), 'the empty state is wrapped');
  await core.relatedDelay(5000);
  await click(linkedSwitch(page), 'the switch');
  await must(loadingStatus(page), 'Loading…', 2000);
  assert.ok(wrapped(await loadingStatus(page).innerText()), 'the loading state is wrapped');
});
