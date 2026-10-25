// Preview v0.68 feedback, L5 (WebKit + fake core): Backlinks panel chips wrap (D-764, amends D-633's "one line,
// truncated"; docs/feedback/ms6-v068.md F11). docs/acceptance/backlinks.md FR-LNK-01 AC-25 (wrapping chips) and AC-26
// (the windowed list with wrapped chips). The vaults are synthetic and written here, as in panel_chips.ac.test.ts:
// AC-25 is AC-22's vault plus a long Page and `Poslat rozpočet` under its long title; AC-26 has 300 sources whose
// titles alternate between 10 and 120 characters (fake-core extension: none needed, the fake answers `index_backlinks`
// for any vault). Test clock 2026-10-19T10:00:00+02:00, Europe/Prague, region en-US. Written from the ACs only (D-61);
// every lookup goes through `must`/node:assert (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { loadFixtureVault, type FakeVault } from '../ui/test/fake-core';
import { eventually, must, mustBeOn, sleep, start } from './helpers';
import { backlinksPanel, mustPanel, panelChips } from './links-helpers';
import { axeContrast } from './read-helpers';
import { shortDate } from './tasks-helpers';
import { esc, nfc } from './v068-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const NOW = '2026-10-19T10:00:00+02:00';
const STAMP = '2026-10-10T09:00:00+02:00';
const CIL = 'Pages/Cíl panelu.md';
const LONG_PAGE = 'Velmi dlouhý název stránky, který se rozhodně nevejde na jeden řádek panelu zpětných odkazů';
const LONG_TASK = 'Poslat rozpočet za čtvrté čtvrtletí všem vedoucím oddělení';
const TASKS: [string, string, string | null, string | null][] = [
  ['Uklidit štítky', 'To do', null, null],
  ['Připravit poznámky', 'To do', '2026-10-23', null],
  ['Projít osnovu', 'In progress', '2026-10-19', null],
  [LONG_TASK, 'To do', '2026-10-16', null], // AC-22's `Poslat rozpočet`, renamed by the test (AC-25)
  ['Zeptat se Petra', 'Waiting', '2026-10-22', null],
  ['Sebrat ceny letenek', 'Done', '2026-10-17', '2026-10-18T09:00:00+02:00'],
  ['Objednat kyvadlo', 'Cancelled', null, '2026-10-17T16:00:00+02:00'],
];
const id = (n: number) => `01JB76400000000000000C${String(n).padStart(4, '0')}`;
const note = (n: number, type: string, title: string, keys: string, body: string) =>
  `---\nid: ${id(n)}\ntype: ${type}\ntitle: ${title}\n${keys}created: ${STAMP}\nmodified: ${STAMP}\n---\n${body}`;
const LINK = 'Viz [[Cíl panelu]].\n';

function wrapVault(): FakeVault {
  const v = { ...loadFixtureVault('tests/fixtures/vaults/new-empty/.tegg'), name: 'Panel' };
  TASKS.forEach(([title, status, due, completed], i) => {
    v.files[nfc(`Tasks/${title}.md`)] = note(i + 1, 'task', title, `status: ${status}\n${due ? `due: ${due}\n` : ''}${completed ? `completed: ${completed}\n` : ''}`, LINK);
  });
  v.files[nfc('Quick Notes/Nápad na podcast.md')] = note(20, 'quick-note', 'Nápad na podcast', 'review: unreviewed\n', LINK);
  v.files[nfc('Quick Notes/Hotová myšlenka.md')] = note(21, 'quick-note', 'Hotová myšlenka', 'review: reviewed\n', LINK);
  v.files[nfc('Pages/Plán.md')] = note(22, 'page', 'Plán', '', LINK);
  v.files[nfc(`Pages/${LONG_PAGE}.md`)] = note(24, 'page', LONG_PAGE, '', LINK);
  v.files[nfc(CIL)] = note(23, 'page', 'Cíl panelu', '', 'Cíl.\n');
  return v;
}
/** AC-26: 300 Pages linking Cíl panelu, titles alternating 10 and 120 characters. */
const shortTitle = (i: number) => `Krátký ${String(i).padStart(3, '0')}`; // 10 characters
function longTitle(i: number): string {
  const base = `Dlouhý zdroj ${String(i).padStart(3, '0')} o čtení, psaní a přepisování poznámek `;
  let t = base;
  while (t.length < 120) t += 'žluťoučký kůň ';
  return t.slice(0, 120).replace(/\s+$/, 'x').padEnd(120, 'x');
}
const MANY = Array.from({ length: 300 }, (_, i) => (i % 2 === 0 ? shortTitle(i) : longTitle(i)));
function manyVault(): FakeVault {
  const v = { ...loadFixtureVault('tests/fixtures/vaults/new-empty/.tegg'), name: 'Panel' };
  MANY.forEach((t, i) => { v.files[nfc(`Pages/${t}.md`)] = note(100 + i, 'page', t, '', LINK); });
  v.files[nfc(CIL)] = note(23, 'page', 'Cíl panelu', '', 'Cíl.\n');
  return v;
}

