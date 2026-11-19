// Slice Q2.1, L1: docs/acceptance/views.md FR-UX-03 AC-52 (R199's commands `sort.useQuery` and `columns.useQuery`: titles,
// no shortcut, `needsVault: true`, section `view`, listed only on a view tab or a selected saved-query block whose usage
// has that key, valid or broken, and can be written; D-1856, D-1864) and NFR-OTH-02 AC-22 (R199's catalog keys and
// texts). Interface docs/contracts/v1-views.md §19.2, §19.4 (`ViewsStatus.usage`). Written from the ACs and the contract
// only (D-61). Modules load inside the tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try { return (await import(/* @vite-ignore */ path)) as Mod; } catch { return null; }
}
async function mods() {
  const reg = await load('../ui/src/shell/registry.ts');
  const cat = await load('../ui/src/i18n/catalog.ts');
  const cmd = await load('../ui/src/shell/commands.ts');
  assert.ok(reg && cat && cmd, 'registry, catalog and commands modules load');
  return { reg: reg!, cat: cat!, cmd: cmd! };
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const VAULT = { name: 'Knihovna', path: '/tmp/Knihovna', placeholders: 0 };
type Usage = { kind: 'tab' | 'block'; ownSort: boolean; ownColumns: boolean } | null;
type Status = { typeKey: string | null; tab: string | null; writable: boolean; board: null; sortable: boolean; usage: Usage } | null;
function ctxOf(route: Record<string, unknown> | null, status: Status, calls: string[] = [], vault = true) {
  return {
    vault: vault ? VAULT : null, types: [], counts: {}, route,
    actions: { go: (r: any) => calls.push(`go ${r.id}`), views: { status: () => status, run: (id: string) => calls.push(id) }, queryStatus: () => null, pinStatus: () => null },
  };
}
const BOOK = { id: 'type/<type>', param: 'book' };
const QUERY = { id: 'query/<name>', param: 'Přečtené 2026' };
const NOTE = { id: 'note/<path>', param: 'Pages/Knihy na cesty.md', path: 'Pages/Knihy na cesty.md', type: 'page' };
const st = (o: Partial<NonNullable<Status>> = {}): Status => ({ typeKey: 'book', tab: 'Přečtené 2026', writable: true, board: null, sortable: true, usage: { kind: 'tab', ownSort: true, ownColumns: true }, ...o });
const IDS = ['sort.useQuery', 'columns.useQuery'];

test('fr_ux_03_ac52_usage_commands', async () => {
  const { reg, cat, cmd } = await mods();
  const ids = (route: Record<string, unknown> | null, s: Status) => (cmd.commands(ctxOf(route, s)) as any[]).map((c) => c.id).filter((id: string) => IDS.includes(id)).sort();
  const all = cmd.commands(ctxOf(BOOK, st())) as any[];
  for (const [id, key, text] of [['sort.useQuery', 'cmd.useQuerySort', 'Use the query\'s sort'], ['columns.useQuery', 'cmd.useQueryColumns', 'Use the query\'s columns']]) {
    const c = all.find((x) => x.id === id);
    assert.ok(c, `${id} listed on a tab with its own value`);
    assert.deepEqual([c.title, cat.t(c.title), c.section, c.needsVault, c.shortcut ?? null], [key, text, 'view', true, null], `${id}: ${text}`);
  }
  assert.deepEqual(ids(BOOK, st()), IDS.slice().sort(), 'a tab with own sort and columns: both');
  assert.deepEqual(ids(BOOK, st({ usage: { kind: 'tab', ownSort: true, ownColumns: false } })), ['sort.useQuery'], 'only the sort key: only sort.useQuery');
  assert.deepEqual(ids(BOOK, st({ usage: { kind: 'tab', ownSort: false, ownColumns: true } })), ['columns.useQuery'], 'only the columns key');
  assert.deepEqual(ids(BOOK, st({ usage: { kind: 'tab', ownSort: false, ownColumns: false } })), [], 'no own key: none');
  assert.deepEqual(ids(BOOK, st({ writable: false })), [], 'a tab that can\'t be written: none');
  assert.deepEqual(ids(BOOK, st({ tab: null, usage: null })), [], '`All Books`: none');
  assert.deepEqual(ids(QUERY, st({ typeKey: null, tab: null, usage: null })), [], 'query/<name>: none');
  assert.deepEqual(ids(NOTE, st({ typeKey: null, tab: null, usage: { kind: 'block', ownSort: true, ownColumns: true } })), IDS.slice().sort(), 'a selected block with both keys');
  assert.deepEqual(ids(NOTE, st({ typeKey: null, tab: null, usage: null })), [], 'an inline block: none');
  assert.deepEqual(ids(NOTE, null), [], 'no selected block: none');
  const calls: string[] = [];
  const ctx = ctxOf(BOOK, st(), calls);
  for (const id of IDS) await (cmd.commands(ctx) as any[]).find((c) => c.id === id).run(ctx);
  assert.deepEqual(calls, IDS, 'each runs views.run(id)');
  const sc = (reg.SHORTCUTS as { keys: string; command: string }[]).filter((s) => IDS.includes(s.command));
  assert.deepEqual(sc, [], 'no shortcut');
});

const R199: [string, Record<string, string | number>, string][] = [
  ['sort.scope.tab', {}, 'This tab\'s sort'], ['sort.scope.block', {}, 'This block\'s sort'], ['sort.scope.default', {}, 'Default for tabs and blocks without their own sort'],
  ['sort.useQuery', {}, 'Use the query\'s sort'], ['columns.scope.tab', {}, 'Columns of this tab'], ['columns.scope.block', {}, 'Columns of this block'],
  ['columns.scope.default', {}, 'Default for tabs and blocks without their own columns'], ['columns.useQuery', {}, 'Use the query\'s columns'],
  ['query.block.usageNotEditable', {}, 'Open the note to change how this block shows.'], ['query.editor.perUsage', {}, 'Sort and columns are set on each tab and block.'],
  ['views.trashFailed', { name: 'Výborné knihy' }, '“Výborné knihy” couldn\'t be moved to the trash. The view is back on the page.'],
  ['cmd.useQuerySort', {}, 'Use the query\'s sort'], ['cmd.useQueryColumns', {}, 'Use the query\'s columns'],
];
const REUSED: [string, Record<string, string | number>, string][] = [
  ['queries.trashed', { name: 'Výborné knihy' }, 'Moved “Výborné knihy” to the trash'],
  ['views.changedOutside', { plural: 'Books' }, '"Books" changed outside Tegg. The views weren\'t changed.'],
  ['query.block.brokenKey', { key: 'sort' }, 'The setting sort can\'t be read, so its default is used.'],
  ['query.block.readOnly', {}, 'Made by a newer version of Tegg. Read-only.'],
];

test('nfr_oth_02_ac22_usage_strings', async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  assert.ok(cat, 'ui/src/i18n/catalog.ts loads');
  const en = cat!.en as Record<string, unknown>;
  const bad: string[] = [];
  for (const [key, vars, want] of [...R199, ...REUSED]) {
    const got = key in en ? cat!.t(key, vars) : 'missing';
    if (got !== want) bad.push(`${key} ${JSON.stringify(vars)}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, [], 'R199\'s keys with R199\'s texts, and the reused keys');
});
