// Slice PIN, L1: the registry parts of docs/acceptance/pinned.md FR-HOM-02 AC-7 (where `sidebar.pin` / `sidebar.unpin` are
// listed, R136), FR-UX-03 AC-39 (the commands and ⌥⌘↑ / ⌥⌘↓ in the registry, no clash) and FR-NAV-04 AC-10 (no `pinned`
// route, no `Go to Pinned`). Interface docs/contracts/v1-pinned.md §3.4 (`ShellActions.pinStatus`, `pinCurrent`,
// `unpinCurrent`, `movePinned`; `SHORTCUTS`). Written from the ACs and the contract only (D-61). Modules load inside the
// tests (TS-I1).
//
// Red-test point AP-1252: §3.4 lists ⌥⌘↑/↓ "while the focus (or the palette's opener) is a pinned row" but doesn't say how
// `commands(ctx)` learns it; the test checks the SHORTCUTS rows, the commands' absence without a focused row, and leaves
// the listing with a focused row to the L5 test.
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { R4_PIN, RESERVED, shortcutClashes } from './shell-tables';

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

const VAULT = { name: 'Pinned', path: '/tmp/Pinned', placeholders: 0 };
const NOTE = { id: 'note/<path>', param: 'Projekty/Rozpočet 2027.md', path: 'Projekty/Rozpočet 2027.md', type: 'projekt' };
const DAILY = { id: 'daily/YYYY-MM-DD', param: '2026-10-07', date: '2026-10-07', path: 'Daily/2026-10-07.md' };
const VIRTUAL = { id: 'daily/YYYY-MM-DD', param: '2026-11-07', date: '2026-11-07', path: null };
const TAG = { id: 'tag/<key>', param: 'účty' };
const TYPE = { id: 'type/<type>', param: 'schůzka' };
const NEW = { id: 'new/<type>', param: 'page', type: 'page', path: null };
type Status = { pinned: boolean; disabled: string | null } | null;
function ctxOf(route: Record<string, unknown>, status: Status, calls: string[] = []) {
  return {
    vault: VAULT, types: [], counts: { page: 10 }, route,
    actions: { pinStatus: () => status, pinCurrent: () => calls.push('pin'), unpinCurrent: () => calls.push('unpin'), movePinned: (d: number) => calls.push(`move ${d}`) },
  };
}

test('fr_hom_02_ac7_pin_and_unpin_from_the_palette', async () => {
  const { cat, cmd } = await mods();
  const list = (route: Record<string, unknown>, s: Status, calls?: string[]) => cmd.commands(ctxOf(route, s, calls)) as any[];
  const find = (l: any[], id: string) => l.find((c) => c.id === id);
  for (const [what, route] of [['note', NOTE], ['daily', DAILY], ['tag', TAG], ['type', TYPE]] as const) {
    const off = list(route, { pinned: false, disabled: null });
    const pin = find(off, 'sidebar.pin');
    assert.ok(pin, `${what}: sidebar.pin listed while not pinned`);
    assert.deepEqual([cat.t(pin.title), pin.section, pin.shortcut ?? null], ['Pin to sidebar', 'edit', null], `${what}: \`Pin to sidebar\`, edit`);
    assert.equal(find(off, 'sidebar.unpin'), undefined, `${what}: not sidebar.unpin`);
    const on = list(route, { pinned: true, disabled: null });
    const unpin = find(on, 'sidebar.unpin');
    assert.ok(unpin && !find(on, 'sidebar.pin'), `${what}: only sidebar.unpin while pinned`);
    assert.equal(cat.t(unpin.title), 'Unpin from sidebar', `${what}: \`Unpin from sidebar\``);
  }
  const calls: string[] = [];
  await find(list(NOTE, { pinned: false, disabled: null }, calls), 'sidebar.pin').run(ctxOf(NOTE, { pinned: false, disabled: null }, calls));
  await find(list(NOTE, { pinned: true, disabled: null }, calls), 'sidebar.unpin').run(ctxOf(NOTE, { pinned: true, disabled: null }, calls));
  assert.deepEqual(calls, ['pin', 'unpin'], 'running them calls pinCurrent / unpinCurrent');
  for (const [what, route] of [['new', NEW], ['virtual daily', VIRTUAL]] as const) {
    const l = list(route, { pinned: false, disabled: 'Available once the object is saved.' });
    const pin = find(l, 'sidebar.pin');
    assert.ok(pin, `${what}: sidebar.pin listed`);
    assert.equal(pin.disabled?.() ?? null, 'Available once the object is saved.', `${what}: aria-disabled with the reason`);
  }
  for (const id of ['inbox', 'tasks', 'search', 'tags', 'trash', 'graph/<path>', 'settings/appearance']) {
    const l = list({ id, param: id === 'graph/<path>' ? 'Pages/Plán.md' : undefined }, null);
    assert.ok(!find(l, 'sidebar.pin') && !find(l, 'sidebar.unpin'), `${id}: neither command listed`);
  }
});

