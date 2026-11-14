// Slice OL, L5 (WebKit + fake core): accessibility, motion, themes, strings, the rail switch and the no-write tour
// (docs/acceptance/outline.md): FR-UX-08 AC-21 (names and states for VoiceOver), AC-22 (Reduce motion, and the motion
// without it), FR-UX-05 AC-22 (axe `color-contrast` and no colour leaks in light and dark, token use), NFR-OTH-02 AC-19
// (the pseudo-locale wraps every string but heading texts), FR-SET-02 AC-10 (`Show outline rail` in Settings ›
// Appearance) and FR-SYN-06 AC-46 (the tour writes nothing; the fake core counts 0 write commands). D-1675: no Outline
// tab; the outline is observed in the rail's card. Interface
// docs/contracts/v1-outline.md §3.4, §3.6, §3.7, §5, §6, §7, §9; helpers outline-helpers.ts. Written from the ACs and the
// contract only (D-61). Every lookup goes through `must` and node:assert (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { axeContrast, colourLeaks } from './read-helpers';
import {
  P, ZONE, animationsOf, another, backlinksTab, card, cardRowAt, cardRowFor, cardRows, cardTree, eventually, flat, graphTab, headingEl, jumpVia, mainScroll,
  must, noteRoute, openCardByHover, outlineRows, paletteDialog, paletteOptions, pauseClock, pointerToNote, rail, recordFrames, frames, runCommand, runFor,
  scrollHeadingTo, separator, setScroll, sleep, startOutline, tokenColor, uiSets, vaultWrites, mustBeOn, goToQuery, TITLE,
} from './outline-helpers';

test.use({ timezoneId: ZONE, locale: 'cs-CZ' });

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-21

/** Plán's rows with aria-level, aria-setsize, aria-posinset among siblings (README). */
const PLAN_ARIA: [string, number, number, number][] = [
  ['Cíle', 1, 3, 1], ['Co od toho chceme', 2, 2, 1], ['Kdo jede', 2, 2, 2], ['Program', 1, 3, 2], ['Den 1', 2, 2, 1], ['Ráno: strategie', 3, 2, 1],
  ['Odpoledne: plán', 3, 2, 2], ['Den 2', 2, 2, 2], ['Logistika', 1, 3, 3], ['Cesta', 2, 2, 1], ['Rozpočet', 2, 2, 2],
];

