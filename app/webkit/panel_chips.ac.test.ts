// Preview v0.55 panel feedback, L5 (WebKit + fake core): the Backlinks panel's chips. docs/acceptance/backlinks.md
// FR-LNK-01 AC-22 (D-633: each panel chip is a D-600 chip with exactly the look of embeds.md FR-LNK-07 AC-9 (a)…(d) for
// the same object; one line, the title truncated and never the suffix, `title` = the full title; an external change
// updates it within 2 s (AC-9's timing); dark mode and axe colour-contrast), AC-23 (D-635: no `Unlinked mentions`, the
// panel's tab order is the tab, the group headers and the chips). Interface docs/contracts/ms4-links.md §9.1, §9.2,
// §9.4 (entries carry `review`, `status`, `due`, `completed`; the chip is built with `chipParts()` and keeps
// `data-link-kind="note"`), ms3-shell.md §16.1 (chip DOM hooks: `data-review`, `aria-description` `Unreviewed`,
// `data-task-state`, `.chip-suffix` with `data-tone`). Written from the ACs and the contracts only (D-61). Every lookup
// goes through `must`/node:assert, so a missing chip or suffix fails an assertion (TS-I1).
//
// Test clock 2026-10-19T10:00:00+02:00 (a Monday), Europe/Prague, region en-US. The due dates are the region's short
// date (tasks-helpers `shortDate`), as in link_chips_v052.ac.test.ts (the AC writes them as `Fri 23 Oct`). The vault is
// synthetic and written here (ms4-links §9.5): the AC-22 sources plus one task with a long title (for the truncation
// step); `Cíl panelu`'s own body links every source so the same objects are also drawn as note chips, which the panel
// chips are compared with ("exactly the look … for the same object"). Links from `Cíl panelu` are not backlinks of it.
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { loadFixtureVault, type FakeVault } from '../ui/test/fake-core';
import { eventually, must, mustBeOn, start, type FakeCoreHandle } from './helpers';
import { B, backlinksPanel, contextPanel, flat, groupHeader, mustPanel, openLinks } from './links-helpers';
import { axeContrast, tokenColour } from './read-helpers';
import { shortDate } from './tasks-helpers';
import { amber, dots, rgba, transparent } from './v052-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const NOW = '2026-10-19T10:00:00+02:00';
const STAMP = '2026-10-10T09:00:00+02:00';
const nfc = (s: string) => s.normalize('NFC');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const d = (iso: string) => shortDate(iso, 'en-US');

const CIL = 'Pages/Cíl panelu.md';
const LONG = 'Velmi dlouhý název úkolu o přípravě podkladů pro celoroční plánování celého týmu a všech jeho projektů';
/** AC-22's tasks (title — status, due, completed) plus the long title. */
const TASKS: [string, string, string | null, string | null][] = [
  ['Uklidit štítky', 'To do', null, null],
  ['Připravit poznámky', 'To do', '2026-10-23', null],
  ['Projít osnovu', 'In progress', '2026-10-19', null],
  ['Poslat rozpočet', 'To do', '2026-10-16', null],
  ['Zeptat se Petra', 'Waiting', '2026-10-22', null],
  ['Sebrat ceny letenek', 'Done', '2026-10-17', '2026-10-18T09:00:00+02:00'],
  ['Objednat kyvadlo', 'Cancelled', null, '2026-10-17T16:00:00+02:00'],
  [LONG, 'To do', '2026-10-23', null],
];
const OTHERS = ['Plán', 'Nápad na podcast', 'Hotová myšlenka'];
const ALL = [...TASKS.map((t) => t[0]), ...OTHERS];
const id = (n: number) => `01JB63300000000000000C${String(n).padStart(4, '0')}`;
const note = (n: number, type: string, title: string, keys: string, body: string) =>
  `---\nid: ${id(n)}\ntype: ${type}\ntitle: ${title}\n${keys}created: ${STAMP}\nmodified: ${STAMP}\n---\n${body}`;
const LINK = 'Viz [[Cíl panelu]].\n';

