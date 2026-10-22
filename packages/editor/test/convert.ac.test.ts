// MS5 slice 5A-2, L1: the @tegg/editor side of block → object conversion (docs/contracts/ms5-tasks.md §11.3; D-490,
// D-492, D-494, D-496), with real ProseMirror transactions and the save path through the real @tegg/doc.
// FR-CNV-01 AC-4 (the unit of a caret, a text selection and a block selection), FR-CNV-03 AC-2…AC-4, AC-9 (what
// `convertUnit` leaves in the editor and what the next save writes), FR-CNV-06 AC-1 (one undo step, `afterUndo`),
// AC-2 (redo through `beforeRedo`), FR-CNV-01 AC-5 (`convertible: false`), FR-CNV-08 AC-1, AC-5 (`guardEmbedRemoval`
// is asked before user removals only), FR-CNV-05 AC-6 (`emptyHint`), R53 (slash items built), and the link texts of
// FR-CNV-04 AC-1 and FR-CNV-03 AC-5, AC-11 (`linkText`, `embedTarget`). Fixture: tests/fixtures/vaults/tasks (read only).
// Written from docs/acceptance/conversion.md and the contract only (D-61). The editor module loads dynamically
// (TS-I1); `conversionUnit()` and `convertUnit` exist as stubs, so the tests fail on their assertions.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { blockStart, body, editorModule, frontWithoutModified, NOW, newId, readFixture } from './helpers';

const tasksNote = (rel: string) => readFixture(`tests/fixtures/vaults/tasks/${rel}`);
const BLOKY = () => tasksNote('Pages/Bloky.md');
const nfc = (s: string) => s.normalize('NFC');
type Unit = { kind: 'blocks' | 'items' | 'nested-item'; from: number; to: number; count: number; first: string; checked: boolean | null };
type Rec = { path: string; created: string; type: string; title: string };

/** Offset of `needle` in `text`; the needle must occur exactly once (fixture guard). */
function at(text: string, needle: string): number {
  const i = text.indexOf(needle);
  assert.ok(i >= 0 && text.indexOf(needle, i + 1) < 0, `fixture text holds ${JSON.stringify(needle)} exactly once`);
  return i;
}
const end = (text: string, needle: string) => at(text, needle) + needle.length;
function sw(text: string, from: string, to: string): string {
  at(text, from);
  return text.replace(from, () => to);
}
/** `text` with its `modified:` line set to the test clock (the editor's `now`). */
const touched = (text: string) => text.replace(/^modified: .*$/m, `modified: ${NOW}`);

type Log = { afterUndo: Rec[]; beforeRedo: Rec[]; guard: { pos: number; source: string }[][]; embeds: string[] };
const fresh = (): Log => ({ afterUndo: [], beforeRedo: [], guard: [], embeds: [] });

function ui(log: Log) {
  return {
    resolve: () => ({ kind: 'note' as const, path: 'Pages/Zasedačka.md', type: 'page', title: 'Zasedačka' }),
    unresolved: (t: string) => `No note named ${t}`,
    sourceBlock: 'Source block',
    hint: 'Type / for commands',
    placeholder: (kind: string, value: string) => ({ name: `${kind} ${value}`, text: value }),
    onLink: () => {},
    onTag: () => {},
    onExternal: () => {},
    embed: (source: string, dom: HTMLElement) => {
      log.embeds.push(source);
      dom.setAttribute('data-test-embed', source);
      return { update: () => {}, selected: () => {}, destroy: () => {} };
    },
    embedChip: (value: string) => ({ title: value, type: 'page', state: 'ok' as const, description: 'Embedded note' }),
  };
}

async function openWith(text: string, log: Log, extra: Record<string, unknown> = {}) {
  const m = await editorModule();
  return (m.createEditor as any)({
    text, now: () => NOW, newId, ui: ui(log),
    conversion: {
      afterUndo: (r: Rec) => { log.afterUndo.push(r); },
      beforeRedo: (r: Rec) => { log.beforeRedo.push(r); return Promise.resolve(r.title); },
    },
    ...extra,
  });
}

