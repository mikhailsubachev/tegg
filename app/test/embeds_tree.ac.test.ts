// MS4 slice 4F, L1: the embed tree (docs/contracts/ms4-embeds.md §5): the mode of each embed (FR-EMB-02 AC-1, AC-6,
// D-416, D-417, D-419), inline embeds (FR-EMB-01 AC-3), what isn't an embed (FR-EMB-01 AC-4), sections and their
// states (FR-EMB-02 AC-3), broken targets (FR-LNK-07 AC-6), other states (FR-LNK-07 AC-7), circular embeds and depth 3
// (FR-EMB-04 AC-1…AC-6, AC-9), batched loading (FR-EMB-02 AC-12). Pure functions over an in-memory `embed_load`
// (embeds-helpers.ts). Written from docs/acceptance/embeds.md and the contract only (D-61). The tree module is loaded
// dynamically inside each test (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { NFD_CIL, NFD_UVOD, TYPES, fixture, fixtureLoader, hostOf, rows, treeModule, typeDto } from './embeds-helpers';

async function treeOf(path: string, opts?: Record<string, unknown>, overrides: Record<string, string | null> = {}, text?: string) {
  const t = await treeModule();
  const loader = await fixtureLoader(overrides);
  const host = await hostOf(path, text ?? overrides[path] ?? fixture(path));
  const tree = await t.buildEmbedTree(host, TYPES(), loader.load, opts);
  return { tree, calls: loader.calls, flat: loader.calls.flat().map((p) => p.normalize('NFC')) };
}
const REZIMY_VALUES = [
  'Cíl', 'Jana Nováková', 'Šárka Malá', 'Svíčková', 'Saturnin', 'Zavolat Janě', 'Praha', '2026-10-07',
  'Cíl|card', 'Jana Nováková|full', 'Svíčková|link', 'Cíl|jiný text',
];
const REZIMY_MODES = ['full', 'card', 'card', 'full', 'link', 'card', 'card', 'full', 'card', 'full', 'link', 'full'];
const REZIMY_TYPES = ['page', 'osoba', 'osoba', 'recept', 'kniha', 'task', 'místo', 'daily-note', 'page', 'osoba', 'recept', 'page'];

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-1, AC-6

test('fr_emb_02_ac1_embed_mode_for_each_embed_of_rezimy', async () => {
  const t = await treeModule();
  const types = TYPES();
  const got = REZIMY_VALUES.map((v, i) => t.embedModeFor(v, REZIMY_TYPES[i], types, false));
  assert.deepEqual(got, REZIMY_MODES, 'block embeds: keyword, else the type default (R31, recept full, kniha link, místo unknown → card)');
  assert.deepEqual(REZIMY_VALUES.map((v, i) => t.embedModeFor(v, REZIMY_TYPES[i], types, true)), REZIMY_MODES.map(() => 'link'), 'inline embeds are always link (D-419)');
  assert.equal(t.embedModeFor('Dvojník', 'quick-note', types, false), 'full', 'Quick Note default full');
  assert.equal(t.embedModeFor('Cíl|CARD', 'page', types, false), 'card', 'keyword in any case');
  assert.equal(t.embedModeFor('Cíl| Link ', 'page', types, false), 'link', 'keyword trimmed');
  assert.equal(t.embedModeFor('Cíl#Úvod', 'page', types, false), 'full');
});

test('fr_emb_02_ac6_type_defaults_without_and_with_a_definition', async () => {
  const t = await treeModule();
  assert.equal(t.embedModeFor('Svíčková', 'recept', [], false), 'card', 'a type without a definition (D-121) → R31 card');
  assert.equal(t.embedModeFor('Cíl', 'page', [], false), 'full', 'Page without a type file → R31 full');
  assert.equal(t.embedModeFor('2026-10-07', 'daily-note', [], false), 'full', 'Daily Note → full');
  for (const k of ['task', 'tag', 'image', 'pdf']) assert.equal(t.embedModeFor('X', k, [], false), 'card', `${k} → card`);
  assert.equal(t.embedModeFor('Praha', 'místo', TYPES(), false), 'card', 'místo’s unknown value → card');
  // The type's effective mode is what counts: recept changed to `embed: card` (FR-EMB-02 AC-10).
  const types = TYPES().map((x) => (x.key === 'recept' ? { ...x, embed: 'card', embedRaw: 'card' } : x));
  assert.equal(t.embedModeFor('Svíčková', 'recept', types, false), 'card', 'recept → card after the change');
  assert.equal(t.embedModeFor('Svíčková|full', 'recept', types, false), 'full', 'the per-embed keyword still wins');
  assert.equal(typeDto('recept').embed, 'full', 'setup: the fixture’s recept is full');
});