function panelVault(): FakeVault {
  const v = { ...loadFixtureVault('tests/fixtures/vaults/new-empty/.tegg'), name: 'Panel' };
  TASKS.forEach(([title, status, due, completed], i) => {
    v.files[nfc(`Tasks/${title}.md`)] = note(i + 1, 'task', title, `status: ${status}\n${due ? `due: ${due}\n` : ''}${completed ? `completed: ${completed}\n` : ''}`, LINK);
  });
  v.files[nfc('Quick Notes/Nápad na podcast.md')] = note(20, 'quick-note', 'Nápad na podcast', 'review: unreviewed\n', LINK);
  v.files[nfc('Quick Notes/Hotová myšlenka.md')] = note(21, 'quick-note', 'Hotová myšlenka', 'review: reviewed\n', LINK);
  v.files[nfc('Pages/Plán.md')] = note(22, 'page', 'Plán', '', LINK);
  v.files[nfc(CIL)] = note(23, 'page', 'Cíl panelu', '', `Odkazy zpět: ${ALL.map((t) => `[[${t}]]`).join(' ')}\n`);
  return v;
}

async function openCil(page: Page, theme: 'light' | 'dark' = 'light'): Promise<FakeCoreHandle> {
  await page.addInitScript(() => { (window as any).__TEGG_REGION__ = 'en-US'; });
  await page.clock.setFixedTime(new Date(NOW));
  await page.setViewportSize({ width: 1440, height: 900 });
  const core = await start(page, {
    vault: panelVault(), last: { path: nfc(CIL), id: id(23) },
    uiState: { version: 1, theme, sidebarOpen: true, rightPanel: { open: true, tab: 'backlinks' } },
  });
  await mustBeOn(page, 'Cíl panelu', 'landing on Cíl panelu', 5000);
  await mustPanel(page);
  return core;
}

/** A panel chip: a `data-link-kind="note"` element in the Backlinks tabpanel whose text starts with the title. */
const panelChip = (page: Page, title: string) =>
  backlinksPanel(page).locator('[data-link-kind="note"]').filter({ hasText: new RegExp(`^\\s*${esc(nfc(title))}`) });
/** The same object drawn as a note chip in Cíl panelu's body. */
const noteChip = (page: Page, title: string) =>
  page.getByRole('main').locator('[data-link-kind]').filter({ hasText: new RegExp(`^\\s*${esc(nfc(title))}`) });
const needPanelChip = (page: Page, title: string) => must(panelChip(page, title), `panel chip "${title}"`, 5000);
const needNoteChip = (page: Page, title: string) => must(noteChip(page, title), `note chip "${title}" in Cíl panelu`, 5000);

