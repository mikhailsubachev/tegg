// MS4 slice 4D-lite, L1: the registry, shortcut and command changes of R87 (docs/acceptance/tags.md R87; app-shell R1,
// R3, R4): `tags`, `tag/<key>` and `settings/backups` built; `duplicates.merge` and `ctl.rowColor` no longer disabled;
// no new shortcut (D-234); the palette commands of §6.3 (FR-UX-03), tag-page commands only on `tag/<key>`. The
// criteria are FR-TAG-07 AC-1 (`Go to Tags`), FR-TAG-03 AC-1 (`New tag…`), FR-HIS-04 AC-7 (`Go to Settings: Backups`),
// FR-TAG-04 AC-6, FR-TAG-08 AC-1, FR-TAG-05 AC-1, FR-TAG-06 AC-8, AC-5, AC-10 (tag-page commands), FR-LNK-14 AC-11
// (`Merge…`). Interface docs/contracts/ms4-tags.md §6.1, §6.3. Written from the ACs and the contract only (D-61).
import { afterEach, test } from 'vitest';
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
  const reg = await load('../ui/src/shell/registry.ts');
  const cat = await load('../ui/src/i18n/catalog.ts');
  const cmd = await load('../ui/src/shell/commands.ts');
  assert.ok(reg && cat && cmd, 'shell registry, catalog and commands modules load');
  return { reg: reg!, cat: cat!, cmd: cmd! };
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const VAULT = { name: 'Štítky', path: '/tmp/Štítky', placeholders: 0 };
const TYPES = [
  ['page', 'Page', 'Pages'], ['task', 'Task', 'Tasks'], ['quick-note', 'Quick Note', 'Quick Notes'], ['daily-note', 'Daily Note', 'Daily Notes'],
  ['tag', 'Tag', 'Tags'], ['image', 'Image', 'Images'], ['pdf', 'PDF', 'PDFs'], ['projekt', 'Projekt', 'Projekty'],
].map(([key, name, plural]) => ({ key, name, plural, folder: plural, icon: 'file-text', color: 'gray', system: key !== 'projekt', invalid: false }));
const ctx = (route: Record<string, unknown> | null) => ({ vault: VAULT, types: TYPES, counts: { page: 30, task: 2 }, ...(route ? { route } : {}) });
const TAG = { id: 'tag/<key>', key: 'účty', param: 'účty' };

test('fr_tag_07_ac1_routes_tags_tag_page_and_backups_are_built', async () => {
  const { reg } = await mods();
  const routes = reg.ROUTES as any[];
  const tags = routes.find((r) => r.id === 'tags');
  assert.ok(tags, 'route tags');
  assert.equal(tags.status.built, true, 'tags is built (All tags, R81)');
  assert.equal(tags.design, 'TagsAll', 'board TagsAll');
  const tag = routes.find((r) => r.id === 'tag/<key>');
  assert.ok(tag, 'route tag/<key>');
  assert.equal(tag.status.built, true, 'tag/<key> is built');
  assert.equal(tag.design, 'TagPage', 'board TagPage');
  assert.ok((tag.reqs as string[]).includes('FR-TAG-06'), 'FR-TAG-06');
  const b = routes.find((r) => r.id === 'settings/backups');
  assert.ok(b, 'route settings/backups');
  assert.equal(b.status.built, true, 'settings/backups is built');
  assert.equal(b.design, null, 'no board');
  const ms4 = (reg.overdue('MS4') as string[]).join('\n');
  for (const re of [/^tags /m, /FR-TAG-0[1-8]/, /duplicates\.merge|Merge…/, /ctl\.rowColor/]) assert.ok(!re.test(ms4), `overdue('MS4') holds ${re}:\n${ms4}`);
});

test('fr_lnk_14_ac11_merge_and_the_colour_row_are_no_longer_disabled', async () => {
  const { reg } = await mods();
  const labels = (reg.DISABLED_CONTROLS as any[]).map((c) => c.label);
  assert.ok(!labels.includes('duplicates.merge'), 'Merge… is built (R3)');
  assert.ok(!labels.includes('ctl.rowColor'), 'the Tag color row is removed (a Tag has no note page, D-692)');
  assert.ok(!(reg.DISABLED_CONTROLS as any[]).some((c) => String(c.req).startsWith('FR-TAG-')), 'no disabled FR-TAG control');
});

test('fr_tag_03_ac1_no_new_shortcut_and_the_new_commands', async () => {
  const { reg, cat, cmd } = await mods();
  const sc = reg.SHORTCUTS as { keys: string; command: string }[];
  assert.ok(!sc.some((s) => /^(tags|tag|settings\.backups|duplicates)\./.test(s.command)), 'no new shortcut (D-234)');
  const title = (c: any) => cat.t(c.title, c.vars ?? {});
  for (const route of [{ id: 'inbox' }, { id: 'note/<path>', path: 'Pages/Rozpočet.md', type: 'page' }, TAG]) {
    const list = cmd.commands(ctx(route)) as any[];
    for (const [id, t] of [['tags.go', 'Go to Tags'], ['tags.new', 'New tag…'], ['settings.backups', 'Go to Settings: Backups']]) {
      const c = list.find((x) => x.id === id);
      assert.ok(c, `${id} on ${route.id}`);
      assert.equal(title(c), t, `${id}: ${t}`);
      assert.equal(c.needsVault, true, `${id}: needsVault`);
      assert.equal(c.due ?? null, null, `${id}: runs`);
      assert.ok(c.title in cat.en, `${id}: a catalog key`);
    }
  }
});

test('fr_tag_08_ac1_tag_page_commands_only_on_tag_pages', async () => {
  const { cat, cmd } = await mods();
  const title = (c: any) => cat.t(c.title, c.vars ?? {});
  const on = cmd.commands(ctx(TAG)) as any[];
  const want: [string, string][] = [
    ['tag.rename', 'Rename tag…'], ['tag.delete', 'Delete tag…'], ['tag.colour', 'Change tag colour…'],
    ['tag.groupType', 'Group by type'], ['tag.groupNone', 'No grouping'],
  ];
  for (const [id, t] of want) {
    const c = on.find((x) => x.id === id);
    assert.ok(c, `${id} on tag/<key>`);
    assert.equal(title(c), t, `${id}: ${t}`);
    assert.equal(typeof c.run, 'function', `${id} runs`);
  }
  for (const route of [{ id: 'tags' }, { id: 'inbox' }, { id: 'note/<path>', path: 'Pages/Rozpočet.md', type: 'page' }]) {
    const list = cmd.commands(ctx(route)) as any[];
    for (const [id] of want) {
      const c = list.find((x) => x.id === id);
      if (c) assert.doesNotThrow(() => c.run(ctx(route)), `${id} on ${route.id} isn't run and shows no error`);
    }
  }
  const ids = on.map((c) => c.id);
  assert.deepEqual(ids.filter((x, i) => ids.indexOf(x) !== i), [], 'command ids are unique');
});

test('fr_lnk_14_ac11_merge_command_on_duplicate_titles', async () => {
  const { cat, cmd } = await mods();
  const list = cmd.commands(ctx({ id: 'duplicate-titles' })) as any[];
  const c = list.find((x) => x.id === 'duplicates.merge');
  assert.ok(c, 'duplicates.merge on duplicate-titles');
  assert.equal(cat.t(c.title, c.vars ?? {}), 'Merge…', 'Merge…');
  assert.equal(c.due ?? null, null, 'not "Coming in MS4 (4D)"');
});
