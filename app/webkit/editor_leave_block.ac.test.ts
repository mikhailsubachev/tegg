// v0.113 feedback, L5 (WebKit + fake core): leaving the last block (D-1356, AP-1214). FR-EDT-01 AC-14 (a click below
// the last block) and FR-EDT-02 AC-23 (⏎⏎ and ⌘⏎ leave a code block). docs/acceptance/editor.md; the hint and the
// no-write rule of an empty paragraph are FR-EDT-01 AC-9 and AC-3. The AC-14 note is a copy of Prázdná whose body is
// only the code block ```js / let a = 1 / ``` (written here). ↓ at the end of the last block (unchanged behaviour) is
// checked in editor.ac.test.ts. Written from the ACs only (D-61); every lookup goes through `must`/`seen` and
// node:assert, so a missing element is an AssertionError (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { openNote } from './helpers';
import {
  E, block, caretIn, editorBody, editorVault, fileText, must, mustBeSaved, noModified, openEditor, seen, sleep, writes, type FakeCoreHandle,
} from './editor-helpers';

const HINT = 'Type / for blocks, [[ to link, # to tag';
const CODE = '```js\nlet a = 1\n```\n';

/** The editor vault with Prázdná's body replaced by `body` (Prázdná's original body is empty) and extra notes. */
function vaultWith(body: string, extra: Record<string, string> = {}) {
  const v = editorVault();
  v.files[E.prazdna] = v.files[E.prazdna] + body;
  Object.assign(v.files, extra);
  return v;
}
/** A runtime Page with Prázdná's frontmatter shape, its own id and title, and `body`. */
function pageNote(n: number, title: string, body: string): string {
  return `---\nid: 01JB0E0000000000000000V${String(n).padStart(3, '0')}\ntype: page\ntitle: ${title}\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\n${body}`;
}

/** The top-level blocks of the editor (tag and text) and the index of the one holding the caret (-1: none). */
async function caretState(page: Page): Promise<{ blocks: { tag: string; text: string }[]; caret: number; inEditor: boolean }> {
  const box = await must(editorBody(page), 'textbox "Note body"');
  return box.first().evaluate((root) => {
    // ProseMirror's gap cursor is a widget, not a block.
    const kids = ([...root.children] as HTMLElement[]).filter((k) => !k.classList.contains('ProseMirror-gapcursor'));
    const sel = window.getSelection();
    const node = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
    const el = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null;
    const top = el ? kids.findIndex((k) => k === el || k.contains(el)) : -1;
    return {
      blocks: kids.map((k) => ({ tag: k.tagName.toLowerCase(), text: (k.textContent ?? '').replace(/​/g, '') })),
      caret: top,
      inEditor: !!document.activeElement && (document.activeElement === root || root.contains(document.activeElement)),
    };
  });
}
/** The text of the code block (block `n`): its `code` element, else the block's text. */
async function codeText(page: Page, n = 1): Promise<string> {
  const b = await must(block(page, n), `block ${n}`);
  return b.evaluate((el) => (el.querySelector('code') ?? el).textContent ?? '');
}
/** Clicks the empty area of the note `dy` px below the last block, over the middle of the text column. */
async function clickBelowLast(page: Page, dy = 60) {
  const n = (await caretState(page)).blocks.length;
  const last = await must(block(page, n), `the last block (${n})`);
  const b = await last.boundingBox();
  assert.ok(b, 'the last block is on screen');
  const x = b!.x + Math.min(120, b!.width / 2);
  const y = b!.y + b!.height + dy;
  const under = await page.evaluate(([px, py]) => {
    const e = document.elementFromPoint(px, py) as HTMLElement | null;
    return e ? !!e.closest('main') : false;
  }, [x, y] as const);
  assert.ok(under, `the point ${dy} px below the last block is the note's area`);
  await page.mouse.click(x, y);
  await sleep(150);
}
/** After the click: a new empty paragraph after `before` blocks holds the caret, with the AC-9 hint. */
async function mustBeInNewParagraph(page: Page, before: number, what: string) {
  const s = await caretState(page);
  assert.equal(s.blocks.length, before + 1, `${what}: one new block after the last one (${JSON.stringify(s.blocks)})`);
  assert.equal(s.blocks[before].tag, 'p', `${what}: the new block is a paragraph (${JSON.stringify(s.blocks)})`);
  assert.equal(s.blocks[before].text, '', `${what}: the new paragraph is empty`);
  assert.equal(s.caret, before, `${what}: the caret is in the new paragraph`);
  assert.ok(s.inEditor, `${what}: the editor has the focus`);
  assert.ok(await seen(block(page, before + 1).getByText(HINT), 1000), `${what}: the AC-9 hint in the new paragraph`);
}
async function savedText(page: Page, core: FakeCoreHandle, path: string): Promise<string> {
  await sleep(150);
  await mustBeSaved(page);
  const t = await fileText(core, path);
  assert.ok(t !== undefined, `${path} exists`);
  return t!;
}

