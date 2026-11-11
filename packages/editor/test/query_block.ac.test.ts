// Slice Q, L1 (@tegg/editor with real ProseMirror transactions, the save path through the real @tegg/doc): the query
// block of docs/acceptance/queries.md FR-EDT-02 AC-24 (one atom: rendered through `EditorUi.query`, selected, moved,
// deleted as a whole; opening writes nothing; ⌘↩ asks the app to open its editor), AC-25 (undo of insert, move and
// delete restores the exact bytes), FR-QRY-06 AC-9 (`insertQuery` with a name; slash item `Advanced › Query`), AC-10
// (`insertQuery(…, null)`: a `draft` block that is never serialized, `dropQueryDraft`, the first commit's `setSource`),
// AC-12 / AC-14 (`QueryCtl.setSource`: one transaction, one undo step, only that fence's bytes) and FR-FMT-07 AC-30
// (notes with blocks round-trip; an edit next to a block changes only that block). Interface
// docs/contracts/v1-queries.md §3.2. Fixture tests/fixtures/vaults/queries (read only). Written from the ACs and the
// contract only (D-61); the new hooks and commands are read at run time, so their absence is an assertion failure (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { NodeSelection } from '@tiptap/pm/state';
import { blockStart, body, caret, editorModule, frontWithoutModified, NOW, newId, press, readFixture, type } from './helpers';

const fx = (rel: string) => readFixture(`tests/fixtures/vaults/queries/${rel}`);
const PORADA = () => fx('Schůzky/2026-10-07 Týdenní porada.md');
const LISABON = () => fx('Projekty/Výjezd Lisabon 2026.md');
const PREHLED = () => fx('Pages/Přehled dotazů.md');
const OPEN = 'saved: Otevřené úkoly z této schůzky';
const TABLE = 'saved: Úkoly z této schůzky';

type Ctl = { getPos(): number | undefined; nested: boolean; draft: boolean; setSource(source: string): boolean; select(): void };
type Rec = { queries: { source: string; ctl: Ctl; dom: HTMLElement }[]; keys: [number, string][]; placeholders: [string, string][] };
const fresh = (): Rec => ({ queries: [], keys: [], placeholders: [] });
function ui(rec: Rec) {
  return {
    resolve: () => ({ kind: 'note' as const, path: 'Pages/Cíl.md', type: 'page', title: 'Cíl' }),
    unresolved: (t: string) => `No note named ${t}`,
    sourceBlock: 'Source block',
    hint: 'Type / for commands',
    placeholder: (kind: 'embed' | 'query' | 'mindmap', value: string) => { rec.placeholders.push([kind, value]); return { name: `${kind} ${value}`, text: value }; },
    onLink: () => {}, onTag: () => {}, onExternal: () => {},
    query: (source: string, dom: HTMLElement, ctl: Ctl) => {
      rec.queries.push({ source, ctl, dom });
      dom.setAttribute('data-test-query', source);
      return { update: () => {}, selected: () => {}, destroy: () => {} };
    },
  };
}
async function openWith(text: string, rec: Rec) {
  const m = await editorModule();
  return (m.createEditor as any)({
    text, now: () => NOW, newId, ui: ui(rec),
    onQueryKey: (pos: number, key: string) => { rec.keys.push([pos, key]); return true; },
  });
}
/** Top-level nodes as `type:kind` (rawBlock kinds) or the node type. */
function tops(ed: any): string[] {
  const out: string[] = [];
  ed.view.state.doc.forEach((n: any) => out.push(n.type.name === 'rawBlock' ? `rawBlock:${n.attrs.kind}${n.attrs.draft ? ':draft' : ''}` : n.type.name));
  return out;
}
function selectAt(ed: any, k: number) {
  ed.view.dispatch(ed.view.state.tr.setSelection(NodeSelection.create(ed.view.state.doc, blockStart(ed, k))));
}
const swap = (t: string, a: string, b: string) => t.replace(a, '\u0000').replace(b, a).replace('\u0000', b);
const fence = (line: string) => `\`\`\`query\n${line}\n\`\`\``;

// ------------------------------------------------------------------------------------------------ FR-EDT-02 AC-24