test('fr_ux_08_ac21_outline_voiceover', async ({ page }) => {
  await startOutline(page, noteRoute(P.plan));
  assert.equal(await (await must(rail(page), 'the rail')).getAttribute('aria-hidden'), 'true', 'the rail is aria-hidden="true"');
  await scrollHeadingTo(page, 'Den 1', 4);
  await openCardByHover(page);
  const d = await must(card(page), 'the card: a dialog Outline');
  assert.equal(await d.getAttribute('aria-modal'), null, 'without aria-modal');
  const tree = await must(cardTree(page), 'containing a tree Outline');
  assert.equal(await tree.getAttribute('aria-label'), 'Outline', 'the tree is labelled Outline');
  const r = await eventually(() => cardRows(page), (x) => x.length === 11 && x.some((y) => y.current === 'location'));
  assert.deepEqual(r.map((x) => [x.label, Number(x.level), Number(x.setsize), Number(x.posinset)]), PLAN_ARIA, 'each treeitem: its heading text, aria-level = depth, aria-setsize and aria-posinset among its siblings');
  assert.deepEqual(r.filter((x) => x.expanded !== null).map((x) => x.label), ['Cíle', 'Program', 'Den 1', 'Logistika'], 'aria-expanded on headings with children');
  assert.deepEqual(r.filter((x) => x.current).map((x) => [x.label, x.current]), [['Den 1', 'location']], 'aria-current="location" on the current row');
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-22

test('fr_ux_08_ac22_outline_reduce_motion', async ({ page }) => {
  await startOutline(page, noteRoute(P.cten), { reducedMotion: 'reduce' });
  await eventually(() => outlineRows(page), (r) => r.length > 0);
  await setScroll(page, 0);
  const target = await cardRowFor(page, 'Zpoždění replikace');
  await recordFrames(page);
  await pauseClock(page);
  await target.click();
  await runFor(page, 20);
  const hd = headingEl(page, 'Zpoždění replikace');
  assert.ok(await hd.evaluate((e) => e.hasAttribute('data-outline-flash')), 'a jump: data-outline-flash');
  assert.equal(await hd.evaluate((e) => getComputedStyle(e).transitionDuration.split(',').every((x) => parseFloat(x) === 0)), true, 'with transition-duration 0s');
  const end = (await mainScroll(page)).top;
  assert.ok((await frames(page)).every((x) => Math.abs(x) <= 1 || Math.abs(x - end) <= 1), 'the jump\'s scroll is instant');
  await runFor(page, 1880);
  assert.ok(await hd.evaluate((e) => e.hasAttribute('data-outline-flash')), 'still at 1,900 ms');
  await runFor(page, 220);
  assert.deepEqual(await hd.evaluate((e) => [e.hasAttribute('data-outline-flash'), e.hasAttribute('data-outline-fade'), getComputedStyle(e).backgroundColor]), [false, false, 'rgba(0, 0, 0, 0)'],
    'at 2,100 ms the background is removed at once (no fade)');
  await page.clock.resume();
  // Chevrons (the card's).
  await setScroll(page, 0);
  await sleep(150);
  const uvod = await cardRowFor(page, 'Úvod');
  await uvod.locator('[data-outline-chevron]').click();
  assert.deepEqual(await animationsOf(uvod.locator('[data-outline-chevron]')), [], 'toggling a chevron runs no rotation transition');
  // The rail, hidden and shown again (focus mode).
  await pointerToNote(page);
  await page.keyboard.press('Meta+Shift+Backslash');
  assert.deepEqual(await animationsOf(rail(page)), [], 'hiding the rail runs no animation');
  await page.keyboard.press('Meta+Shift+Backslash');
  await must(rail(page), 'the rail');
  assert.deepEqual(await animationsOf(rail(page)), [], 'showing the rail runs no animation');
  // Without Reduce motion.
  const { p } = await another(page, noteRoute(P.cten));
  await eventually(() => outlineRows(p), (r) => r.length > 0);
  const t2 = await cardRowFor(p, 'Zpoždění replikace');
  await pauseClock(p);
  await t2.click();
  await runFor(p, 2010);
  const h2 = headingEl(p, 'Zpoždění replikace');
  assert.ok(await h2.evaluate((e) => e.hasAttribute('data-outline-fade')), 'without Reduce motion: data-outline-fade after the flash');
  // The fades are checked as declared plus their end state, not caught mid-way in real time (D-1656).
  assert.equal(await declaredMs(h2, /^(background|background-color|all)$/), 300, 'the background fade is declared over 300 ms');
  await p.clock.resume();
  assert.equal(await eventually(() => h2.evaluate((e) => getComputedStyle(e).backgroundColor), (b) => b === 'rgba(0, 0, 0, 0)', 2000), 'rgba(0, 0, 0, 0)', 'and ends transparent');
  await setScroll(p, 0);
  await sleep(150);
  const u2 = await cardRowFor(p, 'Úvod');
  await u2.locator('[data-outline-chevron]').click();
  assert.ok((await animationsOf(u2.locator('[data-outline-chevron]'))).some((a) => a.prop === 'transform' && a.ms === 120), 'the chevron rotates over 120 ms');
  await pointerToNote(p);
  await p.keyboard.press('Meta+Shift+Backslash');
  await sleep(200);
  await p.keyboard.press('Meta+Shift+Backslash');
  const r = await must(rail(p), 'the rail shows again after focus mode');
  assert.equal(await declaredMs(r, /^(opacity|all)$/), 150, 'the rail fades over 150 ms (declared opacity transition)');
  assert.equal(await eventually(() => r.evaluate((e) => Number(getComputedStyle(e).opacity)), (o) => o === 1, 1000), 1, 'and ends at opacity 1');
});

/** The duration (ms) of the computed transition whose property matches `prop`, or 0 when none is declared. */
async function declaredMs(loc: Locator, prop: RegExp): Promise<number> {
  return loc.first().evaluate((e, src) => {
    const re = new RegExp(src);
    const cs = getComputedStyle(e);
    const props = cs.transitionProperty.split(',').map((x) => x.trim());
    const durs = cs.transitionDuration.split(',').map((x) => x.trim());
    const i = props.findIndex((x) => re.test(x));
    if (i < 0) return 0;
    const d = durs[i % durs.length] ?? '0s';
    return Math.round(d.endsWith('ms') ? parseFloat(d) : parseFloat(d) * 1000);
  }, prop.source);
}

// ------------------------------------------------------------------------------------------------ FR-UX-05 AC-22

for (const theme of ['light', 'dark'] as const) {
  test(`fr_ux_05_ac22_outline_in_light_and_dark_${theme}`, async ({ page }) => {
    const check = async (p: Page, what: string) => {
      await p.waitForFunction(() => document.getAnimations().every((x) => x.playState !== 'running'), undefined, { timeout: 3000 }).catch(() => {});
      assert.deepEqual(await axeContrast(p), [], `${theme}, ${what}: axe color-contrast`);
      assert.deepEqual(await colourLeaks(p, theme), [], `${theme}, ${what}: only theme tokens (FR-UX-05 AC-5)`);
    };
    await startOutline(page, noteRoute(P.plan), { theme });
    await scrollHeadingTo(page, 'Den 1', 4);
    const cestaRow = await cardRowFor(page, 'Cesta');
    await cestaRow.hover();
    await sleep(150);
    await check(page, 'Plán with the card and a row hovered');
    const [text, hover, muted, faint, linkBg, pop, border] = await Promise.all(['--text', '--hover', '--muted', '--faint', '--link-bg', '--pop', '--border'].map((t) => tokenColor(page, t)));
    const r = await cardRows(page);
    const cur = r.find((x) => x.current === 'location');
    assert.equal(cur?.color, text, 'the current text is --text');
    assert.equal(await cardRowAt(page, cur!.index).evaluate((e) => getComputedStyle(e, '::before').backgroundColor), text, 'the current bar is --text');
    assert.equal(r.find((x) => x.label === 'Cesta')?.bg, hover, 'the hover row is --hover');
    const { p: a } = await another(page, noteRoute(P.arch), { theme });
    await openCardByHover(a);
    const ar = await eventually(() => cardRows(a), (x) => x.length === 18);
    for (const t of ['Názvy souborů', 'Časová pásma', 'Přejmenování']) if (ar.find((x) => x.label === t)?.current !== 'location') assert.equal(ar.find((x) => x.label === t)?.color, muted, `${t} (level 5–6) is --muted`);
    await check(a, 'Architektura\'s card');
    const { p: c } = await another(page, noteRoute(P.cten), { theme, panel: null });
    await must(rail(c), 'the rail');
    await scrollHeadingTo(c, 'Zpoždění replikace', 4);
    await openCardByHover(c);
    await check(c, 'the rail and the card on Čtenářské');
    const cs = await card(c).evaluate((d) => [getComputedStyle(d).backgroundColor, getComputedStyle(d).borderTopColor, getComputedStyle(d).boxShadow]);
    assert.equal(cs[0], pop, 'the card uses --pop');
    assert.equal(cs[1], border, 'and --border');
    assert.notEqual(cs[2], 'none', 'and the popovers\' shadow');
    // The pointer leaves the rail before the line colours are read: a hovered line is lit (FR-EDT-16 AC-7; D-1657).
    await pointerToNote(c);
    await sleep(500);
    const lines = await c.evaluate(() => ([...document.querySelectorAll('[data-outline-line]')] as HTMLElement[]).map((l) => {
      const b = getComputedStyle(l, '::before');
      const h = l.getBoundingClientRect().height;
      return [l.getAttribute('data-state'), h > 3 && b.content !== 'none' ? b.backgroundColor : getComputedStyle(l).backgroundColor];
    }));
    const byState: Record<string, string> = { current: text, ancestor: muted, rest: faint };
    for (const [s, col] of lines) assert.equal(col, byState[s ?? 'rest'], `a ${s} rail line is ${s === 'current' ? '--text' : s === 'ancestor' ? '--muted' : '--faint'}`);
    await jumpVia(page, 'Kdo jede');
    await sleep(50);
    assert.equal(await headingEl(page, 'Kdo jede').evaluate((e) => getComputedStyle(e).backgroundColor), linkBg, 'the highlight is --link-bg');
    assert.deepEqual(await axeContrast(page), [], `${theme}, a jump's highlight: axe color-contrast`);
    assert.deepEqual(await colourLeaks(page, theme), [], `${theme}, a jump's highlight: only theme tokens`);
  });
}

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-19

const wrapped = (s: string | null) => !s || /^⟦[\s\S]*⟧$/.test(flat(s));

test('nfr_oth_02_ac19_outline_strings_in_the_catalog', async ({ page }) => {
  await startOutline(page, noteRoute(P.cten), { pseudo: true });
  await openCardByHover(page);
  await must(page.getByRole('dialog', { name: '⟦Outline⟧', exact: true }), 'the card named ⟦Outline⟧');
  await must(card(page).getByRole('tree', { name: '⟦Outline⟧', exact: true }), 'tree ⟦Outline⟧');
  const chev = cardTree(page).locator('[data-outline-chevron]').first();
  await must(chev, 'a chevron in the card');
  assert.ok(wrapped(await chev.getAttribute('title')), `the chevron's tooltip: ${await chev.getAttribute('title')}`);
  const r = await cardRows(page);
  assert.equal(r[0]?.label, 'Úvod', 'heading texts stay as written (user content)');
  // The commands.
  await pointerToNote(page);
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'palette');
  await page.getByRole('combobox', { name: /Command query/ }).fill('outline');
  await sleep(300);
  const opts = (await paletteOptions(page)).map((x) => flat(x).replace(/\s*(⌘J|⟦⌘J⟧)$/, '')); // the shortcut, plain or pseudo (D-1658)
  for (const want of ['⟦Outline: jump to heading…⟧', '⟦Toggle outline rail⟧']) assert.ok(opts.includes(want), `the palette shows ${want}: ${opts.join(' | ')}`);
  await page.keyboard.press('Escape');
  // ⌘J with no headings: the live region's text.
  const { p: b } = await another(page, noteRoute(P.bez), { pseudo: true });
  await b.getByRole('textbox', { name: /Note body/ }).locator('p').last().click();
  await b.keyboard.press('Meta+j');
  const live = await eventually(() => b.locator('[data-outline-live]').first().textContent().catch(() => ''), (t) => !!t && t.length > 0, 1500);
  assert.ok(wrapped(live), `the live region's text: ${live}`);
  // The Settings switch.
  const { p: s } = await another(page, 'settings/appearance', { pseudo: true, wait: false });
  const sw = await must(s.getByRole('switch', { name: '⟦Show outline rail⟧', exact: true }), 'switch ⟦Show outline rail⟧');
  assert.ok(wrapped(await sw.getAttribute('aria-description')), 'its description');
});

// ------------------------------------------------------------------------------------------------ FR-SET-02 AC-10

test('fr_set_02_ac10_outline_rail_switch', async ({ page }) => {
  const core = await startOutline(page, noteRoute(P.plan), { panel: null });
  await must(rail(page), 'Plán\'s rail');
  const vault0 = (await core.files())['.tegg/vault.yml'];
  await runCommand(page, 'Go to Settings: Appearance');
  await mustBeOn(page, 'Settings: Appearance', 'settings/appearance', 5000).catch(() => {});
  const sw = await must(page.getByRole('switch', { name: 'Show outline rail', exact: true }), 'switch Show outline rail');
  assert.equal(await sw.getAttribute('data-command'), 'outline.toggleRail', 'data-command="outline.toggleRail"');
  assert.equal(await sw.getAttribute('aria-checked'), 'true', 'on with no stored value');
  assert.equal(await sw.getAttribute('aria-description'), 'Short lines on the note’s right edge; hover them to see the outline.', 'its description');
  assert.ok(await page.getByText('Short lines on the note’s right edge; hover them to see the outline.', { exact: true }).count(), 'shown as the muted note');
  const s0 = await uiSets(core);
  await sw.click();
  await sleep(300);
  assert.equal(await uiSets(core), s0 + 1, 'turning it off sends one ui_state_set');
  assert.equal(((await core.uiState()) as any)?.outlineRail, false, 'with outlineRail: false');
  assert.equal(await sw.getAttribute('aria-checked'), 'false', 'the switch is off');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, TITLE[P.plan], 'back to Plán');
  await sleep(100);
  assert.equal(await rail(page).count(), 0, 'Plán\'s rail is gone within 100 ms of returning');
  await runCommand(page, 'Toggle outline rail');
  assert.ok(await eventually(async () => (await rail(page).count()) > 0, (x) => x, 1500), 'the palette\'s Toggle outline rail turns it on again');
  assert.equal(((await core.uiState()) as any)?.outlineRail, true, 'outlineRail: true');
  assert.deepEqual(await core.writesTo(), [], 'nothing is written to the vault');
  assert.equal((await core.files())['.tegg/vault.yml'], vault0, '.tegg/vault.yml is untouched');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-46

test('fr_syn_06_ac46_outline_tour_writes_nothing', async ({ page }) => {
  const core = await startOutline(page, noteRoute(P.plan));
  await eventually(() => outlineRows(page), (r) => r.length === 11);
  const tour = async (title: string, route: string) => {
    if (route.startsWith('note/')) {
      await goToQuery(page, title);
      await page.keyboard.press('Enter');
      await mustBeOn(page, title, `open ${title}`);
    }
    await sleep(300);
    if (!(await rail(page).count())) return;
    await setScroll(page, 'end');
    await setScroll(page, 0);
    await pointerToNote(page);
    await sleep(350);
    await openCardByHover(page);
    const chev = cardTree(page).locator('[data-outline-chevron]').first();
    if (await chev.count()) {
      await chev.click();
      await chev.click();
    }
    const items = cardTree(page).getByRole('treeitem');
    const n = await items.count();
    if (n) await items.nth(n - 1).locator('.outline-text').click();
    await page.keyboard.press('Meta+BracketLeft');
    await page.keyboard.press('Meta+BracketRight');
    await sleep(150);
  };
  for (const [title, path] of [[TITLE[P.plan], P.plan], [TITLE[P.arch], P.arch], [TITLE[P.cten], P.cten], [TITLE[P.okraje], P.okraje], [TITLE[P.bezHlavicky], P.bezHlavicky]] as const) {
    await tour(title, noteRoute(path));
  }
  // Okraje's folded callout through a jump.
  await goToQuery(page, TITLE[P.okraje]);
  await page.keyboard.press('Enter');
  await mustBeOn(page, TITLE[P.okraje], 'Okraje');
  await jumpVia(page, 'Skrytý nadpis');
  // The rail and the card, ⌘J; panel tabs; resize across 640; focus mode; the switch.
  await must(rail(page), 'the rail');
  await pointerToNote(page);
  await sleep(350);
  await openCardByHover(page);
  await (await must(card(page).getByRole('treeitem').nth(1), 'a card row')).click();
  await page.keyboard.press('Meta+j');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Meta+BracketLeft');
  await page.keyboard.press('Meta+Backslash');
  for (const t of [backlinksTab, graphTab, backlinksTab]) await (await must(t(page), 'a panel tab')).click();
  await page.setViewportSize({ width: 1100, height: 900 });
  await sleep(200);
  await page.setViewportSize({ width: 1440, height: 900 });
  const sep = await must(separator(page), 'separator');
  const sb = (await sep.boundingBox())!;
  await page.mouse.move(sb.x + 2, sb.y + 50);
  await page.mouse.down();
  await page.mouse.move(sb.x - 150, sb.y + 50, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Meta+Shift+Backslash');
  await page.keyboard.press('Meta+Shift+Backslash');
  await runCommand(page, 'Toggle outline rail');
  await runCommand(page, 'Toggle outline rail');
  // The days.
  const { p: d, core: dc } = await another(page, 'daily/2026-11-12');
  await eventually(() => outlineRows(d), (r) => r.length === 3);
  await jumpVia(d, 'Večer');
  const { p: v, core: vc } = await another(page, 'daily/2026-11-13');
  await eventually(() => outlineRows(v), (r) => r.length === 3);
  await jumpVia(v, 'Poznámky');
  const { p: r, core: rc } = await another(page, noteRoute(P.rozbita));
  await eventually(() => outlineRows(r), (x) => x.length === 2);
  await jumpVia(r, 'Druhý v rozbité');
  await sleep(800);
  for (const [what, c] of [['main', core], ['daily', dc], ['virtual daily', vc], ['Rozbitá', rc]] as const) {
    assert.equal(await c.writes(), 0, `${what}: the fake core counts 0 write commands over the tour`);
    assert.deepEqual(await c.writesTo(), [], `${what}: no file written`);
    assert.deepEqual(await vaultWrites(c), [], `${what}: no vault write command`);
  }
  assert.equal((await vc.files())['Daily/2026-11-13.md'], undefined, 'no Daily/2026-11-13.md');
});
