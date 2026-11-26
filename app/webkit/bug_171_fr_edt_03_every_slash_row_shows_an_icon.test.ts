// Bug #171 (owner, 0.8.0 feedback, 2026-11-26): in the `/` menu only H1–H3 and the New rows showed an icon; board
// `ObjectMenu` draws one on every row (D-2677). FR-EDT-03 AC-19 (docs/acceptance/new-object-menu.md): every static
// row shows one aria-hidden icon before its label, `data-icon` naming it, Mindmap's in the teal type colour.
import { test, type Locator } from '@playwright/test';
import assert from 'node:assert/strict';
import { addBelow, openConvert } from './convert-helpers';
import { BLOKY, caretAfter, must, needMenu, optionNames, sleep } from './new-object-helpers';

test.use({ timezoneId: 'Europe/Prague' });

/** R234 rows and the icon each shows (D-2677); the heading rows keep their `H1`…`H3` text. */
const ICONS: [string, string][] = [
  ['Text', 'text'], ['Bulleted list', 'bullet-list'], ['Numbered list', 'ordered-list'], ['Checklist', 'checklist'], ['Mindmap', 'mindmap'],
  ['Quote', 'quote'], ['Callout', 'callout'], ['Code block', 'code-block'], ['Divider', 'divider'], ['Table', 'table'],
  ['Turn into object…', 'turn-into-object'], ['Embed object', 'embed-object'], ['Image', 'image'], ['PDF', 'pdf'], ['Query', 'query'],
  ['Block embed', 'block-embed'],
];

async function option(menu: Locator, label: string): Promise<Locator> {
  const names = await optionNames(menu);
  const i = names.indexOf(label);
  assert.ok(i >= 0, `option "${label}" (${names.join(', ')})`);
  return menu.getByRole('option').nth(i);
}

test('bug_171_fr_edt_03_every_slash_row_shows_an_icon', async ({ page }) => {
  await openConvert(page, BLOKY);
  await caretAfter(page, 'Úvodní odstavec.');
  await (await must(addBelow(page), 'button "Add block below"')).click();
  await sleep(100);
  await page.keyboard.type('/');
  const { menu } = await needMenu(page, '/ in an empty paragraph');
  const bad: string[] = [];
  const colours = new Map<string, string>();
  for (const [row, name] of ICONS) {
    const o = await option(menu, row);
    const icons = o.locator('.slash-icon');
    const n = await icons.count();
    if (n !== 1) { bad.push(`${row}: ${n} icons`); continue; }
    const ic = icons.first();
    if ((await ic.getAttribute('aria-hidden')) !== 'true') bad.push(`${row}: the icon isn't aria-hidden`);
    if ((await ic.getAttribute('data-icon')) !== name) bad.push(`${row}: data-icon ${JSON.stringify(await ic.getAttribute('data-icon'))}, not ${name}`);
    const drawn = await ic.evaluate((e) => { const p = e.querySelector('svg path'); return !!p && (p.getAttribute('d') ?? '').length > 4; });
    if (!drawn) bad.push(`${row}: the icon draws nothing`);
    // The icon comes before the label on screen.
    const first = await o.evaluate((e) => { const i = e.querySelector('.slash-icon')!.getBoundingClientRect(); const r = e.getBoundingClientRect(); return i.left - r.left < 40; });
    if (!first) bad.push(`${row}: the icon isn't at the start of the row`);
    colours.set(row, await ic.evaluate((e) => getComputedStyle(e).color));
  }
  if (colours.get('Mindmap') === colours.get('Quote')) bad.push(`Mindmap's icon has the muted colour of the others (${colours.get('Mindmap')}), not teal`);
  assert.deepEqual(bad, [], 'bug #171: every row of the / menu shows its icon (board ObjectMenu, D-2677)');
});