async function openCil(page: Page, vault: FakeVault, theme: 'light' | 'dark' = 'light') {
  await page.addInitScript(() => { (window as any).__TEGG_REGION__ = 'en-US'; });
  await page.clock.setFixedTime(new Date(NOW));
  await page.setViewportSize({ width: 1440, height: 900 });
  const core = await start(page, { vault, last: { path: nfc(CIL), id: id(23) }, uiState: { version: 1, theme, sidebarOpen: true, rightPanel: { open: true, tab: 'backlinks' } } });
  await mustBeOn(page, 'Cíl panelu', 'landing on Cíl panelu', 5000);
  await mustPanel(page);
  return core;
}
const chip = (page: Page, title: string) =>
  backlinksPanel(page).locator('[data-link-kind="note"]').filter({ hasText: new RegExp(`^\\s*${esc(nfc(title))}`) });

/** The lines a chip's title text occupies (distinct line tops of its text), its icon and first line, its suffix lines. */
async function geometry(c: Locator, title: string) {
  return c.evaluate((el, t) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Text | null = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n.textContent ?? '').trim().normalize('NFC') === t) { node = n as Text; break; }
    const tops = (n: Node | null) => {
      if (!n) return [] as number[];
      const r = document.createRange();
      r.selectNodeContents(n);
      return [...new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top)))];
    };
    const lines = tops(node);
    const first = node ? (() => { const r = document.createRange(); r.selectNodeContents(node!); return [...r.getClientRects()].filter((x) => x.width > 0)[0] ?? null; })() : null;
    const titleEl = node?.parentElement ?? null;
    const icon = el.querySelector('svg[data-icon]')?.getBoundingClientRect() ?? null;
    const suffix = el.querySelector('.chip-suffix') as HTMLElement | null;
    const host = el.closest('[role="tabpanel"]') as HTMLElement;
    const hs = getComputedStyle(host);
    const hr = host.getBoundingClientRect();
    const cr = el.getBoundingClientRect();
    return {
      lines: lines.length, visibleTitle: (el as HTMLElement).innerText.replace(/\s+/g, ' ').includes(t),
      ellipsis: !!titleEl && getComputedStyle(titleEl).textOverflow === 'ellipsis',
      clipped: !!titleEl && titleEl.scrollWidth > titleEl.clientWidth + 1,
      iconInFirstLine: !!icon && !!first && icon.top + icon.height / 2 >= first.top - 1 && icon.top + icon.height / 2 <= first.bottom + 1,
      suffix: suffix ? (suffix.innerText ?? '').replace(/\s+/g, ' ').trim() : null,
      // Lines of the suffix's text (the 6 px status dot and the 12 px divider sit mid-line, so element boxes don't count).
      suffixLines: suffix ? (() => {
        const w = document.createTreeWalker(suffix, NodeFilter.SHOW_TEXT);
        const ts = new Set<number>();
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          if (!(n.textContent ?? '').trim()) continue;
          const r = document.createRange();
          r.selectNodeContents(n);
          for (const x of r.getClientRects()) if (x.width > 0) ts.add(Math.round(x.bottom));
        }
        return ts.size;
      })() : 0,
      inside: cr.right <= hr.right - parseFloat(hs.paddingRight) + 0.5 && cr.left >= hr.left - 0.5,
      tooltip: (el.getAttribute('title') ?? '').normalize('NFC'),
    };
  }, nfc(title));
}

// ------------------------------------------------------------------------------------------------ AC-25

