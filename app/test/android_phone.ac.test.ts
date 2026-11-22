// Slice AND-2, L1 and L0 (Vitest, Node): docs/acceptance/android-phone.md
// - FR-UX-04 AC-1 (L1): `layoutFor` (contract §4.1);
// - FR-MMP-02 AC-33 (L1): the map's scale rules (§4.2, `app/ui/src/mindmap/zoom.ts`);
// - NFR-SEC-01 AC-4 (L1): `openUrlAllowed` accepts exactly http, https, mailto and tel (§4.4; the Rust twin is
//   app/src-tauri/tests/ac_android_phone.rs), and on Android `ipc.openExternal` leaves through `android_open_url` with
//   the percent-encoded URL and never invokes `open_external` (§2.2);
// - AR-03 AC-13 (L1): the phone's command list and routes against RA9 / RA11 (§7, §10): PHONE_HIDDEN_COMMANDS,
//   PHONE_FRAME_COMMANDS, PHONE_NOT_OFFERED as tables in this test; `commands(ctx)` on Android on each RA9 route holds
//   the frame commands, none of the hidden ones, and no `run` reaches an ANDROID_EXCLUDED command or a not-offered
//   route; `app/ui/test/phone-writes.ts`'s two lists are disjoint and cover `DESKTOP ∪ ANDROID_ONLY` (§2.3);
// - NFR-OTH-02 AC-24 (L0, L1): RA13's keys and texts and §11's in the catalog; `phone.moreProperties` has plural forms
//   (the Czech test catalog picks three forms for 1, 3, 5); no UI literal in `app/ui/src/phone/`;
// - AR-03 AC-14 (L0): the phone layout's modules import no `@tauri-apps/*` package directly.
// Red-test readings (reported): `commands.json` is the AND-1 file (`node scripts/commands-json.mjs`, run by the
// `app-ui-test` step before this suite); a `run` is recorded through a recording `actions` object and a mocked
// `window.__TAURI_INTERNALS__.invoke`.
// Written from the ACs and the contract only (D-61). Modules load inside the tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try { return (await import(/* @vite-ignore */ path)) as Mod; } catch { return null; }
}
const SRC = resolve(import.meta.dirname, '../ui/src');
const COMMANDS_JSON = resolve(import.meta.dirname, '../src-tauri/target/commands.json');
const g = globalThis as any;
const hadWindow = 'window' in g;
const savedWindow = g.window;
afterEach(() => { if (hadWindow) g.window = savedWindow; else delete g.window; });

// ------------------------------------------------------------------------------------------------ FR-UX-04 AC-1 (L1)

