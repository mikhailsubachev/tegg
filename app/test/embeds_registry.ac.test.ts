// MS4 slice 4F, L1: the registry, command and catalog changes of R32 and R33 (docs/acceptance/embeds.md;
// docs/contracts/ms4-embeds.md §7.1). FR-EMB-01 AC-1 (R5 loses `embed-note`), AC-11 (R6: `Embed object` built,
// `Block embed` v1.0 with FR-EMB-01, FR-LNK-06), AC-10 and FR-EMB-02 AC-14 (palette commands `Embed object…`,
// `Open embedded note`, `Display embed as…`: section edit, needsVault, no shortcut), FR-EMB-02 AC-15 (R33 strings).
// A new file: the R5/R6 tables of app/test/shell-tables.ts and the existing registry tests change with the 4F build
// (D-431, TS-I3). Written from the ACs and the contract only (D-61). Modules load dynamically (TS-I1).
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
  assert.ok(reg && cat && cmd, 'shell registry, catalog and commands modules load');
  return { reg: reg!, cat: cat!, cmd: cmd! };
}
beforeEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const T = (key: string, name: string, plural: string) => ({ key, name, plural, folder: plural, icon: 'file-text', color: 'gray', system: true, invalid: false });
const TYPES = [T('page', 'Page', 'Pages'), T('quick-note', 'Quick Note', 'Quick Notes')];
const VAULT = { name: 'Vložení', path: '/tmp/Vložení', placeholders: 0 };
const ctx = (route: Record<string, unknown> | null) => ({ vault: VAULT, types: TYPES, counts: { page: 30 }, ...(route ? { route } : {}) });
const NOTE = { id: 'note/<path>', path: 'Pages/Vkládání.md' };
const label = (cat: Mod, key: string) => (key in cat.en ? cat.t(key) : key);
const reqs = (r: string[] | string) => (Array.isArray(r) ? r : String(r).split(/,\s*/)).map((x) => x.trim());

test('fr_emb_01_ac1_in_note_placeholders_lose_embed_note', async () => {
  const { reg } = await mods();
  const ids = (reg.IN_NOTE_PLACEHOLDERS as { id: string }[]).map((d) => d.id);
  // 6A (D-630): the media placeholders are retired too; slice MM (D-679) removes the mindmap row.
  // Slice Q (queries.md: read-view R5's `query` row is built): no row is left.
  assert.deepEqual(ids, [], 'R5 without the embed-note row (R32), the media rows (D-630), the mindmap row (D-679) and the query row (slice Q)');
  const ms4 = (reg.overdue('MS4') as string[]).join('\n');
  assert.ok(!ms4.includes('embed-note'), `overdue('MS4') lists no embed-note:\n${ms4}`);
});

test('fr_emb_01_ac11_slash_registry_embed_object_built_block_embed_v1_0', async () => {
  const { reg, cat } = await mods();
  type Item = { id: string; group: string; label: string; status?: { built: boolean; due?: { milestone: string } }; due?: { milestone: string }; reqs: string[] | string };
  const items = reg.SLASH_ITEMS as Item[];
  const find = (l: string) => items.find((i) => label(cat, i.label) === l);
  const obj = find('Embed object');
  const blk = find('Block embed');
  assert.ok(obj && blk, 'R6 rows Embed object and Block embed');
  const built = (i: Item) => (i.status ? i.status.built : !i.due);
  const due = (i: Item) => i.due ?? i.status?.due ?? null;
  assert.equal(built(obj!), true, 'Embed object is built (R32)');
  assert.deepEqual(reqs(obj!.reqs), ['FR-EMB-01']);
  assert.equal(obj!.group, 'objects');
  assert.equal(built(blk!), false, 'Block embed stays disabled');
  assert.equal(reg.showDue(due(blk!)), 'v1.0', 'Block embed: Coming in v1.0 (AP-329)');
  assert.deepEqual(reqs(blk!.reqs), ['FR-EMB-01', 'FR-LNK-06']);
  const ms4 = (reg.overdue('MS4') as string[]).join('\n');
  assert.ok(!ms4.includes('Embed object') && !ms4.includes('Block embed'), `overdue('MS4') lists neither:\n${ms4}`);
  assert.ok((reg.overdue('v1.0') as string[]).join('\n').includes('Block embed'), 'Block embed is overdue at v1.0');
});

