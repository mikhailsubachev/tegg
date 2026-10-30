// Slice P QA review (B1, round-trip and minimal-write findings): `editLink` and `removeLink` (v1-previews §5.3,
// FR-LNK-13 AC-6, AC-7) write nothing while the editor is read-only (a type move, D-804; the merge dialog, FR-SYN-03
// AC-13), never write a target or text that wouldn't parse back (FR-FMT-07), write nothing when nothing changed
// (FR-SYN-06), and don't act on an inline embed's chip (its `|link` is the mode word).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { editorModule, newId } from './helpers';

const NOW = '2026-10-29T10:00:00+01:00';
const TEXT = [
  '---',
  'id: 01JQAPGUARD0000000000000',
  'type: page',
  'title: Guards',
  'created: 2026-10-01T10:00:00+02:00',
  'modified: 2026-10-01T10:00:00+02:00',
  '---',
  '',
  'Text [[ Rozpočet 2027 | rozpočet ]] a [[Jana Nováková]] a ![[Petr Dvořák|link]].',
  '',
].join('\n');

async function open(text = TEXT) {
  const m = await editorModule();
  const element = document.createElement('div');
  document.body.appendChild(element);
  const ui = {
    resolve: () => ({ kind: 'note' as const, path: 'Pages/X.md', type: 'page', title: 'X' }),
    unresolved: (t: string) => `No note named ${t}`,
    sourceBlock: 'Source block',
    hint: 'Type / for commands',
    placeholder: (kind: string, value: string) => ({ name: `${kind} ${value}`, text: value }),
    onLink: () => {},
    onTag: () => {},
    onExternal: () => {},
  };
  return (m.createEditor as any)({ text, element, now: () => NOW, newId, ui });
}
function chipPos(ed: any, pred: (value: string, embed: boolean) => boolean): number {
  let at = -1;
  ed.view.state.doc.descendants((n: any, p: number) => {
    if (at < 0 && n.type.name === 'wikiLink' && pred(String(n.attrs.value).normalize('NFC'), !!n.attrs.embed)) at = p;
    return true;
  });
  assert.ok(at >= 0, 'the chip is in the editor');
  return at;
}
const jana = (ed: any) => chipPos(ed, (v, e) => !e && v === 'Jana Nováková');

test('bug_qap_fr_lnk_13_read_only_editor_edit_and_remove_link_write_nothing', async () => {
  const ed = await open();
  const before = ed.text();
  ed.editor.setEditable(false);
  assert.equal(ed.editLink(jana(ed), { target: 'Petr Dvořák', alias: null }), false, 'editLink is refused while read-only');
  ed.focusAfterChip(jana(ed));
  assert.equal(ed.commands.removeLink(), false, 'removeLink is refused while read-only');
  assert.equal(ed.text(), before, 'the text is unchanged');
  ed.editor.setEditable(true);
  assert.equal(ed.editLink(jana(ed), { target: 'Petr Dvořák', alias: null }), true, 'editable again: the edit applies');
});

test('bug_qap_fr_fmt_07_edit_link_refuses_values_that_would_not_parse_back', async () => {
  const ed = await open();
  const before = ed.text();
  for (const next of [
    { target: 'A]]B', alias: null }, { target: 'A[[B', alias: null }, { target: 'A|B', alias: null }, { target: 'A\nB', alias: null },
    { target: 'Petr Dvořák', alias: 'a]]b' }, { target: 'Petr Dvořák', alias: 'a|b' }, { target: 'Petr Dvořák', alias: 'a\nb' },
  ]) assert.equal(ed.editLink(jana(ed), next), false, `refused: ${JSON.stringify(next)}`);
  assert.equal(ed.text(), before, 'nothing written');
  assert.equal(ed.editLink(jana(ed), { target: 'Petr Dvořák', alias: 'Petr #1' }), true, '`#` in the link text is fine');
  assert.ok(ed.text().includes('[[Petr Dvořák|Petr #1]]'));
});

test('bug_qap_fr_syn_06_unchanged_edit_link_writes_nothing', async () => {
  const ed = await open();
  const before = ed.text();
  const pos = chipPos(ed, (v, e) => !e && v.includes('Rozpočet'));
  assert.equal(ed.editLink(pos, { target: 'Rozpočet 2027', alias: 'rozpočet' }), true, 'the dialog confirmed unchanged');
  assert.equal(ed.editLink(pos, { target: 'Rozpočet 2027', alias: 'rozpočet' }), true, 'an NFD form of the same text');
  assert.equal(ed.text(), before, '`[[ Rozpočet 2027 | rozpočet ]]` is kept byte for byte');
  assert.equal(await ed.save(), null, 'and there is nothing to save (no write, no `modified` bump)');
});

test('bug_qap_fr_lnk_13_edit_link_leaves_an_inline_embed_alone', async () => {
  const ed = await open();
  const before = ed.text();
  const pos = chipPos(ed, (v, e) => e && v.startsWith('Petr'));
  assert.equal(ed.linkAt(pos)?.alias ?? null, null, 'the embed\'s `link` is no link text');
  assert.equal(ed.editLink(pos, { target: 'Petr Dvořák', alias: null }), false, 'editLink is refused on an embed chip');
  assert.equal(ed.text(), before);
});
