// MS5 slice 5A-1 preview feedback, L5 (WebKit + fake core): the Tasks header layout. FR-TSK-04 AC-16 (D-517, D-519):
// on `tasks`, `tasks/kanban` and `type/task` the `Task views` tablist and the icon button `Type settings` sit on the
// heading's row, right of it, `Type settings` right after the tablist (`New Task` after it on `type/task`); `Sort` is
// the toolbar's last control at its right end. docs/acceptance/tasks.md R40; window 1280 × 800 pt. Written from the
// ACs only (D-61). Missing elements fail an assertion (TS-I1).
//
// Slice Q2-T (AC-Test-Change, D-1912; views.md part three, row FR-TSK-04 AC-9, AC-15…AC-17): one route `type/task`, the type
// page's header on every tab (R186, R204): `Type settings` and `New Task` on the heading's row, right of it; the tablist
// `Views` below the heading; the toolbar ends with `View actions` (the sort button before it, R204, FR-TSK-04 AC-22).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { iconButtonLook, typeTable } from './types-helpers';
import { click, column, gotoKanban, gotoTasks, heading, main, must, sectionOf, startTasksPage as startTasks, viewTab, views, writeCalls } from './tasks-helpers';

test.use({ timezoneId: 'Europe/Prague', viewport: { width: 1280, height: 800 } });

type Box = { x: number; y: number; width: number; height: number };
async function boxOf(loc: Locator, what: string): Promise<Box> {
  const el = await must(loc, what);
  const b = await el.boundingBox();
  assert.ok(b, `${what} has a box`);
  return b!;
}
const settingsBtn = (page: Page) => main(page).getByRole('button', { name: 'Type settings', exact: true });

async function headerRow(page: Page, tab: string) {
  const h = await boxOf(heading(page), `${tab}: heading Tasks`);
  const t = await boxOf(views(page), `${tab}: tablist Views`);
  const s = await boxOf(settingsBtn(page), `${tab}: Type settings`);
  const n = await boxOf(main(page).getByRole('button', { name: 'New Task', exact: true }), `${tab}: New Task`);
  const overlapsRow = (b: Box) => b.y < h.y + h.height && b.y + b.height > h.y;
  assert.ok(t.y >= h.y + h.height - 0.5, `${tab}: the tablist is below the heading (${t.y} ≥ ${h.y + h.height})`);
  assert.ok(s.x >= h.x + h.width - 0.5 && overlapsRow(s), `${tab}: Type settings is on the heading's row, right of it`);
  assert.ok(n.x >= s.x + s.width - 0.5 && overlapsRow(n), `${tab}: New Task on the row, right of Type settings`);
  const look = await iconButtonLook(settingsBtn(page));
  assert.equal(look.text, '', `${tab}: Type settings is icon-only ("${look.text}")`);
  assert.equal(look.title, 'Type settings', `${tab}: tooltip Type settings`);
  assert.ok(Math.abs(look.width - 36) <= 1 && Math.abs(look.height - 36) <= 1, `${tab}: 36 × 36 pt (${look.width} × ${look.height})`);
  assert.ok(look.borders.every((b) => { const [w, st] = b.split(' '); return Math.abs(parseFloat(w) - 1) < 0.01 && st !== 'none' && st !== 'hidden'; }),
    `${tab}: a 1 px border (${look.borders.join(', ')})`);
}

/** `View actions` is the toolbar's last control (R204). */
async function viewActionsLast(page: Page, tab: string) {
  const r = await main(page).locator('div.view-toolbar').first().evaluate((bar) => {
    const controls = ([...bar.querySelectorAll('button, input, [role="button"], [role="combobox"], [role="radio"], [role="searchbox"]')] as HTMLElement[]).filter((e) => e.getClientRects().length > 0);
    return controls.at(-1)?.getAttribute('data-command') ?? null;
  }).catch(() => null);
  assert.equal(r, 'views.menu', `${tab}: \`View actions\` is the toolbar's last control`);
}

test('fr_tsk_04_ac16_header_on_schedule', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  await must(sectionOf(page, 'today'), 'Schedule');
  await headerRow(page, 'Schedule');
  await viewActionsLast(page, 'Schedule');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

test('fr_tsk_04_ac16_header_on_kanban', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  await must(column(page, 'To do'), 'Kanban');
  await headerRow(page, 'Kanban');
  await viewActionsLast(page, 'Kanban');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

test('fr_tsk_04_ac16_header_on_all_tasks', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  await click(viewTab(page, 'All Tasks'), 'tab All Tasks');
  await must(typeTable(page, 'Tasks'), 'table Tasks');
  await headerRow(page, 'All Tasks');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

test('fr_tsk_04_ac16_type_settings_opens_the_task_settings', async ({ page }) => {
  await startTasks(page);
  for (const [tab, go] of [
    ['Schedule', () => gotoTasks(page)],
    ['Kanban', () => gotoKanban(page, 'Status')],
    ['All Tasks', async () => { await gotoTasks(page); await click(viewTab(page, 'All Tasks'), 'tab All Tasks'); }],
  ] as const) {
    await go();
    await click(settingsBtn(page), `${tab}: Type settings`);
    await must(page.getByRole('heading', { level: 1, name: 'Task type settings', exact: true }), `${tab}: → type-settings/task`, 5000);
  }
});
