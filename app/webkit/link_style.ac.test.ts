// MS4 slice 4A, L5 (WebKit + fake core): links look the same everywhere. FR-LNK-07 AC-1 (one resolved chip style in
// the editor, the read view, a relation row, a text value, a type-page cell, a backlinks excerpt and a Broken links
// excerpt), AC-2 (one broken chip style, date chips resolved with the Daily Note icon), AC-3 (axe color-contrast on
// those chips), in light and dark. docs/acceptance/backlinks.md; interface docs/contracts/ms4-links.md §5.2,
// ms3-shell §3.5 (tokens), §11.3 (`data-link-kind`). Written from the ACs and the contracts only (D-61). Every lookup
// goes through `must`, so a missing chip fails an assertion (TS-I1).
import { test, type Browser, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { B, backlinksPanel, chips, description, editorBody, linksVault, main, must, mustPanel, openLinks, props, runCommand, swap } from './links-helpers';
import { tokenColour } from './read-helpers';

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
type Style = { kind: string | null; color: string; bg: string; border: string; weight: string; display: string; icon: string | null; line: string; deco: string };

async function style(chip: Locator): Promise<Style> {
  return chip.evaluate((e) => {
    const s = getComputedStyle(e);
    return {
      kind: e.getAttribute('data-link-kind'),
      color: s.color, bg: s.backgroundColor,
      border: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].join(' '),
      weight: s.fontWeight, display: s.display,
      icon: e.querySelector('[data-icon]')?.getAttribute('data-icon') ?? (e.getAttribute('data-icon') || null),
      line: s.textDecorationLine, deco: s.textDecorationStyle,
    };
  });
}
async function chipIn(scope: Locator, text: string, what: string): Promise<Locator> {
  return must(chips(scope, text), `${what}: chip "${text}"`, 5000);
}
/** A vault where a Broken links excerpt also holds a resolved Cíl chip (Další rozbitý: `[[Neexistuje]] a [[Cíl]]`). */
const vault = () => linksVault((f) => { f[B.dalsi] = swap(f[B.dalsi], '[[Neexistuje]]', '[[Neexistuje]] a [[Cíl]]'); });

async function page(browser: Browser, theme: 'light' | 'dark', at: string, readView = false): Promise<Page> {
  const p = await browser.newPage();
  await openLinks(p, at, { theme, vault: vault(), readView });
  return p;
}

/** The resolved chips of AC-1 in every context, as [context, style]. */
async function resolvedChips(browser: Browser, theme: 'light' | 'dark'): Promise<{ styles: [string, Style][]; pages: Page[]; link: string | null }> {
  const styles: [string, Style][] = [];
  const pages: Page[] = [];
  const p1 = await page(browser, theme, B.odkazy); pages.push(p1);
  styles.push(['editor', await style(await chipIn(editorBody(p1), 'Cíl', 'editor body'))]);
  const p2 = await page(browser, theme, B.odkazy, true); pages.push(p2);
  styles.push(['read view', await style(await chipIn(main(p2), 'Cíl', 'read view'))]);
  const p3 = await page(browser, theme, B.porada); pages.push(p3);
  styles.push(['relation row', await style(await chipIn(props(p3).getByRole('group', { name: 'Téma', exact: true }), 'Cíl', 'Téma'))]);
  styles.push(['text value', await style(await chipIn(props(p3).locator('[aria-label="Poznámka"], [aria-labelledby]').filter({ hasText: 'Připravit' }), 'Cíl', 'Poznámka'))]);
  const p4 = await page(browser, theme, B.cil); pages.push(p4);
  await mustPanel(p4);
  // D-368: the panel shows chips, not excerpts; the chip of the source Odkazy v textu (a Page) is the panel's resolved chip.
  styles.push(['backlinks chip', await style(await chipIn(backlinksPanel(p4), 'Odkazy v textu', 'backlinks panel'))]);
  await runCommand(p4, 'Go to Broken links');
  styles.push(['broken links excerpt', await style(await chipIn(main(p4).getByRole('group', { name: /^Neexistuje/ }).locator('[data-occurrence]').filter({ hasText: 'Cíl' }), 'Cíl', 'Broken links excerpt'))]);
  const p5 = await page(browser, theme, B.cil); pages.push(p5);
  await runCommand(p5, 'Go to type: Schůzky');
  const jana = await style(await chipIn(main(p5).getByRole('table', { name: 'Schůzky' }), 'Jana Nováková', 'type page cell Účastníci'));
  styles.push(['type page cell (Jana)', jana]);
  return { styles, pages, link: await tokenColour(p1, 'link') };
}

