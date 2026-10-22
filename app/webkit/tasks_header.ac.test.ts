// MS5 slice 5A-1 preview feedback, L5 (WebKit + fake core): the Tasks header layout. FR-TSK-04 AC-16 (D-517, D-519):
// on `tasks`, `tasks/kanban` and `type/task` the `Task views` tablist and the icon button `Type settings` sit on the
// heading's row, right of it, `Type settings` right after the tablist (`New Task` after it on `type/task`); `Sort` is
// the toolbar's last control at its right end. docs/acceptance/tasks.md R40; window 1280 × 800 pt. Written from the
// ACs only (D-61). Missing elements fail an assertion (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { iconButtonLook, typeTable } from './types-helpers';
import { click, column, dateFilter, gotoKanban, gotoTasks, heading, main, must, sectionOf, sortBtn, startTasks, viewTab, views, writeCalls } from './tasks-helpers';

test.use({ timezoneId: 'Europe/Prague', viewport: { width: 1280, height: 800 } });

type Box = { x: number; y: number; width: number; height: number };
async function boxOf(loc: Locator, what: string): Promise<Box> {
  const el = await must(loc, what);
  const b = await el.boundingBox();
  assert.ok(b, `${what} has a box`);
  return b!;
}
const settingsBtn = (page: Page) => main(page).getByRole('button', { name: 'Type settings', exact: true });

/** The interactive elements of `main` after the tablist `Task views`, in DOM order, by accessible name (first 2). */
async function controlsAfterTabs(page: Page): Promise<string[]> {
  return main(page).first().evaluate((m) => {
    const tabs = m.querySelector('[role="tablist"][aria-label="Task views"]')
      ?? ([...m.querySelectorAll('[role="tablist"]')] as HTMLElement[]).find((t) => (t.getAttribute('aria-labelledby') ?? '').split(/\s+/).some((id) => document.getElementById(id)?.textContent?.trim() === 'Task views'));
    if (!tabs) return [];
    const all = [...m.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="combobox"], [role="link"]')] as HTMLElement[];
    const after = all.filter((e) => !tabs.contains(e) && !!(tabs.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING));
    const name = (e: HTMLElement) => (e.getAttribute('aria-label') ?? (e.getAttribute('aria-labelledby') ?? '').split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim()) || (e.textContent ?? '').replace(/\s+/g, ' ').trim();
    return after.slice(0, 2).map(name);
  });
}

async function headerRow(page: Page, route: string) {
  const h = await boxOf(heading(page), `${route}: heading Tasks`);
  const t = await boxOf(views(page), `${route}: tablist Task views`);
  const s = await boxOf(settingsBtn(page), `${route}: Type settings`);
  const overlapsRow = (b: Box) => b.y < h.y + h.height && b.y + b.height > h.y;
  assert.ok(t.x >= h.x + h.width - 0.5, `${route}: the tablist starts right of the heading (${t.x} ≥ ${h.x + h.width})`);
  assert.ok(overlapsRow(t), `${route}: the tablist is on the heading's row (tabs ${t.y}…${t.y + t.height}, heading ${h.y}…${h.y + h.height})`);
  assert.ok(s.x >= h.x + h.width - 0.5 && overlapsRow(s), `${route}: Type settings is on the heading's row, right of it`);
  assert.ok(s.x >= t.x + t.width - 0.5, `${route}: Type settings is right of the tablist (${s.x} ≥ ${t.x + t.width})`);
  const next = await controlsAfterTabs(page);
  assert.equal(next[0], 'Type settings', `${route}: Type settings right after the tablist (${next.join(', ')})`);
  if (route === 'type/task') {
    assert.equal(next[1], 'New Task', `${route}: New Task after Type settings`);
    const n = await boxOf(main(page).getByRole('button', { name: 'New Task', exact: true }), 'New Task');
    assert.ok(n.x >= s.x + s.width - 0.5 && overlapsRow(n), `${route}: New Task on the row, right of Type settings`);
  }
  const look = await iconButtonLook(settingsBtn(page));
  assert.equal(look.text, '', `${route}: Type settings is icon-only ("${look.text}")`);
  assert.equal(look.title, 'Type settings', `${route}: tooltip Type settings`);
  assert.ok(Math.abs(look.width - 36) <= 1 && Math.abs(look.height - 36) <= 1, `${route}: 36 × 36 pt (${look.width} × ${look.height})`);
  assert.ok(look.borders.every((b) => { const [w, st] = b.split(' '); return Math.abs(parseFloat(w) - 1) < 0.01 && st !== 'none' && st !== 'hidden'; }),
    `${route}: a 1 px border (${look.borders.join(', ')})`);
}