/** Collapsed caret (or a text selection to `toNeedle`) at the first text position of `needle` (+ `offset`). */
function textPos(ed: any, needle: string): number {
  let pos = -1;
  ed.view.state.doc.descendants((n: any, p: number) => {
    if (pos >= 0) return false;
    if (n.isText) {
      const i = (n.text as string).indexOf(needle);
      if (i >= 0) pos = p + i;
    }
    return true;
  });
  assert.ok(pos >= 0, `editor text holds ${JSON.stringify(needle)}`);
  return pos;
}
function select(ed: any, needle: string, offset = 0, toNeedle?: string, toOffset = 0) {
  const from = textPos(ed, needle) + offset;
  const to = toNeedle === undefined ? from : textPos(ed, toNeedle) + toOffset;
  const TextSel = Object.getPrototypeOf(ed.view.state.selection).constructor as any;
  assert.equal(typeof TextSel.create, 'function', 'TextSelection.create reachable from the editor state');
  ed.view.dispatch(ed.view.state.tr.setSelection(TextSel.create(ed.view.state.doc, from, to)));
}
/** Top-level block index whose node satisfies `pred`. */
function blockIndex(ed: any, pred: (n: any) => boolean, what: string): number {
  const doc = ed.view.state.doc;
  for (let i = 0; i < doc.childCount; i++) if (pred(doc.child(i))) return i;
  assert.fail(`no top-level block ${what}`);
}
const isEmbed = (src: string) => (n: any) => n.type.name === 'rawBlock' && n.attrs.kind === 'embed' && String(n.attrs.source ?? n.textContent).includes(src);
const hasText = (s: string) => (n: any) => n.textContent.includes(s);
const settle = () => new Promise((r) => setTimeout(r, 0));

/** Unit of the caret through the editor, then `convertUnit`; returns the record and the result. */
async function convert(ed: any, target: string, type = 'task', title = target) {
  const unit = ed.conversionUnit() as Unit | null;
  assert.ok(unit, 'conversionUnit() gives a unit for the selection');
  const rec: Rec = { path: `Tasks/${target}.md`, created: `---\ntype: ${type}\ntitle: ${title}\n---\n`, type, title };
  const pos = ed.commands.convertUnit(unit, target, rec);
  assert.equal(typeof pos, 'number', 'convertUnit applies and returns the embed position');
  return { unit: unit!, rec, pos: pos as number };
}

// ------------------------------------------------------------------------------------------------ FR-CNV-01 AC-4

test('fr_cnv_01_ac4_the_editor_unit_of_a_caret_a_text_selection_and_a_block_selection', async () => {
  const b = BLOKY();
  const ed = await openWith(b, fresh());
  select(ed, 'servisu');
  assert.deepEqual(ed.conversionUnit(), { kind: 'blocks', from: at(b, 'Zavolat do servisu'), to: end(b, 'a domluvit termín.'), count: 1, first: 'paragraph', checked: null }, 'caret in the two-line paragraph');
  select(ed, 'Úvodní odstavec.', 7, 'servisu');
  assert.deepEqual(ed.conversionUnit(), { kind: 'blocks', from: at(b, 'Úvodní'), to: end(b, 'a domluvit termín.'), count: 2, first: 'paragraph', checked: null }, 'a text selection converts the whole blocks it touches (AP-423)');
  select(ed, 'Citace', 2, 'převedení', 3);
  assert.deepEqual(ed.conversionUnit(), { kind: 'blocks', from: at(b, '> Citace'), to: end(b, '> Citace k převedení.'), count: 1, first: 'quote', checked: null }, 'a selection inside the quote converts the whole quote (AP-420)');
  const h = blockIndex(ed, hasText('Připravit podklady'), 'Připravit podklady');
  const p = blockIndex(ed, hasText('Odstavec pod nadpisem.'), 'Odstavec pod nadpisem.');
  assert.equal(ed.commands.selectBlockRange(h, p), true, 'block selection of the heading and the paragraph');
  assert.deepEqual(ed.conversionUnit(), { kind: 'blocks', from: at(b, '## Připravit'), to: end(b, 'Odstavec pod nadpisem.'), count: 2, first: 'heading', checked: null }, 'the block range: 2 blocks');
  select(ed, 'projektor');
  assert.deepEqual(ed.conversionUnit(), { kind: 'items', from: at(b, '- [ ] Objednat'), to: end(b, '  - porovnat nabídky'), count: 1, first: 'item', checked: false }, 'a top-level checklist item with children');
  select(ed, 'zjistit');
  assert.deepEqual(ed.conversionUnit(), { kind: 'nested-item', from: at(b, '  - zjistit cenu'), to: end(b, '  - zjistit cenu'), count: 1, first: 'item', checked: null }, 'a nested item alone');
  ed.destroy();
});

