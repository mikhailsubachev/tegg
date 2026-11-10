// Slice MM, L1: the registry, commands and strings of mindmaps (docs/acceptance/mindmap.md R94; contract
// docs/contracts/mm-mindmap.md §4). FR-MMP-01 AC-8 (the slash item `Mindmap` is built with no milestone; R5 has no
// `mindmap` row, `IN_NOTE_PLACEHOLDERS` equals `['query']`; no `ph.mindmap`; nothing about Mindmap is overdue),
// NFR-OTH-02 AC-7 (every R94 text is a catalog key with R94's English text; the commands' titles are keys) and the
// registry side of FR-UX-03 AC-15 (`mindmap.showMap` / `mindmap.showList`: section edit, needsVault, no shortcut).
// Interface: docs/contracts/ms3-shell.md §3.1–§3.3, §11.3, §13.4. Modules load dynamically (TS-I1). Written from the
// ACs and the contract only (D-61).
import { beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
async function mods() {
  const reg = await load('../ui/src/shell/registry.ts');
  const cat = await load('../ui/src/i18n/catalog.ts');
  const cmd = await load('../ui/src/shell/commands.ts');
  assert.ok(reg && cat && cmd, 'registry, catalog and commands modules load');
  return { reg: reg!, cat: cat!, cmd: cmd! };
}
beforeEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const T = (key: string, name: string, plural: string) => ({ key, name, plural, folder: plural, icon: 'file-text', color: 'gray', system: true, invalid: false });
const CTX = {
  vault: { name: 'Mapy', path: '/tmp/Mapy', placeholders: 0 },
  types: [T('page', 'Page', 'Pages'), T('task', 'Task', 'Tasks')],
  counts: { page: 21 },
  route: { id: 'note/<path>', path: 'Pages/Výjezd 2026.md' },
};

/** R94's catalog keys and English texts. */
const R94: [string, string][] = [
  ['slash.mindmap', 'Mindmap'],
  ['slash.mindmap.description', 'Edit as a list, shown as a map'],
  ['callout.mindmap', 'Mindmap'],
  ['mindmap.figure', 'Mindmap: {title}'],
  ['mindmap.untitled', 'Mindmap'],
  ['mindmap.view', 'Mindmap view'],
  ['mindmap.map', 'Map'],
  ['mindmap.list', 'List'],
  ['mindmap.tree', 'Map of {title}'],
  ['mindmap.empty', 'Type the central topic'],
  ['mindmap.notOneList', 'A mindmap holds one list'],
  ['mindmap.more', 'More in the list'],
  ['mindmap.checked', 'Checked'],
  ['mindmap.unchecked', 'Not checked'],
  ['cmd.mindmap.showMap', 'Show mindmap as map'],
  ['cmd.mindmap.showList', 'Show mindmap as list'],
];

test('fr_mmp_01_ac8_slash_mindmap_is_built_without_a_milestone', async () => {
  const { reg, cat } = await mods();
  type Item = { id: string; group: string; label: string; status?: { built: boolean; due?: unknown }; due?: unknown; reqs: string[] | string; description?: string };
  const items = reg.SLASH_ITEMS as Item[];
  const mm = items.filter((i) => (i.label in cat.en ? cat.t(i.label) : i.label) === 'Mindmap');
  assert.equal(mm.length, 1, 'one slash item Mindmap (R6)');
  const it = mm[0];
  assert.equal(it.id, 'mindmap');
  assert.equal(it.group, 'advanced');
  assert.equal(it.status ? it.status.built : !it.due, true, 'built (D-685)');
  assert.equal(it.due ?? it.status?.due ?? null, null, 'no milestone');
  assert.deepEqual(Array.isArray(it.reqs) ? it.reqs : String(it.reqs).split(/,\s*/), ['FR-MMP-01'], 'requirement FR-MMP-01');
  for (const m of ['MS5', 'MS8', 'v1.0', 'v1.x']) {
    const over = (reg.overdue(m) as string[]).join('\n');
    assert.ok(!/mindmap/i.test(over), `overdue('${m}') lists nothing about Mindmap:\n${over}`);
  }
});

test('fr_mmp_01_ac8_in_note_placeholders_are_query_only', async () => {
  const { reg } = await mods();
  // Slice Q (queries.md: read-view R5's `query` row is built, the block of R141): the table is now empty.
  assert.deepEqual((reg.IN_NOTE_PLACEHOLDERS as { id: string }[]).map((p) => p.id), [], 'R5 has no mindmap row (D-679), and no query row after slice Q');
});

test('fr_mmp_01_ac8_catalog_has_no_ph_mindmap', async () => {
  const { cat } = await mods();
  assert.equal('ph.mindmap' in (cat.en as Record<string, string>), false, 'ph.mindmap is removed (R94)');
  const coming = Object.entries(cat.en as Record<string, string>).filter(([k, v]) => /mindmap/i.test(k) && /coming in/i.test(v));
  assert.deepEqual(coming, [], 'no mindmap text says "Coming in …"');
});

test('nfr_oth_02_ac7_r94_texts_are_catalog_keys', async () => {
  const { cat } = await mods();
  const en = cat.en as Record<string, string>;
  const bad = R94.filter(([k, v]) => en[k] !== v).map(([k, v]) => `${k}: ${JSON.stringify(en[k])} ≠ ${JSON.stringify(v)}`);
  assert.deepEqual(bad, [], 'every R94 key with its English text');
  assert.equal(cat.t('mindmap.figure', { title: 'Výjezd 2026' }), 'Mindmap: Výjezd 2026', 'the figure name takes the title');
  assert.equal(cat.t('mindmap.tree', { title: 'Výjezd 2026' }), 'Map of Výjezd 2026', 'the tree name takes the title');
  const pseudo = cat.pseudo?.(cat.en) as Record<string, string> | undefined;
  assert.ok(pseudo, 'the pseudo-locale exists');
  for (const [k] of R94) assert.match(pseudo![k] ?? '', /^⟦.*⟧$/s, `${k} is wrapped by the pseudo-locale`);
});

test('nfr_oth_02_ac7_mindmap_commands_are_catalog_keys_in_edit', async () => {
  const { cat, cmd } = await mods();
  const list = cmd.commands(CTX) as { id: string; title: string; section?: string; needsVault?: boolean; shortcut?: string; due?: unknown }[];
  const want: [string, string, string][] = [['mindmap.showMap', 'cmd.mindmap.showMap', 'Show mindmap as map'], ['mindmap.showList', 'cmd.mindmap.showList', 'Show mindmap as list']];
  for (const [id, key, text] of want) {
    const c = list.find((x) => x.id === id);
    assert.ok(c, `command ${id} is registered (R94, mm-mindmap §4)`);
    assert.equal(c!.title, key, `${id}: title key`);
    assert.equal(cat.t(c!.title), text, `${id}: text`);
    assert.equal(c!.section, 'edit', `${id}: section edit`);
    assert.equal(c!.needsVault, true, `${id}: needsVault`);
    assert.equal(c!.shortcut ?? null, null, `${id}: no shortcut (AP-731)`);
    assert.equal(c!.due ?? null, null, `${id}: built`);
  }
});
