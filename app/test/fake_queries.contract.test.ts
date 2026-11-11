// Keeps the fake core's queries twin (app/ui/test/fake-queries.ts, docs/contracts/v1-queries.md §5) honest against the
// shared corpus (D-512): tests/fixtures/queries-files/expected.json (reads, fences, results; L3, shape §6.2, read by
// crates/tegg-core/tests/ac_queries.rs too), R146 of docs/acceptance/queries.md and the expected bytes of
// tests/fixtures/queries-files/expected/ (R138 write rules, D-1436). The WebKit tests (L5) run against this twin, so it
// must agree with the core. Not an AC test: the AC tests (app/test/queries_*.ac.test.ts, packages/*/test/query*.ac.test.ts,
// crates/*/tests/ac_quer*.rs) check the product.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  columnsDefault, fenceRead, handle, queryCreateText, queryDuplicateText, queryFencesOf, queryPatch, queryRead, queryRetitleText, queryRun,
  type QueryDefDto,
} from '../ui/test/fake-queries';
import { listTypes } from '../ui/test/fake-schema';
import { ALL_OBJECTS, CS, NOW, P, QFX, R146, expectedFile, qfile, queriesVault } from './queries-data';

const EXPECTED = join(QFX, 'expected.json');
function expectedJson(): any {
  assert.ok(existsSync(EXPECTED), 'tests/fixtures/queries-files/expected.json exists (L3, contract §6.2)');
  return JSON.parse(readFileSync(EXPECTED, 'utf8'));
}
const files = queriesVault();
const types = listTypes(files, {});
const cols = columnsDefault(types);
const stem = (p: string) => p.split('/').pop()!.replace(/\.yml$/, '');
const crlf = (t: string) => t.replace(/\n/g, '\r\n');
const noNewline = (t: string) => t.replace(/\n$/, '');

// ------------------------------------------------------------------------------------------------ L3 reads, fences, results

test('the twin reads every query file as expected.json', () => {
  const ex = expectedJson();
  const bad: string[] = [];
  for (const [path, want] of Object.entries(ex.reads as Record<string, any>)) {
    assert.ok(files[path] !== undefined, `${path} is a fixture file`);
    const r = queryRead(files[path], true, stem(path), cols);
    const got = { state: r.state, line: r.line, def: r.state === 'unreadable' ? null : r.def, broken: r.broken, usesThis: r.usesThis };
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${path}\n  want ${JSON.stringify(want)}\n  got  ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, [], 'the twin reads every query file as expected.json');
  assert.ok(Object.keys(ex.reads).length >= 12, 'expected.json covers the eleven live query files and the trashed one');
});

test('the twin finds every fence as expected.json', async () => {
  const ex = expectedJson();
  for (const [path, want] of Object.entries(ex.fences as Record<string, any[]>)) {
    const fences = await queryFencesOf(files[path]);
    const got = fences.map((f) => {
      const r = fenceRead(f.body, cols);
      const form = r.form === 'inline' && r.read?.state === 'unreadable' ? 'unreadable' : r.form;
      const line = r.form === 'unreadable' ? r.line ?? null : r.form === 'inline' && r.read?.state === 'unreadable' ? r.read.line : null;
      return { range: f.range, saved: f.saved, nested: f.nested, form, line };
    });
    assert.deepEqual(got, want, `${path}: the twin's fences`);
  }
});

test('the twin runs every expected.json result', async () => {
  const ex = expectedJson();
  for (const row of ex.results as any[]) {
    const r = await queryRun({ kind: 'saved', name: row.query }, row.host, row.env, files, types);
    assert.deepEqual({ paths: r.rows.map((x) => x.path), state: r.state, broken: r.broken }, { paths: row.paths, state: row.state, broken: row.broken },
      `${row.query} on ${row.host ?? '(no host)'} in ${row.env.zone}, ${row.env.locale}`);
  }
});

// ------------------------------------------------------------------------------------------------ R146 in the twin