test('fr_emb_02_ac1_tree_of_rezimy_in_file_order_with_one_load', async () => {
  const { tree, calls, flat } = await treeOf('Pages/Režimy.md');
  assert.deepEqual(rows(tree.embeds), REZIMY_VALUES.map((v, i) => [1, v, REZIMY_MODES[i], 'ok']), 'modes and states in file order');
  assert.deepEqual(tree.embeds.map((n: any) => n.line), REZIMY_VALUES.map((_, i) => 10 + 2 * i), 'lines');
  assert.deepEqual(tree.embeds.map((n: any) => n.inline), REZIMY_VALUES.map(() => false), 'all are block embeds');
  assert.deepEqual(tree.embeds.map((n: any) => n.target.path), [
    'Pages/Cíl.md', 'Osoby/Jana Nováková.md', 'Osoby/Šárka Malá.md', 'Recepty/Svíčková.md', 'Knihy/Saturnin.md', 'Tasks/Zavolat Janě.md',
    'Místa/Praha.md', 'Daily/2026-10-07.md', 'Pages/Cíl.md', 'Osoby/Jana Nováková.md', 'Recepty/Svíčková.md', 'Pages/Cíl.md',
  ], 'targets');
  assert.equal(tree.path, 'Pages/Režimy.md');
  assert.equal(tree.loads, 1, 'one embed_load call for all 12 embeds (D-429)');
  assert.equal(calls.length, 1, 'one call');
  assert.deepEqual([...flat].sort(), ['Daily/2026-10-07.md', 'Místa/Praha.md', 'Osoby/Jana Nováková.md', 'Osoby/Šárka Malá.md', 'Pages/Cíl.md', 'Recepty/Svíčková.md', 'Tasks/Zavolat Janě.md'].sort(), 'full and card targets, each once; link-mode Saturnin isn’t read');
  const cil = tree.embeds[0];
  assert.equal(cil.note?.text, fixture('Pages/Cíl.md'), 'the full embed holds the loaded file');
  assert.equal(cil.section?.kind, 'whole', 'whole note');
  assert.equal(cil.readOnly, false, 'a depth-1 full embed of a whole note is editable in the editor (D-421)');
});

test('fr_emb_02_ac1_quick_note_target_in_the_same_folder_is_full', async () => {
  const { tree } = await treeOf('Quick Notes/Vložení dvojníka.md');
  assert.deepEqual(rows(tree.embeds), [[1, 'Dvojník', 'full', 'ok']]);
  assert.equal(tree.embeds[0]?.target.path, 'Quick Notes/Dvojník.md', 'same folder first');
});

// ------------------------------------------------------------------------------------------------ FR-EMB-01 AC-3, AC-4

test('fr_emb_01_ac3_embeds_in_text_lists_quotes_and_tables_are_inline_link_mode', async () => {
  const { tree, flat } = await treeOf('Pages/Uvnitř textu.md');
  assert.deepEqual(rows(tree.embeds), [[1, 'Cíl', 'link', 'ok'], [1, 'Jana Nováková', 'link', 'ok'], [1, 'Cíl', 'link', 'ok'], [1, 'Cíl', 'link', 'ok'], [1, 'Cíl', 'link', 'ok']]);
  assert.deepEqual(tree.embeds.map((n: any) => [n.inline, n.line]), [[true, 8], [true, 10], [true, 11], [true, 13], [true, 17]]);
  assert.deepEqual(flat, [], 'link-mode embeds load nothing');
  // A `|full` or `|card` override doesn't make an inline embed a frame.
  const text = fixture('Pages/Uvnitř textu.md').replace('Text s vloženým ![[Cíl]] uvnitř', 'Text s vloženým ![[Cíl|full]] uvnitř').replace('- ![[Cíl]]', '- ![[Cíl|card]]');
  const o = await treeOf('Pages/Uvnitř textu.md', undefined, {}, text);
  assert.deepEqual(o.tree.embeds.map((n: any) => n.mode), ['link', 'link', 'link', 'link', 'link']);
});

