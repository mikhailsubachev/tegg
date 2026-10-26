// Contract test of the fake core's tag twin (app/ui/test/fake-tags.ts) against docs/contracts/ms4-tags.md §1 and
// docs/acceptance/tags.md R79, R80 on the tags fixture: the rows, the Tag file winners, the tag page rows and the new
// Tag file paths. Not an AC test (D-512): it keeps the L5 fake honest ("L1 for the TS twin of the fake core" of
// FR-TAG-01 AC-1); the core is tested at L4 (crates/tegg-core/tests/ac_tags.rs).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { handle } from '../ui/test/fake-tags';

const REPO = resolve(import.meta.dirname, '../..');
function vault(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (root: string, d: string, prefix: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const rel = (prefix + relative(root, p)).normalize('NFC');
      if (statSync(p).isDirectory()) walk(root, p, prefix);
      else if (rel !== 'README.md') out[rel] = readFileSync(p, 'utf8');
    }
  };
  const fx = resolve(REPO, 'tests/fixtures/vaults/tags');
  walk(fx, fx, '');
  const tegg = resolve(REPO, 'tests/fixtures/vaults/new-empty/.tegg');
  walk(tegg, tegg, '.tegg/');
  return out;
}
const iso = (s: string) => `${s}:00+02:00`;

test('fake_tags_rows_are_r80', async () => {
  const r = (await handle('index_tags', {}, vault(), {})).result as any[];
  const got = r.map((x) => [x.key, x.name, x.file?.path ?? null, x.color, x.colorRaw, x.count, x.lastUsed, x.losers]);
  assert.deepEqual(got, [
    ['a/b', 'a/b', 'Tags/a b.md', null, null, 1, iso('2026-10-18T09:00'), []],
    ['cizí', 'cizí', 'Pages/Cizí štítek.md', null, null, 0, null, []],
    ['dvojí', 'dvojí', 'Tags/dvojí.md', 'red', 'red', 1, iso('2026-10-19T12:00'), ['Tags/Dvojí (2).md']],
    ['finance', 'finance', null, null, null, 2, iso('2026-10-21T09:00'), []],
    ['neznámá', 'neznámá', 'Tags/neznámá.md', null, 'magenta', 1, iso('2026-09-10T09:00'), []],
    ['prázdný', 'prázdný', 'Tags/prázdný.md', 'teal', 'teal', 0, null, []],
    ['účty', 'Účty', 'Tags/Účty.md', 'blue', 'blue', 6, iso('2026-10-22T08:00'), []],
    ['účty-2026', 'účty-2026', null, null, null, 1, iso('2026-10-01T09:00'), []],
    ['účty/archiv', 'účty/archiv', null, null, null, 1, iso('2026-10-15T12:00'), []],
    ['čtení', 'čtení', null, null, null, 2, iso('2026-09-10T09:00'), []],
  ], 'R80 (key order by code point)');
});

test('fake_tags_objects_of_ucty', async () => {
  const r = (await handle('tag_objects', { key: 'účty' }, vault(), {})).result as any[];
  assert.deepEqual(r.map((x) => [x.path, x.type, x.tags]), [
    ['Daily/2026-10-20.md', 'daily-note', []],
    ['Pages/Dvakrát.md', 'page', ['účty/archiv']],
    ['Pages/Rozpočet.md', 'page', ['finance']],
    ['Quick Notes/Faktura.md', 'quick-note', []],
    ['Tasks/Zaplatit nájem.md', 'task', []],
    ['Tasks/Zavolat bance.md', 'task', []],
  ]);
  const banka = r.find((x) => x.path === 'Tasks/Zavolat bance.md');
  assert.deepEqual([banka.status, banka.due, banka.modified], ['To do', '2026-10-21', iso('2026-10-12T08:00')]);
  assert.equal(r.find((x) => x.path === 'Quick Notes/Faktura.md').review, 'unreviewed');
  assert.deepEqual((await handle('tag_objects', { key: 'neexistuje' }, vault(), {})).result, []);
  // §1.6 (D-784): the distinct count All tags shows (R80: 11 tagged objects, D-721), one read.
  assert.equal((await handle('index_tagged_objects', {}, vault(), {})).result, 11);
});

test('fake_tags_new_paths_and_usage', async () => {
  const v = vault();
  const p = async (name: string) => ((await handle('tag_new_path', { name }, v, {})).result as any).path;
  assert.equal(await p('Účetnictví'), 'Tags/Účetnictví.md');
  assert.equal(await p('Rozpočet'), 'Tags/Rozpočet (2).md');
  assert.equal(await p('a//b'), 'Tags/a b (2).md');
  assert.equal(await p('x/y'), 'Tags/x y.md');
  const long = await p('č'.repeat(130));
  assert.ok(Buffer.byteLength(long.slice('Tags/'.length, -3)) <= 200, 'stem ≤ 200 bytes');
  assert.deepEqual((await handle('tag_usage', { key: 'účty' }, v, {})).result, { notes: 6, templates: 1, file: 'Tags/Účty.md', losers: [] });
  assert.deepEqual((await handle('capture_tags', {}, v, {})).result, [
    { name: 'a/b', color: null }, { name: 'cizí', color: null }, { name: 'dvojí', color: 'red' }, { name: 'finance', color: null },
    { name: 'neznámá', color: null }, { name: 'prázdný', color: 'teal' }, { name: 'Účty', color: 'blue' }, { name: 'účty-2026', color: null },
    { name: 'účty/archiv', color: null }, { name: 'čtení', color: null },
  ]);
});