// ------------------------------------------------------------------------------------------------ FR-EDT-01 AC-14

test('fr_edt_01_ac14_click_below_a_last_code_block_adds_an_empty_paragraph', async ({ page }) => {
  const vault = vaultWith(CODE);
  const written = vault.files[E.prazdna];
  const core = await openEditor(page, E.prazdna, { vault });
  assert.deepEqual((await caretState(page)).blocks.map((b) => b.tag), ['pre'], 'setup: the body is only the code block');
  await clickBelowLast(page);
  await mustBeInNewParagraph(page, 1, 'a click below the code block');
  await sleep(1500);
  assert.equal((await writes(core)).length, 0, 'no note_write until text is typed (FR-EDT-01 AC-3)');
  await page.keyboard.type('Dál');
  const t = await savedText(page, core, E.prazdna);
  assert.equal(noModified(t), noModified(written) + '\nDál\n', 'the original bytes, one blank line, Dál and one \\n; only modified changes');
});

test('fr_edt_01_ac14_click_below_a_last_table_callout_or_divider_and_a_paragraph', async ({ page }) => {
  const cases = [
    { title: 'Tabulka na konci', body: 'Úvod.\n\n| Jméno | Počet |\n| --- | --- |\n| Žluťoučký kůň | 1 |\n', tag: 'table' },
    { title: 'Výstraha na konci', body: 'Úvod.\n\n> [!warning] Pozor\n> Obsah výstrahy.\n', tag: 'callout' },
    { title: 'Čára na konci', body: 'Úvod.\n\n---\n', tag: 'divider' },
  ];
  const extra: Record<string, string> = {};
  cases.forEach((c, i) => { extra[`Pages/${c.title}.md`] = pageNote(i + 1, c.title, c.body); });
  const last = { title: 'Odstavec na konci', body: 'Úvod.\n\nPoslední odstavec.\n' };
  extra[`Pages/${last.title}.md`] = pageNote(9, last.title, last.body);
  const vault = vaultWith(CODE, extra);
  const core = await openEditor(page, E.prazdna, { vault });
  for (const c of cases) {
    const path = `Pages/${c.title}.md`;
    await openNote(page, c.title);
    await must(editorBody(page), `${c.title}: the editor`, 5000);
    const n = (await caretState(page)).blocks.length;
    assert.equal(n, 2, `setup: ${c.title} has two blocks, the last a ${c.tag}`);
    const before = (await writes(core, path)).length;
    await clickBelowLast(page);
    await mustBeInNewParagraph(page, n, `a click below a last ${c.tag}`);
    await sleep(1200);
    assert.equal((await writes(core, path)).length, before, `${c.tag}: no note_write until text is typed`);
    await page.keyboard.type('Dál');
    const t = await savedText(page, core, path);
    assert.equal(noModified(t), noModified(extra[path]) + '\nDál\n', `${c.tag}: the original bytes, one blank line, Dál`);
  }
  // A last paragraph: the caret goes to its end and nothing is added.
  const path = `Pages/${last.title}.md`;
  await openNote(page, last.title);
  await must(editorBody(page), `${last.title}: the editor`, 5000);
  await clickBelowLast(page);
  const s = await caretState(page);
  assert.equal(s.blocks.length, 2, 'a click below a last paragraph adds no block');
  assert.equal(s.caret, 1, 'the caret is in the last paragraph');
  const atEnd = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
    const r = sel.getRangeAt(0);
    const host = (r.startContainer.nodeType === 1 ? (r.startContainer as Element) : r.startContainer.parentElement)?.closest('p');
    if (!host) return false;
    const after = document.createRange();
    after.selectNodeContents(host);
    after.setStart(r.startContainer, r.startOffset);
    return after.toString().replace(/​/g, '') === '';
  });
  assert.ok(atEnd, 'the caret is at the end of the last paragraph');
  await page.keyboard.type(' Dál');
  const t = await savedText(page, core, path);
  assert.equal(noModified(t), noModified(extra[path]).replace('Poslední odstavec.\n', 'Poslední odstavec. Dál\n'), 'typing goes to the end of that paragraph');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-02 AC-23

