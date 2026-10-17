// MS5 slice 5A-1 real-app tests (L6, Appium mac2 on the built test app, D-382): docs/acceptance/tasks.md FR-TSK-04
// AC-1 once (the Tasks page opens and writes nothing), FR-TSK-02 AC-11 once (a real external writer is never
// overwritten), FR-TSK-05 AC-13 (two drags write exactly two files, atomically), FR-TSK-10 AC-8 (quick-add creates
// exactly one file within 1.2 s), FR-DLY-04 AC-12 once (completing from a virtual Daily Note writes only the task),
// FR-TSK-04 AC-13 (its L6 part: views, filters and a menu), FR-SYN-06 AC-20 (a browsing tour writes nothing), FR-SYN-06 AC-21 (each action writes one file). Interface:
// docs/contracts/ms3-shell.md §1, §6 (TEGG_TEST, TEGG_APP_SUPPORT, TEGG_VAULT, TEGG_ROUTE, TEGG_PERF_LOG,
// TEGG_EXIT_AFTER; `route-ready:<route>`) and docs/contracts/ms5-tasks.md §6 (routes `tasks`, `tasks/kanban`, R40
// accessible names). Always TEGG_TEST=1 with a temporary Application Support and a temporary copy of the synthetic
// fixture tests/fixtures/vaults/tasks (+ new-empty/.tegg) (D-62). Written from the ACs and contracts only (D-61); the
// helpers are copied from ms4_daily.ac.test.ts (existing AC test files are not changed, TS-I3).
//
// The clock: L6 uses the system clock (no clock injection for the built app, ms3-shell §13.6; see AP-433 in the
// red-commit report), so every expectation here holds on any date after 2026-10-14: dates in bytes come from the
// fixture or are computed from Date.now() in the zone given to the app as `TZ`.
//
// Prerequisites as in ms3_shell.ac.test.ts: `npm run app:build`, `npm run e2e:setup`, Accessibility permission.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const APP = resolve(import.meta.dirname, '../src-tauri/target/release/bundle/macos/Tegg.app');
const EXE = join(APP, 'Contents/MacOS/tegg');
const BUNDLE_ID = 'app.tegg.desktop';
const PORT = Number(process.env.APPIUM_PORT ?? 4726);
const APPIUM_HOME = process.env.APPIUM_HOME ?? resolve(import.meta.dirname, '.appium');
const FX = join(REPO, 'tests/fixtures/vaults');
const MARK_TIMEOUT = 20_000;
const TZ = 'Europe/Prague';

const T03 = 'Tasks/Zalít květiny.md';
const T04 = 'Tasks/Koupit dárek.md';
const T01 = 'Tasks/Zavolat Janě.md';
const TASK_YML = '.tegg/types/task.yml';

// ---------------------------------------------------------------- setup helpers (no AC assertions)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tmp = (name: string) => mkdtempSync(join(tmpdir(), `tegg-ms5-5a-${name}-`));

