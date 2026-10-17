// MS4 slice 4F, L5 (WebKit + fake core): embeds look clearly different from links. docs/acceptance/embeds.md FR-LNK-07
// AC-4 (the frame), AC-5 (link-mode embeds aren't links), AC-6 (broken embeds, Create offer), AC-7 (other states),
// AC-8 (both themes: tokens, contrast, no colour leaks). Interface docs/contracts/ms4-embeds.md §6 (tokens `embed-border`,
// `embed-bg`, broken frame), ms4-links.md §5.2 (chips), §5.3 (Create offer). Written from the ACs and the contracts only
// (D-61). Every lookup goes through `must`/`seen` and node:assert (TS-I1).
import { test, type Browser, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { axeContrast, colourLeaks, tokenColour } from './read-helpers';
import {
  M, createOffer, description, displayAsButton, displayAsMenu, embedList, embedMessage, embedsVault, eventually, fileText, gotoNote,
  gotoSettings, headerText, main, mainName, must, mustBeOn, needTop, nfc, openButton, openEmbeds, original, runCommand, seen, sleep, topEmbed,
  topEmbeds, writeCalls, type EmbedInfo,
} from './embeds-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const ICON: Record<string, string> = {
  [M.cil]: 'file-text', [M.jana]: 'user', [M.sarka]: 'user', [M.svickova]: 'utensils', [M.zavolat]: 'check-square', [M.praha]: 'map', [M.denni]: 'calendar',
};
type Box = { display: string; inP: boolean; bw: number[]; bs: string; bc: string; bg: string; weight: string; icon: string | null };
async function boxOf(el: Locator): Promise<Box> {
  return el.evaluate((e) => {
    const s = getComputedStyle(e);
    const header = e.firstElementChild;
    return {
      display: s.display, inP: !!e.parentElement?.closest('p'),
      bw: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].map((x) => parseFloat(x)),
      bs: s.borderTopStyle, bc: s.borderTopColor, bg: s.backgroundColor, weight: s.fontWeight,
      icon: e.getAttribute('data-icon') ?? header?.querySelector('[data-icon]')?.getAttribute('data-icon') ?? null,
    };
  });
}
async function list(page: Page, n: number): Promise<EmbedInfo[]> {
  return eventually(() => topEmbeds(main(page)).catch(() => [] as EmbedInfo[]), (l) => l.length >= n, 5000);
}

// ------------------------------------------------------------------------------------------------ AC-4

for (const theme of ['light', 'dark'] as const) {
  test(`fr_lnk_07_ac4_the_frame_${theme}`, async ({ page }) => {
    await openEmbeds(page, M.rezimy, { theme });
    const border = await tokenColour(page, 'embed-border');
    const bg = await tokenColour(page, 'embed-bg');
    assert.ok(border && bg, 'tokens embed-border and embed-bg exist');
    const link = await tokenColour(page, 'link');
    const bad: string[] = [];
    for (const at of [M.rezimy, M.sekce]) {
      if (at !== M.rezimy) await gotoNote(page, 'Sekce');
      const l = await list(page, at === M.rezimy ? 12 : 7);
      for (const [i, e] of l.entries()) {
        if (e.mode === 'link') continue;
        const el = topEmbed(main(page), i);
        const b = await boxOf(el);
        const what = `${at} embed ${i + 1}`;
        if (b.display !== 'block') bad.push(`${what}: display ${b.display}`);
        if (b.inP) bad.push(`${what}: inside a p`);
        if (b.bw.some((w) => w < 1)) bad.push(`${what}: border ${b.bw.join(' ')}`);
        if (b.bs !== 'solid') bad.push(`${what}: border-style ${b.bs}`);
        if (b.bc !== border) bad.push(`${what}: border-color ${b.bc} ≠ embed-border ${border}`);
        if (b.bg !== bg) bad.push(`${what}: background ${b.bg} ≠ embed-bg ${bg}`);
        if (link && b.bg === link) bad.push(`${what}: the link tint`);
        const want = ICON[e.target ?? ''] ?? null;
        if (b.icon !== want) bad.push(`${what}: data-icon ${b.icon} ≠ ${want}`);
        const title = e.label.replace(/^Embedded: /, '');
        if (!(await headerText(el)).includes(title)) bad.push(`${what}: title "${title}" not in the header`);
        const note = title.split(' › ')[0]; // D-452: `Open <note title>`, without the heading
        if (!(await seen(openButton(el, note), 300))) bad.push(`${what}: no Open ${note}`);
      }
    }
    assert.deepEqual(bad, [], 'every full and card frame is a bordered block with the embed tokens, icon, title and Open');
    await gotoNote(page, 'Režimy');
    const chip = await must(topEmbed(main(page), 0).locator('[data-link-kind="note"]').first(), 'the Jana Nováková link chip inside Cíl');
    assert.deepEqual((await boxOf(chip)).bw, [0, 0, 0, 0], 'link chips have border width 0');
  });
}

