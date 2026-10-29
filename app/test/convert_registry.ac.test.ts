// MS5 slice 5A-2, L1: the registry, command and catalog changes of R53 and R54 (docs/acceptance/conversion.md;
// docs/contracts/ms5-tasks.md §11.4). FR-CNV-01 AC-2 (R6: `Task` and `Turn into object…` built), AC-1 (R3: `Turn into
// object` in the toolbar and block menu built), AC-3 (palette commands `Turn into task` ⇧⌘T and `Turn into object…`
// ⇧⌘O, section edit, FR-UX-03 AC-7 integrity), AC-8 (every R54 string a catalog key with its English text, plural
// forms). A new file: the R3/R6 tables of shell-tables.ts and editor_registry.ac.test.ts change with the 5A-2 build
// commit (D-499, TS-I3). Written from the ACs and the contract only (D-61). Modules load dynamically (TS-I1).
import { beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RESERVED, expandReqs, shortcutClashes } from './shell-tables';

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

const REPO = resolve(import.meta.dirname, '../..');
const T = (key: string, name: string, plural: string) => ({ key, name, plural, folder: plural, icon: 'file-text', color: 'gray', system: true, invalid: false });
const TYPES = [T('page', 'Page', 'Pages'), T('task', 'Task', 'Tasks'), T('quick-note', 'Quick Note', 'Quick Notes')];
const VAULT = { name: 'Úkoly', path: '/tmp/Úkoly', placeholders: 0 };
const ctx = (route: Record<string, unknown>) => ({ vault: VAULT, types: TYPES, counts: { page: 12, task: 19 }, route });
const NOTE = { id: 'note/<path>', path: 'Pages/Bloky.md' };
const label = (cat: Mod, key: string) => (key in cat.en ? cat.t(key) : key);

/** R54 pairs `key` `English text`, read from the approved criteria. */
function r54(): [string, string][] {
  const md = readFileSync(resolve(REPO, 'docs/acceptance/conversion.md'), 'utf8');
  const line = md.split('\n').find((l) => l.startsWith('`convert.title`'));
  assert.ok(line, 'R54 line in conversion.md');
  return [...line!.matchAll(/`([a-z][A-Za-z.]*)` `([^`]+)`/g)].map((m) => [m[1], m[2]]);
}

// ------------------------------------------------------------------------------------------------ R53

test('fr_cnv_01_ac2_r6_task_and_turn_into_object_are_built', async () => {
  const { reg, cat } = await mods();
  type Item = { id: string; group: string; label: string; status?: { built: boolean; due?: unknown }; due?: unknown; reqs: string[] | string };
  const items = reg.SLASH_ITEMS as Item[];
  const find = (l: string) => items.find((i) => label(cat, i.label) === l);
  const built = (i: Item) => (i.status ? i.status.built : !i.due);
  const task = find('Task');
  const turn = find('Turn into object…');
  assert.ok(task && turn, 'R6 rows Task and Turn into object…');
  assert.equal(built(task!), true, 'Task is built (R53)');
  assert.equal(built(turn!), true, 'Turn into object… is built (R53)');
  assert.deepEqual(expandReqs(task!.reqs), expandReqs('FR-TSK-01, FR-CNV-01'), 'Task: requirements');
  assert.deepEqual(expandReqs(turn!.reqs), expandReqs('FR-CNV-01'), 'Turn into object…: requirements');
  const ms5 = (reg.overdue('MS5') as string[]).join('\n');
  assert.ok(!ms5.includes('Turn into object') && !/\bTask\b/.test(ms5), `overdue('MS5') lists neither:\n${ms5}`);
});

test('fr_cnv_01_ac1_r3_turn_into_object_control_is_built', async () => {
  const { reg } = await mods();
  const ctl = reg.DISABLED_CONTROLS as any[];
  const row = ctl.find((c) => c.label === 'ctl.turnIntoObject' || c.label === 'Turn into object');
  const stillDisabled = row !== undefined && !(row.status?.built === true || (row.due === undefined && row.status?.due === undefined));
  assert.equal(stillDisabled, false, `R3 Turn into object is built (not a disabled control): ${JSON.stringify(row)}`);
  const ms5 = (reg.overdue('MS5') as string[]).join('\n');
  assert.ok(!ms5.includes('Turn into object') && !ms5.includes('turnIntoObject'), `overdue('MS5') doesn't list it:\n${ms5}`);
});

