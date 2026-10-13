// Block transactions of @tegg/editor (L1, real ProseMirror): FR-EDT-01 AC-5 (move by keyboard), AC-7 (the two D-67
// exceptions), FR-EDT-04 AC-1 (block shortcuts as input rules) and AC-4 (literal syntax stays text).
// docs/acceptance/editor.md R7; docs/contracts/ms3-shell.md §13.3.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { blocksRaw, body, caret, editorNote, frontWithoutModified, open, press, type } from './helpers';

const DESET = () => editorNote('Deset bloků');

test('fr_edt_01_ac5_move_block_down_and_up_keeps_bytes', async () => {
  const orig = DESET();
  const ob = await blocksRaw(orig);
  assert.equal(ob.length, 10, 'setup: Deset bloků has 10 blocks');
  const ed = await open(orig);
  caret(ed, 2, 0); // block 3, the `*` list
  assert.equal(ed.commands.moveBlock('down'), true, 'moveBlock(down) applies');
  const out = await ed.save();
  assert.ok(out !== null, 'a move is saved');
  assert.deepEqual(await blocksRaw(out!), [ob[0], ob[1], ob[3], ob[2], ...ob.slice(4)], 'blocks 1, 2, 4, 3, 5…10 byte-identical');
  assert.equal(await frontWithoutModified(out!), await frontWithoutModified(orig), 'frontmatter differs only in modified');
  assert.equal(ed.commands.moveBlock('up'), true, 'moveBlock(up) applies');
  assert.equal(await ed.save(), null, 'moved back: equal to the original, nothing to write');
});

test('fr_edt_01_ac5_move_at_the_edges_does_nothing', async () => {
  const ed = await open(DESET());
  caret(ed, 0, 0);
  assert.equal(ed.commands.moveBlock('up'), false, 'first block cannot move up');
  caret(ed, 9, 0);
  assert.equal(ed.commands.moveBlock('down'), false, 'last block cannot move down');
  assert.equal(await ed.save(), null, 'nothing written');
});

test('fr_edt_01_ac7_seznamy_delete_separator_gives_two_lists_one_with_star', async () => {
  const orig = editorNote('Seznamy');
  const ed = await open(orig);
  caret(ed, 1, 0); // `Oddělovací odstavec.`
  assert.equal(ed.commands.deleteBlocks(), true, 'deleteBlocks applies');
  const out = await ed.save();
  assert.ok(out !== null, 'saved');
  const b = await body(out!);
  const { markdownTree } = await import('@tegg/doc');
  const lists = markdownTree(b).children.filter((n: any) => n.type === 'list');
  assert.equal(lists.length, 2, `the body parses to two lists:\n${b}`);
  const lines = b.split('\n').filter((l) => l.trim() !== '');
  assert.deepEqual(lines.map((l) => l.slice(2)), ['a', 'b', 'c', 'd'], 'item text unchanged');
  const markers = new Set(lines.map((l) => l[0]));
  assert.deepEqual([...markers].sort(), ['*', '-'], 'one list written with `*`, the other with `-` (D-67)');
  assert.equal(lines[0][0], lines[1][0], 'one marker per list');
  assert.equal(await frontWithoutModified(out!), await frontWithoutModified(orig), 'frontmatter differs only in modified');
});

test('fr_edt_01_ac7_odsazeny_kod_delete_separator_writes_comment_line', async () => {
  const orig = editorNote('Odsazený kód');
  const ed = await open(orig);
  caret(ed, 1, 0); // `Oddělovač.`
  assert.equal(ed.commands.deleteBlocks(), true, 'deleteBlocks applies');
  const out = await ed.save();
  assert.ok(out !== null, 'saved');
  const b = await body(out!);
  assert.match(b, /^- položka\n\n<!-- -->\n\n {4}odsazený kód\n$/, `list, <!-- -->, indented code:\n${JSON.stringify(b)}`);
  const { markdownTree } = await import('@tegg/doc');
  const kinds = markdownTree(b).children.map((n: any) => n.type).filter((t: string) => t !== 'html');
  assert.deepEqual(kinds, ['list', 'code'], 'parses to a list and a code block');
});