for (const theme of ['light', 'dark'] as const) {
  test(`fr_lnk_01_ac25_chips_wrap_inside_the_panel_${theme}`, async ({ page }) => {
    await openCil(page, wrapVault(), theme);
    const panel = await mustPanel(page);
    const pw = (await panel.boundingBox())?.width ?? 0;
    assert.ok(pw > 0 && pw <= 289, `the panel is 288 px wide (${pw})`);
    for (const t of [LONG_PAGE, LONG_TASK, 'Plán']) await must(chip(page, t), `panel chip "${t}"`, 5000);
    // One chip per line: every chip starts below the previous one's bottom.
    const rows = await panelChips(backlinksPanel(page)).evaluateAll((cs) => cs.map((c) => { const r = c.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, name: c.getAttribute('title') ?? '' }; }));
    const shared = rows.slice(1).filter((r, i) => r.top < rows[i].bottom - 0.5).map((r) => r.name);
    assert.deepEqual(shared, [], 'each chip is on its own line');
    const long = await geometry(chip(page, LONG_PAGE), LONG_PAGE);
    assert.ok(!long.ellipsis && !long.clipped && long.visibleTitle, `the long Page title is not truncated (${JSON.stringify(long)})`);
    assert.ok(long.lines >= 2, `the long Page title wraps onto ≥ 2 lines (${long.lines})`);
    assert.ok(long.inside, 'the long chip stays inside the panel');
    assert.ok(long.iconInFirstLine, 'its icon is top-aligned with the first line');
    assert.equal(long.tooltip, nfc(LONG_PAGE), 'the tooltip is the full title');
    const task = await geometry(chip(page, LONG_TASK), LONG_TASK);
    assert.equal(task.suffix, `${shortDate('2026-10-16', 'en-US')} · To do`, 'the R44 suffix');
    assert.equal(task.suffixLines, 1, 'the suffix is on one line, never split from its separator');
    assert.ok(task.inside && !task.ellipsis && !task.clipped, `the long task chip wraps inside the panel (${JSON.stringify(task)})`);
    assert.equal(task.tooltip, nfc(LONG_TASK), 'the task tooltip is the full title');
    const plan = await geometry(chip(page, 'Plán'), 'Plán');
    assert.equal(plan.lines, 1, 'a short title keeps one line');
    assert.deepEqual(await axeContrast(page), [], `${theme}: axe color-contrast passes`);
  });
}

// ------------------------------------------------------------------------------------------------ AC-26

test('fr_lnk_01_ac26_windowed_list_with_wrapped_chips', async ({ page }) => {
  test.setTimeout(120_000);
  await openCil(page, manyVault());
  const panel = await mustPanel(page, 'tabpanel "Backlinks" with 300 sources');
  await must(panelChips(backlinksPanel(page)), 'the first chips', 5000);
  // The scroller: the tabpanel or the element inside it that scrolls.
  const scroll = async (to: 'end' | 'top' | number) => panel.evaluate((p, w) => {
    const all = [p, ...p.querySelectorAll('*')] as HTMLElement[];
    const s = all.find((e) => e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY)) ?? p;
    s.scrollTop = w === 'end' ? s.scrollHeight : w === 'top' ? 0 : w;
    const r = s.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, scrollTop: s.scrollTop, max: s.scrollHeight - s.clientHeight, page: s.clientHeight };
  }, to);
  const state = async () => panelChips(backlinksPanel(page)).evaluateAll((cs) => cs.map((c) => {
    const r = c.getBoundingClientRect();
    return { name: (c.getAttribute('title') ?? '').normalize('NFC'), top: r.top, bottom: r.bottom };
  }));
  // Wrapped chips are the premise (D-764): a 120-character title spans at least two lines.
  const firstLong = MANY[1];
  const g = await geometry(await must(chip(page, firstLong), `chip "${firstLong.slice(0, 20)}…"`, 3000), firstLong);
  assert.ok(g.lines >= 2, `a 120-character title wraps (${g.lines} lines)`);
  const seen = new Set<string>();
  let most = 0;
  const overlaps: string[] = [];
  let s = await scroll('top');
  for (let i = 0; i < 400; i++) {
    await sleep(60);
    const cs = await state();
    most = Math.max(most, cs.length);
    cs.forEach((c) => seen.add(c.name));
    cs.slice(1).forEach((c, k) => { if (c.top < cs[k].bottom - 0.5) overlaps.push(`${cs[k].name.slice(0, 15)} / ${c.name.slice(0, 15)}`); });
    if (s.scrollTop >= s.max - 1) break;
    s = await scroll(s.scrollTop + Math.max(40, s.page / 2));
  }
  s = await scroll('end');
  await sleep(200);
  s = await scroll('end'); // measured heights may have changed the total
  await sleep(200);
  const end = await state();
  assert.deepEqual(overlaps.slice(0, 5), [], 'no two consecutive entries overlap');
  assert.equal(seen.size, 300, `every source is reachable by scrolling (${seen.size})`);
  assert.ok(most > 0 && most <= 100, `at most 100 entries in the DOM (${most})`);
  const last = end[end.length - 1];
  assert.ok(last && last.top >= s.top - 0.5 && last.bottom <= s.bottom + 0.5, `the last chip is fully shown at the end (${JSON.stringify({ last, s })})`);
  await scroll('top');
  const header = backlinksPanel(page).getByRole('button', { name: /^Pages, 300$/ });
  const top = await eventually(async () => {
    const h = await header.first().boundingBox().catch(() => null);
    return h ? h.y - (await scroll('top')).top : null;
  }, (v) => v !== null && v >= -0.5 && v <= 48, 2000);
  assert.ok(top !== null && top >= -0.5 && top <= 48, `back at the top the group header "Pages, 300" is at the top (${top})`);
});