test('fr_cnv_01_ac5_convertible_false_gives_no_unit', async () => {
  const b = BLOKY();
  const on = await openWith(b, fresh());
  select(on, 'servisu');
  assert.notEqual(on.conversionUnit(), null, 'the default (convertible) editor gives a unit for a paragraph');
  on.destroy();
  for (const [rel, what] of [['_templates/Page/Page.md', 'a template note'], ['Pages/Bloky.md', 'a nested embed editor']] as const) {
    const ed = await openWith(tasksNote(rel), fresh(), { convertible: false });
    select(ed, rel.startsWith('_templates') ? 'šabloně' : 'servisu');
    assert.equal(ed.conversionUnit(), null, `${what}: convertible false → null (D-494)`);
    ed.destroy();
  }
});

// ------------------------------------------------------------------------------------------------ FR-CNV-03 (convertUnit)

test('fr_cnv_03_ac2_convert_unit_writes_the_helper_text_and_selects_the_embed', async () => {
  const b = BLOKY();
  const log = fresh();
  const ed = await openWith(b, log);
  select(ed, 'servisu');
  const { unit } = await convert(ed, 'Zavolat do servisu kvůli kolu');
  const want = sw(b, 'Zavolat do servisu kvůli kolu\na domluvit termín.', '![[Zavolat do servisu kvůli kolu]]');
  const m = (await import('@tegg/doc')) as any;
  assert.equal(m.replaceUnitWithEmbed(b, unit, 'Zavolat do servisu kvůli kolu').text, want, 'the helper gives the AC-2 text (one text engine, D-82)');
  assert.equal(await body(ed.text()), await body(want), 'the editor body equals the helper result');
  assert.equal(ed.selectedEmbed()?.source, '![[Zavolat do servisu kvůli kolu]]', 'the new embed is selected as a block (FR-CNV-01 AC-7)');
  assert.ok(log.embeds.includes('![[Zavolat do servisu kvůli kolu]]'), 'the embed renders through EditorUi.embed');
  assert.deepEqual(log.guard, [], 'convertUnit never asks the removal guard');
  const out = await ed.save();
  assert.equal(out, touched(want), 'the save: the AC-2 body, frontmatter differs only in modified (D-55)');
  ed.destroy();
});

test('fr_cnv_03_ac2_a_stale_unit_changes_nothing', async () => {
  const b = BLOKY();
  const ed = await openWith(b, fresh());
  select(ed, 'servisu');
  const unit = ed.conversionUnit() as Unit | null;
  assert.ok(unit, 'a unit');
  select(ed, 'Úvodní');
  ed.view.dispatch(ed.view.state.tr.insertText('Nový ', ed.view.state.selection.from));
  const before = ed.text();
  const r = ed.commands.convertUnit(unit, 'Zavolat do servisu kvůli kolu', { path: 'Tasks/x.md', created: '', type: 'task', title: 'x' });
  assert.equal(r, false, 'the text moved on: false');
  assert.equal(ed.text(), before, 'nothing changed');
  ed.destroy();
});

test('fr_cnv_03_ac3_cut_out_of_a_list_in_the_editor', async () => {
  const b = BLOKY();
  const ed = await openWith(b, fresh());
  select(ed, 'projektor');
  await convert(ed, 'Objednat nový projektor pro Zasedačka');
  const want = sw(b, '- [ ] Objednat **nový** projektor pro [[Zasedačka]] #práce\n  - zjistit cenu\n  - porovnat nabídky\n- [ ] Rezervovat sál', '\n![[Objednat nový projektor pro Zasedačka]]\n\n- [ ] Rezervovat sál');
  assert.equal(await ed.save(), touched(want), 'the list split around the embed paragraph; item bytes unchanged');
  ed.destroy();
  const ed2 = await openWith(b, fresh());
  select(ed2, 'Druhý');
  await convert(ed2, 'Druhý bod', 'page');
  assert.equal(await ed2.save(), touched(sw(b, '1. První bod\n2. Druhý bod\n3. Třetí bod', '1. První bod\n\n![[Druhý bod]]\n\n3. Třetí bod')), 'a numbered list keeps 3.');
  ed2.destroy();
});