test('the twin gives R146', async () => {
  for (const row of R146) {
    const r = await queryRun({ kind: 'saved', name: row.query }, row.host, row.env, files, types);
    const what = `${row.query} on ${row.host ?? '(no host)'} (${row.env.zone}, ${row.env.locale})`;
    assert.deepEqual(r.rows.map((x) => x.path), row.paths, `${what}: results in order`);
    assert.equal(r.state, row.state, `${what}: state`);
    if (row.broken) assert.deepEqual(r.broken, row.broken, `${what}: broken parts`);
    if (row.lookup) assert.equal(r.lookup, row.lookup, `${what}: lookup`);
    for (const p of r.rows.map((x) => x.path)) {
      assert.ok(!p.startsWith('.trash/') && !p.startsWith('_templates/') && p !== row.host, `${what}: ${p} is never trash, a template or the host`);
    }
  }
  const fence = async (body: string) => queryRun({ kind: 'fence', body }, P.prehled, CS, files, types);
  const miss = await fence('saved: Neexistující dotaz');
  assert.deepEqual([miss.form, miss.lookup, miss.rows.length], ['reference', 'missing', 0], 'Neexistující dotaz: not found');
  const old = await fence('saved: Starý dotaz');
  assert.deepEqual([old.form, old.lookup, old.rows.length], ['reference', 'trashed', 0], 'Starý dotaz: in the trash');
  const bad = await fence('saved: Nečitelný');
  assert.deepEqual([bad.lookup, bad.line, bad.rows.length], ['unreadable', 5, 0], 'Nečitelný: unreadable (line 5)');
  const inline = await fence('title: Ruční dotaz\ntypes: [kniha]\nfilters:\n  - přečteno: true\n# napsáno ručně\nview: list\n');
  assert.deepEqual([inline.form, inline.rows.map((x) => x.path)], ['inline', [P.krakatit]], 'Ruční dotaz (inline): Krakatit');
  const broken = await fence('title: [rozbitý\n');
  assert.deepEqual([broken.form, broken.line], ['unreadable', 1], 'the inline fence with invalid YAML: unreadable (line 1)');
  const empty = await fence('');
  assert.equal(empty.form, 'empty', 'an empty fence is the empty draft');
  const all = await queryRun({ kind: 'def', def: { title: 'Vše', types: [], match: 'all', filters: [], sort: { by: 'title', order: 'asc' }, limit: 50, view: 'list', columns: ['type', 'modified'] }, name: null }, null, CS, files, types);
  assert.deepEqual(all.rows.map((x) => x.path).sort(), [...ALL_OBJECTS].sort(), 'no types and no filters: the 21 objects (FR-QRY-01 AC-1)');
});

// ------------------------------------------------------------------------------------------------ R138 writes (expected/)

const DEF = (path: string) => queryRead(files[path], true, stem(path), cols).def;

test('commits give komentare-after-*.yml', () => {
  const path = qfile('Komentáře a neznámé klíče');
  for (const [variant, f] of [['', (t: string) => t], ['-crlf', crlf], ['-no-newline', noNewline]] as const) {
    const text = f(files[path]);
    const read = queryRead(text, true, stem(path), cols);
    const view = queryPatch(text, read, { ...read.def, view: 'table' }, NOW);
    assert.ok('text' in view, `${variant || 'LF'}: the view commit is accepted`);
    assert.equal((view as any).text, expectedFile(`komentare-after-view${variant}.yml`), `${variant || 'LF'}: komentare-after-view`);
    const filter = queryPatch(text, read, { ...read.def, filters: [...read.def.filters, { kind: 'filter', key: 'rozpočet', op: 'gt', value: 5000, src: null }] }, NOW);
    assert.equal((filter as any).text, expectedFile(`komentare-after-filter${variant}.yml`), `${variant || 'LF'}: komentare-after-filter`);
    assert.deepEqual(queryPatch(text, read, read.def, NOW), { text: null }, `${variant || 'LF'}: a no-op commit writes nothing`);
  }
  const ne = queryRead(files[qfile('Novější verze')], true, 'Novější verze', cols);
  assert.equal((queryPatch(files[qfile('Novější verze')], ne, { ...ne.def, view: 'table' }, NOW) as any).error?.kind, 'NewerVersion', 'a newer file is never patched');
  const un = queryRead(files[qfile('Nečitelný')], true, 'Nečitelný', cols);
  assert.equal((queryPatch(files[qfile('Nečitelný')], un, { ...un.def, view: 'table' }, NOW) as any).error?.kind, 'Unreadable', 'an unreadable file is never patched');
});

test('New query gives created*.yml', async () => {
  const def = (title: string): QueryDefDto => ({ title, types: [], match: 'all', filters: [], sort: { by: 'modified', order: 'desc' }, limit: 50, view: 'list', columns: ['type', 'modified'] });
  assert.equal(queryCreateText(def('Úkoly na víkend'), NOW), expectedFile('created.yml'), 'created.yml');
  assert.equal(queryCreateText(def('A/B: plán?'), NOW), expectedFile('created-a-b-plan.yml'), 'created-a-b-plan.yml');
  const r = await handle('query_create', { title: 'A/B: plán?', def: null, fence: null, free: false, now: NOW }, files);
  assert.deepEqual(Object.entries(r.writes ?? {}), [['.tegg/queries/A B plán.yml', expectedFile('created-a-b-plan.yml')]], 'the file name is the sanitized title (D-52)');
  for (const name of ['projekty v běhu', 'Projekty v běhu'.normalize('NFD'), '  Projekty v běhu ']) {
    const t = await handle('query_create', { title: name, def: null, fence: null, free: false, now: NOW }, files);
    assert.deepEqual([t.error?.kind, t.writes], ['NameTaken', undefined], `${JSON.stringify(name)}: NameTaken, nothing written`);
  }
  for (const name of ['', '   ']) assert.equal((await handle('query_create', { title: name, def: null, fence: null, free: false, now: NOW }, files)).error?.kind, 'EmptyName', `${JSON.stringify(name)}: EmptyName`);
});

