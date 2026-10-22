// v0.52 feedback, L5 (WebKit + fake core): the link chip variants of the `LinkChips` board. docs/acceptance/embeds.md
// FR-LNK-07 AC-9 (D-600: Unreviewed ring and dot, the task suffix, done and cancelled, one line), AC-10 (D-601: the
// fields come from `link_resolve`; chips follow an external change; no other call). Interface docs/contracts/
// ms3-shell.md §16.1 (DOM hooks on every link chip: `data-review="unreviewed"` with `aria-description` `Unreviewed`,
// `data-task-state`, the suffix `.chip-suffix` with `data-tone` on its date; tokens `--link-bg-h`, `--unrev`,
// `--unrev-ring`, `--unrev-bg`, `--chip-div`), §11.1 (`link_resolve` with `review`, `status`, `due`, `completed`).
// Written from the ACs and the contract only (D-61). Every lookup goes through `must`/node:assert (TS-I1).
// Test clock 2026-10-19T10:00:00+02:00 (a Monday), Europe/Prague, region en-US. The due dates are the R44 short date
// of the region (tasks-helpers `shortDate`), see the report (the AC writes them as `Fri 23 Oct`).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { loadFixtureVault, type FakeVault } from '../ui/test/fake-core';
import { eventually, must, mustBeOn, sleep, start, type FakeCoreHandle } from './helpers';
import { axeContrast, tokenColour } from './read-helpers';
import { shortDate } from './tasks-helpers';
import { amber, dots, luminance, rgba, transparent } from './v052-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const NOW = '2026-10-19T10:00:00+02:00';
const STAMP = '2026-10-10T09:00:00+02:00';
const nfc = (s: string) => s.normalize('NFC');
const flat = (s: string | null | undefined) => nfc((s ?? '').replace(/\s+/g, ' ').trim());
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const d = (iso: string) => shortDate(iso, 'en-US');

const LONG = 'Velmi dlouhý název úkolu o přípravě podkladů pro celoroční plánování celého týmu';
/** The AC's tasks (title — status, due, completed) plus one long title for (e). */
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
const PREHLED = 'Pages/Přehled.md';
const PRIPRAVIT = 'Tasks/Připravit poznámky.md';
const id = (n: number) => `01JB52000000000000000C${String(n).padStart(4, '0')}`;
const note = (n: number, type: string, title: string, keys: string, body = '') =>
  `---\nid: ${id(n)}\ntype: ${type}\ntitle: ${title}\n${keys}created: ${STAMP}\nmodified: ${STAMP}\n---\n${body}`;

function chipsVault(): FakeVault {
  const v = { ...loadFixtureVault('tests/fixtures/vaults/new-empty/.tegg'), name: 'Odkazy' };
  TASKS.forEach(([title, status, due, completed], i) => {
    v.files[nfc(`Tasks/${title}.md`)] = note(i + 1, 'task', title, `status: ${status}\n${due ? `due: ${due}\n` : ''}${completed ? `completed: ${completed}\n` : ''}`);
  });
  v.files[nfc('Quick Notes/Nápad na podcast.md')] = note(20, 'quick-note', 'Nápad na podcast', 'review: unreviewed\n');
  v.files[nfc('Pages/Plán.md')] = note(21, 'page', 'Plán', '');
  v.files[nfc('Quick Notes/Hotová myšlenka.md')] = note(22, 'quick-note', 'Hotová myšlenka', 'review: reviewed\n');
  const links = [...OTHERS, ...TASKS.map((t) => t[0])].map((t) => `[[${t}]]`).join(' ');
  v.files[nfc(PREHLED)] = note(23, 'page', 'Přehled', '', `Odkazy: ${links}\n`);
  return v;
}

