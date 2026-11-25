// Slice AND-2, LA (the test APK on the emulator; contract docs/contracts/android-phone.md §2.3, §3, §12.1, §14.2):
// docs/acceptance/android-phone.md FR-SYN-06 AC-54 (a reading tour leaves the vault untouched; T1), AC-52 (no task-views
// migration on Android; T1), FR-SYN-03 AC-38 (the sync app's changes reach every page; T2), AC-36 (a partly synced
// vault; T2).
// Changes "from the sync app" are made with `adb shell`: a temporary file beside the target, then `mv`. "Untouched" is
// AND-1's `fileState` (SHA-256, size, inode, mtime, no file created); "zero writes" is the IPC log (§12.1) without a
// `WRITE_COMMANDS` entry. Every test starts with `ready()` (requireDevice): without an emulator it fails, never skips.
// Red-test readings (reported): the tour navigates with CDP clicks on the contract's `data-command`s (the gestures of
// FR-NAV-03 AC-18 and the background / cold-start steps are real); AC-52's "the Mac's result" is the expected bytes of
// tests/fixtures/queries-files/expected/views-tasks/ (`queries/schedule-default.yml`, `queries/kanban-default.yml`,
// `types/task-migrated.yml`), pushed in that order.
// Written from the ACs and the contract only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  adb, eventually, fileState, forceStop, home, install, pushVault, quote, REPO, requireDevice, resume, runAs, sh, SHARED, sleep, start, TEST_APK, TEST_ID, webview,
  writeShared, type WebView,
} from './helpers/device.ts';
import { DRAWER, FRAME, ipcWrites, launchPhone, pushPhone, swipe, title, titleIs, toDevice, cssRect } from './helpers/phone.ts';