test('fr_ux_04_ac1_phone_layout_on_android', async () => {
  const m = await load('../ui/src/phone/layout.ts');
  assert.ok(m && typeof m.layoutFor === 'function', 'app/ui/src/phone/layout.ts exports layoutFor (contract §4.1)');
  for (const width of [320, 360, 412, 600, 915, 1280]) assert.equal(m!.layoutFor({ platform: 'android', width }), 'phone', `android at ${width}: phone`);
  for (const width of [800, 1440, 2560]) assert.equal(m!.layoutFor({ platform: 'macos', width }), 'desktop', `macos at ${width}: desktop`);
  assert.equal(typeof m!.currentLayout, 'function', 'currentLayout() is exported');
  assert.equal(typeof m!.isPhone, 'function', 'isPhone() is exported');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-33 (L1)

test('fr_mmp_02_ac33_mindmap_zoom_on_the_phone', async () => {
  const z = await load('../ui/src/mindmap/zoom.ts');
  assert.ok(z, 'app/ui/src/mindmap/zoom.ts loads (contract §4.2)');
  assert.deepEqual([z!.MAP_MIN, z!.MAP_MAX, z!.MAP_STEP, z!.MAP_PAD], [0.5, 2.5, 1.25, 24], 'MAP_MIN 0.5, MAP_MAX 2.5, MAP_STEP 1.25, MAP_PAD 24');
  const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`);
  near(z!.openingScale(380, 300), 1, 'openingScale: a layout that fits opens at 1');
  near(z!.openingScale(380, 380), 1, 'openingScale: exactly the width opens at 1');
  near(z!.openingScale(380, 494), 380 / 494, 'openingScale: area ÷ layout');
  near(z!.openingScale(100, 1000), 0.5, 'openingScale: at least 0.5');
  near(z!.zoomIn(1), 1.25, 'zoomIn(1)');
  near(z!.zoomIn(2.4), 2.5, 'zoomIn up to 2.5');
  near(z!.zoomIn(2.5), 2.5, 'zoomIn at 2.5 stays');
  near(z!.zoomOut(1), 0.8, 'zoomOut(1)');
  near(z!.zoomOut(0.55), 0.5, 'zoomOut down to 0.5');
  assert.equal(z!.canZoomIn(2.5), false, 'canZoomIn at 2.5');
  assert.equal(z!.canZoomIn(2.4), true, 'canZoomIn below 2.5');
  assert.equal(z!.canZoomOut(0.5), false, 'canZoomOut at 0.5');
  assert.equal(z!.canZoomOut(0.6), true, 'canZoomOut above 0.5');
  near(z!.pinchScale(1, 100, 200), 2, 'a pinch from 100 to 200 px doubles the scale');
  near(z!.pinchScale(2, 100, 200), 2.5, 'clamped to 2.5');
  near(z!.pinchScale(0.8, 200, 100), 0.5, 'clamped to 0.5');
  near(z!.blockHeight(112, 0.5), 80, 'blockHeight: layout height × scale + 24');
  near(z!.blockHeight(192, 1), 216, 'blockHeight at 1');
  const sc = z!.scrollAfterZoom({ left: 100, top: 0 }, { x: 50, y: 20 }, 1, 2);
  assert.deepEqual(sc, { left: 250, top: 20 }, 'scrollAfterZoom keeps the layout point under the centre in place');
  const back = z!.scrollAfterZoom(sc, { x: 50, y: 20 }, 2, 1);
  assert.deepEqual(back, { left: 100, top: 0 }, 'and back');
});

// ------------------------------------------------------------------------------------------------ NFR-SEC-01 AC-4 (L1)

/** The §4.4 table, shared with the Rust twin. */
const URL_TABLE: [string, boolean][] = [
  ['https://example.org/čeština', true], ['http://example.org/', true], ['HTTPS://EXAMPLE.ORG/A', true], ['  https://example.org/x  ', true],
  ['mailto:eva@example.org', true], ['MailTo:eva@example.org', true], ['tel:+420123456789', true],
  ['javascript:alert(1)', false], ['JavaScript:alert(1)', false], ['file:///etc/hosts', false], ['data:text/html,x', false], ['content://media/1', false],
  ['intent://scan/#Intent;scheme=zxing;end', false], ['ftp://example.org/', false], ['/relative/path', false], ['relative.md', false], ['', false], ['   ', false],
  ['https//missing-colon', false],
];

test('nfr_sec_01_ac4_external_links_leave_through_the_system', async () => {
  const m = await load('../ui/src/phone/links.ts');
  assert.ok(m && typeof m.openUrlAllowed === 'function', 'app/ui/src/phone/links.ts exports openUrlAllowed (contract §4.4)');
  const wrong = URL_TABLE.filter(([u, want]) => m!.openUrlAllowed(u) !== want).map(([u, want]) => `${JSON.stringify(u)} → ${!want}`);
  assert.deepEqual(wrong, [], 'openUrlAllowed accepts exactly http, https, mailto and tel (trimmed, case-insensitive)');

  // ipc.openExternal on Android: android_open_url with the percent-encoded URL; never open_external.
  const calls: { cmd: string; args: any }[] = [];
  g.window = {
    __TEGG_PLATFORM__: 'android',
    __TAURI_INTERNALS__: { invoke: async (cmd: string, args: any) => { calls.push({ cmd, args }); return null; }, transformCallback: () => 0 },
  };
  const c = await load('../ui/src/ipc/client.ts');
  assert.ok(c && c.ipc && typeof c.ipc.openExternal === 'function', 'ipc.openExternal exists');
  assert.equal(typeof c!.ipc.androidOpenUrl, 'function', 'ipc.androidOpenUrl exists (§2.2)');
  assert.equal(typeof c!.ipc.androidWindow, 'function', 'ipc.androidWindow exists (§2.2)');
  await Promise.resolve(c!.ipc.openExternal('https://example.org/čeština')).catch(() => undefined);
  await Promise.resolve(c!.ipc.openExternal('javascript:alert(1)')).catch(() => undefined);
  await Promise.resolve(c!.ipc.openExternal('file:///etc/hosts')).catch(() => undefined);
  assert.deepEqual(calls.filter((x) => x.cmd === 'open_external'), [], 'open_external is never invoked on Android');
  assert.deepEqual(calls.filter((x) => x.cmd === 'android_open_url').map((x) => x.args), [{ url: 'https://example.org/%C4%8De%C5%A1tina' }], 'only the https link leaves, through android_open_url, percent-encoded');
});

// ------------------------------------------------------------------------------------------------ AR-03 AC-13 (L1)

/** §10's PHONE_HIDDEN_COMMANDS. */
const HIDDEN_TABLE = [
  'app.palette', 'help.shortcuts', 'nav.forward', 'view.toggleSidebar', 'view.toggleRightPanel', 'view.toggleFocus', 'note.toggleProperties', 'note.width.*', 'edit.*',
  'editor.insertQuery', 'mindmap.layoutRight', 'mindmap.layoutSpider', 'preview.*', 'link.edit', 'link.remove', 'outline.*', 'panel.*', 'related.toggleLinked', 'graph.*',
  'sidebar.pin', 'sidebar.unpin', 'sidebar.pinned.moveUp', 'sidebar.pinned.moveDown', 'tags.new', 'tag.*', 'queries.new', 'query.edit', 'query.rename', 'query.trash',
  'query.saveAs', 'query.columns', 'views.new', 'views.menu', 'views.remove', 'views.edit', 'views.moveLeft', 'views.moveRight', 'board.*', 'sort.*', 'columns.*',
  'typePage.*', 'type.*', 'task.*', 'tasks.schedule', 'tasks.kanban', 'tasks.search', 'types.restoreDefaultViews', 'note.markReviewed', 'note.markUnreviewed',
  'daily.markReviewed', 'daily.markUnreviewed', 'note.changeType', 'note.editProperties', 'object.trash', 'media.add', 'trash.*', 'goto.trash', 'goto.brokenLinks',
  'goto.duplicateTitles', 'goto.settings/shortcuts', 'goto.settings/menu-bar', 'goto.settings/trash-history', 'goto.settings/previews', 'settings.backups', 'job.*',
  'capture.*', 'import.open', 'inbox.*', 'duplicates.merge', 'vault.open', 'vault.addStarterTypes', 'app.about', 'nav.newTab', 'edit.copyBlockLink', 'typeSettings.*',
  'panel.editRecurrence', 'settings.font', 'settings.fontSize', 'settings.accentColor', 'settings.changeShortcut',
];
/** §10's PHONE_FRAME_COMMANDS (`goto.type:<key>` stands for each type entry). */
const FRAME_TABLE = [
  'nav.back', 'object.new', 'phone.menu', 'phone.more', 'phone.properties', 'phone.sheet.close', 'note.toggleSource', 'goto.inbox', 'goto.search', 'goto.conflicts',
  'goto.settings', 'goto.settings/appearance', 'goto.settings/date-time', 'goto.settings/vault', 'goto.settings/storage', 'daily.today', 'daily.previous', 'daily.next',
  'daily.pickDate', 'tasks.go', 'tags.go', 'queries.go', 'goto.type:<key>', 'vault.switch', 'vault.recent.1', 'vault.recent.2', 'vault.recent.3', 'vault.recent.4',
  'vault.recent.5', 'vault.recent.6', 'vault.recent.7', 'vault.recent.8', 'vault.recent.9', 'vault.openFolder', 'vault.create', 'app.logoMenu', 'theme.system',
  'theme.light', 'theme.dark', 'mindmap.showMap', 'mindmap.showList', 'mindmap.zoomIn', 'mindmap.zoomOut', 'mindmap.fit', 'mindmap.fullScreen',
  'mindmap.closeFullScreen', 'android.openSettings',
];
/** §7's PHONE_NOT_OFFERED (route ids; CP-9 adds broken-links and duplicate-titles). */
const NOT_OFFERED_TABLE = ['new/<type>', 'home', 'graph/<path>', 'trash', 'type-settings/<type>', 'help/shortcuts', 'settings/shortcuts', 'settings/menu-bar', 'settings/trash-history', 'settings/previews', 'settings/backups', 'broken-links', 'duplicate-titles'];
/** RA2's excluded commands (android-shell.md RA2, as AND-1's android_platform test). */
const RA2 = [
  'capture_context', 'capture_create', 'capture_ready', 'capture_hide', 'capture_resize', 'capture_open_main', 'capture_draft_get', 'capture_draft_set', 'capture_saved_show', 'capture_saved_hover', 'capture_suggest', 'capture_open', 'capture_media_add',
  'hotkeys', 'hotkeys_retry', 'shell_settings', 'shell_settings_set', 'import_pick_source', 'import_scan', 'import_cancel', 'import_where', 'import_check_target', 'import_plan', 'import_start', 'import_status', 'import_discard', 'import_transform_result',
  'vault_pick_dir', 'media_pick', 'vault_reveal', 'media_reveal', 'backup_reveal', 'media_open', 'open_external', 'app_about', 'app_quit',
  'note_rename', 'tag_rename', 'tag_delete', 'merge_start', 'type_move_plan', 'type_move', 'folder_move_preview', 'tidy_now', 'value_remove_start', 'type_delete_start', 'inbox_bulk', 'starter_add', 'backup_restore', 'job_undo', 'job_redo', 'type_create', 'type_patch', 'type_delete',
  'query_apply', 'query_revert', 'query_create', 'query_duplicate', 'query_rename', 'query_trash', 'query_restore', 'task_views_restore',
  'graph_neighbourhood', 'graph_presets_get', 'graph_presets_apply', 'index_related', 'trash_restore', 'trash_delete', 'trash_empty',
];
const hidden = (id: string) => id !== 'inbox.open' && !/^board\..*(fold|collapse|expand)/i.test(id) && HIDDEN_TABLE.some((h) => (h.endsWith('*') ? id.startsWith(h.slice(0, -1)) : id === h));
const sorted = (xs: Iterable<string>) => [...xs].sort();

const VAULT = { name: 'Knihovna', path: '/storage/emulated/0/Documents/Knihovna', placeholders: 0 };
const TYPES = [
  ['page', 'Page', 'Pages', true], ['task', 'Task', 'Tasks', true], ['quick-note', 'Quick Note', 'Quick Notes', true], ['daily-note', 'Daily Note', 'Daily Notes', true],
  ['tag', 'Tag', 'Tags', true], ['image', 'Image', 'Images', true], ['pdf', 'PDF', 'PDFs', true], ['book', 'Book', 'Books', false], ['autor', 'Autor', 'Autoři', false],
].map(([key, name, plural, system]) => ({ key, name, plural, folder: plural, icon: 'file-text', color: 'gray', system, invalid: false }));
/** One context per RA9 route. */
const RA9: Record<string, unknown>[] = [
  { id: 'inbox' }, { id: 'today' }, { id: 'daily/YYYY-MM-DD', param: '2026-11-19', date: '2026-11-19', path: null }, { id: 'type/<type>', param: 'book' },
  { id: 'type/<type>', param: 'task' }, { id: 'queries' }, { id: 'query/<name>', param: 'Rozečtené' }, { id: 'tags' }, { id: 'tag/<key>', param: 'čtení', key: 'čtení' },
  { id: 'search' }, { id: 'note/<path>', param: 'Pages/Mapa výletu.md', path: 'Pages/Mapa výletu.md', type: 'page' }, { id: 'conflicts' }, { id: 'settings' },
  { id: 'settings/appearance' }, { id: 'settings/date-time' }, { id: 'settings/vault' }, { id: 'settings/storage' },
];
const ALWAYS = ['nav.back', 'object.new', 'phone.menu', 'goto.inbox', 'goto.search', 'goto.settings', 'goto.settings/appearance', 'goto.settings/date-time', 'goto.settings/vault', 'goto.settings/storage', 'daily.today', 'tasks.go', 'tags.go', 'queries.go', 'vault.switch', 'vault.openFolder', 'vault.create', 'app.logoMenu', 'theme.system', 'theme.light', 'theme.dark', 'android.openSettings', 'goto.type:book', 'goto.type:page'];

test('ar_03_ac13_phone_offers_no_excluded_action', async () => {
  // the tables (§7, §10)
  const pc = await load('../ui/src/phone/commands.ts');
  assert.ok(pc, 'app/ui/src/phone/commands.ts loads (contract §1, §10)');
  // Entries may be written as exact ids, prefixes ending in `*`, or a pattern with `<key>` / a range: two lists are equal
  // when every entry of each is matched by an entry of the other.
  const stem = (x: string) => x.replace(/\*$/, '').replace(/<[^>]*>.*$/, '').replace(/\d+(…\d+)?$/, '');
  const matches = (a: string, b: string) => a === b || ((/[*<…]|\d$/.test(a) || /[*<…]|\d$/.test(b)) && (stem(a) === stem(b) || (a.endsWith('*') && b.startsWith(stem(a))) || (b.endsWith('*') && a.startsWith(stem(b)))));
  const sameList = (got: string[], want: string[], what: string) => {
    assert.deepEqual(want.filter((w) => !got.some((x) => matches(x, w))), [], `${what}: every contract entry is listed`);
    assert.deepEqual(got.filter((x) => !want.some((w) => matches(x, w))), [], `${what}: nothing beyond the contract`);
  };
  sameList(pc!.PHONE_HIDDEN_COMMANDS ?? [], HIDDEN_TABLE, 'PHONE_HIDDEN_COMMANDS (RA11)');
  sameList(pc!.PHONE_FRAME_COMMANDS ?? [], FRAME_TABLE, 'PHONE_FRAME_COMMANDS (RA8, RA10)');
  assert.equal(typeof pc!.phoneCommands, 'function', 'phoneCommands(list) is exported');
  const pr = await load('../ui/src/phone/routes.ts');
  assert.ok(pr, 'app/ui/src/phone/routes.ts loads (contract §7)');
  assert.deepEqual(sorted((pr!.PHONE_ROUTES ?? []).map((r: { id: string }) => r.id)), ['settings', 'settings/storage'], 'PHONE_ROUTES adds settings and settings/storage');
  assert.deepEqual(sorted(pr!.PHONE_NOT_OFFERED ?? []), sorted(NOT_OFFERED_TABLE), 'PHONE_NOT_OFFERED equals RA9\'s "Not offered" and CP-9');
  for (const id of NOT_OFFERED_TABLE) assert.equal(pr!.phoneRouteOffered(id), false, `phoneRouteOffered(${id}) is false`);
  for (const r of RA9) assert.equal(pr!.phoneRouteOffered((r as { id: string }).id), true, `phoneRouteOffered(${(r as { id: string }).id}) is true`);

  // commands(ctx) on Android, per route: the frame commands, none hidden, no run reaches an excluded command or route
  const invoked: string[] = [];
  g.window = {
    __TEGG_PLATFORM__: 'android', innerWidth: 412,
    __TAURI_INTERNALS__: { invoke: async (cmd: string) => { invoked.push(cmd); return null; }, transformCallback: () => 0 },
    addEventListener: () => undefined, removeEventListener: () => undefined, matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
  };
  const cmd = await load('../ui/src/shell/commands.ts');
  assert.ok(cmd && typeof cmd.commands === 'function', 'shell/commands.ts loads');
  const failures: string[] = [];
  for (const route of RA9) {
    const gone: unknown[] = [];
    const actions = new Proxy({}, { get: (_t, name) => (...args: unknown[]) => { if (name === 'go') gone.push(args[0]); return undefined; } });
    const ctx = { vault: VAULT, types: TYPES, counts: { book: 17, page: 5 }, actions, route };
    const list = cmd!.commands(ctx) as { id: string; run: (c: unknown) => unknown }[];
    const ids = new Set(list.map((c) => c.id));
    const rid = (route as { id: string }).id;
    for (const want of ALWAYS) if (!ids.has(want)) failures.push(`${rid}: missing ${want}`);
    if (rid === 'note/<path>') for (const want of ['phone.more', 'phone.properties', 'note.toggleSource']) if (!ids.has(want)) failures.push(`${rid}: missing ${want}`);
    if (rid === 'daily/YYYY-MM-DD') for (const want of ['daily.previous', 'daily.next', 'daily.pickDate']) if (!ids.has(want)) failures.push(`${rid}: missing ${want}`);
    for (const id of ids) if (hidden(id)) failures.push(`${rid}: hidden command ${id} is listed`);
    for (const c of list) {
      const before = invoked.length;
      const went = gone.length;
      try { await Promise.race([Promise.resolve(c.run(ctx)), new Promise((r) => setTimeout(r, 50))]); } catch { /* a run may need the DOM; only what it reached counts */ }
      for (const x of invoked.slice(before)) if (RA2.includes(x)) failures.push(`${rid}: ${c.id} invokes the excluded ${x}`);
      for (const t of gone.slice(went)) {
        const id = (t as { id?: string })?.id ?? '';
        if (NOT_OFFERED_TABLE.includes(id) || id === 'graph') failures.push(`${rid}: ${c.id} goes to the not-offered ${id}`);
      }
    }
  }
  assert.deepEqual(failures, [], 'the phone\'s command list per RA9 route');

  // §2.3: WRITE_COMMANDS ∪ READ_COMMANDS = DESKTOP ∪ ANDROID_ONLY, disjoint
  const pw = await load('../ui/test/phone-writes.ts');
  assert.ok(pw, 'app/ui/test/phone-writes.ts loads');
  assert.ok(existsSync(COMMANDS_JSON), `${COMMANDS_JSON} exists (scripts/commands-json.mjs)`);
  const lists = JSON.parse(readFileSync(COMMANDS_JSON, 'utf8')) as { DESKTOP: string[]; ANDROID_ONLY: string[] };
  const W = pw!.WRITE_COMMANDS as string[];
  const R = pw!.READ_COMMANDS as string[];
  assert.deepEqual(W.filter((c) => R.includes(c)), [], 'the two lists are disjoint');
  assert.deepEqual(sorted(new Set([...W, ...R])), sorted(new Set([...lists.DESKTOP, ...lists.ANDROID_ONLY])), 'WRITE_COMMANDS ∪ READ_COMMANDS = DESKTOP ∪ ANDROID_ONLY (every command classified)');
});

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-24 (L0, L1)

/** RA13 and §11: key → English text. */
const RA13: Record<string, string> = {
  'phone.menu': 'Menu', 'phone.search': 'Search', 'phone.new': 'New', 'phone.today': 'Today', 'phone.back': 'Back', 'phone.more': 'More actions', 'phone.bottomBar': 'Main',
  'phone.drawer': 'Navigation', 'phone.settings': 'Settings', 'phone.newLater': 'Creating objects comes with editing on the phone.', 'phone.viewOnly': 'View only on the phone',
  'phone.sortLine': '{column}: {order}', 'phone.sortLineJoin': '{sort} · {viewOnly}', 'phone.properties': 'Properties', 'phone.close': 'Close',
  'phone.showSource': 'Show Markdown source', 'phone.showFormatted': 'Show formatted note', 'phone.noNote': 'No note named “{name}” in this vault yet.',
  'phone.map.zoomIn': 'Zoom in', 'phone.map.zoomOut': 'Zoom out', 'phone.map.fit': 'Fit to width', 'phone.map.fullScreen': 'Open full screen',
  'phone.map.closeFullScreen': 'Close full screen', 'phone.settings.storage': 'Storage access', 'phone.settings.storageOn': 'On', 'phone.settings.storageOff': 'Off',
  'phone.settings.switchVault': 'Switch vault…', 'phone.settings.version': 'Tegg {version} · Android', 'phone.search.noMatch': 'Nothing matches “{query}”.',
  'cmd.goto.settings': 'Go to Settings', 'cmd.goto.settings.storage': 'Go to Settings: Storage access', 'cmd.phone.menu': 'Open or close navigation',
  'cmd.phone.more': 'More actions', 'cmd.phone.properties': 'Show properties', 'cmd.phone.closeSheet': 'Close sheet', 'cmd.mindmap.zoomIn': 'Zoom in on the mindmap',
  'cmd.mindmap.zoomOut': 'Zoom out of the mindmap', 'cmd.mindmap.fit': 'Fit the mindmap to the width', 'cmd.mindmap.fullScreen': 'Open the mindmap full screen',
  'cmd.mindmap.closeFullScreen': 'Close the full-screen mindmap',
};
const ATTRS = new Set(['aria-label', 'aria-description', 'title', 'placeholder', 'alt', 'label']);
function literals(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const shown = (s: string) => /\p{L}/u.test(s);
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n) && shown(n.getText().trim())) out.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: ${n.getText().trim()}`);
    if (ts.isJsxAttribute(n) && ATTRS.has(n.name.getText()) && n.initializer) {
      const i = n.initializer;
      const lit = ts.isStringLiteral(i) ? i.text : ts.isJsxExpression(i) && i.expression && (ts.isStringLiteral(i.expression) || ts.isNoSubstitutionTemplateLiteral(i.expression)) ? i.expression.text : null;
      if (lit && shown(lit)) out.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: ${n.name.getText()}="${lit}"`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : []; });
}

test('nfr_oth_02_ac24_phone_strings', async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  assert.ok(cat, 'the catalog loads');
  const en = cat!.en as Record<string, unknown>;
  const wrong = Object.entries(RA13).filter(([k, v]) => en[k] !== v).map(([k, v]) => `${k}: ${JSON.stringify(en[k])} ≠ ${JSON.stringify(v)}`);
  assert.deepEqual(wrong, [], 'every string of RA13 and §11 is a catalog key with its English text');
  for (const k of ['purpose.phone.settings', 'purpose.phone.settingsStorage']) assert.equal(typeof en[k], 'string', `${k} is a catalog key`);
  const mp = en['phone.moreProperties'] as Record<string, string> | undefined;
  assert.deepEqual(mp, { one: '+{count} property', other: '+{count} properties' }, 'phone.moreProperties is a plural message (one, other)');
  cat!.setCatalog({ ...en, 'phone.moreProperties': { one: '+{count} vlastnost', few: '+{count} vlastnosti', other: '+{count} vlastností' } }, 'cs');
  const forms = [1, 3, 5].map((n) => cat!.t('phone.moreProperties', { count: n }));
  cat!.setCatalog(en, 'en');
  assert.deepEqual(forms, ['+1 vlastnost', '+3 vlastnosti', '+5 vlastností'], 'the Czech test catalog picks three forms for 1, 3 and 5');
  // L0: no UI literal in the phone components
  const phone = files(join(SRC, 'phone'));
  assert.ok(phone.some((f) => f.endsWith('PhoneFrame.tsx')) && phone.some((f) => f.endsWith('Drawer.tsx')), 'the phone components exist (contract §1)');
  const found = phone.flatMap((f) => literals(f.slice(SRC.length + 1), readFileSync(f, 'utf8')));
  assert.deepEqual(found, [], 'no UI string literal in app/ui/src/phone/ (NFR-OTH-02 AC-1\'s rule)');
});

// ------------------------------------------------------------------------------------------------ AR-03 AC-14 (L0)

test('ar_03_ac14_desktop_unchanged_by_the_phone_layout', () => {
  const mods = [...files(join(SRC, 'phone')), join(SRC, 'mindmap/zoom.ts'), join(SRC, 'mindmap/MapViewport.tsx')];
  const missing = ['phone/layout.ts', 'phone/native.ts', 'phone/back.ts', 'phone/PhoneFrame.tsx', 'phone/Drawer.tsx', 'phone/Sheet.tsx', 'phone/strip.ts', 'phone/sortLine.ts', 'phone/links.ts', 'phone/commands.ts', 'phone/routes.ts', 'phone/PhoneSettings.tsx', 'mindmap/zoom.ts', 'mindmap/MapViewport.tsx']
    .filter((f) => !existsSync(join(SRC, f)));
  assert.deepEqual(missing, [], 'the phone layout\'s modules exist (contract §1)');
  const direct = mods.filter((f) => existsSync(f)).flatMap((f) => {
    const src = readFileSync(f, 'utf8');
    return [...src.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](@tauri-apps\/[^'"]+)['"]/g)].map((m) => `${f.slice(SRC.length + 1)}: ${m[1]}`);
  });
  assert.deepEqual(direct, [], 'the phone layout\'s modules import no @tauri-apps/* package directly (only app/ui/src/ipc does)');
});