test('fr_emb_01_ac4_code_frontmatter_comments_and_attachments_are_not_embeds', async () => {
  const { tree, flat } = await treeOf('Pages/Rozbitá vložení.md');
  assert.deepEqual(tree.embeds.map((n: any) => n.value), ['Chybí', 'Šablona', 'Smazaná', 'Reading list', '2026-10-20', 'Chyba hlavičky'], 'obrázek.png and the inline code aren’t embeds');
  assert.ok(!flat.some((p) => p.endsWith('.png')), 'nothing is read for obrázek.png (D-144)');
  const text = '---\nid: 01JB4F0000000000000000T001\ntype: page\nvztah: "![[Cíl]]"\n---\n```\n![[Cíl]]\n```\n\n%%![[Cíl]]%%\n\nText `![[Cíl]]` a ![[Jana Nováková]].\n\n![[Svíčková]]\n';
  const o = await treeOf('Pages/Kód.md', undefined, {}, text);
  assert.deepEqual(rows(o.tree.embeds), [[1, 'Jana Nováková', 'link', 'ok'], [1, 'Svíčková', 'full', 'ok']], 'only the real embeds, in file order');
  assert.deepEqual(o.flat, ['Recepty/Svíčková.md'], 'Cíl is never loaded');
});

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-3

test('fr_emb_02_ac3_section_embeds_and_missing_sections', async () => {
  const { tree, flat } = await treeOf('Pages/Sekce.md');
  assert.deepEqual(rows(tree.embeds), [
    [1, 'Cíl#Úvod', 'full', 'ok'], [1, 'Cíl#úvod', 'full', 'ok'], [1, 'Cíl#Podkapitola', 'full', 'ok'], [1, 'Cíl#Druhá kapitola', 'full', 'ok'],
    [1, 'Cíl#^blok1', 'full', 'ok'], [1, 'Cíl#Neexistující nadpis', 'full', 'missing-section'], [1, 'Cíl#^chybí', 'full', 'missing-section'],
  ]);
  assert.deepEqual(flat, ['Pages/Cíl.md'], 'Cíl is read once for all seven');
  const cil = fixture('Pages/Cíl.md');
  const shown = (n: any) => (n.section && n.section.kind !== 'missing' ? cil.slice(n.section.from, n.section.to) : null);
  const [uvod, uvod2, pod, druha, blok] = tree.embeds;
  assert.deepEqual([uvod.subpath, uvod2.subpath, blok.subpath], ['Úvod', 'úvod', '^blok1']);
  assert.ok(shown(uvod)?.includes('Text v úvodu') && shown(uvod)?.includes('Vnořený text podkapitoly.') && !shown(uvod)?.includes('Druhá kapitola'), 'Úvod: to the next heading of the same level');
  assert.equal(shown(uvod2), shown(uvod), 'case-insensitive');
  assert.equal(shown(pod)?.trim(), 'Vnořený text podkapitoly.');
  assert.equal(shown(druha)?.trim(), 'Odstavec s identifikátorem. ^blok1\n\nPoslední odstavec cíle.');
  assert.equal(blok.section?.kind, 'block');
  assert.deepEqual([uvod.readOnly, blok.readOnly], [false, true], 'a #Heading section is editable at depth 1, a block embed isn’t (D-421)');
});