const BLOCK_SHORTCUTS: [string, string][] = [
  ['# ', '# Řádek'], ['## ', '## Řádek'], ['### ', '### Řádek'],
  ['#### ', '#### Řádek'], ['##### ', '##### Řádek'], ['###### ', '###### Řádek'],
  ['- ', '- Řádek'], ['* ', '- Řádek'], ['+ ', '- Řádek'],
  ['1. ', '1. Řádek'], ['1) ', '1. Řádek'], ['7. ', '7. Řádek'],
  ['[] ', '- [ ] Řádek'], ['[ ] ', '- [ ] Řádek'], ['[x] ', '- [x] Řádek'],
  ['> ', '> Řádek'],
];

test('fr_edt_04_ac1_block_shortcuts_convert_at_start_of_empty_paragraph', async () => {
  const orig = editorNote('Prázdná');
  const bad: string[] = [];
  for (const [trigger, written] of BLOCK_SHORTCUTS) {
    const ed = await open(orig);
    caret(ed, 0, 0);
    type(ed, trigger + 'Řádek');
    const out = await ed.save();
    const b = out === null ? '(nothing saved)' : await body(out);
    if (b !== `${written}\n`) bad.push(`${JSON.stringify(trigger)} → ${JSON.stringify(b)} (want ${JSON.stringify(written + '\n')})`);
    ed.destroy();
  }
  for (const [typed, enter, written] of [['```js', true, '```js\nŘádek\n```\n'], ['```', true, '```\nŘádek\n```\n']] as const) {
    const ed = await open(orig);
    caret(ed, 0, 0);
    type(ed, typed);
    if (enter) press(ed, 'Enter');
    type(ed, 'Řádek');
    const out = await ed.save();
    const b = out === null ? '(nothing saved)' : await body(out);
    if (b !== written) bad.push(`${typed}⏎ → ${JSON.stringify(b)}`);
    ed.destroy();
  }
  {
    const ed = await open(orig);
    caret(ed, 0, 0);
    type(ed, '---');
    press(ed, 'Enter');
    type(ed, 'Řádek');
    const out = await ed.save();
    const b = out === null ? '(nothing saved)' : await body(out);
    if (b !== '---\n\nŘádek\n') bad.push(`---⏎ → ${JSON.stringify(b)}`);
    ed.destroy();
  }
  assert.deepEqual(bad, [], 'R7 block shortcuts');
});

test('fr_edt_04_ac1_shortcuts_mid_paragraph_do_not_convert', async () => {
  const orig = editorNote('Prázdná');
  const { markdownTree } = await import('@tegg/doc');
  for (const typed of ['text - text', 'a 1. b', 'x > y']) {
    const ed = await open(orig);
    caret(ed, 0, 0);
    type(ed, typed);
    const out = await ed.save();
    assert.ok(out !== null, `${typed}: saved`);
    const tree = markdownTree(await body(out!));
    assert.deepEqual(tree.children.map((n: any) => n.type), ['paragraph'], `${typed}: stays one paragraph`);
    ed.destroy();
  }
});

/** Concatenated text of an mdast subtree, and the node types in it. */
function flat(n: any, types: Set<string>): string {
  types.add(n.type);
  if (typeof n.value === 'string' && n.type === 'text') return n.value;
  return (n.children ?? []).map((c: any) => flat(c, types)).join('');
}

test('fr_edt_04_ac4_literal_syntax_is_saved_as_text', async () => {
  const orig = editorNote('Prázdná');
  const { markdownTree } = await import('@tegg/doc');
  const cases = ['Krok 1. není seznam', 'Úkol #1 hotový', 'Dvě == rovnítka', 'Procenta %% nejsou komentář', 'Cena $ za kus'];
  const forbidden = ['heading', 'list', 'wikiLink', 'tag', 'highlight', 'comment', 'inlineMath', 'math'];
  for (const typed of cases) {
    const ed = await open(orig);
    caret(ed, 0, 0);
    type(ed, typed);
    const out = await ed.save();
    assert.ok(out !== null, `${typed}: saved`);
    const types = new Set<string>();
    const tree = markdownTree(await body(out!));
    const text = flat(tree, types).trim();
    assert.equal(text, typed, `${typed}: reads back as the same text`);
    assert.deepEqual(forbidden.filter((t) => types.has(t)), [], `${typed}: no syntax node`);
    ed.destroy();
  }
});
