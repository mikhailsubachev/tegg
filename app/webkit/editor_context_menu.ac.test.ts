// v0.52 feedback, L5 (WebKit + fake core): the context menu on a text selection. docs/acceptance/editor.md FR-EDT-05
// AC-7 (D-605, AP-527). Interface docs/contracts/ms3-shell.md §16.3 (`EditorPane` handles `contextmenu` on its host and
// nested embed editors; with a non-empty, non-node text selection outside code it calls `preventDefault()` and opens
// `SelectionMenu`, `role=menu`, `aria-label` `Selection`; `Cut`/`Copy` through `document.execCommand`, `Paste` through
// `navigator.clipboard.readText()`), §13.5 (editor labels). Written from the AC and the contracts only (D-61). Every
// lookup goes through `must`/node:assert (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  E, block, caretIn, eventually, fileText, must, mustBeSaved, openEditor, original, selectIn, seen, sleep, titleField,
} from './editor-helpers';
import { M, embedTextbox, needFrame, openEmbeds, main } from './embeds-helpers';

const ITEMS = ['Cut', 'Copy', 'Paste', 'Bold', 'Italic', 'Strikethrough', 'Code', 'Highlight', 'Link…', 'Turn into object'];
const selectionMenu = (page: Page) => page.getByRole('menu', { name: 'Selection', exact: true });

/** Dispatches a right-click `contextmenu` event at the centre of the current DOM selection (or of `at` when there is no
 *  selection) and returns whether the page prevented the system menu. */
async function rightClick(page: Page, at?: Locator): Promise<boolean> {
  const target = at ? await at.first().elementHandle() : null;
  return page.evaluate((el) => {
    const sel = window.getSelection();
    let x = 0, y = 0, node: Element | null = el as Element | null;
    if (sel && sel.rangeCount && !sel.isCollapsed && !el) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      x = r.left + r.width / 2; y = r.top + r.height / 2;
      const a = sel.anchorNode;
      node = a ? (a.nodeType === 3 ? a.parentElement : (a as Element)) : null;
    } else if (node) {
      const r = node.getBoundingClientRect();
      x = r.left + Math.min(10, r.width / 2); y = r.top + r.height / 2;
    } else if (sel && sel.anchorNode) {
      const a = sel.anchorNode;
      node = a.nodeType === 3 ? a.parentElement : (a as Element);
      const r = node!.getBoundingClientRect();
      x = r.left + 2; y = r.top + r.height / 2;
    }
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 2, buttons: 2 });
    (node ?? document.body).dispatchEvent(ev);
    return ev.defaultPrevented;
  }, target);
}
async function menuItems(page: Page): Promise<{ items: string[]; separatorAfter: string | null }> {
  const menu = await must(selectionMenu(page), 'menu "Selection" (D-605)', 1500);
  return menu.evaluate((m) => {
    const kids = [...m.querySelectorAll('[role="menuitem"], [role="separator"], [role="menuitemradio"], [role="menuitemcheckbox"]')] as HTMLElement[];
    const items: string[] = [];
    let separatorAfter: string | null = null;
    for (const k of kids) {
      if (k.getAttribute('role') === 'separator') { separatorAfter = items[items.length - 1] ?? null; continue; }
      items.push((k.getAttribute('aria-label') ?? k.innerText ?? '').split('\n')[0].replace(/\s+/g, ' ').trim());
    }
    return { items, separatorAfter };
  });
}
const selectedText = (page: Page) => page.evaluate(() => (window.getSelection()?.toString() ?? '').normalize('NFC'));

test('fr_edt_05_ac7_right_click_on_a_selection_opens_the_selection_menu', async ({ page }) => {
  await openEditor(page, E.odstavce);
  await selectIn(page, 2, 'Druhý odstavec');
  const prevented = await rightClick(page);
  assert.equal(prevented, true, 'the contextmenu event is prevented (no system menu)');
  const { items, separatorAfter } = await menuItems(page);
  assert.deepEqual(items, ITEMS, 'Cut, Copy, Paste, separator, Bold, Italic, Strikethrough, Code, Highlight, Link…, Turn into object');
  assert.equal(separatorAfter, 'Paste', 'a separator after Paste');
});

test('fr_edt_05_ac7_bold_from_the_menu_wraps_the_selection', async ({ page }) => {
  const core = await openEditor(page, E.odstavce);
  await selectIn(page, 2, 'Druhý odstavec');
  await rightClick(page);
  await (await must(selectionMenu(page).getByRole('menuitem', { name: 'Bold' }), 'menuitem Bold', 1500)).click();
  await sleep(150);
  await mustBeSaved(page);
  const t = await eventually(() => fileText(core, E.odstavce), (x) => !!x?.includes('**Druhý odstavec**'), 2000);
  assert.equal((t ?? '').replace(/^modified: .*$/m, 'modified: <x>'), original(E.odstavce).replace('Druhý odstavec.', '**Druhý odstavec**.').replace(/^modified: .*$/m, 'modified: <x>'), 'Bold wraps the selection in ** as the toolbar does');
});