const views: WebView[] = [];
let installed = false;
function ready() {
  requireDevice();
  if (!installed) { install(TEST_APK); installed = true; }
}
after(() => {
  for (const v of views) v.close();
  adb(['shell', `rm -rf ${SHARED}/Documents/tegg-la-*`]);
});
function syncWrite(path: string, text: string) {
  const tmp = `${path.replace(/[^/]*$/, '')}.sync-${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeShared(tmp, text);
  sh(`mv ${quote(tmp)} ${quote(path)}`);
}
const changed = (a: Record<string, unknown>, b: Record<string, unknown>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
async function drawerGo(v: WebView, cmd: string) {
  if (!(await v.waitFor(DRAWER, 100))) await v.click(`${FRAME} [data-command="phone.menu"]`);
  assert.ok(await v.waitFor(DRAWER, 3000), 'the drawer');
  await v.click(`${DRAWER} [data-command="${cmd}"]`);
  await sleep(600);
}
const privateListing = () => runAs(TEST_ID, 'cd files && find . -type f | sort', false);

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-54

test('fr_syn_06_ac54_reading_on_the_phone_writes_nothing', async () => {
  ready();
  const vault = pushPhone();
  const before = fileState(vault);
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'inbox' }, views);
  // every RA9 route through the drawer and the bottom bar
  for (const cmd of ['goto.inbox', 'daily.today', 'tasks.go', 'goto.type:book', 'tags.go', 'queries.go', 'goto.settings']) await drawerGo(v, cmd);
  await v.click(`${FRAME} [data-command="goto.search"]`);
  await v.click(`${FRAME} [data-command="daily.today"]`);
  await sleep(500);
  // every view tab, lanes to their end, Podle žánru folded and unfolded
  await drawerGo(v, 'goto.type:book');
  for (const t of ['Rozečtené', 'Přečtené 2026', 'Výborné knihy', '']) { await v.click(`main [role="tab"][data-view-tab="${t}"]`); await sleep(300); }
  await v.click('main [role="tab"][data-view-tab="Rozečtené"]');
  // The board renders just after the click (AC-Test-Change, approved by the owner).
  assert.ok(await v.waitFor('main [data-board]', 2000), 'the Rozečtené board');
  await v.eval(`(() => { const b = document.querySelector('main [data-board]'); for (const e of [b, ...b.querySelectorAll('*')]) if (e.scrollWidth > e.clientWidth + 1) e.scrollLeft = e.scrollWidth; return true; })()`);
  await drawerGo(v, 'queries.go');
  await v.click('main [data-query-row="Podle žánru"]');
  await sleep(600);
  for (let i = 0; i < 2; i++) { await v.eval(`(() => { const b = [...document.querySelectorAll('main button')].find((x) => /^(Collapse|Expand) Poezie$/.test(x.getAttribute('aria-label') || x.innerText.trim())); b.click(); return true; })()`); await sleep(300); }
  // five notes with their sheets and source views; the map; the gestures; [[Neexistuje]]
  for (const note of ['Mapa výletu', 'Široký obsah', 'Odkazy ven', 'Dlouhá poznámka', 'Mapa bez severu']) {
    await v.click(`${FRAME} [data-command="goto.search"]`);
    await v.eval(`(() => { const i = document.querySelector('header[role="banner"] [role="search"] input'); i.focus(); i.select(); return true; })()`);
    await v.type(note);
    await sleep(700);
    await v.key('Enter');
    await titleIs(v, note);
    for (const cmd of ['phone.more', 'phone.properties', 'phone.sheet.close', 'phone.more', 'note.toggleSource', 'phone.more', 'note.toggleSource']) {
      // A menu item is clicked inside the open menu: the Properties strip carries `phone.properties` too
      // (AC-Test-Change, approved by the owner).
      const inMenu = cmd === 'phone.properties' || cmd === 'note.toggleSource';
      await v.click(inMenu ? `[role="menu"] [data-command="${cmd}"]` : `[data-command="${cmd}"]`).catch(() => undefined);
      await sleep(250);
    }
    if (note === 'Mapa výletu') {
      for (const cmd of ['mindmap.zoomIn', 'mindmap.zoomOut', 'mindmap.fullScreen', 'mindmap.closeFullScreen', 'mindmap.showList', 'mindmap.showMap']) { await v.click(`[data-command="${cmd}"]`).catch(() => undefined); await sleep(250); }
      // Slice AND-3 (android-edit.md contract §20): a checkbox tap writes now, so the reading tour no longer makes it
      // (AC-Test-Change, approved by the owner with the contract, D-2541).
    }
    if (note === 'Odkazy ven') {
      await v.eval(`[...document.querySelectorAll('main article a, main [data-wikilink]')].find((a) => a.innerText.trim() === 'Neexistuje')?.click(), true`);
      // Slice AND-3 (contract §10.4, §20): the Create offer sheet opens; Back closes it without a write (AC-Test-Change, D-2541).
      await sleep(400);
      sh('input keyevent KEYCODE_BACK');
    }
    if (note === 'Dlouhá poznámka') {
      const p = await cssRect(v, 'main p');
      const a = await toDevice(v, 4, p!.top + 10);
      swipe(a.x, a.y, a.x + 500, a.y, 300);
      swipe(a.x + 500, a.y, a.x, a.y, 300);
    }
  }
  // Slice AND-3 (contract §20): New opens the type sheet now and isn't part of the reading tour (AC-Test-Change, D-2541).
  // three searches; Today and the days around it
  for (const q of ['mapa', 'kniha', 'cesta']) {
    await v.click(`${FRAME} [data-command="goto.search"]`);
    await v.eval(`(() => { const i = document.querySelector('header[role="banner"] [role="search"] input'); i.focus(); i.select(); return true; })()`);
    await v.type(q);
    await sleep(500);
  }
  await v.click(`${FRAME} [data-command="daily.today"]`);
  for (const cmd of ['daily.previous', 'daily.next', 'daily.pickDate']) { await v.click(`main [data-command="${cmd}"]`).catch(() => undefined); await sleep(300); }
  await v.key('Escape');
  // Settings: the theme and the date format
  await drawerGo(v, 'goto.settings');
  await v.click('main [data-command="goto.settings/appearance"]');
  await v.click('[data-command="theme.dark"]').catch(() => undefined);
  // the app to the background and back, then a cold start
  home();
  await sleep(1500);
  resume(TEST_ID);
  await sleep(1500);
  forceStop(TEST_ID);
  start(TEST_ID);
  const w = await webview(TEST_ID); views.push(w);
  assert.ok(await w.waitFor(FRAME, 30_000), 'the cold start opens the vault');
  await sleep(2000);
  assert.deepEqual(ipcWrites(), [], 'no WRITE_COMMANDS entry in the IPC log during the tour (§2.3)');
  assert.deepEqual(changed(before, fileState(vault)), [], 'the vault is untouched throughout (SHA-256, size, inode, mtime; nothing created)');
  assert.ok(privateListing().length > 0, 'only the private files dir changes');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-55

test('fr_syn_06_ac55_no_task_views_migration_on_android', async () => {
  ready();
  const vault = pushVault(['tests/fixtures/vaults/tasks', 'tests/fixtures/vaults/new-empty/.tegg'], 'Úkoly');
  sh(`rm -f ${quote(`${vault}/README.md`)}`, false);
  const before = fileState(vault);
  const { v } = await launchPhone(vault, { TEGG_TEST_TASK_VIEWS: '1', TEGG_ROUTE: 'type/task' }, views);
  await titleIs(v, 'Tasks', 10_000);
  await sleep(3000);
  assert.equal(sh(`ls ${quote(`${vault}/.tegg/queries`)} 2>/dev/null`, false).trim(), '', 'no Schedule.yml or Kanban.yml');
  assert.deepEqual(changed(before, fileState(vault)), [], 'nothing is written; task.yml untouched');
  const tabs = () => v.eval<string[]>(`[...document.querySelectorAll('main [role="tablist"][aria-label="Views"] [role="tab"]')].map((t) => t.innerText.trim())`);
  assert.deepEqual(await tabs(), ['All Tasks'], 'type/task shows only All Tasks');
  // the Mac's result arrives: the two query files, then task.yml with views
  const exp = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/queries-files/expected/views-tasks', rel), 'utf8');
  sh(`mkdir -p ${quote(`${vault}/.tegg/queries`)}`);
  syncWrite(`${vault}/.tegg/queries/Schedule.yml`, exp('queries/schedule-default.yml'));
  syncWrite(`${vault}/.tegg/queries/Kanban.yml`, exp('queries/kanban-default.yml'));
  syncWrite(`${vault}/.tegg/types/task.yml`, exp('types/task-migrated.yml'));
  const got = await eventually(tabs, (t) => t.includes('Schedule') && t.includes('Kanban'), 2000, 100);
  assert.deepEqual(got, ['All Tasks', 'Schedule', 'Kanban'], 'the chips Schedule and Kanban appear within 2 s');
  assert.deepEqual(ipcWrites(), [], 'no write by Tegg');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-38

test('fr_syn_03_ac38_external_changes_on_the_phone', async () => {
  ready();
  const vault = pushPhone();
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'note/Pages/Dlouhá poznámka.md' }, views);
  await titleIs(v, 'Dlouhá poznámka');
  await v.eval(`(() => { const m = [...document.querySelectorAll('main')].find((e) => e.getClientRects().length > 0); const h = [...m.querySelectorAll('h1, h2, h3, h4, h5, h6')].find((x) => x.innerText.trim() === 'Druhá kapitola'); m.scrollTop += h.getBoundingClientRect().top - m.getBoundingClientRect().top; return true; })()`);
  const first = () => v.eval<string>(`(() => { const m = [...document.querySelectorAll('main')].find((e) => e.getClientRects().length > 0); const t = m.getBoundingClientRect().top; const b = [...m.querySelectorAll('p, h1, h2, h3, h4, h5, h6')].find((x) => x.getBoundingClientRect().bottom > t + 2); return b ? b.innerText.trim().slice(0, 30) : ''; })()`);
  const p = `${vault}/Pages/Dlouhá poznámka.md`;
  syncWrite(p, `${sh(`cat ${quote(p)}`)}\nPřipsáno na Macu: žluťoučký kůň.\n`);
  const shown = await eventually(() => v.eval<boolean>(`document.querySelector('main').innerText.includes('Připsáno na Macu')`), (x) => x, 2000, 100);
  assert.equal(shown, true, 'an appended paragraph shows in the read view within 2 s');
  assert.match(await first(), /^(Druhá kapitola|Další odstavec 1:|Odstavec 40:)/, 'the first visible block is unchanged (± one line)');
  // a new unreviewed Quick Note: an Inbox row and the drawer count
  await v.click(`${FRAME} [data-command="phone.menu"]`);
  const count = () => v.eval<number>(`Number((document.querySelector('${DRAWER} [data-command="goto.inbox"]')?.innerText ?? '').replace(/\\D/g, '') || 0)`);
  const c0 = await count();
  syncWrite(`${vault}/Quick Notes/Z Macu.md`, '---\nid: 01JBAN2000000000000000N401\ntype: quick-note\ntitle: Z Macu\nreview: unreviewed\ncaptured: 2026-11-19T09:55:00+01:00\ncreated: 2026-11-19T09:55:00+01:00\n---\nNapsáno na Macu.\n');
  assert.equal(await eventually(count, (c) => c === c0 + 1, 2000, 100), c0 + 1, 'the drawer count rises within 2 s');
  await v.click(`${DRAWER} [data-command="goto.inbox"]`);
  assert.ok(await eventually(() => v.eval<boolean>(`document.querySelector('main').innerText.includes('Z Macu')`), (x) => x, 2000, 100), 'its Inbox row');
  // the open note deleted
  await v.click(`main li a`);
  await sleep(800);
  const open = await title(v);
  sh(`rm ${quote(`${vault}/Quick Notes/${open}.md`)}`, false);
  assert.ok(await eventually(() => v.eval<boolean>(`document.body.innerText.includes('This note was moved or deleted')`), (x) => x, 2000, 100), 'the open note deleted shows "This note was moved or deleted"');
  assert.deepEqual(ipcWrites(), [], 'Tegg writes nothing');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-39

test('fr_syn_03_ac39_partly_synced_vault_on_the_phone', async () => {
  ready();
  const vault = pushPhone();
  const book = `${vault}/.tegg/types/book.yml`;
  sh(`sed -i 's/^views: \\[Rozečtené, Přečtené 2026, Výborné knihy\\]$/views: [Rozečtené, Přečtené 2026, Výborné knihy, Chybí]/' ${quote(book)}`);
  sh(`printf '  - id: 01JBAN2000000000000000N301\\n    path: Pages/Později.md\\n' >> ${quote(`${vault}/.tegg/pinned.yml`)}`);
  const before = fileState(vault);
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'note/Pages/Odkazy ven.md' }, views);
  await titleIs(v, 'Odkazy ven');
  const style = (name: string) => v.eval<string>(`(() => { const a = [...document.querySelectorAll('main article a')].find((x) => x.innerText.trim() === ${JSON.stringify(name)}); if (!a) return ''; const s = getComputedStyle(a); return s.color + '|' + s.textDecorationLine + '|' + (a.getAttribute('data-link-kind') ?? ''); })()`);
  const broken = await style('Neexistuje');
  assert.equal(await style('Později'), broken, '[[Později]] shows the broken-link style');
  await v.eval(`[...document.querySelectorAll('main article a')].find((a) => a.innerText.trim() === 'Později').click(), true`);
  assert.ok(await eventually(() => v.eval<boolean>(`document.body.innerText.includes('No note named “Později” in this vault yet.')`), (x) => x, 1000, 100), 'a tap shows AC-11\'s notice');
  const pozdeji = '---\nid: 01JBAN2000000000000000N301\ntype: page\ntitle: Později\n---\nDorazilo později.\n';
  syncWrite(`${vault}/Pages/Později.md`, pozdeji);
  assert.notEqual(await eventually(() => style('Později'), (s) => s !== broken, 2000, 100), broken, 'the link resolves within 2 s');
  await v.eval(`[...document.querySelectorAll('main article a')].find((a) => a.innerText.trim() === 'Později').click(), true`);
  assert.equal(await titleIs(v, 'Později'), 'Později', 'and opens it');
  // the pin that hadn't arrived now resolves
  await v.click(`${FRAME} [data-command="phone.menu"]`);
  assert.notEqual(await eventually(() => v.eval<string>(`document.querySelector('${DRAWER} .sidebar-pinned [data-pinned-row="2"]')?.getAttribute('data-pin-state') ?? ''`), (s) => s !== '' && s !== 'missing', 2000, 100), 'missing', 'the pin resolves when its target arrives');
  // a view whose query file isn't there yet
  await v.click(`${DRAWER} [data-command="goto.type:book"]`);
  await sleep(800);
  await v.click('main [role="tab"][data-view-tab="Chybí"]');
  await sleep(500);
  assert.equal(await v.eval<number>(`[...document.querySelectorAll('main button')].filter((b) => b.innerText.trim() === 'Remove from Books page').length`), 0, 'the not-found state without Remove from Books page');
  syncWrite(`${vault}/.tegg/queries/Chybí.yml`, '# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › Chybí.\nversion: 1\ntitle: Chybí\ntypes: [book]\nmatch: all\nfilters: []\nsort: { by: title, order: asc }\nlimit: 50\nview: list\ncreated: 2026-11-19T09:00:00+01:00\nmodified: 2026-11-19T09:00:00+01:00\n');
  assert.equal(await eventually(() => v.eval<number>(`document.querySelectorAll('main [role="tabpanel"] [data-query-result]').length`), (n) => n === 17, 2000, 100), 17, 'its results within 2 s of the file\'s arrival');
  const now = fileState(vault);
  assert.deepEqual(changed(before, now), ['.tegg/queries/Chybí.yml', 'Pages/Později.md'].map((x) => x.normalize('NFC')).sort(), 'no file created or rewritten by Tegg to "fix" anything');
  assert.deepEqual(ipcWrites(), [], 'zero writes');
});