/** A temp copy of tests/fixtures/vaults/tasks (without its README.md) plus new-empty/.tegg. */
function tasksCopy(base: string): string {
  const v = join(base, 'Úkoly');
  cpSync(join(FX, 'tasks'), v, { recursive: true, filter: (src) => relative(join(FX, 'tasks'), src) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  return v;
}
function support(base: string, tasks?: Record<string, unknown>): string {
  const s = join(base, 'support');
  mkdirSync(s, { recursive: true });
  writeFileSync(join(s, 'ui-state.json'), JSON.stringify({ version: 1, theme: 'light', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' }, ...(tasks ? { tasks } : {}) }));
  return s;
}
const fx = (rel: string) => readFileSync(join(FX, 'tasks', rel), 'utf8');

type Entry = { sha: string; mtimeMs: number; ino: number } | 'dir';
function tree(root: string): Record<string, Entry> {
  const out: Record<string, Entry> = {};
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const st = lstatSync(p);
      const rel = relative(root, p).normalize('NFC');
      if (st.isDirectory()) { out[`${rel}/`] = 'dir'; walk(p); }
      else out[rel] = { sha: createHash('sha256').update(readFileSync(p)).digest('hex'), mtimeMs: st.mtimeMs, ino: st.ino };
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}
const changedPaths = (a: Record<string, Entry>, b: Record<string, Entry>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
const inode = (t: Record<string, Entry>, p: string) => { const e = t[p]; return e && e !== 'dir' ? e.ino : null; };

function marks(file: string): string[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => (JSON.parse(l) as { mark: string }).mark);
}
async function waitMark(file: string, mark: string, ms = MARK_TIMEOUT): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (marks(file).includes(mark)) return true;
    await sleep(50);
  }
  return false;
}
async function waitFile(path: string, ok: (t: string | null) => boolean, ms: number): Promise<string | null> {
  const endAt = Date.now() + ms;
  let t: string | null = null;
  while (Date.now() < endAt) {
    t = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (ok(t)) return t;
    await sleep(20);
  }
  return t;
}

type Env = Record<string, string>;
function testEnv(appSupport: string, perfLog: string, extra: Env = {}): Env {
  return { TEGG_TEST: '1', TEGG_APP_SUPPORT: appSupport, TEGG_PERF_LOG: perfLog, TZ, ...extra };
}
function spawnApp(env: Env): ChildProcess {
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith('TEGG_')) delete clean[k];
  return spawn(EXE, [], { env: { ...clean, ...env }, stdio: 'ignore' });
}
function quitApp(child?: ChildProcess) {
  try { execFileSync('osascript', ['-e', `tell application id "${BUNDLE_ID}" to quit`], { stdio: 'ignore', timeout: 5000 }); } catch { /* not running */ }
  if (child && child.exitCode === null) child.kill('SIGTERM');
}
async function waitExit(child: ChildProcess, ms = 10_000) {
  const end = Date.now() + ms;
  while (child.exitCode === null && child.signalCode === null && Date.now() < end) await sleep(50);
}

const KEY: Record<string, number> = { a: 0, d: 2, k: 40, n: 45, v: 9, lbracket: 33, enter: 36, escape: 53, tab: 48, space: 49, down: 125, up: 126, left: 123, right: 124, f10: 109 };
const osa = (...lines: string[]) => execFileSync('osascript', lines.flatMap((l) => ['-e', l]), { encoding: 'utf8' });
function press(key: keyof typeof KEY | string, mods: ('command' | 'shift' | 'control' | 'option')[] = []) {
  osa(`tell application "System Events" to key code ${KEY[key]}${mods.length ? ` using {${mods.map((m) => `${m} down`).join(', ')}}` : ''}`);
}
function paste(text: string) {
  execFileSync('pbcopy', { input: text, env: { ...process.env, LANG: 'en_US.UTF-8' } });
  press('v', ['command']);
}
function palette(command: string) {
  press('k', ['command']);
  paste(command);
  press('enter');
}

// ---------------------------------------------------------------- Appium
let appium: ChildProcess | undefined;
async function appiumUp() {
  if (appium) return;
  appium = spawn('npx', ['appium', '--port', String(PORT), '--log-level', 'error'], { cwd: import.meta.dirname, env: { ...process.env, APPIUM_HOME }, stdio: 'ignore', detached: true });
  appium.unref();
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    if (await fetch(`http://127.0.0.1:${PORT}/status`).then((r) => r.ok, () => false)) return;
    await sleep(200);
  }
  assert.fail(`Appium did not start on port ${PORT} (run npm run e2e:setup)`);
}
function appiumDown() {
  if (appium?.pid) {
    try { process.kill(-appium.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  appium = undefined;
}
after(appiumDown);
process.on('exit', appiumDown);

type Driver = Awaited<ReturnType<typeof import('webdriverio').remote>>;
async function session(env: Env): Promise<Driver> {
  await appiumUp();
  const { remote } = await import('webdriverio');
  return remote({
    hostname: '127.0.0.1', port: PORT, logLevel: 'error',
    capabilities: {
      platformName: 'mac', 'appium:automationName': 'Mac2', 'appium:bundleId': BUNDLE_ID, 'appium:appPath': APP,
      'appium:environment': env, 'appium:newCommandTimeout': 300,
    } as any,
  });
}
async function end(d: Driver | undefined) {
  await d?.execute('macos: terminateApp', { bundleId: BUNDLE_ID }).catch(() => {});
  await d?.deleteSession().catch(() => {});
}
async function firstShown(d: Driver, label: string): Promise<any | null> {
  const l = label.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const q = `(label == "${l}" OR title == "${l}" OR value == "${l}")`;
  for (const sel of [`-ios predicate string:elementType IN {9, 10, 12, 17, 41, 42, 49, 80} AND ${q}`, `-ios predicate string:${q}`]) {
    for (const e of await d.$$(sel).catch(() => [] as any[])) {
      if (await e.isDisplayed().catch(() => false)) return e;
    }
  }
  return null;
}
async function shown(d: Driver, label: string, ms = 3000): Promise<boolean> {
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    if (await firstShown(d, label)) return true;
    await sleep(100);
  }
  return false;
}
async function need(d: Driver, label: string, ms = 3000): Promise<any> {
  const endAt = Date.now() + ms;
  let e = await firstShown(d, label);
  while (!e && Date.now() < endAt) { await sleep(100); e = await firstShown(d, label); }
  assert.ok(e, `"${label}" is shown`);
  return e;
}
/** Every displayed element with `label` (any type), in tree order. */
async function allShown(d: Driver, label: string): Promise<any[]> {
  const l = label.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const out: any[] = [];
  for (const e of await d.$$(`-ios predicate string:(label == "${l}" OR title == "${l}" OR value == "${l}")`).catch(() => [] as any[])) {
    if (await e.isDisplayed().catch(() => false)) out.push(e);
  }
  return out;
}
/** `label` inside the element labelled `parent` (e.g. a filter button in the `Filter` group, not the sidebar entry). */
async function needIn(d: Driver, parent: string, label: string, ms = 3000): Promise<any> {
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    for (const g of await allShown(d, parent)) {
      const l = label.replace(/"/g, '\\"');
      for (const e of await g.$$(`-ios predicate string:(label == "${l}" OR title == "${l}")`).catch(() => [] as any[])) {
        if (await e.isDisplayed().catch(() => false)) return e;
      }
    }
    await sleep(100);
  }
  assert.fail(`"${label}" is shown in "${parent}"`);
}
/** A Kanban column (the largest displayed element with its name; the tag filter's button of the same name is small). */
async function needColumn(d: Driver, label: string, ms = 3000): Promise<any> {
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    let best: any = null;
    let area = 0;
    for (const e of await allShown(d, label)) {
      const z = await e.getSize().catch(() => ({ width: 0, height: 0 }));
      if (z.width * z.height > area) { area = z.width * z.height; best = e; }
    }
    if (best) return best;
    await sleep(100);
  }
  assert.fail(`column "${label}" is shown`);
}
/** The element named `label` that appears after `open()` (a popup's choice, not a same-named control already shown). */
async function needNew(d: Driver, label: string, open: () => Promise<void>, ms = 3000): Promise<any> {
  const before = new Set((await allShown(d, label)).map((e) => e.elementId));
  await open();
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    const fresh = (await allShown(d, label)).find((e) => !before.has(e.elementId));
    if (fresh) return fresh;
    await sleep(100);
  }
  assert.fail(`a new "${label}" is shown`);
}

/** A pointer drag from one element to another (mac2 `macos: clickAndDrag`, real mouse events, D-479). */
async function dragTo(d: Driver, from: any, to: any) {
  await d.execute('macos: clickAndDrag', { sourceElementId: from.elementId, destinationElementId: to.elementId, duration: 1 });
  await sleep(300);
}

// ---------------------------------------------------------------- preflight (fails fast on an assertion)
let pre: Promise<string | null> | undefined;
function preflight(): Promise<string | null> {
  pre ??= (async () => {
    if (!existsSync(EXE)) return `app not built: ${EXE} (cd app && npm run app:build)`;
    const base = tmp('preflight');
    const log = join(base, 'perf.jsonl');
    const mark = 'route-ready:tasks';
    const child = spawnApp(testEnv(support(base), log, { TEGG_VAULT: tasksCopy(base), TEGG_ROUTE: 'tasks', TEGG_EXIT_AFTER: mark }));
    const ok = await waitMark(log, mark);
    quitApp(child);
    await waitExit(child);
    rmSync(base, { recursive: true, force: true });
    return ok ? null : 'the app does not open the route tasks (route-ready:tasks missing)';
  })();
  return pre;
}
async function ready() {
  const why = await preflight();
  assert.equal(why, null, why ?? '');
}

const todayIn = (tz: string, plus = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now() + plus * 86_400_000);
const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
/** The bytes with `modified` (and `created`/`id` when asked) masked, after checking their form (AP-345 rule). */
function masked(t: string | null, keys: ('id' | 'created' | 'modified')[] = ['modified']): string {
  let out = t ?? '';
  for (const k of keys) {
    const m = new RegExp(`^${k}: (.*)$`, 'm').exec(out);
    assert.ok(m, `${k} is present`);
    if (k === 'id') assert.match(m![1], /^[0-9A-HJKMNP-TV-Z]{26}$/, 'id is a ULID');
    else assert.match(m![1], ISO_OFFSET, `${k} is an ISO 8601 date-time with offset`);
    out = out.replace(m![0], `${k}: <x>`);
  }
  return out;
}

// ---------------------------------------------------------------- tests

test('fr_tsk_04_ac1_the_tasks_page_in_the_built_app', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('tsk04ac1');
  const vault = tasksCopy(base);
  const log = join(base, 'perf.jsonl');
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    d = await session(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'note/Pages/Porada.md' }));
    assert.ok(await waitMark(log, 'route-ready:note/Pages/Porada.md'), 'Porada shown');
    palette('Go to Tasks');
    assert.ok(await waitMark(log, 'route-ready:tasks', 5000), 'Go to Tasks opens tasks');
    for (const l of ['Tasks', 'Schedule', 'Kanban', 'Add a task…']) assert.ok(await shown(d, l, 3000), `"${l}" shown (R40)`);
    for (const l of ['All', 'Today', 'This week']) assert.ok(await needIn(d, 'Filter', l), `"${l}" shown in the Filter group (R40)`);
    assert.ok(await shown(d, 'Task: Zavolat Janě', 3000), 'T01 card');
  } finally {
    await end(d);
  }
  assert.deepEqual(changedPaths(before, tree(vault)), [], 'opening writes nothing (bytes, mtime, inode)');
  rmSync(base, { recursive: true, force: true });
});

