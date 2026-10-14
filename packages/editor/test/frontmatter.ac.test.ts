// MS3 slice 3D, L1: panel edits go through the editor's save path and undo history (`applyFrontmatter`,
// docs/contracts/ms3-shell.md §14.6, D-240). FR-EDT-07 AC-4 (one save with body edits), AC-12 (identity on the first
// edit), AC-16 (undo/redo); FR-TYP-07 AC-9 (type change undo) at the editor level. Values come from the real
// @tegg/doc `setValue` (never mocked). Written from docs/acceptance/types.md and the contract only (D-61).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { NOW, caret, open, readFixture, type } from './helpers';

const T = (rel: string) => readFixture(`tests/fixtures/vaults/types/${rel}`);
const PORADA = T('Schůzky/2026-10-07 Porada.md');
const OBYC = T('Pages/Obyčejná stránka.md');

async function doc() {
  const m = (await import('@tegg/doc')) as Record<string, any>;
  assert.equal(typeof m.setValue, 'function', '@tegg/doc setValue (§14.5)');
  return m;
}
async function apply(ed: any, key: string, value: unknown) {
  const d = await doc();
  assert.equal(typeof ed.applyFrontmatter, 'function', 'TeggEditor.applyFrontmatter (§14.6)');
  ed.applyFrontmatter(d.setValue(d.parse(ed.text()), key, value));
}
const touched = (t: string) => t.replace(/^modified: .*$/m, `modified: ${NOW}`);
const swap = (t: string, a: string, b: string) => { assert.ok(t.includes(a), `fixture contains ${JSON.stringify(a)}`); return t.replace(a, b); };

test('fr_edt_07_ac16_a_panel_edit_is_one_undo_step_and_redo_reapplies_it', async () => {
  const ed: any = await open(PORADA);
  await apply(ed, 'místo', 'Zasedačka 2');
  assert.equal(ed.dirty(), true, 'the note is dirty');
  const saved = await ed.save();
  assert.equal(saved, touched(swap(PORADA, 'místo:\n', 'místo: Zasedačka 2\n')), 'only the místo line and modified');
  assert.equal(ed.commands.undo(), true, 'undo');
  assert.equal(await ed.save(), null, 'undo restores the previous value exactly');
  assert.equal(ed.commands.redo(), true, 'redo');
  assert.equal(await ed.save(), saved, 'redo re-applies it');
  ed.destroy();
});

test('fr_edt_07_ac16_body_and_panel_steps_share_one_chronological_history', async () => {
  const ed: any = await open(PORADA);
  caret(ed, 0);
  type(ed, ' Ž');
  await apply(ed, 'místo', 'Brno');
  const both = await ed.save();
  assert.ok(both && both.includes('místo: Brno\n') && both.includes('příští rok. Ž'), 'body and panel edit in one save (FR-EDT-07 AC-4)');
  assert.equal(ed.commands.undo(), true);
  const afterOne = await ed.save();
  assert.ok(afterOne && !afterOne.includes('místo: Brno') && afterOne.includes('příští rok. Ž'), 'the last step (panel) is undone first');
  assert.equal(ed.commands.undo(), true);
  assert.equal(await ed.save(), null, 'then the body step');
  ed.destroy();
});

test('fr_edt_07_ac4_apply_frontmatter_rejects_a_changed_body', async () => {
  const ed: any = await open(PORADA);
  assert.equal(typeof ed.applyFrontmatter, 'function', 'TeggEditor.applyFrontmatter (§14.6)');
  assert.throws(() => ed.applyFrontmatter(PORADA.replace('Úkoly rozdělí Jana.', 'Jiné tělo.')), 'only the frontmatter is taken');
  assert.equal(await ed.save(), null, 'nothing pending');
  ed.destroy();
});

test('fr_edt_07_ac4_reload_replaces_the_frontmatter_and_clears_history', async () => {
  const ed: any = await open(PORADA);
  await apply(ed, 'místo', 'Brno');
  assert.equal(ed.dirty(), true, 'red guard: the committed panel edit is pending');
  const theirs = swap(PORADA, 'nálada: dobrá\n', 'nálada: skvělá\n');
  ed.reload(theirs);
  assert.equal(ed.text(), theirs, 'the reloaded frontmatter');
  assert.equal(ed.commands.undo(), false, 'history cleared');
  ed.destroy();
});

test('fr_edt_07_ac4_title_composes_with_a_frontmatter_edit', async () => {
  const ed: any = await open(PORADA);
  ed.setTitle('Porada o rozpočtu');
  await apply(ed, 'místo', 'Brno');
  const saved = await ed.save();
  assert.equal(saved, touched(swap(swap(PORADA, 'title: 2026-10-07 Porada\n', 'title: Porada o rozpočtu\n'), 'místo:\n', 'místo: Brno\n')));
  ed.destroy();
});

test('fr_edt_07_ac12_first_panel_edit_of_a_file_without_frontmatter_adds_identity', async () => {
  const bez = T('Pages/Bez hlavičky.md');
  const ed: any = await open(bez);
  await apply(ed, 'tags', ['nový']);
  const saved = (await ed.save()) ?? '';
  assert.match(saved, /^---\ntags:\n  - nový\nid: 01\w{24}\ntype: page\nmodified: [^\n]+\n---\n/, 'tags, then id, type: page, modified (D-174)');
  assert.ok(saved.endsWith(`---\n${bez}`), 'body byte-identical');
  ed.destroy();
});

test('fr_typ_07_ac9_type_change_undo_and_redo_in_the_editor', async () => {
  const ed: any = await open(OBYC);
  await apply(ed, 'type', 'schůzka');
  const changed = await ed.save();
  assert.equal(changed, touched(swap(OBYC, 'type: page\n', 'type: schůzka\n')));
  assert.equal(ed.commands.undo(), true);
  assert.equal(await ed.save(), null, 'the previous type in one step');
  assert.equal(ed.commands.redo(), true);
  assert.equal(await ed.save(), changed, '⇧⌘Z re-applies it');
  ed.destroy();
});