type ChipInfo = {
  review: string | null; unreviewedDescription: boolean; taskState: string | null; suffix: string | null; tone: string | null;
  toneColour: string | null; toneWeight: number; bg: string; weight: number; shadow: string; icon: string | null;
  iconColour: string | null; struck: boolean; divider: boolean; suffixDots: number;
};
async function info(c: Locator, title: string): Promise<ChipInfo> {
  return c.evaluate((el, t) => {
    const s = getComputedStyle(el);
    const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    const description = (el.getAttribute('aria-description') ?? ids.map((x) => document.getElementById(x)?.textContent ?? '').join(' ')).replace(/\s+/g, ' ').trim();
    const suffix = el.querySelector('.chip-suffix') as HTMLElement | null;
    const tone = suffix?.querySelector('[data-tone]') as HTMLElement | null;
    const icon = el.querySelector('svg[data-icon]') as SVGElement | null;
    const titleEl = [...el.querySelectorAll('*')].find((e) => (e.textContent ?? '').trim().normalize('NFC') === t && ![...e.children].some((k) => (k.textContent ?? '').trim().normalize('NFC') === t)) as HTMLElement | undefined;
    let struck = false;
    for (let x: HTMLElement | null = titleEl ?? null; x && x !== el.parentElement; x = x.parentElement) if (getComputedStyle(x).textDecorationLine.includes('line-through')) struck = true;
    const divider = [...el.querySelectorAll('*')].some((e) => { const r = (e as HTMLElement).getBoundingClientRect(); const cs = getComputedStyle(e); return (r.width > 0 && r.width <= 1.5 && r.height >= 6 && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') || cs.borderLeftWidth === '1px'; });
    const suffixDots = suffix ? [...suffix.querySelectorAll('*')].filter((e) => { const r = (e as HTMLElement).getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.width <= 10 && Math.abs(r.width - r.height) <= 1 && cs.backgroundColor !== 'rgba(0, 0, 0, 0)'; }).length : 0;
    return {
      review: el.getAttribute('data-review'), unreviewedDescription: description.includes('Unreviewed'), taskState: el.getAttribute('data-task-state'),
      suffix: suffix ? (suffix.innerText ?? '').replace(/\s+/g, ' ').trim().normalize('NFC') : null,
      tone: tone?.getAttribute('data-tone') ?? null, toneColour: tone ? getComputedStyle(tone).color : null, toneWeight: tone ? Number(getComputedStyle(tone).fontWeight) || 400 : 0,
      bg: s.backgroundColor, weight: Number(s.fontWeight) || 400, shadow: s.boxShadow, icon: icon?.getAttribute('data-icon') ?? null,
      iconColour: icon ? getComputedStyle(icon).color : null, struck, divider, suffixDots,
    };
  }, nfc(title));
}

/** FR-LNK-07 AC-9 (a)…(d), asserted on the panel's chips. */
async function assertPanelVariants(page: Page, how: string) {
  const p = await info(await needPanelChip(page, 'Plán'), 'Plán');
  assert.equal(p.icon, 'file-text', `${how}: Plán shows the Page type icon`);
  assert.ok(!transparent(p.bg), `${how}: Plán is on the link tint (got ${p.bg})`);
  assert.deepEqual([p.suffix, p.review, p.taskState, p.unreviewedDescription], [null, null, null, false], `${how}: Plán has no suffix and no ring`);
  const hotova = await info(await needPanelChip(page, 'Hotová myšlenka'), 'Hotová myšlenka');
  assert.deepEqual([hotova.suffix, hotova.review, hotova.unreviewedDescription], [null, null, false], `${how}: Hotová myšlenka (review: reviewed) has no suffix and no ring`);
  const napadChip = await needPanelChip(page, 'Nápad na podcast');
  const napad = await info(napadChip, 'Nápad na podcast');
  assert.equal(napad.review, 'unreviewed', `${how}: Nápad na podcast has data-review="unreviewed"`);
  assert.ok(napad.unreviewedDescription, `${how}: Nápad na podcast has the accessible description "Unreviewed"`);
  assert.ok(/inset/.test(napad.shadow) && amber(/rgba?\([^)]*\)/.exec(napad.shadow)?.[0]), `${how}: an amber inset ring (got ${napad.shadow})`);
  assert.ok((await dots(napadChip)).some(([w, , bg]) => Math.abs(w - 6) <= 1 && amber(bg)), `${how}: a 6 px amber dot after the title`);
  const link = await tokenColour(page, 'link');
  const danger = await tokenColour(page, 'danger');
  const want: [string, string, string][] = [
    ['Uklidit štítky', 'To do', 'none'],
    ['Připravit poznámky', `${d('2026-10-23')} · To do`, 'none'],
    ['Projít osnovu', 'Today · In progress', 'today'],
    ['Poslat rozpočet', `${d('2026-10-16')} · To do`, 'overdue'],
    ['Zeptat se Petra', `${d('2026-10-22')} · Waiting`, 'none'],
  ];
  for (const [title, suffix, tone] of want) {
    const c = await info(await needPanelChip(page, title), title);
    assert.equal(c.suffix, suffix, `${how}: ${title}: suffix "${suffix}"`);
    assert.ok(c.divider, `${how}: ${title}: a 1 px divider before the suffix`);
    assert.ok(c.suffixDots >= 1, `${how}: ${title}: the status has a dot in its colour`);
    if (title !== 'Uklidit štítky') assert.equal(c.tone, tone, `${how}: ${title}: data-tone="${tone}" on the date`);
    if (tone === 'today') assert.ok(c.toneColour === link && c.toneWeight >= 600, `${how}: Today in the link colour, semibold (${c.toneColour} ${c.toneWeight})`);
    if (tone === 'overdue') assert.ok(c.toneColour === danger && c.toneWeight >= 600, `${how}: the overdue date in the danger colour, semibold (${c.toneColour} ${c.toneWeight})`);
  }
  const done = await info(await needPanelChip(page, 'Sebrat ceny letenek'), 'Sebrat ceny letenek');
  assert.equal(done.taskState, 'done', `${how}: Sebrat ceny letenek data-task-state="done"`);
  assert.equal(done.suffix, `${d('2026-10-18')} · Done`, `${how}: suffix <completed date> · Done (D-599)`);
  assert.ok(done.struck, `${how}: the done title is struck through`);
  assert.notEqual(done.bg, p.bg, `${how}: the done chip is on the grey tint`);
  const g = rgba(done.iconColour);
  assert.ok(!!g && g[1] > g[0] + 20 && g[1] > g[2], `${how}: a green ticked-box icon (got ${done.iconColour})`);
  const cancelled = await info(await needPanelChip(page, 'Objednat kyvadlo'), 'Objednat kyvadlo');
  assert.equal(cancelled.taskState, 'cancelled', `${how}: Objednat kyvadlo data-task-state="cancelled"`);
  assert.equal(cancelled.suffix, `${d('2026-10-17')} · Cancelled`, `${how}: suffix <completed date> · Cancelled`);
  assert.ok(cancelled.struck, `${how}: the cancelled title is struck through`);
  assert.ok(cancelled.icon !== null && cancelled.icon !== done.icon, `${how}: a crossed-box icon (${cancelled.icon}), not the done icon (${done.icon})`);
  assert.notEqual(cancelled.bg, p.bg, `${how}: the cancelled chip is grey`);
}

/** "Exactly the look of FR-LNK-07 AC-9 for the same object": each panel chip against the note chip of the same object. */
async function assertSameAsNoteChips(page: Page, how: string) {
  const keys: (keyof ChipInfo)[] = ['review', 'unreviewedDescription', 'taskState', 'suffix', 'tone', 'toneColour', 'toneWeight', 'icon', 'iconColour', 'struck', 'divider', 'bg', 'weight', 'shadow'];
  const diffs: string[] = [];
  for (const title of ALL.filter((t) => t !== LONG)) {
    const a = await info(await needPanelChip(page, title), title);
    const b = await info(await needNoteChip(page, title), title);
    for (const k of keys) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diffs.push(`${title}.${k}: panel ${JSON.stringify(a[k])} ≠ note ${JSON.stringify(b[k])}`);
  }
  assert.deepEqual(diffs, [], `${how}: every panel chip looks like the note chip of the same object`);
}

// ------------------------------------------------------------------------------------------------ FR-LNK-01 AC-22

for (const theme of ['light', 'dark'] as const) {
  test(`fr_lnk_01_ac22_panel_chips_are_link_chip_variants_${theme}`, async ({ page }) => {
    await openCil(page, theme);
    for (const t of ALL) assert.equal(await eventually(() => panelChip(page, t).count(), (n) => n === 1, 3000), 1, `${theme}: ${t}: exactly one chip (AC-17)`);
    await assertPanelVariants(page, `panel, ${theme}`);
    await assertSameAsNoteChips(page, theme);
    assert.deepEqual(await axeContrast(page), [], `${theme}: axe color-contrast passes with the panel open`);
  });
}

test('fr_lnk_01_ac22_one_line_title_truncated_suffix_whole_full_title_tooltip', async ({ page }) => {
  await openCil(page);
  const panel = await mustPanel(page);
  const pw = (await panel.boundingBox())?.width ?? 0;
  assert.ok(pw > 0 && pw <= 289, `the panel is the default 288 px wide (tabpanel ${pw})`);
  // Every chip: one line inside the panel, `title` = the full title.
  const bad: string[] = [];
  for (const t of ALL) {
    const c = await needPanelChip(page, t);
    const g = await c.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const host = (el.closest('[role="tabpanel"]') as HTMLElement).getBoundingClientRect();
      return { lines: el.getClientRects().length, inside: r.left >= host.left - 0.5 && r.right <= host.right + 0.5, title: (el.getAttribute('title') ?? '').normalize('NFC') };
    });
    if (g.lines !== 1) bad.push(`${t}: ${g.lines} lines`);
    if (!g.inside) bad.push(`${t}: overflows the panel`);
    if (g.title !== nfc(t)) bad.push(`${t}: title attribute ${JSON.stringify(g.title)}`);
  }
  assert.deepEqual(bad, [], 'each chip is one line inside the panel with its full title as tooltip');
  // The long title is truncated with an ellipsis; its suffix is whole.
  const long = await needPanelChip(page, LONG);
  const fit = await long.evaluate((el, t) => {
    const titleEl = [...el.querySelectorAll('*')].find((e) => (e.textContent ?? '').trim().normalize('NFC') === t && ![...e.children].some((k) => (k.textContent ?? '').trim().normalize('NFC') === t)) as HTMLElement | undefined;
    const suffix = el.querySelector('.chip-suffix') as HTMLElement | null;
    return {
      truncated: !!titleEl && titleEl.scrollWidth > titleEl.clientWidth, ellipsis: !!titleEl && getComputedStyle(titleEl).textOverflow === 'ellipsis',
      suffixWhole: !!suffix && suffix.scrollWidth <= suffix.clientWidth + 1, suffix: suffix ? (suffix.innerText ?? '').replace(/\s+/g, ' ').trim() : null,
    };
  }, nfc(LONG));
  assert.ok(fit.truncated && fit.ellipsis, `the long title is truncated with an ellipsis (${JSON.stringify(fit)})`);
  assert.ok(fit.suffixWhole && fit.suffix === `${d('2026-10-23')} · To do`, `the suffix is shown whole (${fit.suffix})`);
});