test('fr_edt_02_ac24_query_block_is_one_atom', async () => {
  const orig = PORADA();
  const rec = fresh();
  const ed = await openWith(orig, rec);
  assert.deepEqual(tops(ed), ['paragraph', 'heading', 'rawBlock:query', 'rawBlock:query', 'paragraph'], 'each top-level fence is one rawBlock of kind query');
  const node = ed.view.state.doc.child(2);
  assert.ok(node.type.spec.atom && node.type.spec.selectable !== false && node.type.spec.draggable, 'an atom, selectable, draggable');
  assert.equal(node.attrs.draft, false, '`draft` defaults to false');
  assert.deepEqual(rec.queries.map((q) => [q.source.includes(OPEN), q.source.includes(TABLE), q.ctl.nested, q.ctl.draft]), [[true, false, false, false], [false, true, false, false]],
    'EditorUi.query renders both blocks, in file order, top level, not drafts');
  assert.deepEqual(rec.placeholders.filter(([k]) => k === 'query'), [], 'no query block falls back to the R5 placeholder');
  assert.equal(await ed.save(), null, 'opening and rendering write nothing');
  // ⌘↩ on a selected block asks the app to open its editor (R144).
  selectAt(ed, 2);
  press(ed, 'Enter', { meta: true });
  assert.deepEqual(rec.keys, [[blockStart(ed, 2), 'open']], '⌘↩ on the selected block: onQueryKey(pos, "open")');
  // ⇧⌘↓ moves it as a whole; ⌫ deletes it as a whole.
  selectAt(ed, 2);
  assert.equal(ed.commands.moveBlock('down'), true, 'moveBlock applies');
  const moved = await ed.save();
  assert.equal(moved && (await body(moved)), await body(swap(orig, OPEN, TABLE)), 'the two fences swap, byte for byte');
  assert.equal(await frontWithoutModified(moved!), await frontWithoutModified(orig), 'frontmatter: only `modified`');
  ed.destroy();
  const ed2 = await openWith(orig, fresh());
  selectAt(ed2, 3);
  assert.equal(ed2.commands.deleteBlocks(), true, 'deleteBlocks applies');
  const deleted = await ed2.save();
  assert.ok(deleted && !deleted.includes(TABLE) && deleted.includes(fence(OPEN)), 'the selected fence is gone, the other kept');
  assert.equal(await body(deleted!), (await body(orig)).replace(`${fence(TABLE)}\n\n`, ''), 'only that fence and its separator go');
  ed2.destroy();
  // A fence in a list stays a codeBlock `query`, drawn through the same hook with `nested: true`; it writes nothing.
  const nestedText = `${orig.slice(0, orig.indexOf('Program:'))}- úkoly\n\n  \`\`\`query\n  ${OPEN}\n  \`\`\`\n`;
  const rec3 = fresh();
  const ed3 = await openWith(nestedText, rec3);
  let code: any = null;
  ed3.view.state.doc.descendants((n: any) => { if (n.type.name === 'codeBlock' && n.attrs.language === 'query') code = n; return !code; });
  assert.ok(code, 'a nested fence is a codeBlock with language `query`');
  assert.deepEqual(rec3.queries.map((q) => [q.source.includes(OPEN), q.ctl.nested]), [[true, true]], 'drawn through EditorUi.query with nested: true');
  assert.equal(await ed3.save(), null, 'a nested block writes nothing either');
  ed3.destroy();
});

// ------------------------------------------------------------------------------------------------ FR-EDT-02 AC-25