test('fr_cnv_03_ac4_nested_item_in_the_editor', async () => {
  const b = BLOKY();
  const ed = await openWith(b, fresh());
  select(ed, 'zjistit');
  await convert(ed, 'zjistit cenu');
  assert.equal(await ed.save(), touched(sw(b, '  - zjistit cenu\n', '  - ![[zjistit cenu]]\n')), 'replaced in place; parent and sibling keep their bytes');
  ed.destroy();
});

test('fr_cnv_03_ac9_crlf_host_and_host_without_frontmatter_through_the_save', async () => {
  const c = tasksNote('Pages/CRLF host.md');
  const ed = await openWith(c, fresh());
  select(ed, 'Úkol s CRLF');
  await convert(ed, 'Úkol s CRLF');
  const out = await ed.save();
  assert.equal(out, touched(sw(c, 'Úkol s CRLF', '![[Úkol s CRLF]]')).replace(/\r?\n/g, '\r\n').replace(/\r\n$/, ''), 'CRLF on every line, no final newline');
  assert.equal(await body(out!), 'První.\r\n\r\n![[Úkol s CRLF]]\r\n\r\nPoslední.', 'the body');
  ed.destroy();

  const h = tasksNote('Pages/Bez hlavičky host.md');
  const ed2 = await openWith(h, fresh());
  select(ed2, 'Úkol bez');
  await convert(ed2, 'Úkol bez hlavičky');
  const out2 = await ed2.save();
  assert.ok(out2 !== null, 'saved');
  const m = (await import('@tegg/doc')) as any;
  const d = m.parse(out2);
  assert.equal(typeof d.frontmatter?.data?.id, 'string', 'the save adds id (D-54)');
  assert.equal(d.frontmatter?.data?.type, 'page', 'and type: page');
  assert.equal(await body(out2!), '![[Úkol bez hlavičky]]\n\nKonec.\n', 'along with the embed');
  ed2.destroy();
});

// ------------------------------------------------------------------------------------------------ FR-CNV-06 AC-1, AC-2

test('fr_cnv_06_ac1_undo_of_the_conversion_is_one_step_and_reports_the_record', async () => {
  const b = BLOKY();
  const log = fresh();
  const ed = await openWith(b, log);
  select(ed, 'servisu');
  const { rec } = await convert(ed, 'Zavolat do servisu kvůli kolu');
  const saved = await ed.save();
  assert.ok(saved !== null, 'the conversion is saved');
  ed.markSaved(saved);
  assert.equal(ed.commands.undo(), true, 'one undo');
  await settle();
  assert.deepEqual(log.afterUndo, [rec], 'afterUndo gets the conversion record once (D-492)');
  const out = await ed.save();
  assert.ok(out !== null, 'the undo is saved');
  assert.equal(await body(out!), await body(b), 'the body is the original byte for byte');
  assert.equal(await frontWithoutModified(out!), await frontWithoutModified(b), 'frontmatter: modified only');
  assert.deepEqual(log.guard, [], 'undo never asks the removal guard (FR-CNV-08 AC-5)');
  ed.destroy();

  const log2 = fresh();
  const ed2 = await openWith(b, log2);
  select(ed2, 'projektor');
  await convert(ed2, 'Objednat nový projektor pro Zasedačka');
  assert.equal(ed2.commands.undo(), true, 'one undo');
  assert.equal(ed2.text(), b, 'the list is one list again, byte-identical');
  assert.equal(log2.afterUndo.length, 1, 'afterUndo once');
  assert.equal(await ed2.save(), null, 'nothing left to save');
  ed2.destroy();
});

