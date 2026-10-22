// Contract test of the fake core's trash twin (app/ui/test/fake-trash.ts) against docs/contracts/ms6-trash-media.md
// §1.2…§1.4 and docs/acceptance/trash-media.md R70, R71 on the trash-media fixture: rows, order, pairs and the planned
// renames. Not an AC test (D-512): it keeps the L5 fake honest; the core is tested at L4 (ac_trash.rs).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { handle, planRestore, planTrashObject, trashRows, typeFolders, type TrashInput } from '../ui/test/fake-trash';

const REPO = resolve(import.meta.dirname, '../..');
function vault(): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const walk = (root: string, d: string, prefix: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const rel = (prefix + relative(root, p)).normalize('NFC');
      if (statSync(p).isDirectory()) walk(root, p, prefix);
      else if (rel !== 'README.md' && rel !== 'make-media.mjs') out[rel] = /\.(md|yml)$/.test(rel) ? readFileSync(p, 'utf8') : null;
    }
  };
  const fx = resolve(REPO, 'tests/fixtures/vaults/trash-media');
  walk(fx, fx, '');
  const tegg = resolve(REPO, 'tests/fixtures/vaults/new-empty/.tegg');
  walk(tegg, tegg, '.tegg/');
  return out;
}
const AT: Record<string, string> = {
  '.trash/Quick Notes/Stará poznámka.md': '2026-10-01T09:00:00+02:00', '.trash/Recepty': '2026-10-10T09:00:00+02:00',
  '.trash/Tasks/Hotovo.md': '2026-10-15T09:00:00+02:00', '.trash/_attachments/osiřelý.jpg': '2026-10-20T09:00:00+02:00',
  '.trash/Pages/Zahrada.md': '2026-10-21T18:00:00+02:00', '.trash/Images/Smazaný obrázek.md': '2026-10-22T08:00:00+02:00',
};
function input(files = vault(), at = AT): TrashInput {
  const paths = Object.keys(files);
  return { paths, text: (p) => files[p] ?? undefined, trashedAt: (p) => at[p], typeFolders: typeFolders(paths, (p) => files[p] ?? undefined) };
}

test('fake_trash_rows_follow_r70_r71', () => {
  const rows = trashRows(input());
  assert.deepEqual(rows.map((r) => [r.path, r.kind, r.title, r.folder, r.type, r.count]), [
    ['.trash/Images/Smazaný obrázek.md', 'object', 'Smazaný obrázek', 'Images', 'image', 1],
    ['.trash/Pages/Zahrada.md', 'object', 'Zahrada', 'Pages', 'page', 1],
    ['.trash/_attachments/osiřelý.jpg', 'file', 'osiřelý.jpg', '_attachments', null, 1],
    ['.trash/Tasks/Hotovo.md', 'object', 'Hotovo', 'Tasks', 'task', 1],
    ['.trash/Recepty', 'folder', 'Recepty', 'Recepty', null, 1],
    ['.trash/Quick Notes/Stará poznámka.md', 'object', 'Stará poznámka', 'Quick Notes', 'quick-note', 1],
  ]);
  assert.deepEqual(rows[0].files, ['.trash/Images/Smazaný obrázek.md', '.trash/_attachments/Smazaný obrázek.png'], 'a pair is one row');
  const same = trashRows(input(vault(), {}));
  assert.deepEqual(same.map((r) => r.path), [...same.map((r) => r.path)].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1)), 'equal times keep path order');
});

test('fake_trash_plans_follow_1_4', () => {
  const i = input();
  assert.deepEqual(planTrashObject(i, 'Images/Záhon.md'), [{ from: 'Images/Záhon.md', to: '.trash/Images/Záhon.md' }, { from: '_attachments/záhon.png', to: '.trash/_attachments/záhon.png' }]);
  assert.deepEqual(planTrashObject(i, 'Pages/Zahrada.md'), [{ from: 'Pages/Zahrada.md', to: '.trash/Pages/Zahrada (2).md' }]);
  assert.equal((planTrashObject(i, '.trash/Tasks/Hotovo.md') as any).kind, 'Invalid');
  assert.deepEqual(planRestore(i, '.trash/Pages/Zahrada.md'), [{ from: '.trash/Pages/Zahrada.md', to: 'Pages/Zahrada (2).md' }]);
  assert.deepEqual(planRestore(i, '.trash/Recepty'), [{ from: '.trash/Recepty/Bábovka.md', to: 'Recepty/Bábovka.md' }]);
  const files = vault();
  files['Images/Záhon kopie.md'] = files['Images/Záhon.md']!.replace('title: Záhon', 'title: Záhon kopie');
  assert.deepEqual(planTrashObject(input(files), 'Images/Záhon.md'), [{ from: 'Images/Záhon.md', to: '.trash/Images/Záhon.md' }], 'a shared file stays');
  const e = handle('trash_empty', {}, Object.fromEntries(Object.entries(vault()).filter(([, v]) => v !== null)) as Record<string, string>, Object.keys(vault()).filter((k) => vault()[k] === null), AT);
  assert.deepEqual(e.entries, ['.trash/_attachments', '.trash/Images', '.trash/Pages', '.trash/Quick Notes', '.trash/Recepty', '.trash/Tasks'], 'the top-level entries');
});
