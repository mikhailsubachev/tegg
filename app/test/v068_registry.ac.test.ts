// Preview v0.68 feedback, L1: the registries without ⌘O, the switcher command and `New with tag…`.
// docs/acceptance/search-navigation.md FR-NAV-01 AC-18 (L1 for R4: ⌘O is unbound, no `app.switcher`, D-760) and
// docs/acceptance/tags.md FR-TAG-06 AC-12 (L1 for the catalog: no `tag.newWith` key, no `New with tag…` command,
// D-762). Interface: docs/contracts/ms3-shell.md §3.1–§3.3 (`SHORTCUTS`, `commands(ctx)`, the `en` catalog),
// ms4-tags.md §6 (tag-page command ids). Modules are imported dynamically inside each test so a missing module fails
// an assertion (TS-I1). Written from the ACs and the contracts only (D-61).
import { beforeEach, test } from 'vitest';
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
  assert.ok(reg && cat && cmd, 'registry, catalog and commands modules load');
  return { reg: reg!, cat: cat!, cmd: cmd! };
}
beforeEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

// The context shape of registry_4d.ac.test.ts (ms3-shell §3.3).
const VAULT = { name: 'Štítky', path: '/tmp/Štítky', placeholders: 0 };
const TYPES = [
  ['page', 'Page', 'Pages'], ['task', 'Task', 'Tasks'], ['quick-note', 'Quick Note', 'Quick Notes'], ['daily-note', 'Daily Note', 'Daily Notes'],
  ['tag', 'Tag', 'Tags'], ['image', 'Image', 'Images'], ['pdf', 'PDF', 'PDFs'],
].map(([key, name, plural]) => ({ key, name, plural, folder: plural, icon: 'file-text', color: 'gray', system: true, invalid: false }));
const CTX = { vault: VAULT, types: TYPES, counts: { page: 30, task: 2 } };
const TAG_CTX = { ...CTX, route: { id: 'tag/<key>', key: 'účty', param: 'účty' } };

test('fr_nav_01_ac18_r4_has_no_cmd_o_and_no_switcher_command', async () => {
  const { reg, cat, cmd } = await mods();
  const keys = (reg.SHORTCUTS as { keys: string; command: string }[]).map((s) => s.keys);
  assert.ok(keys.length > 0, 'the shortcut table is not empty');
  assert.equal(keys.includes('⌘O'), false, 'R4 has no ⌘O row (D-760)');
  assert.equal((reg.SHORTCUTS as { command: string }[]).some((s) => s.command === 'app.switcher'), false, 'no shortcut runs app.switcher');
  const list = cmd.commands(CTX) as any[];
  assert.ok(list.length > 0, 'the command registry is not empty');
  assert.deepEqual(list.filter((c) => c.id === 'app.switcher').map((c) => c.id), [], 'no app.switcher command');
  const titles = list.map((c) => String(cat.t(c.title, c.vars ?? {})));
  assert.deepEqual(titles.filter((t) => /quick switcher|search or jump to/i.test(t)), [], 'no "Open quick switcher" / "Search or jump to" command');
  assert.ok(list.some((c) => c.shortcut === '⇧⌘F'), '⇧⌘F (Go to Search) stays bound');
});

test('fr_tag_06_ac12_no_new_with_tag_key_or_command', async () => {
  const { cat, cmd } = await mods();
  assert.equal('tag.newWith' in (cat.en as Record<string, string>), false, 'the catalog has no tag.newWith key (D-762)');
  const list = cmd.commands(TAG_CTX) as any[];
  assert.ok(list.length > 0, 'commands on tag/<key>');
  assert.deepEqual(list.filter((c) => c.id === 'tag.newWith' || /^New with tag/.test(String(cat.t(c.title, c.vars ?? {})))).map((c) => c.id), [], 'no New with tag… command on tag/účty');
});