test('fr_edt_02_ac25_query_block_undo_and_reload', async () => {
  const orig = PORADA();
  const origBody = await body(orig);
  for (const step of ['insert', 'move', 'delete'] as const) {
    const ed = await openWith(orig, fresh());
    if (step === 'insert') {
      caret(ed, 4);
      const { from, to } = ed.view.state.selection;
      assert.equal(typeof ed.commands.insertQuery, 'function', 'EditorHandle.insertQuery (contract §3.2)');
      assert.equal(ed.commands.insertQuery(from, to, 'Projekty v běhu'), true, 'insertQuery applies');
    } else {
      selectAt(ed, 2);
      assert.equal(step === 'move' ? ed.commands.moveBlock('down') : ed.commands.deleteBlocks(), true, `${step} applies`);
    }
    const changed = await ed.save();
    assert.ok(changed && (await body(changed)) !== origBody, `${step}: the body changed`);
    assert.equal(ed.commands.undo(), true, `${step}: one undo applies`);
    // save() compares with the opened text (markSaved isn't called), so after the undo it is null: nothing to write.
    const back = (await ed.save()) ?? orig;
    assert.equal(await body(back), origBody, `${step}: ⌘Z restores the exact previous bytes`);
    ed.destroy();
  }
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-9, AC-10

test('fr_qry_06_ac9_insert_saved_query_block', async () => {
  const m = await editorModule();
  const item = m.slashItems().find((i) => i.id === 'query');
  assert.deepEqual(item && [item.group, item.label, item.due ?? null], ['advanced', 'Query', null], 'slash item `Advanced › Query`, built (no due)');
  const orig = LISABON();
  const rec = fresh();
  const ed = await openWith(orig, rec);
  caret(ed, 0); // the end of `Cesta týmu do Lisabonu.`
  type(ed, '/quer');
  const to = ed.view.state.selection.from;
  assert.equal(typeof ed.commands.insertQuery, 'function', 'EditorHandle.insertQuery (contract §3.2)');
  assert.equal(ed.commands.insertQuery(to - 5, to, 'Projekty v běhu'), true, 'insertQuery applies');
  assert.ok(ed.view.state.selection instanceof NodeSelection && ed.view.state.selection.node.attrs.kind === 'query', 'the new block is selected');
  const out = await ed.save();
  assert.equal(out && (await body(out)), `Cesta týmu do Lisabonu.\n\n${fence('saved: Projekty v běhu')}\n\n${fence('saved: Vše, co sem odkazuje')}\n`, '`/quer` removed, the fence after that paragraph');
  assert.ok(rec.queries.some((q) => q.source.includes('saved: Projekty v běhu') && !q.ctl.draft), 'the new block is drawn through EditorUi.query');
  assert.equal(ed.commands.undo(), true, 'one undo step');
  assert.equal(await body((await ed.save()) ?? orig), (await body(orig)).replace('Cesta týmu do Lisabonu.', 'Cesta týmu do Lisabonu./quer'), 'one undo step takes the block out and gives the typed `/quer` back');
  ed.destroy();
});

test('fr_qry_06_ac10_new_query_from_the_note', async () => {
  const orig = LISABON();
  const rec = fresh();
  const ed = await openWith(orig, rec);
  caret(ed, 0);
  type(ed, '/quer');
  const to = ed.view.state.selection.from;
  assert.equal(typeof ed.commands.insertQuery, 'function', 'EditorHandle.insertQuery (contract §3.2)');
  assert.equal(ed.commands.insertQuery(to - 5, to, null), true, 'insertQuery(…, null) applies');
  assert.deepEqual(tops(ed), ['paragraph', 'rawBlock:query:draft', 'rawBlock:query'], 'an empty draft block after the paragraph');
  const draft = rec.queries.find((q) => q.ctl.draft);
  assert.ok(draft, 'the draft is drawn through EditorUi.query with draft: true');
  assert.equal(await ed.save(), null, 'a draft is never serialized: nothing to write (D-1471)');
  assert.equal(typeof ed.commands.dropQueryDraft, 'function', 'EditorHandle.dropQueryDraft (contract §3.2)');
  assert.equal(ed.commands.dropQueryDraft(draft!.ctl.getPos()!), true, 'dropQueryDraft applies');
  assert.deepEqual(tops(ed), ['paragraph', 'rawBlock:query'], 'the draft is gone');
  assert.equal(await ed.save(), null, 'still nothing to write');
  ed.destroy();
  // The first commit names the created query: `setSource` writes the fence, one transaction (D-1495: the created name).
  const rec2 = fresh();
  const ed2 = await openWith(orig, rec2);
  caret(ed2, 0);
  type(ed2, '/quer');
  const t2 = ed2.view.state.selection.from;
  ed2.commands.insertQuery(t2 - 5, t2, null);
  const d2 = rec2.queries.find((q) => q.ctl.draft)!;
  assert.equal(d2.ctl.setSource(fence('saved: Untitled query (2)')), true, 'setSource applies');
  assert.deepEqual(tops(ed2), ['paragraph', 'rawBlock:query', 'rawBlock:query'], 'no longer a draft');
  const out = await ed2.save();
  assert.equal(out && (await body(out)), `Cesta týmu do Lisabonu.\n\n${fence('saved: Untitled query (2)')}\n\n${fence('saved: Vše, co sem odkazuje')}\n`, 'the fence names the created query');
  ed2.destroy();
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-12, AC-14

test('fr_qry_06_ac12_choose_a_query_rewrites_the_fence', async () => {
  const orig = PREHLED();
  const rec = fresh();
  const ed = await openWith(orig, rec);
  const q = rec.queries.find((x) => x.source.includes('saved: Neexistující dotaz'));
  assert.ok(q, 'the not-found block is drawn through EditorUi.query');
  assert.equal(q!.ctl.setSource(q!.source.replace('saved: Neexistující dotaz', 'saved: Zrušené úkoly')), true, 'setSource applies');
  const out = await ed.save();
  assert.equal(out && (await body(out)), (await body(orig)).replace('saved: Neexistující dotaz', 'saved: Zrušené úkoly'), 'only that fence\'s `saved:` line changes');
  assert.equal(ed.commands.undo(), true, 'one undo step');
  assert.equal(await body((await ed.save()) ?? orig), await body(orig), 'undo restores the fence');
  ed.destroy();
});

test('fr_qry_06_ac14_inline_fences_are_read_only', async () => {
  const orig = PREHLED();
  const rec = fresh();
  const ed = await openWith(orig, rec);
  const inline = rec.queries.find((x) => x.source.includes('title: Ruční dotaz'));
  assert.ok(inline, 'the inline fence is drawn through EditorUi.query');
  assert.equal(await ed.save(), null, 'shown, never written');
  assert.equal(inline!.ctl.setSource(fence('saved: Ruční dotaz')), true, '`Save as query…`: setSource applies');
  const out = await ed.save();
  const was = '```query\ntitle: Ruční dotaz\ntypes: [kniha]\nfilters:\n  - přečteno: true\n# napsáno ručně\nview: list\n```';
  assert.equal(out && (await body(out)), (await body(orig)).replace(was, fence('saved: Ruční dotaz')), 'only that fence\'s body is replaced');
  ed.destroy();
});

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-30

test('fr_fmt_07_ac30_notes_with_query_blocks_round_trip', async () => {
  for (const path of ['Schůzky/2026-10-07 Týdenní porada.md', 'Schůzky/2026-10-14 Týdenní porada.md', 'Projekty/Výjezd Lisabon 2026.md', 'Daily/2026-11-10.md', 'Pages/Přehled dotazů.md', '_templates/Schůzka/Schůzka.md']) {
    const orig = fx(path);
    const rec = fresh();
    const ed = await openWith(orig, rec);
    assert.ok(rec.queries.length >= 1, `${path}: its blocks are query blocks`);
    assert.equal(await ed.save(), null, `${path}: open and save with no edit writes nothing`);
    // An edit in the paragraph or heading next to a block changes only that block's bytes. The block is a plain-text
    // one (no link chips or marks, whose textContent isn't their source) whose text ends exactly one source line.
    const origBody = await body(orig);
    let k = -1;
    ed.view.state.doc.forEach((n: any, _o: number, i: number) => {
      if (k >= 0 || (n.type.name !== 'paragraph' && n.type.name !== 'heading') || !n.textContent) return;
      let plain = true;
      n.forEach((c: any) => { if (!c.isText || c.marks.length) plain = false; });
      if (plain && origBody.split(`${n.textContent}\n`).length === 2) k = i;
    });
    assert.ok(k >= 0, `${path}: has a plain text block`);
    const before = `${ed.view.state.doc.child(k).textContent as string}\n`;
    caret(ed, k);
    type(ed, ' x');
    const out = await ed.save();
    assert.ok(out, `${path}: the edit is saved`);
    assert.equal(await body(out!), origBody.replace(before, `${before.slice(0, -1)} x\n`), `${path}: only that block's bytes change`);
    for (const q of rec.queries) assert.ok(out!.includes(q.source.trimEnd()), `${path}: the fence bytes stay`);
    ed.destroy();
  }
});