test('fr_lnk_01_ac22_external_status_change_updates_the_panel_chip', async ({ page }) => {
  const core = await openCil(page);
  const before = await info(await needPanelChip(page, 'Uklidit štítky'), 'Uklidit štítky');
  assert.deepEqual([before.taskState, before.suffix], ['open', 'To do'], 'Uklidit štítky starts as an open task chip');
  const path = nfc('Tasks/Uklidit štítky.md');
  const text = (await core.files())[path]!;
  await core.setFile(path, text.replace('status: To do\n', 'status: Done\n'));
  const after = await eventually(async () => info(await needPanelChip(page, 'Uklidit štítky'), 'Uklidit štítky'), (x) => x.taskState === 'done', 2000);
  assert.equal(after.taskState, 'done', 'within 2 s the panel chip is done (AC-9 timing)');
  assert.ok(after.struck, 'struck through');
  assert.ok((after.suffix ?? '').endsWith('Done'), `the suffix ends with the status Done (${after.suffix})`);
});

// ------------------------------------------------------------------------------------------------ FR-LNK-01 AC-23

/** The focus stops inside the Context panel after its Backlinks tab, as `role name`, until the focus leaves the panel. */
async function panelStopsAfterTab(page: Page): Promise<string[]> {
  const tab = await must(contextPanel(page).getByRole('tab', { name: /^Backlinks\b/ }), 'tab "Backlinks"');
  await tab.focus();
  const stops: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!a || a === document.body) return null;
      const role = a.getAttribute('role') ?? ({ A: 'link', BUTTON: 'button', H2: 'heading' } as Record<string, string>)[a.tagName] ?? a.tagName.toLowerCase();
      const name = (a.getAttribute('aria-label') ?? a.textContent ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
      return { role, name, inPanel: !!a.closest('aside[aria-label="Context panel"], [role="complementary"][aria-label="Context panel"]') };
    });
    if (!f || !f.inPanel) break;
    if (f.role === 'tab') continue; // the other tabs, if the tab list keeps them in the Tab order
    stops.push(`${f.role} ${f.name}`);
  }
  return stops;
}