test('fr_edt_05_ac7_copy_and_link_from_the_menu', async ({ page }) => {
  await openEditor(page, E.odstavce);
  await page.evaluate(() => {
    const w = window as any;
    w.__copied = [];
    window.addEventListener('copy', (e) => { w.__copied.push({ data: (e as ClipboardEvent).clipboardData?.getData('text/plain') ?? '', sel: window.getSelection()?.toString() ?? '' }); });
  });
  await selectIn(page, 2, 'Druhý odstavec');
  await rightClick(page);
  await (await must(selectionMenu(page).getByRole('menuitem', { name: 'Copy' }), 'menuitem Copy', 1500)).click();
  const copied = await eventually(() => page.evaluate(() => (window as any).__copied as { data: string; sel: string }[]), (c) => c.length > 0, 1000);
  assert.ok(copied.some((c) => c.data === 'Druhý odstavec' || (c.data === '' && c.sel === 'Druhý odstavec')), `Copy puts the text on the clipboard (${JSON.stringify(copied)})`);
  await selectIn(page, 2, 'Druhý odstavec');
  await rightClick(page);
  await (await must(selectionMenu(page).getByRole('menuitem', { name: 'Link…' }), 'menuitem Link…', 1500)).click();
  assert.ok(await seen(page.getByRole('combobox', { name: 'Link', exact: true }), 1500), 'Link… opens the link field');
});

test('fr_edt_05_ac7_keyboard_in_the_menu', async ({ page }) => {
  const core = await openEditor(page, E.odstavce);
  await selectIn(page, 2, 'Druhý odstavec');
  await rightClick(page);
  await must(selectionMenu(page), 'menu "Selection"', 1500);
  const focusedItem = () => page.evaluate(() => (document.activeElement?.getAttribute('aria-label') ?? (document.activeElement as HTMLElement | null)?.innerText ?? '').split('\n')[0].trim());
  await page.keyboard.press('ArrowDown');
  const a = await focusedItem();
  await page.keyboard.press('ArrowDown');
  const b = await focusedItem();
  assert.ok(ITEMS.includes(a) && ITEMS.includes(b) && ITEMS.indexOf(b) === ITEMS.indexOf(a) + 1, `↓ moves to the next item (${a} → ${b})`);
  await page.keyboard.press('ArrowUp');
  assert.equal(await focusedItem(), a, '↑ moves back');
  await page.keyboard.press('Escape');
  assert.ok(await eventually(() => selectionMenu(page).count(), (n) => n === 0, 1000) === 0, 'Esc closes the menu');
  assert.equal(await selectedText(page), 'Druhý odstavec', 'and keeps the selection');
  // ⏎ runs the focused item: Bold is reached from the top with ↓ (Cut, Copy, Paste, Bold).
  await rightClick(page);
  await must(selectionMenu(page), 'menu "Selection" again', 1500);
  for (let i = 0; i < 20 && (await focusedItem()) !== 'Bold'; i++) await page.keyboard.press('ArrowDown');
  assert.equal(await focusedItem(), 'Bold', 'Bold is focused');
  await page.keyboard.press('Enter');
  await sleep(150);
  await mustBeSaved(page);
  assert.ok((await fileText(core, E.odstavce))?.includes('**Druhý odstavec**.'), '⏎ runs Bold');
});

test('fr_edt_05_ac7_only_a_text_selection_outside_code_and_fields_gets_the_menu', async ({ page }) => {
  await openEditor(page, E.odstavce);
  // Red guard: a selection gets Tegg's menu.
  await selectIn(page, 2, 'Druhý odstavec');
  assert.equal(await rightClick(page), true, 'guard: a text selection gets the menu');
  await page.keyboard.press('Escape');
  await caretIn(page, 2, 'Druhý');
  assert.equal(await rightClick(page), false, 'without a selection the system menu stays');
  assert.equal(await selectionMenu(page).count(), 0, 'no Selection menu');
  await titleField(page).first().evaluate((e) => {
    (e as HTMLElement).focus();
    const s = window.getSelection()!;
    const r = document.createRange();
    r.selectNodeContents(e);
    s.removeAllRanges();
    s.addRange(r);
    if (e instanceof HTMLInputElement) e.select();
  });
  assert.equal(await rightClick(page, titleField(page)), false, 'in the title field the system menu stays');
  const p2 = await page.context().newPage();
  await openEditor(p2, E.deset);
  const code = block(p2, 7);
  assert.ok(await seen(code.getByText('const x = 1;'), 3000), 'setup: the code block of Deset bloků');
  await code.evaluate((el) => {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = (n as Text).data.indexOf('const');
      if (i >= 0) {
        (el.closest('[contenteditable="true"]') as HTMLElement | null)?.focus();
        const r = document.createRange();
        r.setStart(n, i); r.setEnd(n, i + 5);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(r);
        document.dispatchEvent(new Event('selectionchange'));
        return;
      }
    }
  });
  await sleep(50);
  assert.equal(await rightClick(p2), false, 'inside a code block the system menu stays');
  await p2.close();
});

test('fr_edt_05_ac7_the_menu_acts_on_a_nested_embed_editor', async ({ page }) => {
  const core = await openEmbeds(page, M.upravy);
  const f = await needFrame(main(page), 'Upravitelná', 'the full embed of Upravitelná');
  const inner = await must(embedTextbox(f, 'Upravitelná'), 'the nested editor of Upravitelná');
  await inner.evaluate((el) => {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = (n as Text).data.indexOf('První odstavec');
      if (i >= 0) {
        (el as HTMLElement).focus();
        const r = document.createRange();
        r.setStart(n, i); r.setEnd(n, i + 'První odstavec'.length);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(r);
        document.dispatchEvent(new Event('selectionchange'));
        return;
      }
    }
  });
  await sleep(100);
  assert.equal(await rightClick(page), true, 'a selection in the nested editor gets the menu');
  await (await must(selectionMenu(page).getByRole('menuitem', { name: 'Bold' }), 'menuitem Bold', 1500)).click();
  const t = await eventually(() => fileText(core, M.upravitelna), (x) => !!x?.includes('**První odstavec**'), 3000);
  assert.ok(t?.includes('**První odstavec** k úpravě.'), 'Bold acts on the nested editor: Upravitelná is written');
});