test('fr_tsk_10_ac8_quick_add_in_the_built_app', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('tsk10ac8');
  const vault = tasksCopy(base);
  const log = join(base, 'perf.jsonl');
  const before = tree(vault);
  const tomorrow = todayIn(TZ, 1);
  const path = join(vault, 'Tasks/Zavolat do servisu.md');
  let d: Driver | undefined;
  let t: string | null = null;
  let took = Infinity;
  try {
    d = await session(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'tasks' }));
    assert.ok(await waitMark(log, 'route-ready:tasks'), 'tasks shown');
    await (await need(d, 'Add a task…')).click();
    paste('Zavolat do servisu tomorrow #auto !high');
    await sleep(200);
    const t0 = Date.now();
    press('enter');
    t = await waitFile(path, (x) => x !== null, 5000);
    took = Date.now() - t0;
  } finally {
    await end(d);
  }
  assert.ok(t !== null, 'Tasks/Zavolat do servisu.md created');
  assert.ok(took <= 1200, `within 1.2 s: ${took} ms`);
  assert.equal(masked(t, ['id', 'created', 'modified']),
    `---\nid: <x>\ntype: task\ntitle: Zavolat do servisu\nstatus: To do\npriority: High\ndue: ${tomorrow}\ntags: [auto]\ncreated: <x>\nmodified: <x>\n---\n`, 'the FR-TSK-10 AC-1 bytes');
  assert.deepEqual(changedPaths(before, tree(vault)), ['Tasks/Zavolat do servisu.md'], 'no other vault file changes bytes, mtime or inode');
  rmSync(base, { recursive: true, force: true });
});

