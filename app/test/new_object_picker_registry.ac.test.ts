// Preview v0.120 feedback (D-1431, D-1432), L1: the registry and catalog parts of docs/acceptance/capture.md FR-VLT-05
// AC-14 (`New object…` with ⌘N in the command registry and the shortcut table, on every route, with no shortcut clash,
// FR-UX-03 AC-7; the picker's strings in the `en` catalog, NFR-OTH-02). Interface: docs/contracts/ms3-shell.md §3.1–§3.3
// (`SHORTCUTS`, `commands(ctx)`, the `en` catalog, `t`). No contract names the picker's catalog keys, so the strings are
// looked up among the catalog's values. Modules are imported inside the tests so a missing module fails an assertion
// (TS-I1). Written from the ACs and the contracts only (D-61).
import { beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { RESERVED, shortcutClashes } from './shell-tables';

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

// The inbox fixture's types (Page, Task, Quick Note, Nápad, Schůzka and the system types), in the context shape of
// registry_4d.ac.test.ts / v068_registry.ac.test.ts (ms3-shell §3.3).
const VAULT = { name: 'Doručené', path: '/tmp/Doručené', placeholders: 0 };
const TYPES = [
  ['page', 'Page', 'Pages', true], ['task', 'Task', 'Tasks', true], ['quick-note', 'Quick Note', 'Quick Notes', true],
  ['daily-note', 'Daily Note', 'Daily Notes', true], ['tag', 'Tag', 'Tags', true], ['image', 'Image', 'Images', true], ['pdf', 'PDF', 'PDFs', true],
  ['nápad', 'Nápad', 'Nápady', false], ['schůzka', 'Schůzka', 'Schůzky', false],
].map(([key, name, plural, system]) => ({ key, name, plural, folder: plural, icon: 'file-text', color: 'gray', system, invalid: false }));
const CTX = { vault: VAULT, types: TYPES, counts: { page: 2, task: 1, 'quick-note': 9 } };
/** One route of each kind (app-shell R1): the command is listed on every one (FR-VLT-05 AC-14). */
const ROUTES: Record<string, unknown>[] = [
  { id: 'inbox' },
  { id: 'note/<path>', param: 'Pages/Plán webu.md', path: 'Pages/Plán webu.md', type: 'page' },
  { id: 'type/<type>', param: 'schůzka' },
  { id: 'search' },
  { id: 'tasks' },
  { id: 'daily/YYYY-MM-DD', param: '2026-10-14', date: '2026-10-14', path: null },
  { id: 'new/<type>', param: 'quick-note', type: 'quick-note', path: null },
  { id: 'tag/<key>', param: 'nákup', key: 'nákup' },
  { id: 'settings/appearance' },
];

test('fr_vlt_05_ac14_command_strings_and_themes: registry', async () => {
  const { reg, cat, cmd } = await mods();
  const failures: string[] = [];
  let id: string | null = null;
  for (const route of ROUTES) {
    const list = cmd.commands({ ...CTX, route }) as any[];
    const owners = list.filter((c) => c.shortcut === '⌘N' && !c.due);
    const titles = owners.map((c) => String(cat.t(c.title, c.vars ?? {})));
    if (titles.length !== 1 || titles[0] !== 'New object…') { failures.push(`${route.id}: ⌘N belongs to ${JSON.stringify(titles)}, not exactly "New object…"`); continue; }
    if (id !== null && owners[0].id !== id) failures.push(`${route.id}: the ⌘N command is ${owners[0].id}, elsewhere ${id}`);
    id ??= owners[0].id;
    const clashes = shortcutClashes(list);
    if (clashes.length) failures.push(`${route.id}: shortcut clashes ${clashes.join(', ')} (FR-UX-03 AC-7)`);
    const plain = list.filter((c) => String(cat.t(c.title, c.vars ?? {})) === 'New object');
    if (plain.length) failures.push(`${route.id}: a separate "New object" command is still listed (${plain.map((c) => c.id).join(', ')})`);
  }
  assert.deepEqual(failures, [], 'New object… with ⌘N on every route, the only owner of ⌘N');
  const rows = (reg.SHORTCUTS as { keys: string; command: string }[]).filter((s) => s.keys === '⌘N');
  assert.deepEqual(rows.map((r) => r.command), [id], 'the shortcut table binds ⌘N to New object… only');
  assert.ok(!RESERVED.includes('⌘N'), '⌘N is not reserved by macOS');
});

test('fr_vlt_05_ac14_command_strings_and_themes: catalog', async () => {
  const { cat } = await mods();
  const values = new Set(Object.values(cat.en as Record<string, unknown>).filter((v): v is string => typeof v === 'string'));
  const strings = ['New object…', 'New object', 'Choose a type…', 'Default', 'No type matches “{query}”.', 'Choose', 'Create', 'Cancel'];
  assert.deepEqual(strings.filter((s) => !values.has(s)), [], 'every picker string is a catalog message (NFR-OTH-02)');
  const key = Object.entries(cat.en as Record<string, unknown>).find(([, v]) => v === 'No type matches “{query}”.')?.[0];
  assert.ok(key, 'the no-match message has a key');
  assert.equal(cat.t(key, { query: 'uick' }), 'No type matches “uick”.', 'the query is filled in');
});