async function openPrehled(page: Page, o: { readView?: boolean; theme?: 'light' | 'dark'; vault?: FakeVault } = {}): Promise<FakeCoreHandle> {
  await page.addInitScript(() => { (window as any).__TEGG_REGION__ = 'en-US'; });
  if (o.readView) await page.addInitScript(() => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), readView: true }; });
  await page.clock.setFixedTime(new Date(NOW));
  const vault = o.vault ?? chipsVault();
  const core = await start(page, {
    vault, last: { path: nfc(PREHLED), id: id(23) },
    uiState: { version: 1, theme: o.theme ?? 'light', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' } },
  });
  await mustBeOn(page, 'Přehled', 'landing on Přehled', 5000);
  return core;
}

const main = (page: Page) => page.getByRole('main');
/** The link chip whose text starts with `title` (chips carry `data-link-kind`, ms3-shell §11.3). */
const chip = (page: Page, title: string) => main(page).locator('[data-link-kind]').filter({ hasText: new RegExp(`^\\s*${esc(nfc(title))}`) }).first();
async function needChip(page: Page, title: string): Promise<Locator> {
  return must(chip(page, title), `link chip "${title}"`, 5000);
}

type ChipInfo = {
  review: string | null; description: string; taskState: string | null; suffix: string | null; tone: string | null; toneColour: string | null; toneWeight: number;
  bg: string; weight: number; shadow: string; icon: string | null; iconColour: string | null; struck: boolean; divider: boolean; suffixDots: number;
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
      review: el.getAttribute('data-review'), description, taskState: el.getAttribute('data-task-state'),
      suffix: suffix ? (suffix.innerText ?? '').replace(/\s+/g, ' ').trim().normalize('NFC') : null,
      tone: tone?.getAttribute('data-tone') ?? null, toneColour: tone ? getComputedStyle(tone).color : null, toneWeight: tone ? Number(getComputedStyle(tone).fontWeight) || 400 : 0,
      bg: s.backgroundColor, weight: Number(s.fontWeight) || 400, shadow: s.boxShadow, icon: icon?.getAttribute('data-icon') ?? null,
      iconColour: icon ? getComputedStyle(icon).color : null, struck, divider, suffixDots,
    };
  }, nfc(title));
}

