// MS4 slice 4F, L1 (@tegg/editor with real ProseMirror transactions, the save path through the real @tegg/doc):
// block embeds rendered through `EditorUi.embed` (FR-EMB-01 AC-1, AC-3), what `insertEmbed` writes (FR-EMB-01 AC-5,
// AC-6), a sole embed typed by hand (FR-EMB-01 AC-9), the slash items (FR-EMB-01 AC-11), the line text and undo of
// `setEmbedMode` (FR-EMB-02 AC-8), the keys on a selected embed and in a nested editor (FR-EMB-02 AC-14), the nested
// editor's save path (FR-EMB-03 AC-1) and a section editor (FR-EMB-03 AC-10).
// docs/acceptance/embeds.md; interface docs/contracts/ms4-embeds.md §7, §7.1. Written from the ACs and the contract
// only (D-61). Fixture: tests/fixtures/vaults/embeds (read only).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { blockStart, blocksRaw, body, caret, editorModule, frontWithoutModified, NOW, newId, press, readFixture, type } from './helpers';

const embedsNote = (rel: string) => readFixture(`tests/fixtures/vaults/embeds/${rel}`);
const VKLADANI = () => embedsNote('Pages/Vkládání.md');
const REZIMY = () => embedsNote('Pages/Režimy.md');
const UPRAVY = () => embedsNote('Pages/Úpravy.md');
const UPRAVITELNA = () => embedsNote('Pages/Upravitelná.md');

type Rec = { embeds: string[]; chips: string[]; placeholders: [string, string][]; leave: string[]; keys: [number, string][] };

/** The app's side of the editor (ms3-shell §13.5 plus 4F): records every block embed, inline embed chip and
 *  placeholder the editor asks for. */
function ui(rec: Rec) {
  return {
    resolve: () => ({ kind: 'note' as const, path: 'Pages/Cíl.md', type: 'page', title: 'Cíl' }),
    unresolved: (t: string) => `No note named ${t}`,
    sourceBlock: 'Source block',
    hint: 'Type / for commands',
    placeholder: (kind: 'embed' | 'query' | 'mindmap', value: string) => {
      rec.placeholders.push([kind, value]);
      return { name: `${kind} ${value}`, text: value };
    },
    onLink: () => {},
    onTag: () => {},
    onExternal: () => {},
    embed: (source: string, dom: HTMLElement) => {
      rec.embeds.push(source);
      dom.setAttribute('data-test-embed', source);
      return { update: () => {}, selected: () => {}, destroy: () => {} };
    },
    embedChip: (value: string) => {
      rec.chips.push(value);
      return { title: value, type: 'page', state: 'ok' as const, description: 'Embedded note' };
    },
  };
}
const fresh = (): Rec => ({ embeds: [], chips: [], placeholders: [], leave: [], keys: [] });

async function openWith(text: string, rec: Rec, extra: Record<string, unknown> = {}) {
  const m = await editorModule();
  return (m.createEditor as any)({
    text, now: () => NOW, newId, ui: ui(rec),
    onLeave: (how: string) => { rec.leave.push(how); return true; },
    onEmbedKey: (pos: number, key: string) => { rec.keys.push([pos, key]); return true; },
    ...extra,
  });
}
/** `text` with its `modified:` line set to the test clock. */
const touched = (text: string) => text.replace(/^modified: .*$/m, `modified: ${NOW}`);
/** Top-level blocks of the editor as their text, blank paragraphs dropped. */
function shown(ed: any): string[] {
  const out: string[] = [];
  ed.view.state.doc.forEach((n: any) => {
    if (n.type.name === 'paragraph' && n.textContent.trim() === '') return;
    out.push(n.textContent);
  });
  return out;
}

// ------------------------------------------------------------------------------------------------ FR-EMB-01 AC-1, AC-3