// ------------------------------------------------------------------------------------------------ AC-5

for (const theme of ['light', 'dark'] as const) {
  test(`fr_lnk_07_ac5_link_mode_embeds_are_not_links_${theme}`, async ({ page }) => {
    const vault = embedsVault((f) => { f[M.uvnitr] = `${f[M.uvnitr]}\nOdkaz na [[Cíl]] v textu.\n`; });
    await openEmbeds(page, M.rezimy, { theme, vault });
    const border = await tokenColour(page, 'embed-border');
    const bg = await tokenColour(page, 'embed-bg');
    const out: [string, Box, string][] = [];
    await list(page, 12);
    const sat = await needTop(main(page), 4, 'Saturnin link-mode embed');
    out.push(['Saturnin', await boxOf(sat), await description(sat)]);
    await gotoNote(page, 'Uvnitř textu');
    const els = main(page).locator('[data-embed-mode="link"]');
    await eventually(() => els.count(), (n) => n >= 5, 5000);
    for (let i = 0; i < (await els.count()); i++) out.push([`Uvnitř textu ${i + 1}`, await boxOf(els.nth(i)), await description(els.nth(i))]);
    assert.ok(out.length >= 6, 'Saturnin and the five link-mode embeds of Uvnitř textu');
    for (const [what, b, d] of out) {
      assert.ok(['inline', 'inline-flex'].includes(b.display), `${what}: display ${b.display}`);
      assert.equal(b.weight, '400', `${what}: font-weight 400`);
      assert.deepEqual(b.bw, [1, 1, 1, 1], `${what}: 1 px border`);
      assert.equal(b.bs, 'solid', `${what}: solid`);
      assert.equal(b.bc, border, `${what}: embed-border`);
      assert.equal(b.bg, bg, `${what}: embed-bg`);
      assert.ok(b.icon, `${what}: data-icon of the target type`);
      assert.equal(d, 'Embedded note', `${what}: description`);
    }
    const chip = await must(main(page).locator('[data-link-kind="note"]').filter({ hasText: /^\s*Cíl\s*$/ }), 'the [[Cíl]] link chip');
    const c = await boxOf(chip);
    assert.deepEqual(c.bw, [0, 0, 0, 0], 'the link chip has border width 0');
    assert.notEqual(c.bg, bg, 'the link chip has the link tint, not embed-bg');
    const e = out[1][1];
    assert.notEqual(c.bw[0], e.bw[0], 'border-top-width differs');
    assert.notEqual(c.bg, e.bg, 'background-color differs');
  });
}

// ------------------------------------------------------------------------------------------------ AC-6

const BROKEN = ['Chybí', 'Šablona', 'Smazaná', 'Reading list'];

for (const theme of ['light', 'dark'] as const) {
  test(`fr_lnk_07_ac6_broken_frames_${theme}`, async ({ page }) => {
    await openEmbeds(page, M.rozbita, { theme });
    const danger = await tokenColour(page, 'danger');
    const l = await list(page, 4);
    for (const [i, t] of BROKEN.entries()) {
      assert.deepEqual([l[i]?.state, l[i]?.target], ['broken', nfc(t)], `![[${t}]]: data-embed-state broken`);
      const el = topEmbed(main(page), i);
      const b = await boxOf(el);
      assert.equal(b.bs, 'dashed', `${t}: dashed border`);
      assert.equal(b.bc, danger, `${t}: in the danger token`);
      assert.equal(b.bg, 'rgba(0, 0, 0, 0)', `${t}: transparent background`);
      assert.equal(await el.locator(':scope > :first-child [data-icon]').count(), 0, `${t}: no type icon`);
      assert.equal(await el.getByRole('button', { name: /^Open |^Display as$/ }).count(), 0, `${t}: no Open or Display as`);
      const chip = await must(el.locator('[data-link-kind="unresolved"]'), `${t}: the unresolved chip in the header`);
      assert.equal(await description(chip), `No note named ${t}`, `${t}: chip description`);
    }
  });
}