/** Sort is the toolbar row's last control and ends at the row's right edge (content box, ± 1 pt). */
async function sortAtTheRightEnd(page: Page, route: string, label: string) {
  const sort = await must(sortBtn(page, label), `${route}: Sort "${label}"`);
  await must(dateFilter(page), `${route}: date filter`);
  const r = await sort.evaluate((s) => {
    const filter = document.querySelector('[role="group"][aria-label="Filter"]');
    let row: HTMLElement | null = s.parentElement;
    while (row && filter && !row.contains(filter)) row = row.parentElement;
    if (!row) return null;
    const cs = getComputedStyle(row);
    const rr = row.getBoundingClientRect();
    const right = rr.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
    const controls = ([...row.querySelectorAll('button, a[href], input, select, [role="button"], [role="combobox"], [role="tab"]')] as HTMLElement[])
      .filter((e) => e.getClientRects().length > 0);
    const last = controls.filter((e) => !s.contains(e) && e !== s && !!(s.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING));
    const sr = s.getBoundingClientRect();
    const rightOf = controls.filter((e) => e !== s && !s.contains(e) && e.getBoundingClientRect().left >= sr.right - 0.5 && e.getBoundingClientRect().top < sr.bottom && e.getBoundingClientRect().bottom > sr.top);
    return { sortRight: sr.right, rowRight: right, after: last.map((e) => e.getAttribute('aria-label') ?? e.textContent?.trim() ?? e.tagName), rightOf: rightOf.length };
  });
  assert.ok(r, `${route}: Sort and the date filter share a toolbar row`);
  assert.deepEqual(r!.after, [], `${route}: no control after Sort in the toolbar`);
  assert.equal(r!.rightOf, 0, `${route}: no control right of Sort on its row`);
  assert.ok(Math.abs(r!.sortRight - r!.rowRight) <= 1, `${route}: Sort's right edge ${r!.sortRight} is the toolbar's right edge ${r!.rowRight} (± 1 pt)`);
}

test('fr_tsk_04_ac16_header_on_schedule', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  await must(sectionOf(page, 'today'), 'Schedule');
  await headerRow(page, 'tasks');
  await sortAtTheRightEnd(page, 'tasks', 'Priority, then due');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

test('fr_tsk_04_ac16_header_on_kanban', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  await must(column(page, 'To do'), 'Kanban');
  await headerRow(page, 'tasks/kanban');
  await sortAtTheRightEnd(page, 'tasks/kanban', 'Due date');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

test('fr_tsk_04_ac16_header_on_all_tasks', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  await click(viewTab(page, 'All tasks'), 'tab All tasks');
  await must(typeTable(page, 'Tasks'), 'table Tasks');
  await headerRow(page, 'type/task');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

test('fr_tsk_04_ac16_type_settings_opens_the_task_settings', async ({ page }) => {
  await startTasks(page);
  for (const [route, go] of [
    ['tasks', () => gotoTasks(page)],
    ['tasks/kanban', () => gotoKanban(page, 'Status')],
    ['type/task', async () => { await gotoTasks(page); await click(viewTab(page, 'All tasks'), 'tab All tasks'); }],
  ] as const) {
    await go();
    await click(settingsBtn(page), `${route}: Type settings`);
    await must(page.getByRole('heading', { level: 1, name: 'Task type settings', exact: true }), `${route}: → type-settings/task`, 5000);
  }
});