test('fr_tsk_05_ac13_two_drags_write_exactly_two_files', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('tsk05ac13');
  const vault = tasksCopy(base);
  const log = join(base, 'perf.jsonl');
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    d = await session(testEnv(support(base, { view: 'kanban', groupBy: 'status', dateFilter: 'all', tags: [], doneExpanded: false }), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'tasks/kanban' }));
    assert.ok(await waitMark(log, 'route-ready:tasks/kanban'), 'tasks/kanban shown');
    await dragTo(d, await need(d, 'Task: Zalít květiny'), await need(d, 'In progress'));
    assert.ok(await waitFile(join(vault, T03), (x) => !!x?.includes('status: In progress'), 3000), 'T03 written');
    await (await need(d, 'Tag')).click();
    await sleep(500);
    await dragTo(d, await need(d, 'Task: Koupit dárek'), await needColumn(d, '#práce'));
    assert.ok(await waitFile(join(vault, T04), (x) => !!x?.includes('tags: [práce]'), 3000), 'T04 written');
    await sleep(500);
  } finally {
    await end(d);
  }
  const now = tree(vault);
  assert.deepEqual(changedPaths(before, now), [T04, T03].sort(), 'exactly those two files');
  for (const p of [T03, T04]) assert.notEqual(inode(now, p), inode(before, p), `${p}: a temporary file renamed in Tasks/ (new inode, FR-SYN-02)`);
  assert.deepEqual(readdirSync(join(vault, 'Tasks')).filter((n) => n.includes('.tegg-tmp')), [], 'no .tegg-tmp left');
  const t03 = readFileSync(join(vault, T03), 'utf8');
  assert.equal(masked(t03), masked(fx(T03).replace('status: To do', 'status: In progress')), 'T03: the AC-2 bytes except modified');
  const t04 = readFileSync(join(vault, T04), 'utf8');
  assert.equal(masked(t04), masked(fx(T04).replace('tags: [doma]', 'tags: [práce]')), 'T04: the AC-4 bytes except modified');
  rmSync(base, { recursive: true, force: true });
});

