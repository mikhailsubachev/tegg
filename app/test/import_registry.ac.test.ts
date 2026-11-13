// Slice I2, L1: the registry part of docs/acceptance/import-capacities.md FR-UX-03 AC-43 (R154: `import.open`, title
// `Import…`, section `file`, no shortcut, listed with and without a vault; no `import` route and no `Go to Import`) and
// FR-UX-03 AC-7 with the command added (unique ids, no shortcut clash, catalog titles). Interface
// docs/contracts/v1-import-window.md §4.2 (command, `ShellActions.openImport`), §4.4 (the route goes). Written from the ACs
// and the contract only (D-61). Modules load inside the tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { IMPORT_COMMAND, RESERVED, shortcutClashes } from './shell-tables';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try { return (await import(/* @vite-ignore */ path)) as Mod; } catch { return null; }
}
async function mods() {
  const reg = await load('../ui/src/shell/registry.ts');
  const routes = await load('../ui/src/shell/routes.ts');
  const cat = await load('../ui/src/i18n/catalog.ts');
  const cmd = await load('../ui/src/shell/commands.ts');
  assert.ok(reg && routes && cat && cmd, 'registry, routes, catalog and commands modules load');
  return { reg: reg!, routes: routes!, cat: cat!, cmd: cmd! };
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const TYPES = [
  ['page', 'Page', 'Pages'], ['task', 'Task', 'Tasks'], ['quick-note', 'Quick Note', 'Quick Notes'], ['daily-note', 'Daily Note', 'Daily Notes'],
  ['tag', 'Tag', 'Tags'], ['image', 'Image', 'Images'], ['pdf', 'PDF', 'PDFs'], ['schůzka', 'Schůzka', 'Schůzky'],
].map(([key, name, plural]) => ({ key, name, plural, folder: plural, icon: 'file-text', color: 'gray', system: key !== 'schůzka', invalid: false }));
function ctxOf(o: { vault?: boolean; route?: Record<string, unknown> | null; calls?: string[] } = {}) {
  const calls = o.calls ?? [];
  return {
    vault: o.vault === false ? null : { name: 'Trezor', path: '/tmp/Trezor', placeholders: 0 },
    types: o.vault === false ? [] : TYPES, counts: {}, route: o.route ?? (o.vault === false ? { id: 'chooser' } : { id: 'inbox' }),
    actions: {
      go: (r: any) => calls.push(`go ${r.id}`),
      openImport: () => calls.push('openImport'),
    },
  };
}
const find = (l: any[], id: string) => l.find((c) => c.id === id);

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-43

test('fr_ux_03_ac43_import_entry_points: the registry', async () => {
  const { reg, routes, cat, cmd } = await mods();
  // The route goes (app-shell R1, D-1531).
  assert.equal((reg.ROUTES as any[]).find((r) => r.id === 'import'), undefined, 'no `import` route');
  assert.equal(routes.parseRoute('import'), null, '`import` parses as an unknown route');
  for (const k of ['route.import', 'purpose.import', 'cmd.goto.import']) assert.ok(!(k in cat.en), `the catalog lost ${k}`);
  // The command.
  for (const o of [{}, { vault: false }] as const) {
    const where = 'vault' in o ? 'with no vault' : 'with a vault';
    const list = cmd.commands(ctxOf(o)) as any[];
    const c = find(list, IMPORT_COMMAND.id);
    assert.ok(c, `${where}: import.open is listed`);
    assert.deepEqual(
      [c.title, cat.t(c.title), c.section, c.shortcut ?? null, c.needsVault, c.due ?? null],
      [IMPORT_COMMAND.title, IMPORT_COMMAND.text, IMPORT_COMMAND.section, IMPORT_COMMAND.shortcut, IMPORT_COMMAND.needsVault, null],
      `${where}: title cmd.import (\`Import…\`), section file, no shortcut, needsVault false, built`,
    );
    assert.equal(find(list, 'goto.import'), undefined, `${where}: no goto.import`);
    assert.ok(!list.some((x) => cat.t(x.title, x.vars ?? {}) === 'Go to Import'), `${where}: no \`Go to Import\``);
  }
  // Running it calls `openImport` (the window at step 0, or brings it forward).
  const calls: string[] = [];
  for (const o of [{ calls }, { vault: false, calls }]) {
    const ctx = ctxOf(o);
    await find(cmd.commands(ctx), IMPORT_COMMAND.id).run(ctx);
  }
  assert.deepEqual(calls, ['openImport', 'openImport'], 'import.open runs ShellActions.openImport, with and without a vault');
  // No shortcut: no SHORTCUTS row names it.
  assert.deepEqual((reg.SHORTCUTS as { keys: string; command: string }[]).filter((s) => s.command === IMPORT_COMMAND.id), [], 'no shortcut for import.open (R154)');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-7 with the command

test('fr_ux_03_ac7_registry_integrity_with_import_open', async () => {
  const { cat, cmd } = await mods();
  for (const o of [{}, { vault: false }] as const) {
    const list = cmd.commands(ctxOf(o)) as any[];
    assert.ok(find(list, IMPORT_COMMAND.id), 'import.open is in the list');
    const ids = list.map((c) => c.id);
    assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'no duplicate command id');
    assert.deepEqual(shortcutClashes(list), [], 'no two enabled commands share a shortcut');
    for (const c of list) assert.ok(c.title in cat.en, `the title of ${c.id} is a catalog key: ${c.title}`);
    for (const c of list) assert.ok(!RESERVED.includes(c.shortcut), `${c.id} uses no reserved shortcut`);
    const sections = new Set(list.map((c) => c.section));
    assert.ok(sections.has('file'), 'the section `file` is in use (§4.2)');
  }
});