test('fr_lnk_01_ac23_no_unlinked_mentions_on_cil_and_the_tab_order_is_headers_and_chips', async ({ page }) => {
  await openLinks(page, B.cil);
  const panel = await mustPanel(page);
  await must(groupHeader(page, 'Pages'), 'the Pages group header');
  assert.equal(await contextPanel(page).getByRole('button', { name: 'Unlinked mentions' }).count(), 0, 'no button "Unlinked mentions"');
  assert.equal(await contextPanel(page).getByText('Unlinked mentions').count(), 0, 'no element named "Unlinked mentions"');
  assert.ok(!flat(await panel.innerText()).includes('Coming in v1.x'), 'no "Coming in v1.x" text');
  assert.deepEqual(await panelStopsAfterTab(page), [
    'button Pages, 4', 'link Odkazy v textu', 'link Rozbité odkazy', 'link Markdown odkaz', 'link Neplatná hlavička',
    'button Quick Notes, 1', 'link Rychlá poznámka', 'button Daily Notes, 1', 'link 2026-10-07',
    'button Schůzky, 2', 'link 2026-10-08 Porada', 'link Starší porada', 'button neznámý, 1', 'link Bez typu s vlastností',
  ], "after the tab: the 5 group headers and the 9 chips in visual order, nothing else (AC-20)");
});

test('fr_lnk_01_ac23_no_unlinked_mentions_on_osamela', async ({ page }) => {
  await openLinks(page, B.osamela);
  const panel = await mustPanel(page);
  assert.equal(flat(await panel.getByRole('heading', { level: 2 }).first().innerText()), 'No backlinks yet', 'the empty state (AC-13)');
  assert.equal(await contextPanel(page).getByRole('button', { name: 'Unlinked mentions' }).count(), 0, 'no button "Unlinked mentions"');
  assert.equal(await contextPanel(page).getByText('Unlinked mentions').count(), 0, 'no element named "Unlinked mentions"');
  assert.ok(!flat(await panel.innerText()).includes('Coming in v1.x'), 'no "Coming in v1.x" text');
  assert.deepEqual(await panelStopsAfterTab(page), [], 'after the tab no stop in the panel (no headers, no chips)');
});
