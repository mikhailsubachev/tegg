// New objects from `/` and `+`, L5 (WebKit + fake core): writes, keyboard, themes and strings
// (docs/acceptance/new-object-menu.md R236…R238; contract docs/contracts/new-object-menu.md §4). FR-SYN-06 AC-59 (L5:
// browsing the menu and the dialog and a failed create write nothing; a create writes exactly the new object, then the
// host), FR-UX-03 AC-61 (keyboard only: N8, then `/new` ↓ ↓ Tab … Space; `data-command` on the dialog's buttons; Esc
// returns the caret), FR-UX-05 AC-30 (axe and tokens in both themes), NFR-OTH-02 AC-28 (L5: the pseudo-locale). The
// tasks fixture with the conversion notes, clock 2026-10-14T12:00 Europe/Prague, region cs. Written from the ACs and the
// contract only (D-61); every missing element fails an assertion (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { pseudoLocale } from './helpers';
import { axeContrast, colourLeaks } from './read-helpers';
import { addBelow, alertWith, callsOf, openConvert, saved } from './convert-helpers';
import {
  BLOKY, caretAfter, convertVault, created, dialogCancel, dialogCreate, dialogTitle, fileExists, must, needDialog, needMenu, newDialog, nfc, optionNames, original,
  seen, selectedName, sleep, slashMenu, swap,
} from './new-object-helpers';
import { caretInfo } from './mindmap-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const B0 = original(BLOKY);
const noMod = (t: string | undefined) => (t ?? '').replace(/^modified: .*$/m, 'modified: <x>');
const line1 = (typed: string) => swap(B0, 'Úvodní odstavec.\n', `Úvodní odstavec.${typed}\n`);
async function emptyParagraph(page: Page) {
  await caretAfter(page, 'Úvodní odstavec.');
  await (await must(addBelow(page).or(page.getByRole('button', { name: '⟦Add block below⟧', exact: true })), 'button "Add block below"')).click();
  await sleep(100);
}
async function axeAll(page: Page, scope: Locator): Promise<string[]> {
  await axeContrast(page); // loads axe into the page
  const el = await scope.first().elementHandle();
  return page.evaluate(async (node) => {
    const r = await (window as any).axe.run(node ?? document);
    return r.violations.flatMap((v: any) => v.nodes.map((n: any) => `${v.id} ${n.target.join(' ')}`));
  }, el);
}
function lum(rgb: string): number {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(rgb);
  assert.ok(m, `a colour: ${rgb}`);
  const c = [m![1], m![2], m![3]].map((v) => { const s = Number(v) / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-59 (L5)

test('fr_syn_06_ac59_browsing_the_menu_and_the_dialog_writes_nothing', async ({ page }) => {
  const core = await openConvert(page, BLOKY);
  await emptyParagraph(page);
  for (const trigger of ['/', '+']) {
    await page.keyboard.type(trigger);
    await needMenu(page, trigger);
    await page.keyboard.type('ne');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');
  }
  await page.keyboard.type('+');
  await needMenu(page, '+');
  await page.keyboard.press('Backspace');
  for (const close of ['Cancel', 'outside', 'Escape'] as const) {
    await page.keyboard.type('+pro');
    await needMenu(page, '+pro');
    await page.keyboard.press('Enter');
    const d = await needDialog(page, 'Projekt', `+pro ⏎ (${close})`);
    await page.keyboard.insertText('Spuštění webu');
    if (close === 'Cancel') await (await must(dialogCancel(d), 'Cancel')).click();
    else if (close === 'outside') await page.mouse.click(1300, 860);
    else await page.keyboard.press('Escape');
    assert.equal(await seen(newDialog(page, 'Projekt'), 300), false, `${close} closes the dialog`);
    await emptyParagraph(page);
  }
  await core.writeControl({ fail: 'Io', path: 'Pages/Nový plán.md' });
  await page.keyboard.type('+pa');
  await needMenu(page, '+pa');
  await page.keyboard.press('Enter');
  await needDialog(page, 'Page', '+pa ⏎');
  await page.keyboard.insertText('Nový plán');
  await page.keyboard.press('Enter');
  await must(alertWith(page, 'Couldn’t create "Nový plán". Nothing was changed.'), 'the failure alert');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');
  await core.writeControl({ fail: null, path: null });
  await sleep(1500);
  assert.deepEqual((await callsOf(core, 'note_create')).filter((c) => c.ok !== false).length, 0, 'zero note_create (the failed one created nothing)');
  assert.deepEqual(await created(core), [], 'nothing created');
  const hostWrites = (await callsOf(core, 'note_write')).map((c) => String((c.args as { text?: string }).text ?? ''));
  assert.ok(hostWrites.every((t) => !/\+pro|\[\[/.test(t)), `no write holds a trigger or a link: ${JSON.stringify(hostWrites.map((t) => t.slice(0, 80)))}`);
});

test('fr_syn_06_ac59_a_create_writes_the_object_then_the_host', async ({ page }) => {
  const core = await openConvert(page, BLOKY);
  await caretAfter(page, 'Úvodní odstavec.');
  await page.keyboard.type(' +pa');
  await needMenu(page, ' +pa');
  await page.keyboard.press('Enter');
  await needDialog(page, 'Page', '⏎');
  await page.keyboard.insertText('Nový plán');
  await page.keyboard.press('Enter');
  await saved(page, core, BLOKY, (x) => !!x?.includes('[[Nový plán]]'), 3000);
  await sleep(1300);
  assert.deepEqual((await core.writesTo()).map(nfc), ['Pages/Nový plán.md', BLOKY], 'exactly two files: the new object (create-exclusive, first), then the host');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-61

test('fr_ux_03_ac61_keyboard_only', async ({ page }) => {
  const core = await openConvert(page, BLOKY);
  await page.evaluate(() => {
    (window as any).__pointer = 0;
    for (const t of ['pointerdown', 'mousedown', 'click', 'dblclick']) window.addEventListener(t, (e) => { if ((e as MouseEvent).isTrusted) (window as any).__pointer++; }, true);
  });
  await caretAfter(page, 'Úvodní');
  await page.keyboard.press('End');
  await page.keyboard.type(' +pro');
  await needMenu(page, ' +pro');
  await page.keyboard.press('Enter');
  const d = await needDialog(page, 'Projekt', '⏎');
  const registered = await page.evaluate(() => ((window as any).__TEGG_TEST__?.commands?.() ?? []) as string[]);
  const carried = await d.getByRole('button').evaluateAll((bs) => bs.map((b) => [b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '', b.getAttribute('data-command')]));
  assert.deepEqual(carried.filter(([, c]) => !c || !registered.includes(c)), [], `every dialog button carries a registered command (app-shell FR-UX-03 AC-8): ${JSON.stringify(carried)}`);
  assert.deepEqual(carried.filter(([n]) => /^(Create|Cancel)$/.test(n!)).map(([, c]) => c).sort(), ['newObject.cancel', 'newObject.create'], 'Create and Cancel carry newObject.create / newObject.cancel (R238)');
  await page.keyboard.type('Spuštění webu');
  await page.keyboard.press('Enter');
  const n8 = line1(' [[Spuštění webu]]');
  assert.equal(noMod(await saved(page, core, BLOKY, (x) => noMod(x) === noMod(n8), 3000)), noMod(n8), 'N8 by keyboard');
  await page.keyboard.type(' /new');
  const { menu } = await needMenu(page, ' /new');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.equal(await selectedName(menu), 'New Quick Note', '↓ ↓ to New Quick Note');
  await page.keyboard.press('Tab');
  await needDialog(page, 'Quick Note', 'Tab chooses (FR-EDT-03 AC-3)');
  await page.keyboard.type('Nápad');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const f = await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '').trim());
  assert.equal(f, 'Create', 'Tab, Tab: Create (Title → Cancel → Create)');
  await page.keyboard.press(' ');
  assert.ok((await fileExists(core, 'Quick Notes/Nápad.md')) !== undefined, 'Space creates Quick Notes/Nápad.md');
  const both = line1(' [[Spuštění webu]] [[Nápad]]');
  assert.equal(noMod(await saved(page, core, BLOKY, (x) => noMod(x) === noMod(both), 3000)), noMod(both), 'and inserts [[Nápad]]');
  await page.keyboard.type(' +pa');
  await needMenu(page, ' +pa');
  await page.keyboard.press('Enter');
  await needDialog(page, 'Page', '⏎');
  await page.keyboard.press('Escape');
  const c = await caretInfo(page);
  assert.deepEqual([c.inBody, c.atEnd, c.text.endsWith('Nápad ')], [true, true, true], `Esc in the dialog returns the caret to where the trigger was: ${JSON.stringify(c)}`);
  assert.equal(await page.evaluate(() => (window as any).__pointer), 0, 'no pointer events');
});

// ------------------------------------------------------------------------------------------------ FR-UX-05 AC-30

for (const theme of ['light', 'dark'] as const) {
  test(`fr_ux_05_ac30_the_menu_and_the_dialog_${theme}`, async ({ page }) => {
    await openConvert(page, BLOKY, { theme });
    const bad: string[] = [];
    const check = async (what: string, scope: Locator) => {
      for (const v of await axeAll(page, scope)) bad.push(`${what}: ${v}`);
      for (const v of await colourLeaks(page, theme)) bad.push(`${what}: leak ${v}`);
    };
    await emptyParagraph(page);
    for (const trigger of ['/', '+', '+pro']) {
      await page.keyboard.type(trigger);
      const { menu } = await needMenu(page, trigger);
      await check(`menu ${trigger}`, menu);
      const sel = await menu.first().getByRole('option', { selected: true }).first().evaluate((o) => {
        const s = getComputedStyle(o);
        let bg = s.backgroundColor;
        for (let e: Element | null = o; e && /rgba\(0, 0, 0, 0\)|transparent/.test(bg); e = e.parentElement) bg = getComputedStyle(e).backgroundColor;
        return { color: s.color, bg };
      }).catch(() => null);
      if (!sel) bad.push(`menu ${trigger}: no selected row`);
      else if (contrast(sel.color, sel.bg) < 4.5) bad.push(`menu ${trigger}: the selected row's text ${sel.color} on ${sel.bg} < 4.5:1`);
      if (trigger === '+pro') {
        await page.keyboard.press('Enter');
        const d = await needDialog(page, 'Projekt', '+pro ⏎');
        await check('dialog (empty)', d);
        await page.keyboard.insertText('Spuštění webu');
        await check('dialog (with a title)', d);
        await page.keyboard.press('Escape');
      } else {
        await page.keyboard.press('Escape');
        for (let i = 0; i < trigger.length; i++) await page.keyboard.press('Backspace');
      }
    }
    assert.deepEqual(bad, [], `${theme}: axe (colour contrast included) and tokens only`);
  });
}

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-28 (L5)

test('nfr_oth_02_ac28_pseudo_locale_wraps_the_menu_the_dialog_and_the_alert', async ({ page }) => {
  const core = await openConvert(page, BLOKY, { prelude: pseudoLocale, vault: convertVault() });
  await emptyParagraph(page);
  await page.keyboard.type('+');
  const menu = await must(slashMenu(page), 'the listbox ⟦Insert block⟧');
  assert.equal(await menu.getAttribute('aria-label'), '⟦Insert block⟧', 'the listbox name is wrapped');
  const names = await optionNames(menu);
  assert.ok(names.length === 23, `23 options: ${names.join(' | ')}`);
  assert.deepEqual(names.filter((n) => !/^⟦.*⟧$/s.test(n)), [], 'every option is wrapped; New rows are `⟦New <type>⟧` with the type name as user content');
  const headers = await menu.first().evaluate((m) => [...m.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-label') ?? ''));
  assert.deepEqual(headers.filter((h) => !/^⟦.*⟧$/s.test(h)), [], `the group headers are wrapped: ${headers.join(' | ')}`);
  assert.ok(headers.length === 5, 'five headers');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('+pa');
  await needMenu(page, '+pa');
  await page.keyboard.press('Enter');
  const d = await needDialog(page, 'Page', '+pa ⏎');
  assert.equal(await d.getAttribute('aria-label'), '⟦New Page⟧', 'the dialog name');
  await must(dialogTitle(d), 'textbox ⟦Title⟧');
  await must(dialogCancel(d), 'button ⟦Cancel⟧');
  const create = await must(dialogCreate(d), 'button ⟦Create⟧');
  assert.equal(await create.getAttribute('aria-label') ?? (await create.innerText()).trim(), '⟦Create⟧', 'Create wrapped');
  await page.keyboard.insertText('Nový plán');
  const hint = (await d.innerText()).split('\n').map((s) => s.trim()).find((s) => s.includes('Pages/Nový plán.md')) ?? '';
  assert.match(hint, /^⟦Creates Pages\/Nový plán\.md and links it here\.⟧$/, 'the hint is wrapped; the path is user content');
  await core.writeControl({ fail: 'Io', path: 'Pages/Nový plán.md' });
  await page.keyboard.press('Enter');
  const alert = await must(page.getByRole('alert').filter({ hasText: 'Nový plán' }), 'the failure alert');
  assert.match((await alert.innerText()).trim(), /^⟦Couldn’t create "Nový plán"\. Nothing was changed\.⟧$/, 'the alert is wrapped');
});
