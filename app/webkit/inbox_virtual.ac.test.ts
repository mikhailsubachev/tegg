// MS5 slice 5B, L5 (WebKit + fake core): virtualized Inbox cards, docs/acceptance/inbox.md FR-INB-01 AC-12 (D-586; AC-6
// Back and focus, FR-INB-02 AC-11 grid keys and AC-12 selection as context). Interface docs/contracts/ms5-capture.md §15
// item 10: at most 100 `article` cards in the page; every rendered card keeps `data-path`, its R60 name and its group,
// and has `aria-setsize` (the number of shown items) and `aria-posinset` (its 1-based place in the shown order); the
// group headings of the rendered range are rendered; a focus move to a card outside the window renders it first, then
// focuses it and scrolls it into view. The vault: the inbox fixture with its 13 members marked reviewed, plus 1,000
// synthetic unreviewed Quick Notes with distinct `captured` times, 5 minutes apart, newest at 11:55 on 14 Oct 2026
// (Prague, region cs, week from Monday 12 Oct): Today 144, Yesterday 288, Earlier this week 288, Older 280 (R61).
// Written from the ACs and the contract only (D-61). Every lookup goes through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  I, MEMBERS, callsOf, cardAt, cardNamed, click, eventually, filterBtn, filterGroup, flat, inboxHeading, inboxVault, main, markAllBtn, must,
  mustBeOn, nfc, seen, sleep, startInbox, type FakeVault,
} from './capture-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const N = 1000;
const MAX = 100;
const WORDS = ['Koupit', 'Zavolat', 'Přečíst', 'Opravit', 'Naplánovat', 'Zjistit', 'Uklidit', 'Objednat'];
type Item = { path: string; title: string; name: string; group: 'today' | 'yesterday' | 'week' | 'older' };
const GROUP_NAME = { today: 'Today', yesterday: 'Yesterday', week: 'Earlier this week', older: 'Older' } as const;
/** The 1,000 items in the shown order (newest first, R61). */
const ITEMS: Item[] = Array.from({ length: N }, (_, i) => {
  const title = nfc(`${WORDS[i % WORDS.length]} č. ${String(i + 1).padStart(4, '0')} – žluťoučký kůň`);
  const group = i <= 143 ? 'today' : i <= 431 ? 'yesterday' : i <= 719 ? 'week' : 'older';
  return { path: nfc(`Quick Notes/${title}.md`), title, name: `Quick Note: ${title}`, group };
});
const POS = new Map(ITEMS.map((it, i) => [it.path, i + 1]));
/** `captured` of item i in Prague (CEST, +02:00 all through 10…14 Oct 2026). */
function captured(i: number): string {
  const ms = Date.parse('2026-10-14T11:55:00+02:00') - i * 5 * 60_000;
  return `${new Date(ms + 2 * 3600_000).toISOString().slice(0, 19)}+02:00`;
}
function bigVault(): FakeVault {
  return inboxVault((f) => {
    for (const k of MEMBERS) {
      const p = nfc(I[k]);
      f[p] = /^review: /m.test(f[p]) ? f[p].replace(/^review: .*$/m, 'review: reviewed') : f[p].replace(/^title: (.*)$/m, (l) => `${l}\nreview: reviewed`);
    }
    ITEMS.forEach((it, i) => {
      const t = captured(i);
      const id = `01JB5B000000000000000V${String(i).padStart(4, '0')}`;
      f[it.path] = `---\nid: ${id}\ntype: quick-note\ntitle: ${it.title}\nreview: unreviewed\ncaptured: ${t}\ncreated: ${t}\nmodified: ${t}\n---\nPoznámka číslo ${i + 1}: příliš žluťoučký kůň úpěl ďábelské ódy.\n`;
    });
  });
}
async function startBig(page: Page) {
  const core = await startInbox(page, { vault: bigVault() });
  await must(cardAt(page, ITEMS[0].path), `the first card (${ITEMS[0].name})`, 10_000);
  return core;
}

type Rendered = { path: string; name: string; setsize: string | null; posinset: string | null; group: string | null };
async function rendered(page: Page): Promise<Rendered[]> {
  return main(page).evaluate((m) => ([...m.querySelectorAll('article, [role="article"]')] as HTMLElement[]).map((e) => ({
    path: (e.getAttribute('data-path') ?? '').normalize('NFC'),
    name: (e.getAttribute('aria-label') ?? '').normalize('NFC'),
    setsize: e.getAttribute('aria-setsize'),
    posinset: e.getAttribute('aria-posinset'),
    group: e.closest('[data-group]')?.getAttribute('data-group') ?? null,
  })));
}
/** The window rule (§15.10) at this moment: ≤ 100 articles, each with its R60 name, group, set size and position; the
 *  group headings of the rendered range shown. Returns the rendered cards. */