/** (a)…(d) of FR-LNK-07 AC-9 in the current view and theme. */
async function assertVariants(page: Page, how: string, theme: 'light' | 'dark') {
  // (a) a plain chip.
  const plan = await needChip(page, 'Plán');
  const p = await info(plan, 'Plán');
  assert.equal(p.icon, 'file-text', `${how}: Plán shows the Page type icon`);
  assert.ok(!transparent(p.bg), `${how}: Plán is on the link tint (got ${p.bg})`);
  assert.ok(p.weight < 500, `${how}: Plán at regular weight (got ${p.weight})`);
  assert.deepEqual([p.suffix, p.review, p.taskState], [null, null, null], `${how}: Plán has no suffix, no review or task state`);
  // (b) Unreviewed.
  const napad = await info(await needChip(page, 'Nápad na podcast'), 'Nápad na podcast');
  assert.equal(napad.review, 'unreviewed', `${how}: Nápad na podcast has data-review="unreviewed"`);
  assert.ok(napad.description.split(/\s+/).includes('Unreviewed') || napad.description.includes('Unreviewed'), `${how}: accessible description "Unreviewed" (got "${napad.description}")`);
  assert.ok(/inset/.test(napad.shadow) && amber(/rgba?\([^)]*\)/.exec(napad.shadow)?.[0]), `${how}: a 1 px amber inset ring (got ${napad.shadow})`);
  const napadDots = (await dots(await needChip(page, 'Nápad na podcast'))).filter(([w, , bg]) => Math.abs(w - 6) <= 1 && amber(bg));
  assert.ok(napadDots.length >= 1, `${how}: a 6 px amber dot after the title`);
  const hotova = await info(await needChip(page, 'Hotová myšlenka'), 'Hotová myšlenka');
  assert.equal(hotova.review, null, `${how}: Hotová myšlenka (review: reviewed) has no data-review`);
  assert.ok(!hotova.description.includes('Unreviewed'), `${how}: Hotová myšlenka has no "Unreviewed" description`);
  // (c) task suffixes.
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
    const c = await info(await needChip(page, title), title);
    assert.equal(c.suffix, suffix, `${how}: ${title}: suffix "${suffix}"`);
    assert.ok(c.divider, `${how}: ${title}: a 1 px divider before the suffix`);
    assert.ok(c.suffixDots >= 1, `${how}: ${title}: the status has a dot in its colour`);
    if (title !== 'Uklidit štítky') assert.equal(c.tone, tone, `${how}: ${title}: data-tone="${tone}" on the date`);
    if (tone === 'today') assert.ok(c.toneColour === link && c.toneWeight >= 600, `${how}: Today in the link colour, semibold (${c.toneColour} ${c.toneWeight})`);
    if (tone === 'overdue') assert.ok(c.toneColour === danger && c.toneWeight >= 600, `${how}: the overdue date in the danger colour, semibold (${c.toneColour} ${c.toneWeight})`);
  }
  // (d) done and cancelled.
  const done = await info(await needChip(page, 'Sebrat ceny letenek'), 'Sebrat ceny letenek');
  assert.equal(done.taskState, 'done', `${how}: Sebrat ceny letenek data-task-state="done"`);
  assert.equal(done.suffix, `${d('2026-10-18')} · Done`, `${how}: suffix <completed date> · Done (D-599)`);
  assert.ok(done.struck, `${how}: the done title is struck through`);
  assert.notEqual(done.bg, p.bg, `${how}: the done chip is on the grey tint, not the link tint`);
  const g = rgba(done.iconColour);
  assert.ok(!!g && g[1] > g[0] + 20 && g[1] > g[2], `${how}: a green ticked-box icon (got ${done.iconColour})`);
  const cancelled = await info(await needChip(page, 'Objednat kyvadlo'), 'Objednat kyvadlo');
  assert.equal(cancelled.taskState, 'cancelled', `${how}: Objednat kyvadlo data-task-state="cancelled"`);
  assert.equal(cancelled.suffix, `${d('2026-10-17')} · Cancelled`, `${how}: suffix <completed date> · Cancelled`);
  assert.ok(cancelled.struck, `${how}: the cancelled title is struck through`);
  assert.ok(cancelled.icon !== null && cancelled.icon !== done.icon, `${how}: a crossed-box icon (${cancelled.icon}), not the done icon (${done.icon})`);
  assert.notEqual(cancelled.bg, p.bg, `${how}: the cancelled chip is grey`);
  // Hover darkens the tint (`--link-bg-h`).
  await plan.hover();
  const hovered = await eventually(async () => (await info(plan, 'Plán')).bg, (b) => b !== p.bg, 1000);
  assert.notEqual(hovered, p.bg, `${how}: hovering Plán changes its tint`);
  if (theme === 'light') assert.ok(luminance(hovered) < luminance(p.bg), `${how}: the hover tint is darker (${p.bg} → ${hovered})`);
}

for (const view of ['editor', 'read'] as const) {
  test(`fr_lnk_07_ac9_link_chip_variants_${view}`, async ({ page }) => {
    await openPrehled(page, { readView: view === 'read' });
    await assertVariants(page, view, 'light');
    // (e) one line in a 320 px wide column: the title is truncated with an ellipsis, the suffix is shown whole.
    const long = await needChip(page, LONG);
    const fit = await long.evaluate((el, t) => {
      const host = el.closest('p') as HTMLElement | null ?? el.parentElement!;
      host.style.width = '320px';
      host.style.maxWidth = '320px';
      const titleEl = [...el.querySelectorAll('*')].find((e) => (e.textContent ?? '').trim().normalize('NFC') === t) as HTMLElement | undefined;
      const suffix = el.querySelector('.chip-suffix') as HTMLElement | null;
      return {
        lines: el.getClientRects().length, chipWidth: el.getBoundingClientRect().width,
        truncated: !!titleEl && titleEl.scrollWidth > titleEl.clientWidth, ellipsis: !!titleEl && getComputedStyle(titleEl).textOverflow === 'ellipsis',
        suffixWhole: !!suffix && suffix.scrollWidth <= suffix.clientWidth + 1, suffix: suffix ? (suffix.innerText ?? '').replace(/\s+/g, ' ').trim() : null,
      };
    }, nfc(LONG));
    assert.equal(fit.lines, 1, `${view}: the long chip stays on one line`);
    assert.ok(fit.chipWidth <= 321, `${view}: the chip fits the 320 px column (${fit.chipWidth})`);
    assert.ok(fit.truncated && fit.ellipsis, `${view}: the long title is truncated with an ellipsis`);
    assert.ok(fit.suffixWhole && fit.suffix === `${d('2026-10-23')} · To do`, `${view}: the suffix is shown whole (${fit.suffix})`);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`fr_lnk_07_ac9_both_themes_and_contrast_${theme}`, async ({ page }) => {
    await openPrehled(page, { theme });
    await assertVariants(page, `editor, ${theme}`, theme);
    for (const t of ['--link-bg-h', '--unrev', '--unrev-ring', '--unrev-bg', '--chip-div']) {
      assert.ok(await page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() !== '', t), `${theme}: token ${t} is defined`);
    }
    assert.deepEqual(await axeContrast(page), [], `${theme}: axe color-contrast passes`);
  });
}

