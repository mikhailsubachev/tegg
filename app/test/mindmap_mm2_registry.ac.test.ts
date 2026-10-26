// Slice MM2, L1: the registry, commands and strings of the layout switch and the node field (docs/acceptance/mindmap.md
// R97; contract docs/contracts/mm-mindmap.md §6.4). FR-UX-03 AC-16's registry side (`mindmap.layoutRight` /
// `mindmap.layoutSpider`: section edit, needsVault, no shortcut, built) and NFR-OTH-02 AC-8 (every R97 text is a
// catalog key with its English text; the pseudo-locale wraps each). Interface: docs/contracts/ms3-shell.md §3.1–§3.3,
// §11.3. Modules load dynamically (TS-I1). Written from the ACs and the contract only (D-61).
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
  const cat = await load('../ui/src/i18n/catalog.ts');
  const cmd = await load('../ui/src/shell/commands.ts');
  assert.ok(cat && cmd, 'catalog and commands modules load');
  return { cat: cat!, cmd: cmd! };
}
beforeEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const T = (key: string, name: string, plural: string) => ({ key, name, plural, folder: plural, icon: 'file-text', color: 'gray', system: true, invalid: false });
const CTX = {
  vault: { name: 'Mapy', path: '/tmp/Mapy', placeholders: 0 },
  types: [T('page', 'Page', 'Pages'), T('task', 'Task', 'Tasks')],
  counts: { page: 24 },
  route: { id: 'note/<path>', path: 'Pages/Pavouk.md' },
};

/** R97's catalog keys and English texts (final key names are the contract's, mm-mindmap §6.4). */
const R97: [string, string][] = [
  ['mindmap.layout', 'Mindmap layout'],
  ['mindmap.layoutRight', 'Branches to the right'],
  ['mindmap.layoutSpider', 'Spider: branches on both sides'],
  ['mindmap.editNode', 'Edit node'],
  ['cmd.mindmap.layoutRight', 'Mindmap layout: right'],
  ['cmd.mindmap.layoutSpider', 'Mindmap layout: spider'],
];

test('fr_ux_03_ac16_layout_commands_are_registered_in_edit_without_a_shortcut', async () => {
  const { cat, cmd } = await mods();
  const list = cmd.commands(CTX) as { id: string; title: string; section?: string; needsVault?: boolean; shortcut?: string; due?: unknown; action?: unknown }[];
  const want: [string, string, string][] = [
    ['mindmap.layoutRight', 'cmd.mindmap.layoutRight', 'Mindmap layout: right'],
    ['mindmap.layoutSpider', 'cmd.mindmap.layoutSpider', 'Mindmap layout: spider'],
  ];
  const bad: string[] = [];
  for (const [id, key, text] of want) {
    const c = list.find((x) => x.id === id);
    if (!c) { bad.push(`${id}: not registered (R97, mm-mindmap §6.4)`); continue; }
    if (c.title !== key) bad.push(`${id}: title ${JSON.stringify(c.title)} ≠ ${key}`);
    if (cat.t(c.title) !== text) bad.push(`${id}: text ${JSON.stringify(cat.t(c.title))} ≠ ${JSON.stringify(text)}`);
    if (c.section !== 'edit') bad.push(`${id}: section ${c.section}`);
    if (c.needsVault !== true) bad.push(`${id}: needsVault ${c.needsVault}`);
    if ((c.shortcut ?? null) !== null) bad.push(`${id}: shortcut ${c.shortcut} (none, D-792)`);
    if ((c.due ?? null) !== null) bad.push(`${id}: due ${JSON.stringify(c.due)} (built)`);
  }
  assert.deepEqual(bad, [], 'R4 rows of the two layout commands');
  const titles = list.map((c) => cat.t(c.title));
  assert.equal(titles.filter((t) => /^Mindmap layout:/.test(t)).length, 2, 'exactly the two layout commands');
});

test('nfr_oth_02_ac8_r97_texts_are_catalog_keys', async () => {
  const { cat } = await mods();
  const en = cat.en as Record<string, string>;
  const bad = R97.filter(([k, v]) => en[k] !== v).map(([k, v]) => `${k}: ${JSON.stringify(en[k])} ≠ ${JSON.stringify(v)}`);
  assert.deepEqual(bad, [], 'every R97 key with its English text');
  const pseudo = cat.pseudo?.(cat.en) as Record<string, string> | undefined;
  assert.ok(pseudo, 'the pseudo-locale exists');
  for (const [k] of R97) assert.match(pseudo![k] ?? '', /^⟦.*⟧$/s, `${k} is wrapped by the pseudo-locale`);
  const stray = Object.entries(en).filter(([k, v]) => !R97.some(([rk]) => rk === k) && /^(Branches to the right|Spider: branches on both sides|Edit node|Mindmap layout)$/.test(v));
  assert.deepEqual(stray, [], 'no second key carries an R97 text (one key per string)');
});