test('Duplicate gives duplicate-projekty-v-behu-2.yml', async () => {
  const path = qfile('Projekty v běhu');
  const read = queryRead(files[path], true, 'Projekty v běhu', cols);
  assert.equal(queryDuplicateText(files[path], read, 'Projekty v běhu (2)', NOW), expectedFile('duplicate-projekty-v-behu-2.yml'), 'duplicate-projekty-v-behu-2.yml');
  const r = await handle('query_duplicate', { name: 'Projekty v běhu', now: NOW }, files);
  assert.deepEqual(Object.keys(r.writes ?? {}), ['.tegg/queries/Projekty v běhu (2).yml'], 'the copy is `Projekty v běhu (2).yml`');
});

test('the rename job title patch gives renamed-otevrene-ukoly-porady.yml', async () => {
  const path = qfile('Otevřené úkoly z této schůzky');
  const read = queryRead(files[path], true, stem(path), cols);
  assert.equal(queryRetitleText(files[path], read, 'Otevřené úkoly porady'), expectedFile('renamed-otevrene-ukoly-porady.yml'), 'renamed-otevrene-ukoly-porady.yml');
  const plan = await handle('query_rename_plan', { name: 'Otevřené úkoly z této schůzky', title: 'Otevřené úkoly porady' }, files);
  const p = plan.result as any;
  assert.deepEqual([p?.to, p?.usages], ['.tegg/queries/Otevřené úkoly porady.yml', [P.porada7, P.porada14, P.sablona]], 'the plan: the new file, the three usages');
  assert.equal((await handle('query_rename_plan', { name: 'Otevřené úkoly z této schůzky', title: 'projekty v běhu' }, files)).error?.kind, 'NameTaken', 'a taken name is refused before the job');
  assert.equal((await handle('query_rename_plan', { name: 'Nečitelný', title: 'Čitelný' }, files)).error?.kind, 'Unreadable', 'an unreadable query is never renamed');
});

test('Save as query… gives saved-rucni-dotaz.yml', async () => {
  const body = 'title: Ruční dotaz\ntypes: [kniha]\nfilters:\n  - přečteno: true\n# napsáno ručně\nview: list\n';
  const r = await handle('query_create', { title: 'Ruční dotaz', def: null, fence: body, free: false, now: NOW }, files);
  assert.deepEqual(Object.entries(r.writes ?? {}), [['.tegg/queries/Ruční dotaz.yml', expectedFile('saved-rucni-dotaz.yml')]], 'saved-rucni-dotaz.yml');
});

test('the 4C link patch rewrites only the value token', async () => {
  const text = [
    '# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › Odkazy.', 'version: 1', 'title: Odkazy', 'types: []', 'match: all', 'filters:',
    '  - links_to: "[[Výjezd Lisabon 2026]]"', '  - vlastník: { links_to: "[[Jana Nováková]]" }', '  - linked_from: this', 'sort: { by: title, order: asc }',
    'limit: 50', 'view: list', 'columns: [type, modified]', 'created: 2026-11-01T09:00:00+01:00', 'modified: 2026-11-01T09:00:00+01:00', '',
  ].join('\n');
  const paths = Object.keys(files).filter((p) => p.endsWith('.md'));
  const r = await handle('queries_job', { patches: [{ kind: 'objectMoved', from: P.lisabon, to: 'Projekty/Výjezd Lisabon 2027.md', paths }] }, { ...files, [qfile('Odkazy')]: text });
  assert.deepEqual(r.writes, { [qfile('Odkazy')]: text.replace('"[[Výjezd Lisabon 2026]]"', '"[[Výjezd Lisabon 2027]]"') }, 'only the value token; `modified` and `this` untouched');
  const r2 = await handle('queries_job', { patches: [{ kind: 'objectMoved', from: P.jana, to: 'Osoby/Jana Dvořáková.md', paths }] }, { ...files, [qfile('Odkazy')]: text });
  assert.deepEqual(Object.keys(r2.writes ?? {}), [qfile('Odkazy')], 'the relation value follows Jana; no other query file is written');
});