// ------------------------------------------------------------------------------------------------ FR-LNK-07 AC-10 (L5)

test('fr_lnk_07_ac10_the_fields_come_from_link_resolve_and_follow_an_external_change', async ({ page }) => {
  const core = await openPrehled(page);
  await needChip(page, 'Připravit poznámky');
  await sleep(500);
  const calls = await core.calls();
  const lr = calls.filter((c) => c.cmd === 'link_resolve' && nfc(String((c.args as any)?.from ?? '')) === nfc(PREHLED));
  assert.equal(lr.length, 1, 'one link_resolve call for Přehled');
  const targets = ((lr[0].args as any)?.targets ?? []) as string[];
  const res = (lr[0].result ?? []) as any[];
  const of = (t: string) => res[targets.findIndex((x) => nfc(x) === nfc(t))] ?? {};
  const pick = (r: any) => ({ status: r.status, due: r.due, completed: r.completed, review: r.review });
  assert.deepEqual(pick(of('Připravit poznámky')), { status: 'To do', due: '2026-10-23', completed: null, review: null }, 'Připravit poznámky: status, due, completed, review (D-601)');
  assert.equal(of('Nápad na podcast').review, 'unreviewed', 'Nápad na podcast: review "unreviewed"');
  // The chip is drawn from those fields …
  const before = await info(await needChip(page, 'Připravit poznámky'), 'Připravit poznámky');
  assert.deepEqual([before.taskState, before.suffix], ['open', `${d('2026-10-23')} · To do`], 'the chip shows the task suffix from link_resolve');
  // … and no other IPC call reads the targets to draw the chips.
  const targetPaths = new Set([...TASKS.map((t) => nfc(`Tasks/${t[0]}.md`)), nfc('Quick Notes/Nápad na podcast.md'), nfc('Pages/Plán.md'), nfc('Quick Notes/Hotová myšlenka.md')]);
  const extra = calls.filter((c) => c.cmd !== 'link_resolve' && [((c.args as any)?.path ?? ''), ...(((c.args as any)?.paths ?? []) as string[])].some((p: string) => targetPaths.has(nfc(String(p)))));
  assert.deepEqual(extra.map((c) => c.cmd), [], 'no other call reads a chip target');
  // An external change of the task updates its chip within 2 s.
  const text = (await core.files())[nfc(PRIPRAVIT)]!;
  await core.setFile(PRIPRAVIT, text.replace('status: To do\n', 'status: Done\ncompleted: 2026-10-18T09:30:00+02:00\n'));
  const after = await eventually(async () => info(await needChip(page, 'Připravit poznámky'), 'Připravit poznámky'), (x) => x.taskState === 'done', 2000);
  assert.deepEqual([after.taskState, after.suffix], ['done', `${d('2026-10-18')} · Done`], 'within 2 s the chip is done with the completion date');

});