test('fr_cnv_06_ac1_other_undo_steps_are_not_conversion_steps', async () => {
  const b = BLOKY();
  const log = fresh();
  const ed = await openWith(b, log);
  select(ed, 'servisu');
  await convert(ed, 'Zavolat do servisu kvůli kolu');
  select(ed, 'Závěrečný');
  ed.view.dispatch(ed.view.state.tr.insertText('Velmi ', ed.view.state.selection.from));
  assert.equal(ed.commands.undo(), true, 'undo the typing');
  await settle();
  assert.deepEqual(log.afterUndo, [], 'undoing a later edit isn’t the conversion step');
  assert.ok(ed.text().includes('![[Zavolat do servisu kvůli kolu]]'), 'the embed is still there');
  assert.equal(ed.commands.undo(), true, 'undo the conversion');
  await settle();
  assert.equal(log.afterUndo.length, 1, 'now afterUndo runs');
  ed.destroy();
});

test('fr_cnv_06_ac2_redo_asks_before_redo_and_writes_the_returned_target', async () => {
  const b = BLOKY();
  const log = fresh();
  const ed = await openWith(b, log, {
    conversion: {
      afterUndo: (r: Rec) => { log.afterUndo.push(r); },
      beforeRedo: (r: Rec) => { log.beforeRedo.push(r); return Promise.resolve('Zavolat do servisu kvůli kolu (2)'); },
    },
  });
  select(ed, 'servisu');
  const { rec } = await convert(ed, 'Zavolat do servisu kvůli kolu');
  ed.commands.undo();
  await settle();
  ed.commands.redo();
  await settle();
  await settle();
  assert.deepEqual(log.beforeRedo, [rec], 'beforeRedo gets the record once');
  const want = sw(b, 'Zavolat do servisu kvůli kolu\na domluvit termín.', '![[Zavolat do servisu kvůli kolu (2)]]');
  assert.equal(await body(ed.text()), await body(want), 'the redo writes the target the app returned (FR-CNV-06 AC-2)');
  ed.destroy();

  const log2 = fresh();
  const ed2 = await openWith(b, log2, {
    conversion: { afterUndo: () => {}, beforeRedo: (r: Rec) => { log2.beforeRedo.push(r); return Promise.resolve(false); } },
  });
  select(ed2, 'servisu');
  await convert(ed2, 'Zavolat do servisu kvůli kolu');
  ed2.commands.undo();
  await settle();
  ed2.commands.redo();
  await settle();
  await settle();
  assert.equal(log2.beforeRedo.length, 1, 'beforeRedo asked');
  assert.equal(ed2.text(), b, 'false cancels the redo: nothing changes');
  ed2.destroy();
});

// ------------------------------------------------------------------------------------------------ FR-CNV-08 (guard)

async function guarded(answer: 'now' | boolean) {
  const b = BLOKY();
  const log = fresh();
  const ed = await openWith(b, log, {
    guardEmbedRemoval: (embeds: { pos: number; source: string }[]) => {
      log.guard.push(embeds.map((e) => ({ pos: e.pos, source: e.source })));
      return answer === 'now' ? null : Promise.resolve(answer);
    },
  });
  return { b, log, ed };
}

test('fr_cnv_08_ac1_removing_an_embed_waits_for_the_guard', async () => {
  for (const answer of [false, true] as const) {
    const { b, log, ed } = await guarded(answer);
    const k = blockIndex(ed, isEmbed('Zasedačka'), '![[Zasedačka]]');
    const pos = blockStart(ed, k);
    assert.equal(ed.commands.selectBlockAt(k), true, 'the embed selected as a block');
    ed.commands.deleteBlocks();
    assert.deepEqual(log.guard, [[{ pos, source: '![[Zasedačka]]' }]], `${answer}: the guard is asked once with the embed`);
    await settle();
    await settle();
    if (!answer) {
      assert.equal(ed.text(), b, 'Cancel: the document is unchanged');
      assert.equal(await ed.save(), null, 'and nothing is written');
    } else {
      assert.equal(await body(ed.text()), await body(sw(b, '![[Zasedačka]]\n\n', '')), 'Remove embed: the paragraph is removed');
      assert.equal(ed.commands.undo(), true, 'one undo step');
      assert.equal(ed.text(), b, 'undo restores it');
    }
    ed.destroy();
  }
});