test('fr_emb_01_ac1_every_block_embed_is_rendered_through_the_embed_hook_in_file_order', async () => {
  const rec = fresh();
  const ed = await openWith(REZIMY(), rec);
  const want = [
    'Cíl', 'Jana Nováková', 'Šárka Malá', 'Svíčková', 'Saturnin', 'Zavolat Janě', 'Praha', '2026-10-07',
    'Cíl|card', 'Jana Nováková|full', 'Svíčková|link', 'Cíl|jiný text',
  ].map((v) => `![[${v}]]`);
  assert.deepEqual(rec.embeds, want, 'EditorUi.embed gets each sole-embed paragraph’s source, in file order');
  assert.deepEqual(rec.placeholders.filter(([k]) => k === 'embed'), [], 'no note embed falls back to the 3C placeholder');
  assert.equal(await ed.save(), null, 'rendering writes nothing');
  ed.destroy();

  const rec2 = fresh();
  const ed2 = await openWith(embedsNote('Pages/Rozbitá vložení.md'), rec2);
  assert.deepEqual(rec2.embeds, ['![[Chybí]]', '![[Šablona]]', '![[Smazaná]]', '![[Reading list]]', '![[2026-10-20]]', '![[Chyba hlavičky]]'], 'attachments and inline code are not block embeds');
  assert.ok(rec2.placeholders.some(([k, v]) => k === 'embed' && v.includes('obrázek.png')), 'obrázek.png keeps its R5 placeholder');
  ed2.destroy();
});

test('fr_emb_01_ac3_inline_embeds_are_chips_not_blocks', async () => {
  const rec = fresh();
  const ed = await openWith(embedsNote('Pages/Uvnitř textu.md'), rec);
  assert.deepEqual(rec.embeds, [], 'no embed in text, a list, a quote or a table is a block embed (D-419)');
  const asked = new Set(rec.chips.map((c) => c.normalize('NFC')));
  for (const v of ['Cíl', 'Jana Nováková']) assert.ok(asked.has(v), `embedChip asked for ${v} (got ${[...asked].join(', ')})`);
  assert.equal(await ed.save(), null, 'rendering writes nothing');
  ed.destroy();
});

// ------------------------------------------------------------------------------------------------ FR-EMB-01 AC-5, AC-6

test('fr_emb_01_ac5_insert_embed_in_an_empty_paragraph_writes_the_exact_body_and_undoes_in_one_step', async () => {
  const orig = VKLADANI();
  const rec = fresh();
  const ed = await openWith(orig, rec);
  caret(ed, 0); // end of `Odstavec před.`
  press(ed, 'Enter'); // Add block below
  const { from, to } = ed.view.state.selection;
  assert.equal(ed.commands.insertEmbed(from, to, 'Cíl'), true, 'insertEmbed applies');
  const out = await ed.save();
  assert.ok(out !== null, 'the insertion is saved');
  assert.equal(await body(out!), 'Odstavec před.\n\n![[Cíl]]\n\nOdstavec po.\n', 'body bytes');
  assert.equal(await frontWithoutModified(out!), await frontWithoutModified(orig), 'frontmatter differs only in modified');
  assert.equal(out, touched(orig).replace('Odstavec před.\n\nOdstavec po.\n', 'Odstavec před.\n\n![[Cíl]]\n\nOdstavec po.\n'), 'whole file');
  assert.ok(rec.embeds.includes('![[Cíl]]'), 'the new embed is rendered as an embed');
  assert.equal(ed.commands.undo(), true, 'undo applies');
  assert.deepEqual(shown(ed), ['Odstavec před.', 'Odstavec po.'], 'one undo step removes the embed paragraph');
  ed.destroy();
});

test('fr_emb_01_ac5_slash_text_in_a_paragraph_with_text_inserts_the_embed_after_it', async () => {
  const orig = VKLADANI();
  const ed = await openWith(orig, fresh());
  caret(ed, 0);
  type(ed, '/emb');
  const to = ed.view.state.selection.from;
  assert.equal(ed.commands.insertEmbed(to - 4, to, 'Cíl'), true, 'insertEmbed applies');
  const out = await ed.save();
  assert.equal(out && (await body(out)), 'Odstavec před.\n\n![[Cíl]]\n\nOdstavec po.\n', '`/emb` removed, the embed paragraph after that paragraph (FR-EDT-03 AC-4)');
  ed.destroy();
});