test('fr_tsk_02_ac11_a_real_external_writer_is_never_overwritten', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('tsk02ac11');
  const vault = tasksCopy(base);
  const log = join(base, 'perf.jsonl');
  const external = `${fx(T03)}Změněno jiným programem.\n`;
  let d: Driver | undefined;
  let alerted = false;
  try {
    d = await session(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'tasks' }));
    assert.ok(await waitMark(log, 'route-ready:tasks'), 'tasks shown');
    const box = await need(d, 'Complete "Zalít květiny"');
    writeFileSync(join(vault, T03), external); // another program writes the file
    await box.click();
    alerted = await shown(d, '"Zalít květiny" changed outside Tegg. Your change wasn\'t saved.', 2500);
    await sleep(1500);
  } finally {
    await end(d);
  }
  const final = readFileSync(join(vault, T03), 'utf8');
  assert.ok(final.includes('Změněno jiným programem.\n'), 'the external change is never lost (NFR-REL-02)');
  if (final === external) assert.ok(alerted, 'refused: the file keeps the external bytes and the alert is shown');
  else {
    const strip = (x: string) => x.replace(/^(modified|completed): .*\n/gm, '');
    assert.equal(strip(final), strip(external.replace('status: To do', 'status: Done')), 'or written on top of the reloaded external bytes (status and stamps only)');
  }
  rmSync(base, { recursive: true, force: true });
});

test('fr_dly_04_ac12_completing_from_a_virtual_daily_note_writes_only_the_task', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('dly04ac12');
  const vault = tasksCopy(base);
  const log = join(base, 'perf.jsonl');
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    d = await session(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'daily/2026-10-14' }));
    assert.ok(await waitMark(log, 'route-ready:daily/2026-10-14'), 'daily/2026-10-14 shown');
    assert.ok(await shown(d, 'Not saved yet. Start typing to create this note.', 3000), 'virtual');
    await (await need(d, 'Complete "Zalít květiny"')).click();
    assert.ok(await waitFile(join(vault, T03), (x) => !!x?.includes('completed:'), 3000), 'T03 written');
    await sleep(800);
    assert.ok(await shown(d, 'Not saved yet. Start typing to create this note.', 1000), 'the note stays virtual');
  } finally {
    await end(d);
  }
  assert.deepEqual(changedPaths(before, tree(vault)), [T03], 'only Tasks/Zalít květiny.md; no Daily/2026-10-14.md');
  rmSync(base, { recursive: true, force: true });
});

test('fr_tsk_04_ac13_switching_views_filters_and_menus_writes_nothing_in_the_built_app', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('tsk04ac13');
  const vault = tasksCopy(base);
  const log = join(base, 'perf.jsonl');
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    d = await session(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'tasks' }));
    assert.ok(await waitMark(log, 'route-ready:tasks'), 'tasks shown');
    await (await need(d, 'Kanban')).click();
    assert.ok(await waitMark(log, 'route-ready:tasks/kanban', 5000), 'tasks/kanban');
    await (await need(d, 'Tag')).click();
    await (await need(d, 'Status')).click();
    await (await need(d, 'Schedule')).click();
    for (const f of ['Today', 'This week', 'All']) { await (await needIn(d, 'Filter', f)).click(); await sleep(150); }
    await (await need(d, 'More actions for "Zavolat Janě"')).click();
    await sleep(200);
    press('escape');
    await sleep(500);
  } finally {
    await end(d);
  }
  assert.deepEqual(changedPaths(before, tree(vault)), [], 'no vault file changes (bytes, mtime, inode)');
  rmSync(base, { recursive: true, force: true });
});

