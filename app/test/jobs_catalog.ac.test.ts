// MS4 slice 4C, L1: catalog strings and palette commands of the rename job (docs/contracts/ms4-jobs.md §10).
// FR-LNK-03 AC-16 (`{count} notes not updated` since 4D-lite, D-677; plural, D-133; the skip reasons), FR-UX-07 AC-9 (the status texts and
// `Undo`), FR-LNK-03 AC-14 (palette `Undo rename`), FR-LNK-03 AC-17 (the interrupted banner, D-387). Exact English
// texts are those of docs/acceptance/rename.md. Written from the ACs and the contract only (D-61). Modules load inside
// the tests (TS-I1); a new file, so existing catalog tests are unchanged (TS-I3).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { catalog, load } from './read-helpers';

afterEach(async () => {
  const cat = await catalog().catch(() => null);
  cat?.setCatalog(cat.en, 'en');
});

/** Variables under every name a message might use; plural messages take `count` (ms4-links §5.4). */
const v = (n: number, extra: Record<string, string | number> = {}) => ({ count: n, n, ...extra });

test('fr_lnk_03_ac16_links_not_updated_strings_and_plurals', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, unknown>;
  for (const k of ['job.notUpdated.count', 'job.skip.changed', 'job.skip.missing', 'job.skip.placeholder', 'job.skip.readOnly', 'job.skip.io']) {
    assert.ok(k in en, `catalog key ${k}`);
  }
  assert.equal(typeof en['job.notUpdated.count'], 'object', 'job.notUpdated.count is a plural message (D-133)');
  // 4D-lite (D-672, D-677): one list for every job kind.
  assert.equal(cat.t('job.notUpdated.count', v(3)), '3 notes not updated', 'AC-16 (D-677)');
  assert.equal(cat.t('job.notUpdated.count', v(1)), '1 note not updated', 'singular');
  assert.equal(cat.t('job.skip.changed'), 'changed by another app', 'AC-15 reason');
  assert.equal(cat.t('job.skip.missing'), 'missing', 'AC-15 reason (as written in the AC)');
  assert.equal(cat.t('job.skip.placeholder'), 'not downloaded', 'AC-15 reason');
  // The Czech test catalog picks one / few / other.
  cat.setCatalog({ ...(cat.en as object), 'job.notUpdated.count': { one: '{count} odkaz neaktualizován', few: '{count} odkazy neaktualizovány', other: '{count} odkazů neaktualizováno' } }, 'cs');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('job.notUpdated.count', v(n))), ['1 odkaz neaktualizován', '3 odkazy neaktualizovány', '5 odkazů neaktualizováno']);
});

test('fr_ux_07_ac9_status_strings', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, unknown>;
  for (const k of ['job.rename.running', 'job.rename.done', 'job.undo', 'job.rename.cancel']) assert.ok(k in en, `catalog key ${k}`);
  assert.equal(cat.t('job.rename.running', v(500)), 'Updating links in 500 notes', 'AC-9 while running');
  assert.equal(cat.t('job.rename.done', v(500)), 'Updated links in 500 notes', 'AC-9 when done');
  assert.equal(cat.t('job.undo'), 'Undo', 'the toast action');
});

test('fr_lnk_03_ac14_palette_commands_undo_rename_and_show_links_not_updated', async () => {
  const cat = await catalog();
  const cmd = await load('../ui/src/shell/commands.ts');
  assert.ok(cmd, 'commands module loads');
  const ctx = { vault: { name: 'Přejmenování', path: '/tmp/Přejmenování', placeholders: 0 }, types: [], counts: {}, route: { id: 'note/<path>', path: 'Pages/Alfa.md' } };
  const list = cmd!.commands(ctx) as { id: string; title: string; needsVault: boolean; vars?: Record<string, unknown> }[];
  for (const [id, title] of [['job.undoRename', 'Undo rename'], ['job.showNotUpdated', 'Show notes not updated']] as const) {
    const c = list.find((x) => x.id === id);
    assert.ok(c, `${id} is registered (FR-UX-03)`);
    assert.ok(c!.title in (cat.en as object), `${id}: title is a catalog key`);
    assert.equal(cat.t(c!.title, c!.vars ?? {}), title, `${id}: palette title`);
    assert.equal(c!.needsVault, true, `${id}: needs a vault`);
  }
});

test('fr_lnk_03_ac17_interrupted_banner_strings', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, unknown>;
  for (const k of ['job.interrupted', 'job.finish', 'job.undo']) assert.ok(k in en, `catalog key ${k}`);
  const vars = { old: 'Rozbočovač', title: 'Rozbočovač', from: 'Rozbočovač', name: 'Rozbočovač', done: 120, k: 120, total: 500, n: 500, count: 500 };
  assert.equal(cat.t('job.interrupted', vars), 'Renaming "Rozbočovač" was interrupted: 120 of 500 links updated', 'D-387 banner');
  assert.equal(cat.t('job.finish'), 'Finish');
});
