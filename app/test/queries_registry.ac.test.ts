// Slice Q, L1: the registry parts of docs/acceptance/queries.md FR-NAV-04 AC-12 (the `queries` and `query/<name>` routes,
// no `saved-queries`) and FR-UX-03 AC-41 (R144's commands with R145's titles, listed only where R144 says; no new
// shortcut). Interface docs/contracts/v1-queries.md §4.1 (ROUTES, parseRoute, routeString, icons) and §4.6 (command ids,
// title keys, sections, `ShellActions.queryStatus`, `editQuery`, `renameQuery`, `trashQuery`, `insertQuery`). Written from
// the ACs and the contract only (D-61). Modules load inside the tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try { return (await import(/* @vite-ignore */ path)) as Mod; } catch { return null; }
}
async function mods() {
  const reg = await load('../ui/src/shell/registry.ts');
  const routes = await load('../ui/src/shell/routes.ts');
  const cat = await load('../ui/src/i18n/catalog.ts');
  const cmd = await load('../ui/src/shell/commands.ts');
  const icon = await load('../ui/src/shell/Icon.tsx');
  assert.ok(reg && routes && cat && cmd, 'registry, routes, catalog and commands modules load');
  return { reg: reg!, routes: routes!, cat: cat!, cmd: cmd!, icon };
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const VAULT = { name: 'Dotazy', path: '/tmp/Dotazy', placeholders: 0 };
const NOTE = { id: 'note/<path>', param: 'Schůzky/2026-10-07 Týdenní porada.md', path: 'Schůzky/2026-10-07 Týdenní porada.md', type: 'schůzka' };
const DAILY = { id: 'daily/YYYY-MM-DD', param: '2026-11-10', date: '2026-11-10', path: 'Daily/2026-11-10.md' };
const QUERY = { id: 'query/<name>', param: 'Projekty v běhu' };
const QUERIES = { id: 'queries' };
type QStatus = { name: string; editable: boolean } | null;
function ctxOf(route: Record<string, unknown> | null, o: { status?: QStatus; vault?: boolean; calls?: string[]; insert?: boolean } = {}) {
  const calls = o.calls ?? [];
  return {
    vault: o.vault === false ? null : VAULT, types: [], counts: {}, route,
    actions: {
      go: (r: any) => calls.push(`go ${r.id}${r.param ? ` ${r.param}` : ''}`),
      queryStatus: () => o.status ?? null,
      editQuery: () => calls.push('edit'), renameQuery: () => calls.push('rename'), trashQuery: () => calls.push('trash'),
      ...(o.insert === false ? {} : { insertQuery: () => calls.push('insert') }),
      pinStatus: () => (route && (route as any).id === 'query/<name>' ? { pinned: false, disabled: null } : null),
    },
  };
}
const find = (l: any[], id: string) => l.find((c) => c.id === id);

// ------------------------------------------------------------------------------------------------ FR-NAV-04 AC-12

test('fr_nav_04_ac12_queries_entry', async () => {
  const { reg, routes, cat, icon } = await mods();
  const R = reg.ROUTES as any[];
  assert.equal(R.find((r) => r.id === 'saved-queries'), undefined, 'no `saved-queries` route (AP-1304)');
  const q = R.find((r) => r.id === 'queries');
  assert.ok(q, 'route `queries`');
  assert.deepEqual([q.name, q.purpose, q.status.built, q.design], ['route.queries', 'purpose.queries', true, 'QueriesAll'], '`queries`: names, built, board QueriesAll');
  assert.ok(q.reqs.includes('FR-QRY-06') && q.reqs.includes('FR-NAV-04'), '`queries` reqs FR-QRY-06, FR-NAV-04');
  assert.equal(q.status.due?.milestone ?? 'v1.0', 'v1.0', '`queries` is v1.0');
  const one = R.find((r) => r.id === 'query/<name>');
  assert.ok(one, 'route `query/<name>`');
  assert.deepEqual([one.name, one.purpose, one.status.built, one.design], ['route.query', 'purpose.query', true, 'QueryPage'], '`query/<name>`: names, built, board QueryPage');
  assert.deepEqual([cat.t('route.queries'), cat.t('route.query')], ['Queries', 'Query'], 'route names');
  assert.equal(routes.parseRoute('saved-queries'), null, '`saved-queries` parses as unknown');
  assert.deepEqual(routes.parseRoute('queries'), { id: 'queries' }, '`queries`');
  assert.deepEqual(routes.parseRoute('query/Projekty v běhu'), { id: 'query/<name>', param: 'Projekty v běhu' }, '`query/<name>` with the name unencoded');
  assert.deepEqual(routes.parseRoute('query/Projekty v běhu'.normalize('NFD')), { id: 'query/<name>', param: 'Projekty v běhu' }, 'the name is NFC');
  assert.deepEqual(routes.parseRoute('query/Vše, co sem odkazuje'), { id: 'query/<name>', param: 'Vše, co sem odkazuje' }, 'commas and spaces stay');
  assert.equal(routes.parseRoute('query/'), null, 'an empty name is no route');
  assert.equal(routes.routeString({ id: 'query/<name>', param: 'Otevřené úkoly z této schůzky' }), 'query/Otevřené úkoly z této schůzky', 'routeString');
  assert.equal(routes.routeString({ id: 'queries' }), 'queries', 'routeString of `queries`');
  assert.ok(icon && typeof icon.routeIcon === 'function', 'Icon.tsx routeIcon');
  assert.deepEqual([icon!.routeIcon('queries'), icon!.routeIcon('query/<name>')], ['query', 'query'], 'both routes use the funnel icon `query`');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-41

test('fr_ux_03_ac41_query_commands', async () => {
  const { reg, cat, cmd } = await mods();
  const list = (route: Record<string, unknown> | null, o: Parameters<typeof ctxOf>[1] = {}) => cmd.commands(ctxOf(route, o)) as any[];
  // Everywhere with a vault: Go to Queries, New query…
  for (const route of [NOTE, DAILY, QUERY, QUERIES, { id: 'inbox' }, { id: 'tags' }]) {
    const l = list(route);
    const go = find(l, 'queries.go');
    const nw = find(l, 'queries.new');
    assert.ok(go && nw, `${route.id}: queries.go and queries.new listed`);
    assert.deepEqual([go.title, cat.t(go.title), go.section, go.needsVault, go.shortcut ?? null], ['cmd.goQueries', 'Go to Queries', 'navigate', true, null], `${route.id}: Go to Queries`);
    assert.deepEqual([nw.title, cat.t(nw.title), nw.section, nw.needsVault, nw.shortcut ?? null], ['cmd.newQuery', 'New query…', 'create', true, null], `${route.id}: New query…`);
  }
  assert.equal(find(list(QUERIES), 'goto.saved-queries'), undefined, 'no `Go to Saved queries`');
  // Insert query: note and daily routes only (with the editor; R144).
  for (const route of [NOTE, DAILY]) {
    const ins = find(list(route), 'editor.insertQuery');
    assert.ok(ins, `${route.id}: editor.insertQuery listed`);
    assert.deepEqual([ins.title, cat.t(ins.title), ins.section, ins.shortcut ?? null], ['cmd.insertQuery', 'Insert query', 'edit', null], `${route.id}: Insert query`);
  }
  for (const route of [QUERY, QUERIES, { id: 'tags' }, { id: 'type/<type>', param: 'task' }, { id: 'inbox' }]) {
    assert.equal(find(list(route), 'editor.insertQuery'), undefined, `${route.id}: no Insert query`);
  }
  // query/<name>: Edit query, Rename query…, Move query to trash; Pin to sidebar too (pinned.md R136).
  const onPage = list(QUERY, { status: { name: 'Projekty v běhu', editable: true } });
  const want: [string, string, string][] = [['query.edit', 'query.edit', 'Edit query'], ['query.rename', 'cmd.renameQuery', 'Rename query…'], ['query.trash', 'cmd.trashQuery', 'Move query to trash']];
  for (const [id, key, text] of want) {
    const c = find(onPage, id);
    assert.ok(c, `query/<name>: ${id} listed`);
    assert.deepEqual([c.title, cat.t(c.title), c.section, c.shortcut ?? null, c.disabled?.() ?? null], [key, text, 'edit', null, null], `query/<name>: ${text}`);
  }
  assert.ok(find(onPage, 'sidebar.pin'), 'query/<name>: Pin to sidebar listed');
  // Unreadable or newer: Rename query… disabled (Edit query too: nothing can be written), Move to trash still runs.
  const ro = list(QUERY, { status: { name: 'Nečitelný', editable: false } });
  assert.ok(find(ro, 'query.rename') && find(ro, 'query.rename').disabled?.(), 'unreadable / newer: Rename query… is disabled with a reason');
  assert.ok(find(ro, 'query.trash') && !find(ro, 'query.trash').disabled?.(), 'unreadable / newer: Move query to trash runs');
  // A note: Edit query only with a selected query block (queryStatus non-null).
  assert.equal(find(list(NOTE, { status: null }), 'query.edit'), undefined, 'a note without a selected block: no Edit query');
  assert.ok(find(list(NOTE, { status: { name: 'Otevřené úkoly z této schůzky', editable: true } }), 'query.edit'), 'a note with a selected block: Edit query');
  for (const route of [QUERIES, { id: 'inbox' }]) for (const id of ['query.edit', 'query.rename', 'query.trash']) assert.equal(find(list(route), id), undefined, `${route.id}: no ${id}`);
  // Running them calls the shell's actions.
  const calls: string[] = [];
  const ctxQ = ctxOf(QUERY, { status: { name: 'Projekty v běhu', editable: true }, calls });
  for (const id of ['queries.go', 'query.edit', 'query.rename', 'query.trash']) await find(cmd.commands(ctxQ), id).run(ctxQ);
  const ctxN = ctxOf(NOTE, { calls });
  await find(cmd.commands(ctxN), 'editor.insertQuery').run(ctxN);
  assert.deepEqual(calls, ['go queries', 'edit', 'rename', 'trash', 'insert'], 'queries.go opens `queries`; the others call editQuery, renameQuery, trashQuery, insertQuery');
  // Without a vault none of them.
  const none = list(null, { vault: false });
  for (const id of ['queries.go', 'queries.new', 'editor.insertQuery', 'query.edit']) {
    const c = find(none, id);
    assert.ok(!c || c.needsVault === true, `no vault: ${id} needs a vault`);
  }
  // No new shortcut (R144) and no clash: no SHORTCUTS row names a query command.
  const sc = (reg.SHORTCUTS as { keys: string; command: string }[]).filter((s) => /^(queries\.|query\.|editor\.insertQuery$)/.test(s.command));
  assert.deepEqual(sc, [], 'no shortcut for the query commands');
});