test('fr_emb_02_ac3_nfd_targets_and_subpaths', async () => {
  const text = fixture('Pages/NFD vložení.md');
  assert.ok(text.includes(`![[${NFD_CIL}#${NFD_UVOD}]]`), 'setup: NFD bytes');
  const { tree } = await treeOf('Pages/NFD vložení.md');
  assert.deepEqual(rows(tree.embeds), [[1, 'Cíl', 'full', 'ok'], [1, 'Cíl#Úvod', 'full', 'ok']]);
  assert.deepEqual(tree.embeds.map((n: any) => n.value), [NFD_CIL, `${NFD_CIL}#${NFD_UVOD}`], 'values as written (NFD)');
  assert.deepEqual(tree.embeds.map((n: any) => n.target.path), ['Pages/Cíl.md', 'Pages/Cíl.md']);
  assert.equal(tree.embeds[1]?.section?.kind, 'heading');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-07 AC-6, AC-7

test('fr_lnk_07_ac6_unresolved_alias_template_and_trash_targets_are_broken', async () => {
  const { tree, flat } = await treeOf('Pages/Rozbitá vložení.md');
  const st = Object.fromEntries(tree.embeds.map((n: any) => [n.value, n.state]));
  assert.deepEqual([st['Chybí'], st['Šablona'], st['Smazaná'], st['Reading list']], ['broken', 'broken', 'broken', 'broken']);
  assert.ok(!flat.some((p) => p.startsWith('_templates/') || p.startsWith('.trash/')), 'templates and trash are never read');
  // Deleted between resolve and load: `missing` from embed_load is broken too.
  const gone = await treeOf('Pages/Režimy.md', undefined, { 'Pages/Cíl.md': null });
  assert.deepEqual(gone.tree.embeds.filter((n: any) => n.value.startsWith('Cíl')).map((n: any) => n.state), ['broken', 'broken', 'broken']);
});

test('fr_lnk_07_ac7_date_missing_and_read_only_states', async () => {
  const { tree, flat } = await treeOf('Pages/Rozbitá vložení.md');
  const by = (v: string) => tree.embeds.find((n: any) => n.value === v);
  assert.equal(by('2026-10-20')?.state, 'date-missing', 'a date without a Daily Note (D-424 (3))');
  assert.ok(!flat.includes('Daily/2026-10-20.md'), 'date-missing loads nothing');
  const bad = by('Chyba hlavičky');
  assert.deepEqual([bad?.mode, bad?.state, bad?.readOnly], ['full', 'ok', true], 'invalid frontmatter: full, read-only (NFR-REL-03)');
  const bez = (await treeOf('Pages/Úpravy.md')).tree.embeds.find((n: any) => n.value === 'Bez hlavičky');
  assert.deepEqual([bez?.mode, bez?.state, bez?.readOnly], ['full', 'ok', false], 'a file without frontmatter is a full, editable embed (D-54)');
});

// ------------------------------------------------------------------------------------------------ FR-EMB-04

test('fr_emb_04_ac1_self_embed_is_circular_and_loads_nothing', async () => {
  const { tree, flat } = await treeOf('Pages/Sama sebe.md');
  assert.deepEqual(rows(tree.embeds), [[1, 'Sama sebe', 'full', 'circular']]);
  assert.deepEqual(tree.embeds[0].children, [], 'never expanded');
  assert.ok(!flat.includes('Pages/Sama sebe.md'), 'no content loaded beyond the host’s own read');
});

test('fr_emb_04_ac2_a_to_b_to_a', async () => {
  const a = await treeOf('Pages/Kruh A.md');
  assert.deepEqual(rows(a.tree.embeds), [[1, 'Kruh B', 'full', 'ok'], [2, 'Kruh A', 'full', 'circular']]);
  assert.deepEqual(a.flat, ['Pages/Kruh B.md']);
  assert.equal(a.tree.embeds[0].readOnly, false, 'Kruh B is editable at depth 1');
  const b = await treeOf('Pages/Kruh B.md');
  assert.deepEqual(rows(b.tree.embeds), [[1, 'Kruh A', 'full', 'ok'], [2, 'Kruh B', 'full', 'circular']], 'mirror image');
});

test('fr_emb_04_ac3_own_section_is_circular', async () => {
  const { tree } = await treeOf('Pages/Obsah.md');
  assert.deepEqual(rows(tree.embeds), [[1, 'Obsah#Kapitola jedna', 'full', 'circular']], 'by note, not by heading (D-420)');
});

test('fr_emb_04_ac4_only_full_mode_expands', async () => {
  const { tree } = await treeOf('Pages/Karta sebe.md');
  assert.deepEqual(rows(tree.embeds), [[1, 'Karta sebe|card', 'card', 'ok']], 'a card of the open note is a normal card');
  const text = `${fixture('Pages/Kruh B.md')}\n![[Kruh A|link]]\n`;
  const o = await treeOf('Pages/Kruh A.md', undefined, { 'Pages/Kruh B.md': text });
  assert.deepEqual(rows(o.tree.embeds), [[1, 'Kruh B', 'full', 'ok'], [2, 'Kruh A', 'full', 'circular'], [2, 'Kruh A|link', 'link', 'ok']], 'a link-mode embed of an ancestor is normal');
});

test('fr_emb_04_ac5_depth_3_then_too_deep', async () => {
  const { tree, calls, flat } = await treeOf('Pages/Řetěz 1.md');
  assert.deepEqual(rows(tree.embeds), [[1, 'Řetěz 2', 'full', 'ok'], [2, 'Řetěz 3', 'full', 'ok'], [3, 'Řetěz 4', 'full', 'ok'], [4, 'Řetěz 5', 'link', 'too-deep']]);
  assert.ok(!flat.includes('Pages/Řetěz 5.md'), 'Úroveň 5. is never loaded');
  assert.equal(tree.loads, 3, 'one load per level (FR-EMB-02 AC-12)');
  assert.equal(calls.length, 3);
  const r2 = tree.embeds[0];
  const r3 = r2?.children?.[0];
  const r4 = r3?.children?.[0];
  assert.deepEqual([r2?.readOnly, r3?.readOnly, r4?.readOnly], [false, true, true], 'depth 2 and 3 are read-only (D-421)');
  assert.deepEqual(r4?.children?.[0]?.children, [], 'too-deep never expands');
  const two = await treeOf('Pages/Řetěz 2.md');
  assert.deepEqual(rows(two.tree.embeds), [[1, 'Řetěz 3', 'full', 'ok'], [2, 'Řetěz 4', 'full', 'ok'], [3, 'Řetěz 5', 'full', 'ok']]);
  assert.ok(two.tree.embeds[0]?.children?.[0]?.children?.[0]?.note?.text?.includes('Úroveň 5.'), 'Řetěz 2 shows Úroveň 5. at depth 3');
  const ro = await treeOf('Pages/Řetěz 1.md', { readOnly: true });
  const all: boolean[] = [];
  const walk = (ns: any[]) => ns.forEach((n) => { all.push(n.readOnly); walk(n.children ?? []); });
  walk(ro.tree.embeds);
  assert.ok(all.length === 4 && all.every((x) => x === true), `the read view sets every embed read-only: ${all}`);
});

test('fr_emb_04_ac6_repeats_are_not_cycles_and_list_is_loaded_once', async () => {
  const { tree, flat } = await treeOf('Pages/Kosočtverec.md');
  assert.deepEqual(rows(tree.embeds), [[1, 'Větev 1', 'full', 'ok'], [2, 'List', 'full', 'ok'], [1, 'Větev 2', 'full', 'ok'], [2, 'List', 'full', 'ok']]);
  assert.equal(flat.filter((p) => p === 'Pages/List.md').length, 1, 'List is loaded at most once although shown twice');
  assert.equal(tree.loads, 2);
});

test('fr_emb_04_ac9_a_cycle_made_outside_tegg', async () => {
  const r3 = `${fixture('Pages/Řetěz 3.md')}\n![[Řetěz 1]]\n`;
  const { tree } = await treeOf('Pages/Řetěz 1.md', undefined, { 'Pages/Řetěz 3.md': r3 });
  assert.deepEqual(rows(tree.embeds), [
    [1, 'Řetěz 2', 'full', 'ok'], [2, 'Řetěz 3', 'full', 'ok'], [3, 'Řetěz 4', 'full', 'ok'], [4, 'Řetěz 5', 'link', 'too-deep'], [3, 'Řetěz 1', 'full', 'circular'],
  ], 'Řetěz 3’s frame ends with a circular frame for Řetěz 1');
});