test('fr_cnv_01_ac3_palette_commands_and_shortcuts', async () => {
  const { reg, cat, cmd } = await mods();
  const list = cmd.commands(ctx(NOTE)) as any[];
  const want: [string, string, string][] = [['edit.turnIntoTask', 'Turn into task', '⇧⌘T'], ['edit.turnIntoObject', 'Turn into object…', '⇧⌘O']];
  for (const [id, title, keys] of want) {
    const c = list.find((x) => x.id === id);
    assert.ok(c, `${id} is registered on a note route (R53)`);
    assert.ok(c.title in cat.en, `${id}: title is a catalog key`);
    assert.equal(cat.t(c.title, c.vars ?? {}), title, `${id}: palette title`);
    assert.deepEqual([c.section, c.needsVault, c.shortcut ?? null, c.due ?? null], ['edit', true, keys, null], `${id}: section, needsVault, shortcut, runs`);
    const bound = (reg.SHORTCUTS as { keys: string; command: string }[]).filter((s) => s.keys === keys);
    assert.deepEqual(bound.map((s) => s.command), [id], `${keys} is bound to ${id} only (R4 gets the R53 rows)`);
    assert.ok(!RESERVED.includes(keys), `${keys} isn't reserved by macOS`);
  }
  // D-943 (previews.md R106): `link.edit` shows R4's ⇧⌘K beside `edit.link`; that pair is the only one exempt.
  assert.deepEqual(shortcutClashes(list), [], 'no two enabled commands share a shortcut (FR-UX-03 AC-7)');
  const keys = (reg.SHORTCUTS as any[]).map((s) => String(s.keys));
  assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), [], 'no shortcut bound twice');
});

// ------------------------------------------------------------------------------------------------ R54

test('fr_cnv_01_ac8_r54_strings_are_catalog_keys_with_the_exact_english', async () => {
  const { cat } = await mods();
  const pairs = r54();
  assert.equal(pairs.length, 22, `R54 has ${pairs.length} keys`);
  const bad: string[] = [];
  for (const [key, text] of pairs) {
    if (!(key in cat.en)) { bad.push(`${key}: missing`); continue; }
    const vars: Record<string, string | number> = {};
    for (const m of text.matchAll(/\{(\w+)\}/g)) vars[m[1]] = m[1] === 'count' ? 5 : `«${m[1]}»`;
    const want = text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k]));
    const got = cat.t(key, vars);
    if (got !== want) bad.push(`${key}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, [], 'every R54 key with its English text');
  for (const k of ['convert.summary', 'convert.removeEmbed.many']) assert.equal(typeof cat.en[k], 'object', `${k} has plural forms (D-133)`);
  assert.equal(cat.t('convert.summary', { count: 2, type: 'Task' }), '2 blocks move into a new Task. An embed takes their place.', 'R50 summary for two blocks');
  assert.equal(cat.t('convert.removeEmbed.many', { count: 2 }), 'Remove 2 embeds? The objects stay and keep their link to this note.', 'FR-CNV-08 AC-3');
  assert.equal(
    cat.t('convert.removeEmbed.text', { title: 'Zavolat do servisu kvůli kolu', plural: 'Tasks' }),
    '"Zavolat do servisu kvůli kolu" stays in Tasks and keeps its link to this note. Only the embed is removed.',
    'FR-CNV-08 AC-1',
  );
  assert.equal(cat.t('convert.failed', { title: 'Zavolat do servisu kvůli kolu' }), 'Couldn’t create "Zavolat do servisu kvůli kolu". Nothing was changed.', 'FR-CNV-03 AC-6');
  assert.equal(
    cat.t('convert.trashedOnUndo', { title: 'Zavolat do servisu kvůli kolu' }),
    '"Zavolat do servisu kvůli kolu" was changed after it was created, so it was moved to the trash.',
    'FR-CNV-06 AC-3',
  );
});

test('fr_cnv_01_ac8_card_strings_reuse_r46', async () => {
  const { cat } = await mods();
  const want: [string, string, Record<string, string | number>][] = [
    ['task.complete', 'Complete "Zavolat Janě"', { title: 'Zavolat Janě' }],
    ['task.uncomplete', 'Mark "Zavolat Janě" not done', { title: 'Zavolat Janě' }],
    ['task.noPriority', 'No priority', {}],
    ['task.readOnly', "This task can't be edited here.", {}],
    ['task.statusButton', 'Status: To do', { label: 'To do' }],
    ['task.priorityButton', 'Priority: High', { label: 'High' }],
    ['task.dueButton', 'Due: None', { label: 'None' }],
    ['task.addDetails', 'Add details…', {}],
  ];
  const bad = want.filter(([k, t, v]) => !(k in cat.en) || cat.t(k, v) !== t).map(([k, t, v]) => `${k}: want ${JSON.stringify(t)}, got ${k in cat.en ? JSON.stringify(cat.t(k, v)) : 'missing'}`);
  assert.deepEqual(bad, [], 'the R52 card strings');
});
