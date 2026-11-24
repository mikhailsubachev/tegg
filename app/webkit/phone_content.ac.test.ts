// Slice AND-2, L5p (projects `phone-webkit`, `phone-chromium`): docs/acceptance/android-phone.md
// - FR-UX-03 AC-57 (controls inside a note's content on the phone; D-2474, QA review of AND-2).
// Contract docs/contracts/android-phone.md §10 ("Controls inside a note's content": `read.fold:<n>`,
// `read.openEmbed:<n>`, `board.openCard:<path>`, `board.openSource:<path>` (D-2475); the edit-only embed controls are not rendered), §9.4 (the map's
// `Map` / `List` buttons), §9.5 (type pages), §12.2 (`__TEGG_TEST__.run(id)`, `commands()`), §14.1.
// Fixtures: `tasks/` + `new-empty/.tegg/` + `views-tasks/` + the overlay `phone-content/` (its README) at the tasks
// clock (2026-10-14T12:00:00+02:00); `views/` + `new-empty/.tegg/` + `phone/` for Mapa výletu (phone-helpers'
// `phoneVault`).
// Red-test readings (reported):
// - "the tap's effect": as FR-UX-03 AC-56's test, a fresh page tapped (the first control carrying the id) and a fresh
//   page run by id end with the same route, open dialogs and menus and IPC commands (perf marks aside), plus the
//   in-page state the AC names (aria-expanded and `Skrytý text tipu.`, the map, the route, the pressed `Map` / `List`
//   of every map on the page), and that state is the one the AC names;
// - "every control of the note embed that opens it": every visible button or link inside the embed's frame
//   (`[data-embed-target]`, the frame itself when it is a link) except the task checkbox;
// - the task embed's status is "text": `In progress` is visible in the frame and not inside a button, link or input;
//   its checkbox is `aria-disabled="true"` (the AC names no description, so none is asserted);
// - AC-54's second part is applied with AC-54's test's filter, plus D-2475: a view-only task checkbox
//   (`aria-disabled`) is exempt and carries no `data-command` of its own; "RA11's hidden list" is §10's
//   PHONE_HIDDEN_COMMANDS with `board.openCard:` and `board.openSource:` excepted inside `board.*` (D-2474, D-2475);
// - a board task card (D-2475): in every visible `article[data-board-card]` of the Schedule and Kanban tabs the card
//   itself carries `board.openCard:<data-board-card>` (NFC), the element holding the title resolves to that command,
//   the source chip (the control named after the source note; in the fixture only Zavolat Janě's `Porada`) carries
//   `board.openSource:<data-board-card>` (the card's task path, as `board.openCard:`), every other visible control of
//   the card except the checkbox carries `board.openCard:<path>`, and the checkbox carries no `data-command`;
// - `board.openSource:Tasks/Zavolat Janě.md` on the Kanban tab opens its source `note/Pages/Porada.md` (D-2475).
// Written from the AC and the contract only (D-61).
import { test, type Browser, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  PH, appBar, assertZeroWrites, controls, eventually, fileStateOf, flat, loadVault, main, mainName, must, nfc, phonePage, seen, sleep, startPhone,
  type FileState, type PhoneHandle, type PhoneOptions,
} from './phone-helpers';

test.use({ timezoneId: 'Europe/Prague' });

/** The tasks clock (views-tasks README, tasks.md). */
const TASKS_NOW = '2026-10-14T12:00:00+02:00';
const VLOZENE = 'Pages/Vložené.md';
const STRANKA = 'Pages/Vložená stránka.md';
const KOLO = 'Tasks/Opravit kolo.md';
/** The vault of AC-55: tasks/, new-empty/.tegg/, views-tasks/, phone-content/ (READMEs aside). */
const contentVault = () => loadVault('Úkoly', ['tasks', 'new-empty/.tegg', 'views-tasks', 'phone-content']);
const contentStart = (route: string): PhoneOptions => ({ vault: contentVault(), route, now: TASKS_NOW });