test('fr_edt_02_ac23_two_enters_at_the_end_leave_the_code_block', async ({ page }) => {
  const vault = vaultWith(CODE);
  const written = vault.files[E.prazdna];
  const core = await openEditor(page, E.prazdna, { vault });
  await caretIn(page, 1); // the end of `let a = 1`
  await page.keyboard.press('Enter');
  let s = await caretState(page);
  assert.deepEqual([s.blocks.length, s.caret], [1, 0], 'the first ⏎ stays in the code block');
  assert.equal(await codeText(page), 'let a = 1\n', 'the first ⏎ adds an empty line inside the code');
  await page.keyboard.press('Enter');
  s = await caretState(page);
  assert.equal(s.blocks.length, 2, `the second ⏎ on the empty last line leaves the code block (${JSON.stringify(s.blocks)})`);
  assert.equal(await codeText(page), 'let a = 1', 'the empty last line is removed');
  assert.equal(s.blocks[1].tag, 'p', 'into a new paragraph');
  assert.equal(s.caret, 1, 'the caret is in the new paragraph');
  await page.keyboard.type('Dál');
  const t = await savedText(page, core, E.prazdna);
  assert.equal(noModified(t), noModified(written) + '\nDál\n', 'the code block byte-identical, one blank line, Dál');
});

test('fr_edt_02_ac23_cmd_enter_leaves_from_any_line_and_an_inner_empty_line_stays', async ({ page }) => {
  const vault = vaultWith(CODE);
  const written = vault.files[E.prazdna];
  const core = await openEditor(page, E.prazdna, { vault });
  // ⌘⏎ in the middle of `let a = 1` leaves without changing the code.
  await caretIn(page, 1, 'let');
  await page.keyboard.press('Meta+Enter');
  const s = await caretState(page);
  assert.equal(s.blocks.length, 2, `⌘⏎ inside a line leaves the code block (${JSON.stringify(s.blocks)})`);
  assert.equal(await codeText(page), 'let a = 1', '⌘⏎ changes nothing in the code');
  assert.deepEqual([s.blocks[1].tag, s.blocks[1].text, s.caret], ['p', '', 1], 'the caret is in a new empty paragraph after it');
  await page.keyboard.type('Dál');
  const t = await savedText(page, core, E.prazdna);
  assert.equal(noModified(t), noModified(written) + '\nDál\n', 'the code block byte-identical, one blank line, Dál');
  // ⏎ on an empty line that isn't the last one stays a new line in the code; ⌘⏎ from that line leaves.
  await caretIn(page, 1, null, true); // the start of `let a = 1`
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp'); // the empty first line
  await page.keyboard.press('Enter');
  let s2 = await caretState(page);
  assert.deepEqual([s2.blocks.length, s2.caret], [2, 0], '⏎ on an inner empty line stays in the code block');
  assert.equal(await codeText(page), '\n\nlet a = 1', 'it adds a line in the code');
  await page.keyboard.press('Meta+Enter');
  s2 = await caretState(page);
  assert.equal(s2.blocks.length, 3, `⌘⏎ on an inner empty line leaves (${JSON.stringify(s2.blocks)})`);
  assert.deepEqual([s2.blocks[1].tag, s2.blocks[1].text, s2.caret], ['p', '', 1], 'into a new empty paragraph right after the code block');
  assert.equal(await codeText(page), '\n\nlet a = 1', 'without changing the code');
  await page.keyboard.type('Znovu');
  const t2 = await savedText(page, core, E.prazdna);
  assert.equal(noModified(t2), noModified(written).replace(CODE, '```js\n\n\nlet a = 1\n```\n\nZnovu\n') + '\nDál\n', 'the edited code, the new paragraph, then Dál');
});