for (const theme of ['light', 'dark'] as const) {
  test(`fr_lnk_07_ac1_one_resolved_chip_style_${theme}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const { styles, pages, link } = await resolvedChips(browser, theme);
    const [, first] = styles[0];
    for (const [ctx, s] of styles) {
      assert.equal(s.kind, 'note', `${ctx}: data-link-kind note`);
      assert.equal(s.color, link, `${ctx}: color = the link token`);
      assert.equal(s.bg, first.bg, `${ctx}: the link tint background`);
      assert.notEqual(s.bg, 'rgba(0, 0, 0, 0)', `${ctx}: tinted`);
      assert.equal(s.border, '0px 0px 0px 0px', `${ctx}: border-width 0`);
      assert.equal(s.weight, '400', `${ctx}: font-weight 400`);
      assert.ok(['inline', 'inline-flex'].includes(s.display), `${ctx}: display inline or inline-flex, not ${s.display}`);
      assert.equal(s.icon, ctx.includes('Jana') ? 'user' : 'file-text', `${ctx}: the target type's icon`);
    }
    for (const p of pages) await p.close();
  });

  test(`fr_lnk_07_ac2_one_broken_chip_style_${theme}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const out: [string, Style, string][] = [];
    const p1 = await page(browser, theme, B.rozbite);
    const c1 = await chipIn(editorBody(p1), 'Neexistuje', 'editor');
    out.push(['editor', await style(c1), await description(c1)]);
    const p2 = await page(browser, theme, B.rozbite, true);
    const c2 = await chipIn(main(p2), 'Neexistuje', 'read view');
    out.push(['read view', await style(c2), await description(c2)]);
    const p3 = await page(browser, theme, B.sChybou);
    const c3 = await chipIn(props(p3), 'Chybějící osoba', 'relation row');
    out.push(['relation row', await style(c3), await description(c3)]);
    await runCommand(p1, 'Go to Broken links');
    const c4 = await chipIn(main(p1).getByRole('group', { name: /^Neexistuje/ }).locator('[data-occurrence]').first(), 'Neexistuje', 'Broken links excerpt');
    out.push(['broken links excerpt', await style(c4), await description(c4)]);
    const danger = await tokenColour(p2, 'danger');
    for (const [ctx, s, d] of out) {
      assert.equal(s.kind, 'unresolved', `${ctx}: data-link-kind unresolved`);
      assert.equal(s.bg, 'rgba(0, 0, 0, 0)', `${ctx}: transparent background`);
      assert.equal(s.color, danger, `${ctx}: the danger token`);
      assert.ok(s.line.includes('underline') && s.deco === 'dashed', `${ctx}: dashed underline (${s.line} ${s.deco})`);
      assert.equal(s.icon, null, `${ctx}: no type icon`);
      assert.match(d, /^No note named (Neexistuje|Chybějící osoba)$/, `${ctx}: description`);
    }
    // A date chip to an existing Daily Note has the resolved style with the Daily Note icon.
    const p4 = await page(browser, theme, B.zeStranek);
    const date = await style(await chipIn(editorBody(p4), '2026-10-07', 'date chip'));
    const res = await style(await chipIn(editorBody(p4), 'Dvojník', 'resolved chip'));
    assert.equal(date.kind, 'daily');
    assert.deepEqual({ ...date, kind: null, icon: null }, { ...res, kind: null, icon: null }, 'same style as a resolved chip');
    assert.equal(date.icon, 'calendar', 'the Daily Note icon');
    for (const p of [p1, p2, p3, p4]) await p.close();
  });

  test(`fr_lnk_07_ac3_chip_contrast_${theme}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const failures: string[] = [];
    const check = async (p: Page, what: string) => {
      const n = await p.locator('[data-link-kind]').count();
      assert.ok(n > 0, `${what}: chips present`);
      await p.addScriptTag({ path: AXE });
      const v = await p.evaluate(async () => {
        const r = await (window as any).axe.run({ include: [...document.querySelectorAll('[data-link-kind]')].map((e) => [e]) as any }, { runOnly: { type: 'rule', values: ['color-contrast'] } });
        return r.violations.flatMap((x: any) => x.nodes.map((nd: any) => nd.target.join(' ')));
      });
      for (const x of v) failures.push(`${what}: ${x}`);
    };
    for (const [at, rv] of [[B.odkazy, false], [B.odkazy, true], [B.porada, false], [B.rozbite, false], [B.rozbite, true], [B.sChybou, false], [B.cil, false]] as const) {
      const p = await page(browser, theme, at, rv);
      if (at === B.cil) await must(backlinksPanel(p), 'panel');
      await check(p, `${at}${rv ? ' (read view)' : ''}`);
      await p.close();
    }
    assert.deepEqual(failures, [], 'no color-contrast violation on any chip');
  });
}