/** §10's PHONE_HIDDEN_COMMANDS (as in phone_quality.ac.test.ts); `*` ends a prefix. */
const HIDDEN = [
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
/** `board.*` except folds (§10): a fold is the command of a board's `Collapse <lane>` / `Expand <lane>` button (§9.5,
 *  R206), or an id that names a fold; `board.openCard:` and `board.openSource:` are the exceptions of D-2474, D-2475. */
const isFold = (id: string, folds: Set<string>) => folds.has(id) || /^board\..*(fold|collapse|expand)/i.test(id);
function hiddenCommand(id: string, folds: Set<string> = new Set()): boolean {
  if (id === 'inbox.open' || isFold(id, folds) || id.startsWith('board.openCard:') || id.startsWith('board.openSource:')) return false;
  return HIDDEN.some((h) => (h.endsWith('*') ? id.startsWith(h.slice(0, -1)) : id === h));
}

const cmd = (scope: Page | Locator, id: string) => scope.locator(`[data-command="${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`);
const registry = (page: Page) => page.evaluate(() => ((window as any).__TEGG_TEST__?.commands?.() ?? []) as string[]).then((l) => new Set(l.map((x) => String(x).normalize('NFC'))));
/** `__TEGG_TEST__.run(id)`: 'ok', 'no hook', or 'rejected: …' (never throws, TS-I1). */
async function runById(page: Page, id: string): Promise<string> {
  return page.evaluate((c) => {
    const t = (window as any).__TEGG_TEST__;
    if (typeof t?.run !== 'function') return 'no hook';
    return Promise.resolve(t.run(c)).then(() => 'ok', (e: unknown) => `rejected: ${String((e as Error)?.message ?? e)}`);
  }, id);
}

/** FR-UX-03 AC-56's second part (its test's filter) and RA11's hidden list, on the page as it is. */
async function ac54Holds(page: Page, how: string) {
  // The registry follows the page (§10: per-control commands are registered while their page is shown), so the probe
  // is repeated for up to 2 s after a tab change before the result is asserted.
  const probe = async () => {
    const registered = await registry(page);
    const all = (await controls(page)).filter((c) => !c.inert);
    // D-2475: a view-only task checkbox (`aria-disabled`) is exempt from carrying a command and carries none itself.
    const ownCommands = await main(page).locator('[role="checkbox"][aria-disabled="true"], input[type="checkbox"][aria-disabled="true"]').evaluateAll((bs) => bs.filter((b) => b.getClientRects().length > 0 && b.hasAttribute('data-command')).map((b) => `${(b.getAttribute('aria-label') ?? '').normalize('NFC')} → ${b.getAttribute('data-command')}`));
    const viewOnly = new Set(await main(page).locator('[role="checkbox"][aria-disabled="true"], input[type="checkbox"][aria-disabled="true"]').evaluateAll((bs) => bs.map((b) => (b.getAttribute('aria-label') ?? (b as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().normalize('NFC'))));
    const ctl = all.filter((c) => !c.text && !c.row && !((c.role === 'link' || c.role === 'checkbox') && c.exempt) && !(c.role === 'checkbox' && viewOnly.has(c.name)) && ['button', 'link', 'tab', 'menuitem', 'menuitemradio', 'checkbox', 'radio', 'switch'].includes(c.role));
    const folds = new Set(all.filter((c) => c.command?.startsWith('board.') && /^(Collapse|Expand) /.test(c.name)).map((c) => nfc(c.command!)));
    const missing = ctl.filter((c) => !c.command || !registered.has(nfc(c.command).split(':')[0]) && !registered.has(nfc(c.command))).map((c) => `${c.role} "${c.name.slice(0, 30)}" → ${c.command ?? '(none)'}`);
    const hidden = [...new Set(all.filter((c) => c.command).map((c) => nfc(c.command!)))].filter((id) => hiddenCommand(id, folds));
    return { size: registered.size, missing, hidden, ownCommands };
  };
  const got = await eventually(probe, (r) => r.size > 0 && r.missing.length === 0 && r.hidden.length === 0 && r.ownCommands.length === 0, 2000);
  assert.ok(got.size > 0, `${how}: __TEGG_TEST__.commands() lists the registry`);
  assert.deepEqual(got.missing, [], `${how}: every control carries the data-command of a registered command (FR-UX-03 AC-56)`);
  assert.deepEqual(got.hidden, [], `${how}: no control carries a command of RA11's hidden list (PHONE_HIDDEN_COMMANDS)`);
  assert.deepEqual(got.ownCommands, [], `${how}: view-only task checkboxes carry no data-command (D-2475)`);
}

/** The embed frame of `path` in the note's body (R30: `data-embed-target`, NFC). */
const frameOf = (page: Page, path: string) => main(page).locator(`[data-embed-target="${nfc(path)}"]`).first();

/** Every visible button or link inside an embed frame (and the frame itself when it is a link), except checkboxes. */
async function openers(frame: Locator): Promise<{ role: string; name: string; command: string | null }[]> {
  return frame.evaluate((root) => {
    const out: { role: string; name: string; command: string | null }[] = [];
    const els = [root, ...root.querySelectorAll('a, button, [role="button"], [role="link"]')] as HTMLElement[];
    for (const e of els) {
      const role = e.getAttribute('role') ?? (e.tagName === 'A' ? 'link' : e.tagName === 'BUTTON' ? 'button' : '');
      if (role !== 'button' && role !== 'link') continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const name = (e.getAttribute('aria-label') ?? e.innerText ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
      const holder = e.hasAttribute('data-command') ? e : (e.closest('[data-command]') as HTMLElement | null);
      out.push({ role, name, command: holder && root.contains(holder) || holder === root ? (holder!.getAttribute('data-command') ?? '').normalize('NFC') : null });
    }
    return out;
  });
}

/** From the element carrying `id`, the nearest ancestor whose text holds `title`; returns that ancestor's text. */
async function ownerText(page: Page, id: string, title: string): Promise<string> {
  return cmd(page, id).first().evaluate((e, t) => {
    for (let a: HTMLElement | null = e as HTMLElement; a; a = a.parentElement) if ((a.textContent ?? '').normalize('NFC').includes(t)) return (a.textContent ?? '').normalize('NFC');
    return '';
  }, nfc(title));
}

/** Tasks with a `source` in the fixture and their source note's title (tasks/ README): only Zavolat Janě → Porada. */
const JANE = 'Tasks/Zavolat Janě.md';
const PORADA = 'Pages/Porada.md';
const SOURCES: Record<string, string> = { [nfc(JANE)]: 'Porada' };
type CardProbe = { path: string; own: string | null; title: string | null; chips: (string | null)[]; others: { name: string; command: string | null }[]; boxes: (string | null)[] };
/** Each visible board task card: the card's own command, the command the title resolves to, the source chips'
 *  commands, every other visible control's command (own or nearest inside the card), and the checkboxes' own ones. */
async function boardCards(page: Page): Promise<CardProbe[]> {
  return main(page).locator('article[data-board-card]').evaluateAll((cs, sources) => cs.filter((c) => c.getClientRects().length > 0).map((c) => {
    const path = (c.getAttribute('data-board-card') ?? '').normalize('NFC');
    const cmdOf = (e: Element) => { const h = e.closest('[data-command]'); return h && (c.contains(h)) ? (h.getAttribute('data-command') ?? '').normalize('NFC') : null; };
    const label = (c.getAttribute('aria-label') ?? '').normalize('NFC');
    const title = label.replace(/^⟦?Task: /, '').replace(/⟧$/, '') || path.split('/').pop()!.replace(/\.md$/, '');
    let titleEl: Element | null = null;
    const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n.textContent ?? '').normalize('NFC').trim() === title) { titleEl = n.parentElement; break; }
    const src = sources[path];
    const chips: (string | null)[] = [];
    const others: { name: string; command: string | null }[] = [];
    const boxes: (string | null)[] = [];
    for (const e of c.querySelectorAll('a, button, input, [role="button"], [role="link"], [role="checkbox"]') as NodeListOf<HTMLElement>) {
      if (e.getClientRects().length === 0) continue;
      const role = e.getAttribute('role') ?? (e.tagName === 'INPUT' ? (e as HTMLInputElement).type : e.tagName === 'A' ? 'link' : 'button');
      if (role === 'checkbox') { boxes.push(e.getAttribute('data-command')); continue; }
      const name = (e.getAttribute('aria-label') ?? e.innerText ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
      if (src && (name === src || name.includes(src) && !name.includes(title))) chips.push(cmdOf(e));
      else others.push({ name, command: cmdOf(e) });
    }
    return { path, own: c.getAttribute('data-command')?.normalize('NFC') ?? null, title: titleEl ? cmdOf(titleEl) : null, chips, others, boxes };
  }), SOURCES);
}

type Effect = { route: string | null; open: string[]; ipc: string[] };
async function effect(page: Page, core: PhoneHandle, from: number): Promise<Effect> {
  await sleep(500);
  const open = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"], [role="menu"]')].filter((e) => e.getClientRects().length > 0).map((e) => e.getAttribute('aria-label') ?? '').sort());
  const ipc = [...new Set((await core.calls()).slice(from).map((c) => c.cmd).filter((c) => c !== 'perf_mark' && !c.startsWith('plugin:')))].sort();
  return { route: await mainName(page), open, ipc };
}
/** The note paths `nav_opened` recorded after call `from` (NFC). */
async function opened(core: PhoneHandle, from: number): Promise<string[]> {
  return (await core.calls()).slice(from).filter((c) => c.cmd === 'nav_opened').map((c) => nfc(String((c.args as { path?: string } | null)?.path ?? '')));
}

const foldState = async (page: Page, id: string) => ({ expanded: await cmd(page, id).first().getAttribute('aria-expanded') });
const tipShown = (page: Page) => seen(main(page).getByText('Skrytý text tipu.', { exact: true }), 300);
const mapArea = (page: Page, title: string) => main(page).getByRole('figure', { name: `Mindmap: ${nfc(title)}`, exact: true }).locator('[data-map-area]');
const mapShown = (page: Page, title: string) => seen(mapArea(page, title), 300);
/** The pressed button of each map's `Mindmap view` group, in document order. */
const pressed = (page: Page) => main(page).locator('figure').evaluateAll((fs) => fs.filter((f) => f.querySelector('[role="group"][aria-label="Mindmap view"]')).map((f) => {
  const g = f.querySelector('[role="group"][aria-label="Mindmap view"]')!;
  return `${f.getAttribute('aria-label') ?? ''}: ${[...g.querySelectorAll('button[aria-pressed="true"]')].map((b) => (b.textContent ?? '').trim()).join('+')}`;
}));

type Outcome = { effect: Effect; state: unknown; zero: [PhoneHandle, FileState] };
/** One fresh page: start, `prep`, then `act` (the tap on the first control carrying `id`, or `run(id)`), then `probe`. */
async function once(browser: Browser, o: PhoneOptions, id: string, how: 'tap' | 'run', prep: (p: Page) => Promise<void>, probe: (p: Page, core: PhoneHandle, from: number) => Promise<unknown>, what: string): Promise<Outcome> {
  const page = await phonePage(browser);
  try {
    const core = await startPhone(page, o);
    await eventually(() => mainName(page), (n) => !!n, 5000);
    const before = await fileStateOf(core);
    await prep(page);
    const from = (await core.calls()).length;
    if (how === 'tap') {
      await (await must(cmd(page, id), `${what}: a control carrying ${id}`)).first().click({ force: true });
    } else {
      assert.equal(await runById(page, id), 'ok', `${what}: __TEGG_TEST__.run('${id}') resolves (contract §12.2, D-2474)`);
    }
    const eff = await effect(page, core, from);
    const state = await probe(page, core, from);
    await assertZeroWrites(core, before, `${what} (${how})`);
    return { effect: eff, state, zero: [core, before] };
  } finally {
    await page.close();
  }
}
/** Tap and run by id on fresh pages: the same effect, and the run's state is `want`. */
async function sameAsTap(browser: Browser, o: PhoneOptions, id: string, prep: (p: Page) => Promise<void>, probe: (p: Page, core: PhoneHandle, from: number) => Promise<unknown>, want: unknown, what: string) {
  const tapped = await once(browser, o, id, 'tap', prep, probe, what);
  assert.deepEqual(tapped.state, want, `${what}: the tap on ${id}`);
  const ran = await once(browser, o, id, 'run', prep, probe, what);
  assert.deepEqual(ran.state, want, `${what}: run('${id}') has the effect the AC names`);
  assert.deepEqual(ran.effect, tapped.effect, `${what}: run('${id}') has the tap's effect (route, open dialogs and menus, IPC calls)`);
}

const tabOf = (page: Page, name: string) => main(page).locator(`[role="tab"][data-view-tab="${nfc(name)}"]`);
async function openTab(page: Page, name: string, label: string) {
  const t = await must(tabOf(page, name), `the tab ${label}`, 5000);
  await t.first().click();
  assert.equal(await eventually(() => t.first().getAttribute('aria-selected'), (s) => s === 'true', 3000), 'true', `the tab ${label} is selected`);
  await sleep(300);
}

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-57

test('fr_ux_03_ac57_content_controls_on_the_phone', async ({ page, browser }) => {
  test.setTimeout(300_000);

  // ---- note/Pages/Vložené.md: what is rendered
  const core = await startPhone(page, contentStart(`note/${VLOZENE}`));
  const before = await fileStateOf(core);
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Vložené', 5000), 'Vložené', 'note/Pages/Vložené.md opens');
  const pageFrame = await must(frameOf(page, STRANKA), 'the note embed Vložená stránka (data-embed-target, NFC)', 5000);
  const taskFrame = await must(frameOf(page, KOLO), 'the task embed Opravit kolo (data-embed-target, NFC)', 5000);
  assert.equal(await main(page).getByRole('button', { name: /Display as/ }).count(), 0, 'no Display as control is rendered on the note');
  assert.equal(await main(page).locator('[aria-haspopup="menu"]').filter({ hasText: /Display as/ }).count(), 0, 'no Display as menu button');
  assert.equal(await main(page).getByText('Display as', { exact: true }).count(), 0, 'no Display as text');
  for (const [what, loc] of [
    ['status button', taskFrame.getByRole('button', { name: /^Status\b/ })], ['priority button', taskFrame.getByRole('button', { name: /^Priority\b/ })],
    ['due button', taskFrame.getByRole('button', { name: /^Due\b/ })], ['Due date field', taskFrame.getByRole('textbox', { name: /Due date/ })],
    ['Clear (due)', taskFrame.getByRole('button', { name: 'Clear', exact: true })],
  ] as const) assert.equal(await loc.count(), 0, `the task embed Opravit kolo has no ${what}`);
  assert.deepEqual(await taskFrame.locator('[data-command^="task."]').evaluateAll((es) => es.map((e) => e.getAttribute('data-command'))), [], 'no task.* control in the task embed');
  const status = taskFrame.getByText('In progress', { exact: true });
  assert.ok(await seen(status, 2000), 'the task embed shows its status In progress');
  assert.deepEqual(await status.evaluateAll((es) => es.filter((e) => e.getClientRects().length > 0).map((e) => !!e.closest('button, a, input, select, textarea, [role="button"], [role="link"], [role="combobox"]'))), [false], 'In progress shows as text, not inside a control');
  const box = taskFrame.getByRole('checkbox');
  assert.equal(await box.count(), 1, 'the task embed draws its checkbox');
  assert.equal(await box.first().getAttribute('aria-disabled'), 'true', 'the task embed\'s checkbox is aria-disabled (as RA11)');

  // ---- the commands the content controls carry
  const fold1 = cmd(page, 'read.fold:1');
  const fold2 = cmd(page, 'read.fold:2');
  assert.equal(await fold1.count(), 1, 'one control carries read.fold:1 (the callout\'s fold button)');
  assert.equal(await fold2.count(), 1, 'one control carries read.fold:2 (the mindmap\'s fold button)');
  const o1 = await ownerText(page, 'read.fold:1', 'Složený tip');
  assert.ok(o1.includes('Složený tip') && !o1.includes('Složená mapa'), `read.fold:1 is the fold button of the callout Složený tip (${o1.slice(0, 60)})`);
  const o2 = await ownerText(page, 'read.fold:2', 'Složená mapa');
  assert.ok(o2.includes('Složená mapa') && !o2.includes('Složený tip'), `read.fold:2 is the fold button of the mindmap Složená mapa (${o2.slice(0, 60)})`);
  assert.equal(await fold1.first().getAttribute('aria-expanded'), 'false', 'the callout starts folded (aria-expanded false)');
  assert.equal(await tipShown(page), false, 'Skrytý text tipu. is hidden while folded');
  assert.equal(await mapShown(page, 'Složená mapa'), false, 'the map Složená mapa is hidden while folded');
  const pageOpeners = await openers(pageFrame);
  assert.ok(pageOpeners.some((c) => c.name === 'Open Vložená stránka'), `the note embed has Open Vložená stránka (${JSON.stringify(pageOpeners)})`);
  assert.deepEqual(pageOpeners.filter((c) => c.command !== 'read.openEmbed:1'), [], 'every control of the note embed Vložená stránka that opens it carries read.openEmbed:1');
  const taskOpeners = await openers(taskFrame);
  assert.ok(taskOpeners.some((c) => c.name === 'Open Opravit kolo'), `the task embed has Open Opravit kolo (${JSON.stringify(taskOpeners)})`);
  assert.deepEqual(taskOpeners.filter((c) => c.command !== 'read.openEmbed:2'), [], 'every control of the task embed Opravit kolo that opens it carries read.openEmbed:2');
  const reg = await registry(page);
  for (const id of ['read.fold:1', 'read.fold:2', 'read.openEmbed:1', 'read.openEmbed:2']) assert.ok(reg.has(id), `${id} is registered while the note is shown (__TEGG_TEST__.commands())`);
  await ac54Holds(page, 'note/Pages/Vložené.md');

  // ---- type/task with each tab open; board task cards' titles
  const tasks = await phonePage(browser);
  try {
    const tc = await startPhone(tasks, contentStart('type/task'));
    const tBefore = await fileStateOf(tc);
    assert.equal(await eventually(async () => flat(await appBar(tasks).getByRole('heading', { level: 1 }).first().innerText().catch(() => '')), (t) => t === 'Tasks', 5000), 'Tasks', 'type/task opens');
    for (const [name, label, isBoard] of [['', 'All Tasks', false], ['Schedule', 'Schedule', true], ['Kanban', 'Kanban', true], ['Čeká na ostatní', 'Čeká na ostatní', false]] as const) {
      await openTab(tasks, name, label);
      const how = `type/task, ${label}`;
      await ac54Holds(tasks, how);
      if (!isBoard) continue;
      const cards = await boardCards(tasks);
      assert.ok(cards.length > 0, `${how}: the board shows task cards`);
      const want = (c: CardProbe) => `board.openCard:${c.path}`;
      assert.deepEqual(cards.filter((c) => c.own !== want(c)).map((c) => `${c.path} → ${c.own}`), [], `${how}: each task card itself carries board.openCard:<path> (NFC, D-2475)`);
      assert.deepEqual(cards.filter((c) => c.title !== want(c)).map((c) => `${c.path} → ${c.title}`), [], `${how}: each task card's title carries board.openCard:<path> (D-2475)`);
      assert.deepEqual(cards.flatMap((c) => c.others.filter((o) => o.command !== want(c)).map((o) => `${c.path}: ${o.name} → ${o.command}`)), [], `${how}: every other control of a card that opens its task carries board.openCard:<path> (D-2475)`);
      assert.deepEqual(cards.flatMap((c) => c.boxes.filter((b) => b !== null).map((b) => `${c.path}: ${b}`)), [], `${how}: a card's view-only checkbox carries no data-command (D-2475)`);
      const withSource = cards.filter((c) => SOURCES[c.path]);
      assert.deepEqual(withSource.map((c) => ({ path: c.path, chip: c.chips })), withSource.map((c) => ({ path: c.path, chip: [`board.openSource:${c.path}`] })), `${how}: the source chip carries board.openSource:<path> (D-2475)`);
    }
    await assertZeroWrites(tc, tBefore, 'type/task with each tab open');
  } finally {
    await tasks.close();
  }

  // ---- running each command by id has the tap's effect, also inside the page
  const noPrep = async () => undefined;
  await sameAsTap(browser, contentStart(`note/${VLOZENE}`), 'read.fold:1', noPrep,
    async (p) => ({ ...(await foldState(p, 'read.fold:1')), tip: await tipShown(p) }), { expanded: 'true', tip: true }, 'read.fold:1 on Vložené');
  await sameAsTap(browser, contentStart(`note/${VLOZENE}`), 'read.fold:2', noPrep,
    async (p) => ({ map: await mapShown(p, 'Složená mapa') }), { map: true }, 'read.fold:2 on Vložené');
  await sameAsTap(browser, contentStart(`note/${VLOZENE}`), 'read.openEmbed:1', noPrep,
    async (p, c, from) => ({ route: await eventually(() => mainName(p), (n) => n === 'Vložená stránka', 3000), opened: [...new Set(await opened(c, from))] }),
    { route: 'Vložená stránka', opened: [nfc(STRANKA)] }, 'read.openEmbed:1 on Vložené');
  await sameAsTap(browser, contentStart('type/task'), `board.openCard:${nfc(KOLO)}`, async (p) => openTab(p, 'Kanban', 'Kanban'),
    async (p, c, from) => ({ route: await eventually(() => mainName(p), (n) => n === 'Opravit kolo', 3000), opened: [...new Set(await opened(c, from))] }),
    { route: 'Opravit kolo', opened: [nfc(KOLO)] }, 'board.openCard:Tasks/Opravit kolo.md on the Kanban tab');
  await sameAsTap(browser, contentStart('type/task'), `board.openSource:${nfc(JANE)}`, async (p) => openTab(p, 'Kanban', 'Kanban'),
    async (p, c, from) => ({ route: await eventually(() => mainName(p), (n) => n === 'Porada', 3000), opened: [...new Set(await opened(c, from))] }),
    { route: 'Porada', opened: [nfc(PORADA)] }, 'board.openSource:Tasks/Zavolat Janě.md on the Kanban tab');

  // ---- Mapa výletu (phone/): mindmap.showList, then mindmap.showMap
  const mapa = { route: `note/${PH.mapa}` };
  const mapReady = async (p: Page) => { await must(main(p).getByRole('figure', { name: 'Mindmap: Výlet', exact: true }), 'figure "Mindmap: Výlet"', 5000); };
  /** Whether Výlet's figure shows its list: a visible `li` outside the map area and its tree. */
  const listShown = (p: Page) => main(p).getByRole('figure', { name: 'Mindmap: Výlet', exact: true }).first().evaluate((f) => [...f.querySelectorAll('li')].some((l) => l.getClientRects().length > 0 && !l.closest('[data-map-area], [role="tree"]'))).catch(() => false);
  const mapProbe = async (p: Page) => ({ pressed: await pressed(p), list: await listShown(p) });
  const startPressed = await (async () => {
    const p = await phonePage(browser);
    try { await startPhone(p, mapa); await mapReady(p); return await pressed(p); } finally { await p.close(); }
  })();
  assert.equal(startPressed[0], 'Mindmap: Výlet: Map', `Mapa výletu starts with Map pressed (${JSON.stringify(startPressed)})`);
  await sameAsTap(browser, mapa, 'mindmap.showList', mapReady, mapProbe, { pressed: ['Mindmap: Výlet: List', ...startPressed.slice(1)], list: true }, 'mindmap.showList on Mapa výletu');
  const listFirst = async (p: Page) => {
    await mapReady(p);
    await (await must(cmd(p, 'mindmap.showList'), 'a control carrying mindmap.showList')).first().click({ force: true });
    assert.equal(await eventually(async () => (await pressed(p))[0], (x) => x === 'Mindmap: Výlet: List', 2000), 'Mindmap: Výlet: List', 'List pressed before showMap');
  };
  await sameAsTap(browser, mapa, 'mindmap.showMap', listFirst, mapProbe, { pressed: startPressed, list: false }, 'mindmap.showMap on Mapa výletu');

  // ---- zero writes on the first page too
  await assertZeroWrites(core, before, 'note/Pages/Vložené.md');
});