test('fr_cnv_08_ac1_pasting_over_a_selection_with_an_embed_asks_and_is_one_step', async () => {
  const { b, log, ed } = await guarded(true);
  const k = blockIndex(ed, isEmbed('Zasedačka'), '![[Zasedačka]]');
  const q3 = blockIndex(ed, hasText('Q3: rozpočet/plán'), 'Q3');
  assert.equal(ed.commands.selectBlockRange(k, q3), true, 'block selection of the embed and the next paragraph');
  ed.commands.pasteText('Vložený text');
  assert.equal(log.guard.length, 1, 'the guard is asked once');
  assert.deepEqual(log.guard[0].map((e) => e.source), ['![[Zasedačka]]']);
  await settle();
  await settle();
  assert.ok(ed.text().includes('Vložený text') && !ed.text().includes('![[Zasedačka]]'), 'the paste replaced the selection');
  assert.equal(ed.commands.undo(), true, 'undo');
  assert.equal(ed.text(), b, 'one undo step, the pasted text included');
  ed.destroy();
});

test('fr_cnv_08_ac5_guard_is_not_asked_for_moves_undo_redo_and_without_embeds', async () => {
  const { b, log, ed } = await guarded('now');
  const k = blockIndex(ed, isEmbed('Zasedačka'), '![[Zasedačka]]');
  ed.commands.selectBlockAt(k);
  ed.commands.deleteBlocks();
  assert.equal(log.guard.length, 1, 'a deletion asks (null removes at once)');
  assert.ok(!ed.text().includes('![[Zasedačka]]'), 'null: removed at once');
  ed.commands.undo();
  ed.commands.redo();
  ed.commands.undo();
  assert.equal(ed.text(), b, 'undo / redo / undo');
  ed.commands.selectBlockAt(blockIndex(ed, isEmbed('Zasedačka'), '![[Zasedačka]]'));
  ed.commands.moveBlock('up');
  const z = blockIndex(ed, hasText('Závěrečný odstavec.'), 'Závěrečný');
  ed.commands.selectBlockAt(z);
  ed.commands.deleteBlocks();
  assert.equal(log.guard.length, 1, 'moves, undo, redo and removals without embeds never ask (D-496)');
  ed.destroy();
});

// ------------------------------------------------------------------------------------------------ FR-CNV-05 AC-6 (hint)

test('fr_cnv_05_ac6_empty_hint_is_shown_and_never_saved', async () => {
  const m = await editorModule();
  const text = `---\nid: 01JB5A0000000000000000R301\ntype: task\ntitle: Koupit lepidlo\nstatus: To do\nsource: "[[Bloky]]"\ncreated: ${NOW}\nmodified: ${NOW}\n---\n`;
  const element = document.createElement('div');
  document.body.appendChild(element);
  const ed = (m.createEditor as any)({ text, element, now: () => NOW, newId, section: null, convertible: false, emptyHint: 'Add details…' });
  assert.ok(element.outerHTML.includes('Add details…'), 'the hint is shown in the empty body');
  assert.equal(element.querySelector('[contenteditable="true"]') !== null, true, 'the body stays editable');
  ed.view.focus?.();
  assert.equal(await ed.save(), null, 'focusing writes nothing; the hint is never saved');
  assert.equal(ed.text(), text, 'the text has no hint');
  ed.destroy();
  element.remove();
});

// ------------------------------------------------------------------------------------------------ R53 slash items

test('fr_cnv_01_ac2_slash_items_task_and_turn_into_object_are_built', async () => {
  const m = await editorModule();
  const items = m.slashItems();
  const task = items.find((i) => i.id === 'task');
  const turn = items.find((i) => i.id === 'turnIntoObject');
  assert.ok(task && turn, 'slash items task and turnIntoObject');
  assert.deepEqual([task!.group, task!.label, task!.due ?? null], ['objects', 'Task', null], 'Task is built (R53)');
  assert.deepEqual([turn!.group, turn!.label, turn!.due ?? null], ['objects', 'Turn into object…', null], 'Turn into object… is built (R53)');
});