function command(cat: Mod, list: any[], title: string) {
  return list.find((c) => cat.t(c.title, c.vars ?? {}) === title);
}

test('fr_emb_01_ac10_embed_object_command_on_note_routes', async () => {
  const { reg, cat, cmd } = await mods();
  const c = command(cat, cmd.commands(ctx(NOTE)) as any[], 'Embed object…');
  assert.ok(c, 'Embed object… on a note route (R32)');
  assert.deepEqual([c.id, c.section, c.needsVault, c.shortcut ?? null, c.due ?? null], ['edit.embedObject', 'edit', true, null, null]);
  assert.ok(!(reg.SHORTCUTS as any[]).some((s) => s.command === 'edit.embedObject'), 'no shortcut (AP-331)');
});

test('fr_emb_02_ac14_open_and_display_embed_commands_on_note_routes', async () => {
  const { reg, cat, cmd } = await mods();
  const list = cmd.commands(ctx(NOTE)) as any[];
  for (const [title, id] of [['Open embedded note', 'edit.openEmbed'], ['Display embed as…', 'edit.displayEmbedAs']]) {
    const c = command(cat, list, title);
    assert.ok(c, `${title} on a note route`);
    assert.deepEqual([c.id, c.section, c.needsVault, c.shortcut ?? null], [id, 'edit', true, null], title);
    assert.ok(!(reg.SHORTCUTS as any[]).some((s) => s.command === id), `${title}: no new shortcut`);
  }
  const keys = (reg.SHORTCUTS as any[]).map((s) => String(s.keys));
  assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), [], 'no shortcut bound twice');
});

test('fr_emb_02_ac15_catalog_has_the_r33_strings', async () => {
  const { cat } = await mods();
  const want: [string, string, Record<string, string>?][] = [
    ['embed.name', 'Embedded: Cíl', { title: 'Cíl' }],
    ['embed.open', 'Open Cíl', { title: 'Cíl' }],
    ['embed.displayAs', 'Display as'],
    ['embed.mode.full', 'Full'],
    ['embed.mode.card', 'Card'],
    ['embed.mode.link', 'Link'],
    ['embed.chip', 'Embedded note'],
    ['embed.tooDeep', 'Embedded too deeply to show here'],
    ['embed.circular', 'Circular embed: "Sama sebe" is already shown above.', { title: 'Sama sebe' }],
    ['embed.noHeading', 'No heading "Neexistující nadpis" in Cíl.', { heading: 'Neexistující nadpis', title: 'Cíl' }],
    ['embed.noBlock', 'No block "^chybí" in Cíl.', { id: 'chybí', title: 'Cíl' }],
    ['embed.noDay', 'No note for this day yet.'],
    ['embed.empty', 'Empty note'],
    ['embed.readOnly', 'Read-only'],
    ['embed.saveFailed', 'Couldn’t save "Upravitelná". Tegg will try again.', { title: 'Upravitelná' }],
    ['embed.picker', 'Embed object'],
    ['embed.suggestions', 'Embed suggestions'],
    ['typeSettings.embeds', 'Embeds'],
    ['typeSettings.embedMode', 'Default embed mode'],
    ['typeSettings.embedHint', 'How Osoby look when embedded in a note.', { plural: 'Osoby' }],
    ['typeSettings.embedUnknown', 'Unknown embed mode "obrovský". Using Card.', { value: 'obrovský', mode: 'Card' }],
    ['commands.embedObject', 'Embed object…'],
    ['commands.openEmbed', 'Open embedded note'],
    ['commands.displayEmbedAs', 'Display embed as…'],
  ];
  const bad = want
    .filter(([k, t, v]) => !(k in cat.en) || cat.t(k, v ?? {}) !== t)
    .map(([k, t, v]) => `${k}: want ${JSON.stringify(t)}, got ${k in cat.en ? JSON.stringify(cat.t(k, v ?? {})) : 'missing'}`);
  assert.deepEqual(bad, [], 'R33 strings in the catalog');
  assert.equal(cat.t('link.noNote', { target: 'Chybí' }), 'No note named Chybí', 'the broken state reuses link.noNote');
});