test('fr_lnk_07_ac6_create_from_a_broken_embed', async ({ page }) => {
  const core = await openEmbeds(page, M.rozbita);
  await list(page, 4);
  await (await must(topEmbed(main(page), 0).locator('[data-link-kind="unresolved"]'), 'the Chybí chip')).click();
  const offer = await must(createOffer(page), 'dialog "Create note"');
  assert.ok(await seen(offer.getByText('Type: Quick Note', { exact: true }), 1000), 'type Quick Note');
  await (await must(offer.getByRole('button', { name: 'Create "Chybí"', exact: true }), 'Create "Chybí"')).click();
  if ((await mainName(page)) !== 'Rozbitá vložení') { await page.keyboard.press('Meta+BracketLeft'); await mustBeOn(page, 'Rozbitá vložení', 'back to the host'); }
  const l = await eventually(() => topEmbeds(main(page)), (x) => x[0]?.state === 'ok' && x[0]?.mode === 'full', 2000);
  assert.deepEqual([l[0]?.state, l[0]?.mode], ['ok', 'full'], 'the embed renders full within 2 s');
  assert.ok(await seen(topEmbed(main(page), 0).getByText('Empty note', { exact: true }), 1000), 'Empty note');
  assert.equal(await fileText(core, M.rozbita), original(M.rozbita), 'Rozbitá vložení is not written');
});

test('fr_lnk_07_ac6_broken_link_mode_embed', async ({ page }) => {
  const vault = embedsVault((f) => { f[M.uvnitr] = `${f[M.uvnitr]}\nText ![[Nic]] dál.\n`; });
  await openEmbeds(page, M.uvnitr, { vault });
  const danger = await tokenColour(page, 'danger');
  await eventually(() => embedList(main(page)).catch(() => [] as EmbedInfo[]), (x) => x.length >= 6, 5000);
  const el = await must(main(page).locator('[data-embed-mode="link"][data-embed-state="broken"]'), 'the broken link-mode embed ![[Nic]]', 3000);
  const b = await boxOf(el);
  assert.equal(b.bs, 'dashed', 'dashed border');
  assert.equal(b.bc, danger, 'danger');
  const kind = await el.evaluate((e) => e.getAttribute('data-link-kind') ?? e.querySelector('[data-link-kind]')?.getAttribute('data-link-kind') ?? null);
  assert.equal(kind, 'unresolved', 'the unresolved chip');
});

test('fr_lnk_07_ac6_broken_embeds_on_the_broken_links_page', async ({ page }) => {
  await openEmbeds(page, M.rozbita);
  const l = await list(page, 4);
  assert.deepEqual(l.slice(0, 4).map((e) => e.state), ['broken', 'broken', 'broken', 'broken'], 'the four broken frames are shown');
  await runCommand(page, 'Go to Broken links');
  for (const t of BROKEN) assert.ok(await seen(main(page).getByRole('group', { name: new RegExp(`^${t}`) }), 3000), `${t} on the Broken links page`);
});

// ------------------------------------------------------------------------------------------------ AC-7