test('fr_ux_03_ac39_pin_commands_and_shortcuts', async () => {
  const { reg, cat, cmd } = await mods();
  const shortcuts = reg.SHORTCUTS as { keys: string; command: string }[];
  for (const row of R4_PIN) {
    const s = shortcuts.find((x) => x.keys === row.keys);
    assert.ok(s, `${row.keys} in SHORTCUTS`);
    assert.equal(s!.command, row.keys === '⌥⌘↑' ? 'sidebar.pinned.moveUp' : 'sidebar.pinned.moveDown', `${row.keys} → its command`);
    assert.equal(cat.t(row.keys === '⌥⌘↑' ? 'pinned.moveUp' : 'pinned.moveDown'), row.command, `${row.keys}: \`${row.command}\``);
  }
  const l = cmd.commands(ctxOf(NOTE, { pinned: true, disabled: null })) as any[];
  assert.ok(!l.some((c) => String(c.id).startsWith('sidebar.pinned.move')), 'not listed without a focused pinned row');
  assert.deepEqual(shortcutClashes(l), [], 'no clash with R4 (⇧⌘↑/↓ blocks, ⌥⌘←/→ days)');
  for (const c of l) assert.ok(!RESERVED.includes(c.shortcut), `${c.id} uses a reserved shortcut`);
  for (const k of ['⌥⌘↑', '⌥⌘↓']) assert.ok(!RESERVED.includes(k), `${k} isn't macOS-reserved`);
  const daily = cmd.commands(ctxOf(DAILY, { pinned: false, disabled: null })) as any[];
  const owners = daily.filter((c) => c.shortcut === '⌥⌘↑' || c.shortcut === '⌥⌘↓').map((c) => c.id);
  assert.deepEqual(owners, [], 'no other command owns ⌥⌘↑ / ⌥⌘↓');
});

test('fr_nav_04_ac10_pinned_route_removed', async () => {
  const { reg, cat, cmd } = await mods();
  assert.equal((reg.ROUTES as any[]).find((r) => r.id === 'pinned'), undefined, 'no `pinned` route');
  const titles = (cmd.commands({ vault: VAULT, types: [], counts: {} }) as any[]).map((c) => cat.t(c.title, c.vars ?? {}));
  assert.ok(!titles.includes('Go to Pinned'), 'no `Go to Pinned`');
  assert.ok(titles.includes('Go to Saved queries'), '`Saved queries` stays (TBD v1.0)');
  for (const k of ['route.pinned', 'purpose.pinned', 'cmd.goto.pinned']) assert.ok(!(k in cat.en), `catalog key ${k} removed (§3.3)`);
  const parse = reg.parseRoute ?? reg.routeOf;
  if (typeof parse === 'function') assert.deepEqual(parse('pinned'), parse('no-such-route'), '`pinned` parses like an unknown route');
});
