// MS4 slice 4B, L1: the registry, command and catalog changes of R17 (docs/acceptance/daily-notes.md R17, R19;
// docs/contracts/ms4-daily.md §7.1; D-321, D-329, D-330, D-337). FR-DLY-01 AC-1 (route `today` built as a redirect,
// route `daily/YYYY-MM-DD` built, ⌘D `Go to Today`), FR-DLY-03 AC-1, AC-2 (`Previous day` ⌥⌘←, `Next day` ⌥⌘→ only
// on daily routes, `Go to date…`), FR-DLY-05 AC-2, AC-3 (`Mark reviewed` / `Mark unreviewed` on daily routes; `inbox`
// stays TBD MS5), and the §7.1 catalog keys. A new file: the R1–R4 tables of app/test/shell-tables.ts and the existing
// registry tests change with the 4B build (TS-I3). Written from the ACs and the contract only (D-61).
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

const T = (key: string, name: string, plural: string, folder: string) => ({ key, name, plural, folder, icon: 'file-text', color: 'gray', system: true, invalid: false });
const TYPES = [T('page', 'Page', 'Pages', 'Pages'), T('quick-note', 'Quick Note', 'Quick Notes', 'Quick Notes'), T('daily-note', 'Daily Note', 'Daily Notes', 'Daily')];
const VAULT = { name: 'Deník', path: '/tmp/Deník', placeholders: 0 };
const ctx = (route: Record<string, unknown> | null) => ({ vault: VAULT, types: TYPES, counts: { 'daily-note': 6 }, ...(route ? { route } : {}) });
const NOTE = { id: 'note/<path>', path: 'Pages/Zmínky.md' };
function dailyRouteId(reg: Mod): string | null {
  const r = (reg.ROUTES as any[]).find((x) => /^daily\//.test(String(x.id)));
  return r ? String(r.id) : null;
}
function dailyCtx(reg: Mod, date: string, written: boolean) {
  // D-352: ctx.route = { id: 'daily/YYYY-MM-DD', date, path: string | null }.
  return ctx({ id: dailyRouteId(reg) ?? 'daily/YYYY-MM-DD', date, path: written ? `Daily/${date}.md` : null });
}
const byTitle = (cat: Mod, list: any[], t: string) => list.find((c) => cat.t(c.title, c.vars ?? {}) === t);

test('fr_dly_01_ac1_routes_today_and_daily_are_built', async () => {
  const { reg } = await mods();
  const routes = reg.ROUTES as any[];
  const today = routes.find((r) => r.id === 'today');
  assert.ok(today, 'R1 route today');
  assert.equal(today.status.built, true, 'today built in 4B (R17)');
  const id = dailyRouteId(reg);
  assert.equal(id, 'daily/YYYY-MM-DD', 'R1 route daily/YYYY-MM-DD (D-321, D-352)');
  const daily = routes.find((r) => r.id === id);
  assert.equal(daily.status.built, true, 'daily/… built');
  assert.equal(daily.status.due?.milestone ?? 'MS4', 'MS4', 'MS4');
  assert.deepEqual(daily.reqs, ['FR-DLY-01…06'], 'requirements FR-DLY-01…06 (R17)');
  const ms4 = (reg.overdue('MS4') as string[]).join('\n');
  assert.ok(!/\btoday\b/.test(ms4) && !/daily\//.test(ms4), `overdue('MS4') lists neither today nor daily/…:\n${ms4}`);
});

test('fr_dly_01_ac1_go_to_today_is_cmd_d_and_runs', async () => {
  const { reg, cat, cmd } = await mods();
  for (const route of [NOTE, { id: 'search' }, null]) {
    const list = cmd.commands(ctx(route)) as any[];
    const c = byTitle(cat, list, 'Go to Today');
    assert.ok(c, `Go to Today on ${route ? route.id : 'no route'}`);
    assert.equal(c.id, 'daily.today', 'id daily.today (§7.1)');
    assert.equal(c.shortcut, '⌘D', '⌘D (R4)');
    assert.equal(c.needsVault, true);
    assert.equal(c.due ?? null, null, 'runs (not "Coming in")');
  }
  assert.equal((reg.SHORTCUTS as any[]).filter((s) => s.keys === '⌘D').length, 1, '⌘D is bound once');
});

test('fr_dly_03_ac2_previous_next_and_review_only_on_daily_routes', async () => {
  const { reg, cat, cmd } = await mods();
  const on = cmd.commands(dailyCtx(reg, '2026-10-07', true)) as any[];
  for (const [title, id, keys] of [['Previous day', 'daily.previous', '⌥⌘←'], ['Next day', 'daily.next', '⌥⌘→'], ['Mark reviewed', 'daily.markReviewed', null], ['Mark unreviewed', 'daily.markUnreviewed', null]] as const) {
    const c = byTitle(cat, on, title);
    assert.ok(c, `"${title}" on a daily route`);
    assert.equal(c.id, id, `${title}: id`);
    assert.equal(c.shortcut ?? null, keys, `${title}: shortcut`);
    assert.equal(c.needsVault, true, `${title}: needsVault`);
    assert.equal(c.due ?? null, null, `${title}: runs`);
  }
  for (const route of [NOTE, { id: 'search' }, { id: 'type/daily-note' }]) {
    const off = cmd.commands(ctx(route)) as any[];
    for (const t of ['Previous day', 'Next day', 'Mark reviewed', 'Mark unreviewed']) assert.equal(byTitle(cat, off, t), undefined, `${t} is absent on ${route.id} (D-127)`);
  }
});

test('fr_dly_03_ac1_go_to_date_opens_the_calendar', async () => {
  const { cat, cmd } = await mods();
  for (const route of [NOTE, { id: 'search' }]) {
    const c = byTitle(cat, cmd.commands(ctx(route)) as any[], 'Go to date…');
    assert.ok(c, `Go to date… on ${route.id}`);
    assert.equal(c.id, 'daily.pickDate');
    assert.equal(c.needsVault, true);
    assert.equal(c.due ?? null, null);
  }
});

test('fr_dly_03_ac2_daily_shortcuts_are_not_bound_twice', async () => {
  const { reg } = await mods();
  const keys = (reg.SHORTCUTS as any[]).map((s) => String(s.keys));
  for (const k of ['⌥⌘←', '⌥⌘→']) assert.equal(keys.filter((x) => x === k).length, 1, `${k} bound once (FR-UX-03 AC-7 with R17)`);
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert.deepEqual(dup, [], 'no shortcut conflicts');
});

// FR-DLY-05 AC-3 (no Inbox yet) is retired by 5B and replaced by inbox.md FR-DLY-05 AC-5 (D-272, D-515).

test('fr_dly_01_ac1_catalog_has_the_r19_strings', async () => {
  const { cat } = await mods();
  const want: [string, string, Record<string, unknown>?][] = [
    ['daily.notSaved', 'Not saved yet. Start typing to create this note.'],
    ['daily.titleReadonly', "A Daily Note's title is its date"],
    ['daily.reviewed', 'Reviewed'],
    ['daily.markReviewed', 'Mark reviewed'],
    ['daily.markUnreviewed', 'Mark unreviewed'],
    ['daily.previous', 'Previous day'],
    ['daily.next', 'Next day'],
    ['daily.today', 'Today'],
    ['daily.pickDate', 'Pick date'],
    ['daily.calendar', 'Calendar'],
    ['daily.hasNote', 'Has a note'],
    ['daily.previousMonth', 'Previous month'],
    ['daily.nextMonth', 'Next month'],
    ['daily.duplicateTitles', 'Duplicate titles'],
    ['daily.formatInvalid', "The daily-note format in vault.yml isn't valid; using YYYY-MM-DD."],
    ['daily.section.quickNotes', 'Quick Notes'],
    ['daily.section.tasks', 'Tasks due'],
    ['daily.section.created', 'Created'],
    ['daily.section.modified', 'Modified'],
    ['daily.section.empty', 'Nothing yet'],
    ['daily.otherNotes', '1 other note has this date:', { count: 1 }],
    ['daily.otherNotes', '2 other notes have this date:', { count: 2 }],
    ['daily.section.more', 'Show 3 more', { count: 3 }],
    ['mention.pickDate', 'Pick a date…'],
  ];
  const bad = want.filter(([k, t, v]) => !(k in cat.en) || cat.t(k, v ?? {}) !== t).map(([k, t, v]) => `${k}${v ? ' ' + JSON.stringify(v) : ''}: want ${JSON.stringify(t)}, got ${k in cat.en ? JSON.stringify(cat.t(k, v ?? {})) : 'missing'}`);
  assert.deepEqual(bad, [], 'R19 strings in the catalog (§7.1)');
  for (const k of ['daily.templateInvalid', 'mention.today', 'mention.tomorrow', 'mention.yesterday', 'error.useDailyNote', 'error.dailyMismatch']) {
    assert.ok(k in cat.en, `catalog key ${k}`);
  }
});