async function checkWindow(page: Page, when: string, setsize = N): Promise<Rendered[]> {
  const r = await rendered(page);
  assert.ok(r.length >= 1, `${when}: some cards are rendered`);
  assert.ok(r.length <= MAX, `${when}: at most ${MAX} cards (article) in the page, got ${r.length}`);
  const bad = r.filter((c) => {
    const p = POS.get(c.path);
    const it = p ? ITEMS[p - 1] : undefined;
    return !it || c.setsize !== String(setsize) || c.posinset !== String(p) || c.group !== it.group || (c.name !== '' && c.name !== it.name);
  });
  assert.deepEqual(bad.slice(0, 3), [], `${when}: every rendered card has aria-setsize=${setsize}, its aria-posinset, its group and its R60 name`);
  for (const g of new Set(r.map((c) => c.group))) {
    const name = GROUP_NAME[g as keyof typeof GROUP_NAME];
    assert.ok(await seen(main(page).locator(`[data-group="${g}"]`).getByRole('heading', { level: 2, name, exact: true }), 1000), `${when}: the heading "${name}" of a rendered group is shown`);
  }
  return r;
}
/** The card holding the focus: its path and whether it lies inside the visible area of its scroller and the viewport. */
async function focused(page: Page): Promise<{ path: string | null; inView: boolean }> {
  return page.evaluate(() => {
    const card = document.activeElement?.closest('article, [role="article"]') as HTMLElement | null;
    if (!card) return { path: null, inView: false };
    const r = card.getBoundingClientRect();
    let top = 0;
    let bottom = window.innerHeight;
    for (let p = card.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight) {
        const pr = p.getBoundingClientRect();
        top = Math.max(top, pr.top);
        bottom = Math.min(bottom, pr.bottom);
        break;
      }
    }
    return { path: (card.getAttribute('data-path') ?? '').normalize('NFC'), inView: r.top >= top - 1 && r.bottom <= bottom + 1 };
  });
}
/** Scrolls the card list's scroller by `step` viewports (or to the end with `'end'`); returns whether it moved. */
async function scroll(page: Page, step: number | 'end'): Promise<boolean> {
  return main(page).evaluate((m, st) => {
    const first = m.querySelector('article, [role="article"]');
    let sc: HTMLElement | null = null;
    for (let p = first?.parentElement ?? null; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight) { sc = p; break; }
    }
    sc ??= (document.scrollingElement as HTMLElement | null);
    if (!sc) return false;
    const before = sc.scrollTop;
    sc.scrollTop = st === 'end' ? sc.scrollHeight : before + sc.clientHeight * (st as number);
    return sc.scrollTop !== before;
  }, step);
}
/** Scrolls down until the card `path` is rendered (at most `rounds` steps). */
async function scrollTo(page: Page, path: string, rounds = 400): Promise<boolean> {
  for (let k = 0; k < rounds; k++) {
    if (await cardAt(page, path).count()) return true;
    await scroll(page, 0.8);
    await sleep(40);
  }
  return (await cardAt(page, path).count()) > 0;
}

// ------------------------------------------------------------------------------------------------ the window

test('fr_inb_01_ac12_at_most_100_cards_with_set_size_and_position', async ({ page }) => {
  await startBig(page);
  const r = await checkWindow(page, 'at the top');
  assert.equal(r[0]?.path, ITEMS[0].path, 'the first rendered card is the newest item');
  assert.equal(r[0]?.posinset, '1', 'aria-posinset 1');
  await must(cardNamed(page, ITEMS[0].name), `article ${ITEMS[0].name} (R60 name)`);
  // Rendered cards are consecutive in the shown order.
  const pos = r.map((c) => Number(c.posinset));
  assert.deepEqual(pos, pos.map((_, k) => pos[0] + k), 'the rendered cards are a consecutive range of the shown order');
});

test('fr_inb_01_ac12_group_headings_of_the_rendered_range', async ({ page }) => {
  await startBig(page);
  await checkWindow(page, 'at the top');
  assert.ok(await seen(main(page).getByRole('region', { name: 'Today', exact: true }), 1000), 'region Today');
  // Scroll to the boundary of Yesterday and Earlier this week: both headings are rendered with their cards.
  assert.ok(await scrollTo(page, ITEMS[432].path), `the first card of Earlier this week (${ITEMS[432].title}) is rendered after scrolling`);
  const r = await checkWindow(page, 'around Earlier this week');
  assert.ok(r.some((c) => c.group === 'week'), 'a card of Earlier this week is rendered');
  assert.ok(await seen(main(page).getByRole('region', { name: 'Earlier this week', exact: true }), 1000), 'region Earlier this week');
});

test('fr_inb_01_ac12_scrolling_to_the_end_renders_the_last_card', async ({ page }) => {
  await startBig(page);
  await checkWindow(page, 'at the top');
  const last = ITEMS[N - 1];
  let ok = false;
  for (let k = 0; k < 50 && !ok; k++) {
    await scroll(page, 'end');
    await sleep(80);
    ok = (await cardAt(page, last.path).count()) > 0;
  }
  assert.ok(ok, `scrolling to the end renders the last card (${last.title})`);
  const r = await checkWindow(page, 'at the end');
  assert.equal(r[r.length - 1]?.posinset, String(N), 'the last rendered card has aria-posinset 1000');
  assert.equal(await cardAt(page, ITEMS[0].path).count(), 0, 'the first card is no longer rendered');
  assert.ok(await seen(main(page).getByRole('region', { name: 'Older', exact: true }), 1000), 'region Older');
});

