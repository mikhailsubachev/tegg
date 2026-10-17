// MS4 slice 4A, L1: the registry and command changes of R16 (docs/acceptance/backlinks.md; docs/contracts/ms4-links.md
// §5.4; D-283, D-284, D-292). FR-LNK-01 AC-1 (R2: `backlinks` built, requirements FR-LNK-01, FR-LNK-02), AC-14 (the
// palette command `Show backlinks`), FR-LNK-04 AC-10 (route `broken-links`, `Go to Broken links`), FR-LNK-14 AC-8, AC-9
// (route `duplicate-titles`, `Go to Duplicate titles`, `Merge…` disabled `MS4 (4C)`), R3 additions (`Type picker`,
// `Unlinked mentions`), R5 `embed-note` shows `MS4 (4F)`. A new file: the R1–R5 tables of app/test/shell-tables.ts and
// the existing registry tests change with the 4A build (TS-I3). Written from the ACs and the contract only (D-61).
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
  assert.ok(reg && cat && cmd, 'shell registry, catalog and commands modules load');
  return { reg: reg!, cat: cat!, cmd: cmd! };
}
beforeEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const T = (key: string, name: string, plural: string, system: boolean) => ({ key, name, plural, folder: plural, icon: 'file-text', color: 'gray', system, invalid: false });
const TYPES = [T('page', 'Page', 'Pages', true), T('quick-note', 'Quick Note', 'Quick Notes', true), T('schůzka', 'Schůzka', 'Schůzky', false)];
const VAULT = { name: 'Odkazy', path: '/tmp/Odkazy', placeholders: 0 };
const ctx = (route: Record<string, unknown> | null) => ({ vault: VAULT, types: TYPES, counts: { page: 5 }, ...(route ? { route } : {}) });
const NOTE = { id: 'note/<path>', path: 'Pages/Cíl.md' };
const text = (cat: Mod, key: string) => (key in cat.en ? cat.t(key) : key);

test('fr_lnk_01_ac1_backlinks_tab_is_built_with_its_requirements', async () => {
  const { reg, cat } = await mods();
  const tab = (reg.PANEL_TABS as any[]).find((t) => t.id === 'backlinks');
  assert.ok(tab, 'R2 backlinks tab');
  assert.equal(text(cat, tab.name), 'Backlinks', 'the tab keeps its name (AP-207)');
  assert.equal(tab.status.built, true, 'built in 4A');
  assert.deepEqual(tab.reqs, ['FR-LNK-01', 'FR-LNK-02'], 'FR-LNK-03 is 4C, FR-LNK-04 is not in the panel (AP-221)');
});

test('fr_lnk_04_ac10_route_broken_links_and_fr_lnk_14_ac8_route_duplicate_titles', async () => {
  const { reg, cat } = await mods();
  const routes = reg.ROUTES as any[];
  for (const [id, page, req] of [['broken-links', 'Broken links', 'FR-LNK-04'], ['duplicate-titles', 'Duplicate titles', 'FR-LNK-14']] as const) {
    const r = routes.find((x) => x.id === id);
    assert.ok(r, `R1 route ${id}`);
    assert.equal(text(cat, r.name), page, `${id}: page name`);
    assert.equal(r.status.built, true, `${id}: built`);
    assert.equal(r.status.due?.milestone ?? 'MS4', 'MS4', `${id}: MS4`);
    assert.deepEqual(r.reqs, [req], `${id}: requirement`);
    assert.equal(r.design, null, `${id}: no design board`);
  }
});

test('fr_lnk_14_ac9_r3_controls_added_by_4a', async () => {
  const { reg, cat } = await mods();
  const controls = (reg.DISABLED_CONTROLS as any[]).map((c) => ({ label: text(cat, c.label), due: reg.showDue(c.due) as string, req: c.req }));
  const find = (label: string) => controls.find((c) => c.label === label);
  assert.deepEqual(find('Merge…'), { label: 'Merge…', due: 'MS4 (4C)', req: 'FR-LNK-14' }, 'Merge… on the Duplicate titles page (AP-218, AP-220)');
  assert.deepEqual(find('Unlinked mentions'), { label: 'Unlinked mentions', due: 'v1.x', req: 'FR-LNK-05' }, 'Unlinked mentions in the panel (AP-211)');
  assert.deepEqual(find('Type picker'), { label: 'Type picker', due: 'MS5', req: 'FR-VLT-05' }, 'Type picker in the Create note popover');
});

test('fr_lnk_14_ac9_ms4_slices_show_and_count_as_ms4', async () => {
  const { reg } = await mods();
  assert.equal(reg.showDue({ milestone: 'MS4', slice: '4C' }), 'MS4 (4C)', 'D-292');
  assert.equal(reg.showDue({ milestone: 'MS4', slice: '4F' }), 'MS4 (4F)');
  const ms4 = (reg.overdue('MS4') as string[]).join('\n');
  assert.ok(ms4.includes('Merge…') || ms4.includes('duplicates.merge'), `overdue('MS4') lists Merge… (MS4 (4C) counts as MS4):\n${ms4}`);
  const ms3 = (reg.overdue('MS3') as string[]).join('\n');
  assert.ok(!ms3.includes('Merge…') && !ms3.includes('duplicates.merge'), `overdue('MS3') doesn't list Merge…:\n${ms3}`);
  // 4F built the note embed: R5 has no embed-note row any more (R32, D-431).
  assert.equal((reg.IN_NOTE_PLACEHOLDERS as any[]).find((p) => p.id === 'embed-note'), undefined, 'R5 embed-note is gone (4F)');
});

test('fr_lnk_01_ac14_palette_commands_of_r16', async () => {
  const { cat, cmd } = await mods();
  const note = cmd.commands(ctx(NOTE)) as any[];
  const byTitle = (list: any[], t: string) => list.find((c) => cat.t(c.title, c.vars ?? {}) === t);
  for (const [title, id] of [['Show backlinks', 'panel.backlinks'], ['Go to Broken links', 'goto.brokenLinks'], ['Go to Duplicate titles', 'goto.duplicateTitles']]) {
    const c = byTitle(note, title);
    assert.ok(c, `command "${title}"`);
    assert.equal(c.id, id, `${title}: id`);
    assert.equal(c.needsVault, true, `${title}: needsVault`);
    assert.equal(c.shortcut ?? null, null, `${title}: no shortcut (D-281)`);
    assert.equal(c.due ?? null, null, `${title}: runs (not "Coming in")`);
  }
  const elsewhere = cmd.commands(ctx({ id: 'search' })) as any[];
  assert.ok(byTitle(elsewhere, 'Go to Broken links') && byTitle(elsewhere, 'Go to Duplicate titles'), 'the Go to commands everywhere with a vault');
});