test('fr_lnk_07_ac7_missing_section_frames', async ({ page }) => {
  const core = await openEmbeds(page, M.sekce);
  const muted = await tokenColour(page, 'muted');
  const l = await list(page, 7);
  assert.deepEqual([l[5]?.state, l[6]?.state], ['missing-section', 'missing-section'], 'missing-section, not broken');
  const h = topEmbed(main(page), 5);
  assert.match(await headerText(h), /Cíl › Neexistující nadpis/, 'header');
  assert.equal((await embedMessage(h).innerText()).trim(), 'No heading "Neexistující nadpis" in Cíl.', 'heading message');
  assert.equal(await embedMessage(h).evaluate((e) => getComputedStyle(e).color), muted, 'the muted token');
  assert.equal((await embedMessage(topEmbed(main(page), 6)).innerText()).trim(), 'No block "^chybí" in Cíl.', 'block message');
  const b = await boxOf(h);
  assert.equal(b.bs, 'solid', 'normal frame style');
  await (await must(openButton(h, 'Cíl'), 'Open Cíl')).click();
  await mustBeOn(page, 'Cíl', 'opens Cíl');
  await runCommand(page, 'Go to Broken links');
  await sleep(500);
  assert.equal(await main(page).getByRole('group', { name: /^Cíl/ }).count(), 0, 'not on the Broken links page (D-278)');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

test('fr_lnk_07_ac7_date_without_a_daily_note', async ({ page }) => {
  const core = await openEmbeds(page, M.rozbita);
  const l = await list(page, 5);
  assert.equal(l[4]?.state, 'date-missing', '![[2026-10-20]] is date-missing');
  const f = topEmbed(main(page), 4);
  assert.equal(await f.evaluate((e) => e.firstElementChild?.querySelector('[data-icon]')?.getAttribute('data-icon') ?? null), 'calendar', 'the Daily Note icon');
  assert.ok((await headerText(f)).includes('2026-10-20'), 'the title 2026-10-20');
  assert.equal((await embedMessage(f).innerText()).trim(), 'No note for this day yet.', 'message');
  await (await must(openButton(f, '2026-10-20'), 'Open 2026-10-20')).click();
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  const v = await eventually(() => title.first().evaluate((e) => (e as HTMLInputElement).value ?? e.textContent ?? '').catch(() => ''), (x) => x.trim() === '2026-10-20', 3000);
  assert.equal(v.trim(), '2026-10-20', 'opens daily/2026-10-20');
  await sleep(500);
  assert.deepEqual(await writeCalls(core), [], 'without writing');
});

// ------------------------------------------------------------------------------------------------ AC-8

test('fr_lnk_07_ac8_tokens_exist_in_both_themes', async ({ page }) => {
  await openEmbeds(page, M.rezimy);
  const t = await page.evaluate(async () => {
    const m = await import('/src/theme/tokens.ts' as string);
    return { light: [m.light?.['embed-border'] ?? null, m.light?.['embed-bg'] ?? null], dark: [m.dark?.['embed-border'] ?? null, m.dark?.['embed-bg'] ?? null] };
  });
  for (const th of ['light', 'dark'] as const) assert.ok(t[th][0] && t[th][1], `${th}: embed-border and embed-bg defined`);
});

async function themed(browser: Browser, theme: 'light' | 'dark', at: string): Promise<Page> {
  const p = await browser.newPage();
  await openEmbeds(p, at, { theme });
  await eventually(() => embedList(main(p)).catch(() => [] as EmbedInfo[]), (l) => l.length >= 1, 5000);
  return p;
}
for (const theme of ['light', 'dark'] as const) {
  test(`fr_lnk_07_ac8_contrast_and_no_colour_leaks_${theme}`, async ({ browser }) => {
    test.setTimeout(180_000);
    const failures: string[] = [];
    for (const at of [M.rezimy, M.sekce, M.rozbita, M.kruhA, M.retez1]) {
      const p = await themed(browser, theme, at);
      const n = (await embedList(main(p))).length;
      if (n === 0) failures.push(`${at}: no embeds shown`);
      for (const v of await axeContrast(p)) failures.push(`${at}: contrast ${v}`);
      for (const v of await colourLeaks(p, theme)) failures.push(`${at}: colour ${v}`);
      if (at === M.rezimy) {
        await displayAsButton(await needTop(main(p), 1, "Jana's card")).click().catch(() => failures.push('Režimy: Display as missing'));
        if (await seen(displayAsMenu(p), 1000)) {
          for (const v of await axeContrast(p)) failures.push(`Režimy (Display as open): contrast ${v}`);
          for (const v of await colourLeaks(p, theme)) failures.push(`Režimy (Display as open): colour ${v}`);
        } else failures.push('Režimy: Display as menu not shown');
      }
      await p.close();
    }
    const p = await browser.newPage();
    await openEmbeds(p, M.rezimy, { theme });
    await gotoSettings(p, 'Osoby', 'Osoba');
    if (!(await seen(main(p).getByRole('radiogroup', { name: 'Default embed mode', exact: true }), 2000))) failures.push('type-settings/osoba: Embeds section missing');
    for (const v of await axeContrast(p)) failures.push(`type-settings/osoba: contrast ${v}`);
    for (const v of await colourLeaks(p, theme)) failures.push(`type-settings/osoba: colour ${v}`);
    await p.close();
    assert.deepEqual(failures, [], `no color-contrast violation and no colour leak (${theme})`);
  });
}
