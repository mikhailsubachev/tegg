// Slice OC, L5: commands and a keyboard-only tour (docs/acceptance/cards.md FR-UX-03 AC-54: R217's commands in the
// palette and FR-UX-03 AC-8 on the new surfaces; AC-55: the tour with no pointer event, each step checked by its effect
// and the bytes, each focused element with app-shell FR-UX-03 AC-13 (b)'s indicator). Through the fake core with the
// cards fixture (docs/contracts/v1-cards.md §8, §11, §13). Written from the ACs and the contract only (D-61).
import type { Page } from '@playwright/test';
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  P, STAV_Q, VYLET_YML, addPopover, addProperty, another, board, cardsVault, eventually, fileWhen, focusName, main, must, nfc, noteRoute, objectCard, paletteOptions, picker,
  pickerSearch, queryRoute, runCommand, settingsRoute, sleep, startCards, typePatches, typeRoute,
} from './cards-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const CONTROL_SELECTOR = 'button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="switch"], [role="option"], input[type="checkbox"], input[type="radio"]';
async function controlsWithoutCommand(page: Page): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = [];
    for (const e of document.querySelectorAll(sel)) {
      const el = e as HTMLElement;
      if (el.getClientRects().length === 0) continue;
      if (el.closest('article[data-object-card]') && (el.matches('a.chip, a[data-card-title]') || el.closest('[data-user-content]'))) continue; // card chips and titles are references
      if (el.closest('[role="listbox"]') && el.getAttribute('role') === 'option') continue; // picker and Add property options
      const cmd = el.getAttribute('data-command');
      if (!cmd || !cmd.trim()) out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}"`);
    }
    return out;
  }, CONTROL_SELECTOR);
}

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-54

test('fr_ux_03_ac54_card_and_icon_commands', async ({ page }) => {
  await startCards(page, { route: settingsRoute('výlet') });
  await must(addProperty(page), 'type-settings/výlet', 8000);
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill('card');
  await sleep(300);
  const opts = (await paletteOptions(page)).map((o) => o.replace(/[⟦⟧]/g, ''));
  for (const t of ['Edit card…', 'Add property to card…', 'Reset card to default']) assert.ok(opts.some((o) => o.startsWith(t)), `${t} in the palette (${opts})`);
  await page.keyboard.press('Escape');
  // FR-UX-03 AC-8 with Add property open, with the picker open, on Výlety podle stavu and on Karty.
  await addProperty(page).click();
  await must(addPopover(page), 'Add property open');
  assert.deepEqual(await controlsWithoutCommand(page), [], 'type-settings/výlet with Add property open: every control is a command');
  await page.keyboard.press('Escape');
  await main(page).getByRole('button', { name: /^⟦?Icon for Kraj⟧?$/ }).click();
  await must(pickerSearch(page), 'the picker open');
  assert.deepEqual(await controlsWithoutCommand(page), [], 'with the picker open');
  for (const r of [queryRoute(STAV_Q), noteRoute(P.karty)]) {
    const x = await another(page, { route: r });
    await must(objectCard(main(x.page), P.snezka), `${r}: Sněžka`, 8000);
    assert.deepEqual(await controlsWithoutCommand(x.page), [], `${r}: every control is a command`);
  }
  const t = await another(page, { route: typeRoute('výlet') });
  await must(main(t.page).getByRole('heading', { level: 1 }), 'type/výlet', 8000);
  await runCommand(t.page, 'Change type icon…');
  await must(picker(t.page, 'Výlet'), 'Change type icon… opens the picker for the type icon');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-55

async function indicator(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    if (!e || e === document.body) return false;
    const cs = getComputedStyle(e);
    return (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) || /\d+px/.test(cs.boxShadow);
  });
}
const focusText = async (page: Page) => (await focusName(page)).name.replace(/[⟦⟧]/g, '');
async function tabTo(page: Page, name: string, max = 80): Promise<boolean> {
  for (let i = 0; i < max; i++) {
    if ((await focusText(page)) === name) return true;
    await page.keyboard.press('Tab');
  }
  return (await focusText(page)) === name;
}

test('fr_ux_03_ac55_cards_keyboard_only', async ({ page }) => {
  let pointer = 0;
  await page.exposeFunction('__pointerSeen', () => { pointer += 1; });
  await page.addInitScript(() => { for (const t of ['pointerdown', 'mousedown', 'click']) window.addEventListener(t, (e) => { if ((e as PointerEvent).pointerType || (e as MouseEvent).detail > 0) (window as any).__pointerSeen(); }, true); });
  const core = await startCards(page, { route: 'inbox' });
  const bad: string[] = [];
  const check = async (what: string) => { if (!(await indicator(page))) bad.push(`${what}: no focus indicator on ${await focusText(page)}`); };
  await runCommand(page, 'Go to type: Výlety');
  await must(main(page).getByRole('heading', { level: 1, name: /Výlety/ }), 'Go to type: Výlety', 5000);
  await runCommand(page, 'Edit card…');
  assert.equal(await eventually(() => focusText(page), (f) => f === 'Add property', 3000), 'Add property', 'Edit card… focuses Add property');
  await check('Add property');
  await page.keyboard.press('Enter');
  await page.keyboard.type('poz');
  await page.keyboard.press('Enter');
  const w1 = await fileWhen(core, VYLET_YML, (t) => !!t?.includes('modified, poznámka]'), 2000);
  assert.ok(w1?.includes('neznámý-klíč, modified, poznámka]'), 'Add Poznámka: one write');
  assert.ok(await tabTo(page, 'Drag to reorder Poznámka'), 'Tab to Drag to reorder Poznámka');
  await check('Drag to reorder Poznámka');
  await page.keyboard.press('Alt+ArrowUp');
  assert.ok((await fileWhen(core, VYLET_YML, (t) => !!t?.includes('poznámka, modified]'), 2000))?.includes('poznámka, modified]'), '⌥↑: one write');
  assert.ok(await tabTo(page, 'Remove Poznámka from the card'), 'Tab to Remove Poznámka from the card');
  await check('Remove Poznámka from the card');
  await page.keyboard.press('Enter');
  assert.ok(!(await fileWhen(core, VYLET_YML, (t) => !t?.includes('poznámka'), 2000))?.includes('poznámka'), 'Remove: one write');
  await runCommand(page, 'Change type icon…');
  await page.keyboard.type('tent');
  await page.keyboard.press('Enter');
  assert.ok((await fileWhen(core, VYLET_YML, (t) => !!t?.includes('icon: tent'), 2000))?.includes('\nicon: tent\n'), 'the type icon: one write');
  assert.ok(await tabTo(page, 'Icon for Kraj', 150), 'Tab to Icon for Kraj in Properties');
  await check('Icon for Kraj');
  await page.keyboard.press('Enter');
  await page.keyboard.type('pin');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  assert.ok(!(await fileWhen(core, VYLET_YML, (t) => !t?.includes('    icon: map-pin\n'), 2000))?.includes('    icon: map-pin\n'), 'Kraj\'s icon: one write');
  await runCommand(page, 'Reset card to default');
  assert.ok(!(await fileWhen(core, VYLET_YML, (t) => !t?.includes('\ncard:'), 2000))?.includes('\ncard:'), 'Reset card to default: one write');
  assert.equal((await typePatches(core)).length, 6, 'six writes in all, one per step');
  assert.deepEqual(bad, [], 'every focused element shows the indicator');
  assert.equal(pointer, 0, 'no pointer event');
  void board; void nfc; void cardsVault;
});