// ------------------------------------------------------------------------------------------------ keys and focus

test('fr_inb_01_ac12_arrow_down_from_the_last_rendered_card_reaches_the_next', async ({ page }) => {
  await startBig(page);
  const r = await checkWindow(page, 'at the top');
  const lastPath = r[r.length - 1].path;
  const p = POS.get(lastPath)!;
  await (await must(cardAt(page, lastPath), `the last rendered card (${lastPath})`)).focus();
  await sleep(100);
  await page.keyboard.press('ArrowDown');
  await sleep(150);
  const f = await focused(page);
  assert.ok(f.path !== null && (POS.get(f.path) ?? 0) > p, `↓ from the last rendered card (#${p}) moves the focus to a later card: #${f.path ? POS.get(f.path) : 'none'}`);
  assert.equal(f.inView, true, 'which is scrolled into view');
  await checkWindow(page, 'after ↓');
  // Walking on with ↓ through the list keeps the window rule and the focus moves forward every time.
  let at = POS.get(f.path!)!;
  for (let k = 0; k < 100; k++) {
    await page.keyboard.press('ArrowDown');
    const g = await focused(page);
    const q = g.path ? POS.get(g.path) ?? 0 : 0;
    assert.ok(q > at, `↓ #${k + 1}: the focus moves on from #${at} (now #${q})`);
    at = q;
  }
  const g = await focused(page);
  assert.equal(g.inView, true, 'the focused card is in view');
  await checkWindow(page, `after ↓ to #${at}`);
  // Space selection on a deep card.
  await page.keyboard.press('Space');
  await must(main(page).getByRole('toolbar', { name: '1 selected', exact: true }), 'toolbar "1 selected" for a deep card');
});

test('fr_inb_01_ac12_select_all_and_mark_all_reviewed_cover_the_whole_list', async ({ page }) => {
  const core = await startBig(page);
  await checkWindow(page, 'at the top');
  await (await must(cardAt(page, ITEMS[0].path), 'the first card')).focus();
  await page.keyboard.press('Meta+a');
  await must(main(page).getByRole('toolbar', { name: '1000 selected', exact: true }), '⌘A: toolbar "1000 selected" (all shown items)');
  await checkWindow(page, 'with everything selected');
  await page.keyboard.press('Escape');
  await click(markAllBtn(page), 'Mark all reviewed');
  const dlg = await must(page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: /Mark 1[\s  ,]?000 items reviewed\?/ }), 'Mark 1000 items reviewed?');
  await click(dlg.getByRole('button', { name: 'Mark reviewed', exact: true }), 'Mark reviewed');
  const calls = await eventually(() => callsOf(core, 'inbox_bulk'), (c) => c.length === 1, 3000);
  assert.equal(calls.length, 1, 'one inbox job');
  assert.deepEqual(((calls[0].args as any).paths as string[]).map(nfc).sort(), ITEMS.map((x) => x.path).sort(), 'over all 1,000 items, not only the rendered ones');
});

test('fr_inb_01_ac12_the_summary_and_the_filter_counts', async ({ page }) => {
  await startBig(page);
  await checkWindow(page, 'at the top');
  assert.ok(await seen(main(page).getByText(/^1[\s  ]?000 to review$/), 1000), 'the summary counts all 1,000 items');
  await must(filterGroup(page), 'group Filter by type');
  const labels = await filterGroup(page).getByRole('button').evaluateAll((bs) => bs.map((b) => [b.getAttribute('data-type'), b.textContent ?? '']));
  assert.deepEqual(labels.map(([k, t]) => [k, (t ?? '').replace(/\D/g, '')]), [['all', '1000'], ['quick-note', '1000']], 'All 1000, Quick Notes 1000');
  await click(filterBtn(page, 'quick-note'), 'Quick Notes');
  assert.ok(await seen(main(page).getByText(/^1[\s  ]?000 of 1[\s  ]?000 to review$/), 1000), 'with the filter');
  await checkWindow(page, 'with the Quick Notes filter');
});

test('fr_inb_01_ac12_back_after_opening_the_500th_card_focuses_it', async ({ page }) => {
  await startBig(page);
  await checkWindow(page, 'at the top');
  const it = ITEMS[499];
  assert.ok(await scrollTo(page, it.path), `the 500th card (${it.title}) is rendered after scrolling`);
  await checkWindow(page, 'around the 500th card');
  await (await must(cardAt(page, it.path), 'the 500th card')).focus();
  await page.keyboard.press('Enter');
  await mustBeOn(page, it.title, `note/${it.path}`, 3000);
  await page.keyboard.press('Meta+BracketLeft');
  await must(inboxHeading(page), 'back on inbox');
  const f = await eventually(() => focused(page), (x) => x.path === it.path && x.inView, 2000);
  assert.equal(f.path, it.path, 'the focus is on the 500th card again');
  assert.equal(f.inView, true, 'and it is in view');
  await checkWindow(page, 'after Back');
  assert.equal(flat(await cardAt(page, it.path).getAttribute('aria-posinset')), '500', 'aria-posinset 500');
});