// ------------------------------------------------------------------------------------------------ link texts

test('fr_cnv_04_ac1_source_link_text_from_the_new_files_folder', async () => {
  const m = (await editorModule()) as any;
  const d = (await import('@tegg/doc')) as any;
  const cases: [Record<string, unknown>, string, string][] = [
    [{ path: 'Pages/Bloky.md', title: 'Bloky', fromPath: 'Tasks/Zavolat do servisu kvůli kolu.md', stemResolves: true }, '"[[Bloky]]"', 'Bloky'],
    [{ path: 'Pages/C tips.md', title: 'C# tips', fromPath: 'Tasks/Úkol z tipů.md', stemResolves: true }, '"[[C tips|C# tips]]"', 'C tips: |title'],
    [{ path: 'Pages/Dvojník.md', title: 'Dvojník', fromPath: 'Tasks/Úkol z dvojníka.md', stemResolves: true }, '"[[Dvojník]]"', 'Dvojník (Pages): the stem resolves to the shorter path'],
    [{ path: 'Quick Notes/Dvojník.md', title: 'Dvojník', fromPath: 'Tasks/Úkol z dvojníka (2).md', stemResolves: false }, '"[[Quick Notes/Dvojník|Dvojník]]"', 'Dvojník (Quick Notes): the vault path with |title (D-527)'],
    [{ path: 'Daily/2026-10-14.md', title: '2026-10-14', fromPath: 'Tasks/Zavolat zubaři.md', stemResolves: true }, '"[[2026-10-14]]"', 'a Daily Note: the date (D-162)'],
  ];
  for (const [c, want, what] of cases) {
    const text = m.linkText(c);
    const bytes: string = d.newObject({ type: { key: 'task', attributes: [], review: 'off' }, title: 'X', template: null, now: NOW, newId: () => 'ID', values: [['source', { link: text }]] });
    assert.equal(/^source: (.*)$/m.exec(bytes)?.[1] ?? null, want, what);
  }
});

test('fr_cnv_03_ac5_embed_targets_name_the_file_actually_created', async () => {
  const m = (await editorModule()) as any;
  const FROM = 'Pages/Bloky.md';
  const cases: [Record<string, unknown>, string][] = [
    [{ path: 'Tasks/Koupit lepidlo (2).md', title: 'Koupit lepidlo', fromPath: FROM, stemResolves: true }, 'Koupit lepidlo (2)'],
    [{ path: 'Tasks/Q3 rozpočet plán.md', title: 'Q3: rozpočet/plán', fromPath: FROM, stemResolves: true }, 'Q3 rozpočet plán'],
    [{ path: 'Tasks/Úkol z dvojníka (2).md', title: 'Úkol z dvojníka', fromPath: 'Quick Notes/Dvojník.md', stemResolves: true }, 'Úkol z dvojníka (2)'],
    [{ path: 'Tasks/Úkol v NFD.md', title: nfc('Úkol v NFD'), fromPath: 'Pages/NFD host.md', stemResolves: true }, nfc('Úkol v NFD')],
  ];
  for (const [c, want] of cases) {
    const got = m.embedTarget(c);
    assert.equal(got, want, String(c.path));
    assert.equal(got, nfc(got), 'NFC');
  }
  // The embed written into Bloky names the file actually created (never the planned `Koupit lepidlo`).
  const b = BLOKY();
  const ed = await openWith(b, fresh());
  select(ed, 'lepidlo');
  await convert(ed, m.embedTarget(cases[0][0]));
  assert.equal(await body(ed.text()), await body(sw(b, '- [ ] Koupit lepidlo\n- [x] Vrátit', '![[Koupit lepidlo (2)]]\n\n- [x] Vrátit')), 'the embed before the list names Koupit lepidlo (2)');
  ed.destroy();
  const ed2 = await openWith(b, fresh());
  select(ed2, 'rozpočet');
  await convert(ed2, m.embedTarget(cases[1][0]));
  assert.equal(await body(ed2.text()), await body(sw(b, 'Q3: rozpočet/plán', '![[Q3 rozpočet plán]]')), 'Q3: the sanitized stem');
  ed2.destroy();
});