test('fr_syn_06_ac20_a_browsing_tour_writes_nothing', { timeout: 600_000 }, async () => {
  await ready();
  const base = tmp('syn06ac20');
  const vault = tasksCopy(base);
  const log = join(base, 'perf.jsonl');
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    d = await session(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'tasks' }));
    assert.ok(await waitMark(log, 'route-ready:tasks'), 'tasks shown');
    for (const c of ['Show tasks for today', 'Show tasks for this week', 'Show all tasks', 'Show Kanban', 'Group Kanban by tag', 'Group Kanban by status', 'Show Schedule']) {
      palette(c);
      await sleep(400);
    }
    for (const tag of ['#čtení', '#doma', '#finance', '#práce', '#rodina']) { await (await need(d, tag)).click(); await sleep(150); await (await need(d, tag)).click(); }
    await (await need(d, 'Done')).click(); await sleep(200); await (await need(d, 'Done')).click();
    for (const t of ['Zavolat Janě', 'Zalít květiny', 'Koupit dárek']) {
      await (await need(d, `More actions for "${t}"`)).click();
      await sleep(200);
      press('escape');
      await (await need(d, t)).click();
      await sleep(500);
      press('lbracket', ['command']);
      assert.ok(await shown(d, 'Add a task…', 3000), `back on tasks after ${t}`);
    }
    await (await need(d, 'Porada')).click();
    await sleep(500);
    press('lbracket', ['command']);
    palette('Go to type: Tasks');
    await sleep(500);
    await (await need(d, 'Type settings')).click();
    await sleep(500);
    press('d', ['command']);
    await sleep(800);
    for (const step of [-5, 6]) { for (let i = 0; i < Math.abs(step); i++) press(step < 0 ? 'left' : 'right', ['option', 'command']); await sleep(500); }
  } finally {
    await end(d);
  }
  assert.deepEqual(changedPaths(before, tree(vault)), [], 'every vault file keeps bytes, mtime and inode; no file or folder created');
  rmSync(base, { recursive: true, force: true });
});

test('fr_syn_06_ac21_each_action_writes_one_file', { timeout: 600_000 }, async () => {
  await ready();
  const base = tmp('syn06ac21');
  const vault = tasksCopy(base);
  const log = join(base, 'perf.jsonl');
  let d: Driver | undefined;
  const results: [string, string[]][] = [];
  try {
    d = await session(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'tasks' }));
    assert.ok(await waitMark(log, 'route-ready:tasks'), 'tasks shown');
    const step = async (what: string, wait: string, act: () => Promise<void>) => {
      const b = tree(vault);
      await act();
      await waitFile(join(vault, wait), (x) => x !== null && (b[wait] === undefined || createHash('sha256').update(x).digest('hex') !== (b[wait] as any).sha), 3000);
      await sleep(600);
      results.push([what, changedPaths(b, tree(vault))]);
    };
    await step('checkbox', T03, async () => { await (await need(d!, 'Complete "Zalít květiny"')).click(); });
    palette('Show Kanban');
    await sleep(600);
    await step('status drag', T04, async () => { await dragTo(d!, await need(d!, 'Task: Koupit dárek'), await need(d!, 'In progress')); });
    palette('Group Kanban by tag');
    await sleep(600);
    await step('tag drag', 'Tasks/Přečíst knihu.md', async () => { await dragTo(d!, await need(d!, 'Task: Přečíst knihu'), await needColumn(d!, '#doma')); });
    palette('Show Schedule');
    await sleep(600);
    await step('quick-add', 'Tasks/Nový úkol.md', async () => { await (await need(d!, 'Add a task…')).click(); paste('Nový úkol'); press('enter'); });
    palette('Go to type: Tasks');
    await sleep(600);
    await (await need(d, 'Type settings')).click();
    await sleep(600);
    const edit = await firstShown(d, 'Edit Status');
    if (edit) await edit.click();
    await step('status colour', TASK_YML, async () => { await (await needNew(d!, 'Purple', async () => { await (await need(d!, 'Change color of Waiting')).click(); })).click(); });
    press('d', ['command']);
    await sleep(800);
    await step('daily checkbox', T01, async () => { await (await need(d!, 'Complete "Zavolat Janě"')).click(); });
  } finally {
    await end(d);
  }
  assert.deepEqual(results, [
    ['checkbox', [T03]], ['status drag', [T04]], ['tag drag', ['Tasks/Přečíst knihu.md']], ['quick-add', ['Tasks/Nový úkol.md']], ['status colour', [TASK_YML]], ['daily checkbox', [T01]],
  ], 'each action writes exactly one file: no second file, no Tag file, no Daily Note, no index inside the vault');
  rmSync(base, { recursive: true, force: true });
});