test('fr_emb_01_ac6_insert_embed_writes_the_target_text_byte_for_byte', async () => {
  const orig = VKLADANI();
  for (const target of ['Cíl', 'C tips', 'Senior Product Manager (2)', 'Dvojník', 'Quick Notes/Dvojník']) {
    const ed = await openWith(orig, fresh());
    caret(ed, 0);
    press(ed, 'Enter');
    const { from, to } = ed.view.state.selection;
    assert.equal(ed.commands.insertEmbed(from, to, target), true, `${target}: insertEmbed applies`);
    const out = await ed.save();
    assert.equal(out && (await body(out)), `Odstavec před.\n\n![[${target}]]\n\nOdstavec po.\n`, `${target}: never an alias (the | holds the mode, AP-319)`);
    assert.equal(out, out?.normalize('NFC'), `${target}: NFC`);
    ed.destroy();
  }
});

test('fr_emb_01_ac6_embed_target_of_each_choice_is_the_d184_target_without_title_or_alias', async () => {
  const m = (await editorModule()) as any;
  assert.equal(typeof m.embedTarget, 'function', '@tegg/editor exports embedTarget');
  const FROM = 'Pages/Vkládání.md';
  const cases: [Record<string, unknown>, string, string][] = [
    [{ path: 'Pages/Cíl.md', title: 'Cíl', fromPath: FROM, stemResolves: true }, 'Cíl', '(a) Cíl'],
    [{ path: 'Pages/Cíl.md', title: 'Cíl', viaAlias: 'Reading list', fromPath: FROM, stemResolves: true }, 'Cíl', '(b) through the alias Reading list: never an alias'],
    [{ path: 'Pages/C tips.md', title: 'C# tips', fromPath: FROM, stemResolves: true }, 'C tips', '(c) C tips: no |title'],
    [{ path: 'Pages/Senior Product Manager (2).md', title: 'Senior Product Manager', fromPath: FROM, stemResolves: true }, 'Senior Product Manager (2)', '(d) SPM 2'],
    [{ path: 'Pages/Dvojník.md', title: 'Dvojník', fromPath: FROM, stemResolves: true }, 'Dvojník', '(e) Dvojník in Pages'],
    [{ path: 'Quick Notes/Dvojník.md', title: 'Rychlý dvojník', fromPath: FROM, stemResolves: false }, 'Quick Notes/Dvojník', '(e) Dvojník in Quick Notes: the vault path without .md'],
    [{ path: 'Pages/Ci\u0301l kopie.md', title: 'Ci\u0301l kopie', fromPath: FROM, stemResolves: true }, 'Cíl kopie', 'an NFD-named copy of Cíl: written in NFC (FR-FMT-12)'],
  ];
  for (const [c, want, what] of cases) {
    const got = m.embedTarget(c);
    assert.equal(got, want, what);
    assert.equal(got, String(got).normalize('NFC'), `${what}: NFC`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-EMB-01 AC-9

test('fr_emb_01_ac9_a_sole_embed_typed_by_hand_becomes_an_embed_block', async () => {
  const orig = VKLADANI();
  const rec = fresh();
  const ed = await openWith(orig, rec);
  caret(ed, 0);
  press(ed, 'Enter');
  type(ed, '![[Cíl]]');
  assert.deepEqual(rec.embeds, ['![[Cíl]]'], 'turned into a block embed when `]]` is typed, rendered through EditorUi.embed');
  const out = await ed.save();
  assert.equal(out && (await body(out)), 'Odstavec před.\n\n![[Cíl]]\n\nOdstavec po.\n', 'saved byte for byte');
  ed.destroy();

  const rec2 = fresh();
  const ed2 = await openWith(orig, rec2);
  caret(ed2, 0);
  press(ed2, 'Enter');
  type(ed2, '![[obrázek.png]]');
  assert.deepEqual(rec2.embeds, [], 'an attachment embed stays the embed-image placeholder');
  ed2.destroy();
});

// ------------------------------------------------------------------------------------------------ FR-EMB-01 AC-11

test('fr_emb_01_ac11_slash_items_embed_object_built_block_embed_v1_0', async () => {
  const m = await editorModule();
  const items = m.slashItems();
  const obj = items.find((i) => i.id === 'embedObject');
  const blk = items.find((i) => i.id === 'blockEmbed');
  assert.ok(obj && blk, `slash items embedObject and blockEmbed (ids: ${items.map((i) => i.id).join(', ')})`);
  assert.equal(obj!.due, undefined, 'Embed object is built (no due)');
  assert.equal(obj!.group, 'objects');
  assert.deepEqual(blk!.due, { milestone: 'v1.0' }, 'Block embed moves to v1.0 (AP-329)');
  assert.equal(blk!.group, 'advanced');
});

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-8

test('fr_emb_02_ac8_set_embed_mode_changes_only_that_line_as_one_undo_step', async () => {
  const orig = REZIMY();
  const ed = await openWith(orig, fresh());
  const jana = blockStart(ed, 2); // ![[Jana Nováková]]
  assert.equal(ed.commands.setEmbedMode(jana, 'full'), true, 'setEmbedMode applies');
  const out = await ed.save();
  assert.equal(out, touched(orig).replace('\n![[Jana Nováková]]\n', '\n![[Jana Nováková|full]]\n'), 'that line and modified only');
  assert.deepEqual((await blocksRaw(out!)).filter((b) => b.startsWith('![[')).length, 12, 'all 12 embed lines still there');
  ed.destroy();

  const ed2 = await openWith(orig, fresh());
  assert.equal(ed2.commands.setEmbedMode(blockStart(ed2, 2), 'full'), true);
  assert.equal(ed2.commands.undo(), true, 'undo applies');
  assert.equal(await ed2.save(), null, 'one undo step restores the original');
  ed2.destroy();

  const ed3 = await openWith(orig, fresh());
  assert.equal(ed3.commands.setEmbedMode(blockStart(ed3, 10), null), true, 'the type default on `|full` removes the keyword');
  assert.equal(await ed3.save(), touched(orig).replace('![[Jana Nováková|full]]', '![[Jana Nováková]]'));
  ed3.destroy();

  const ed4 = await openWith(orig, fresh());
  assert.equal(ed4.commands.setEmbedMode(blockStart(ed4, 12), 'card'), true);
  assert.equal(ed4.text(), touched(orig).replace('![[Cíl|jiný text]]', '![[Cíl|card]]'), '`|jiný text` replaced by `|card`');
  assert.equal(ed4.commands.undo(), true);
  assert.equal(await ed4.save(), null, '⌘Z restores `|jiný text`');
  ed4.destroy();
});

test('fr_emb_02_ac8_set_embed_mode_refuses_a_position_that_is_no_embed', async () => {
  const ed = await openWith(REZIMY(), fresh());
  assert.equal(ed.commands.setEmbedMode(blockStart(ed, 0), 'card'), false, '`Před vloženími.` is no embed');
  assert.equal(await ed.save(), null);
  assert.equal(ed.commands.setEmbedMode(blockStart(ed, 1), 'card'), true, 'red guard: the Cíl embed is one');
  ed.destroy();
});

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-14

test('fr_emb_02_ac14_a_selected_embed_is_reported_and_its_keys_go_to_the_app', async () => {
  const rec = fresh();
  const ed = await openWith(UPRAVY(), rec);
  assert.equal(ed.commands.selectBlockAt(1), true, 'selectBlockAt(1) selects the first embed');
  const sel = ed.selectedEmbed();
  assert.deepEqual(sel, { pos: blockStart(ed, 1), index: 1, source: '![[Upravitelná]]' }, 'selectedEmbed');
  press(ed, 'Enter');
  press(ed, 'Enter', { meta: true });
  assert.deepEqual(rec.keys, [[blockStart(ed, 1), 'enter'], [blockStart(ed, 1), 'open']], '⏎ enters, ⌘↩ opens (D-428)');
  assert.equal(await ed.save(), null, 'nothing written');
  assert.equal(ed.commands.selectBlockAt(0), true);
  assert.equal(ed.selectedEmbed(), null, 'a paragraph is no embed');
  ed.destroy();
});

test('fr_emb_02_ac14_escape_in_a_nested_editor_leaves_it', async () => {
  const rec = fresh();
  const ed = await openWith(UPRAVITELNA(), rec, { section: null });
  caret(ed, 0, 0);
  press(ed, 'Escape');
  assert.deepEqual(rec.leave, ['escape'], 'Esc calls onLeave("escape")');
  assert.equal(await ed.save(), null, 'nothing written');
  ed.destroy();
});

// ------------------------------------------------------------------------------------------------ FR-EMB-03 AC-1, AC-10

test('fr_emb_03_ac1_the_host_gives_each_embed_a_slot_and_the_nested_editor_writes_only_its_paragraph', async () => {
  const rec = fresh();
  const host = await openWith(UPRAVY(), rec);
  assert.deepEqual(rec.embeds, ['![[Upravitelná]]', '![[Upravitelná]]', '![[Bez hlavičky]]', '![[Upravitelná#Druhá část]]'], 'one embed slot per block embed of Úpravy');
  const orig = UPRAVITELNA();
  const nested = await openWith(orig, fresh(), { section: null });
  caret(nested, 0); // end of `První odstavec k úpravě.`
  type(nested, ' Doplněno.');
  const out = await nested.save();
  assert.equal(out, touched(orig).replace('První odstavec k úpravě.\n', 'První odstavec k úpravě. Doplněno.\n'), 'only that paragraph and modified (D-55)');
  assert.ok(out!.includes('Druhý odstavec s _kurzívou_ a __tučně__.\n\n* hvězdička jedna\n* hvězdička dvě\n'), 'non-canonical markers kept');
  assert.equal(await host.save(), null, 'the host isn’t written');
  host.destroy();
  nested.destroy();
});

test('fr_emb_03_ac10_a_section_editor_shows_and_saves_only_its_section', async () => {
  const orig = UPRAVITELNA();
  const ed = await openWith(orig, fresh(), { section: 'Druhá část' });
  assert.deepEqual(shown(ed), ['Text druhé části.'], 'only the section, without its heading line');
  caret(ed, 0);
  type(ed, ' Doplněno.');
  const out = await ed.save();
  assert.equal(out, touched(orig).replace('Text druhé části.\n', 'Text druhé části. Doplněno.\n'), 'the whole file is saved; only that line and modified change');
  ed.destroy();
});

test('fr_emb_03_ac10_a_heading_typed_in_a_section_ends_it_after_mark_saved', async () => {
  const orig = UPRAVITELNA();
  const ed = await openWith(orig, fresh(), { section: 'Druhá část' });
  caret(ed, 0);
  press(ed, 'Enter');
  type(ed, '## ');
  type(ed, 'Vsuvka');
  press(ed, 'Enter');
  type(ed, 'Text vsuvky.');
  const out = await ed.save();
  assert.equal(
    out,
    touched(orig).replace('Text druhé části.\n\n## Třetí část', 'Text druhé části.\n\n## Vsuvka\n\nText vsuvky.\n\n## Třetí část'),
    '`## Vsuvka` and `Text vsuvky.` saved just before `## Třetí část`',
  );
  ed.markSaved(out!);
  assert.deepEqual(shown(ed), ['Text druhé části.'], 'after the save the section ends before Vsuvka');
  ed.destroy();
});
