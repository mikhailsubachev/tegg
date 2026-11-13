// Slice P (v1.0, object previews) L5: what a preview shows (R105). docs/acceptance/previews.md FR-LNK-10 AC-1…AC-15
// (L5 parts; AC-16 is L1 only); contract docs/contracts/v1-previews.md §3.4. Written from the ACs and the contract only
// (D-61). Every preview is opened from Odkazy's editor by a single click (click mode, the default).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  PV, ZONE, anyContent, callsSince, chipNamed, clickToPreview, content, contentSequence, dlouhaBlocks, eventually, fileText, flat, header, mark,
  mustBeOn, needHeader, needNoPreview, needOdkazyLink, needPreview, nfc, openBtn, previewsVault, readArticle, sleep, startPreviews, strip, stripItems,
  swap, textOf, tokenColour, topInScroller, topBelowToolbar, writesSince, need, main, isDisabled, type FakeCoreHandle, previewPath,
} from './previews-helpers';

test.use({ timezoneId: ZONE });

/** Opens Odkazy (editor) and previews link `n` of the paragraph starting with `start`. */
async function previewOf(page: Page, start: string, n: number, title: string, o: Parameters<typeof startPreviews>[1] = {}) {
  const core = await startPreviews(page, { at: PV.odkazy, ...o });
  const dlg = await clickToPreview(page, await needOdkazyLink(page, start, n), title, `a click on link ${n + 1} of "${start}…"`);
  return { core, dlg };
}

test('fr_lnk_10_ac1_header_has_the_type_icon_title_and_type_name_and_no_cover', async ({ page }) => {
  const { dlg } = await previewOf(page, 'Projekt', 0, 'Projekt Alfa');
  const h = await needHeader(dlg, 'Preview: Projekt Alfa');
  assert.equal(h.icon, 'folder', 'the header icon is the Projekt type icon (data-icon="folder", D-217)');
  assert.equal(h.title, 'Projekt Alfa', 'the h2');
  assert.equal(h.rest, 'Projekt', 'the type name under the title');
  assert.equal(await dlg.locator('[data-icon="rocket"]').count(), 0, 'no rocket icon (icon: is never shown)');
  assert.equal(await dlg.locator('img').count(), 0, 'no img (the cover graf.png is never shown)');
  const above = await dlg.evaluate((d) => {
    const hd = d.querySelector('header');
    if (!hd) return ['no header'];
    const top = hd.getBoundingClientRect().top;
    return [...d.querySelectorAll('*')]
      .filter((e) => !hd.contains(e) && !e.contains(hd) && e.getClientRects().length > 0 && e.getBoundingClientRect().bottom <= top + 0.5)
      .filter((e) => !e.closest('button, [role="button"]') || !/^(Close preview|Back to .+)$/.test((e.closest('button, [role="button"]') as HTMLElement).getAttribute('aria-label') ?? (e.closest('button, [role="button"]') as HTMLElement).innerText))
      .map((e) => `${e.tagName.toLowerCase()} ${(e as HTMLElement).innerText?.slice(0, 20) ?? ''} ${Math.round(e.getBoundingClientRect().height)}px`);
  });
  assert.deepEqual(above, [], 'nothing above the header except Back and Close (no 56 px cover band, AP-803)');
});

test('fr_lnk_10_ac2_strip_holds_the_preview_attributes_with_a_value_in_order', async ({ page }) => {
  const { dlg } = await previewOf(page, 'Projekt', 0, 'Projekt Alfa');
  assert.deepEqual(await stripItems(dlg), ['Stav Aktivní', 'Vlastník Jana Nováková', 'Termín Dec 31, 2026'], 'exactly three items: Rozpočet is empty, Poznámka is not a preview attribute');
  const s = await need(strip(dlg), 'region "Preview properties"');
  await need(chipNamed(s, 'Jana Nováková'), 'Vlastník as the chip Jana Nováková');
  await page.keyboard.press('Escape');
  const d2 = await clickToPreview(page, await needOdkazyLink(page, 'Hlavní'), 'Rozpočet 2027', 'Rozpočet');
  assert.equal(await strip(d2).count(), 0, 'Rozpočet (Page, preview: []) has no strip element');
});

test('fr_lnk_10_ac2_changing_the_type_preview_list_updates_the_open_strip', async ({ page }) => {
  const { core, dlg } = await previewOf(page, 'Projekt', 0, 'Projekt Alfa');
  const yml = (await fileText(core, PV.projektYml))!;
  await core.setFile(PV.projektYml, swap(yml, 'preview: [stav, vlastník, termín, rozpočet]', 'preview: [termín]'));
  const got = await eventually(() => stripItems(dlg), (x) => JSON.stringify(x) === JSON.stringify(['Termín Dec 31, 2026']), 2000);
  assert.deepEqual(got, ['Termín Dec 31, 2026'], 'only Termín within 2 s');
});

test('fr_lnk_10_ac3_rendered_body_in_order_with_shifted_headings_and_nothing_hidden_shown', async ({ page }) => {
  const { dlg } = await previewOf(page, 'Hlavní', 0, 'Rozpočet 2027');
  const art = await need(content(dlg, 'Rozpočet 2027'), 'article "Content of Rozpočet 2027"');
  const seq = (await contentSequence(art)).map((x) => (x.startsWith('IMG:') ? 'IMG' : x));
  assert.deepEqual(seq, [
    'P:Návrh rozpočtu na rok 2027 pro celý tým.', 'H3:Rozsah', 'P:Personál, cestování a nástroje. Odpovídá Jana Nováková.', 'IMG', 'H4:Podrobnosti',
    'P:Cestování je omezeno na dvě akce ročně.', 'H3:Otevřené otázky', 'P:Kdo schvaluje nákup licencí?', 'CARD:Projekt Alfa', 'P:Poslední odstavec rozpočtu.',
  ], 'the blocks in order (headings one level below the h2, the comment and the block id hidden, the embed as a card)');
  const src = await art.locator('img').first().getAttribute('src');
  assert.ok(src && /graf\.png/.test(decodeURIComponent(src)) && !/^https?:\/\/(?!localhost|asset\.localhost|127\.)/.test(src), `the image is _attachments/graf.png through the shell asset path, no network: ${src}`);
  await need(chipNamed(art, 'Jana Nováková'), 'Jana Nováková as a resolved chip');
  const text = flat(await art.innerText());
  for (const hidden of ['skrytá poznámka', '^otazka1', 'id:', 'title:', '01JBPV']) assert.ok(!text.includes(hidden), `"${hidden}" is not shown`);
  const editable = await dlg.evaluate((d) => [...d.querySelectorAll('[contenteditable="true"], [contenteditable=""], input, textarea, select')]
    .filter((e) => !(e instanceof HTMLInputElement && e.type === 'checkbox' && e.getAttribute('aria-readonly') === 'true')).length);
  assert.equal(editable, 0, 'no editable element in the popover');
});

test('fr_lnk_10_ac4_nested_embeds_are_cards_without_recursion', async ({ page }) => {
  const { dlg } = await previewOf(page, 'Hlavní', 0, 'Rozpočet 2027');
  const art = await need(content(dlg, 'Rozpočet 2027'), 'content');
  assert.ok((await contentSequence(art)).includes('CARD:Projekt Alfa'), 'Projekt Alfa is a card');
  assert.ok(!flat(await art.innerText()).includes('Hlavní projekt roku.'), 'the card has no body text');
});

test('fr_lnk_10_ac4_kruh_a_shows_kruh_b_as_a_card_in_at_most_two_embed_loads', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy });
  const n0 = await mark(core);
  const dlg = await clickToPreview(page, await needOdkazyLink(page, 'Kruh'), 'Kruh A', 'Kruh A');
  const art = await need(content(dlg, 'Kruh A'), 'content of Kruh A');
  const seq = await contentSequence(art);
  assert.deepEqual(seq, ['P:Začátek kruhu A.', 'CARD:Kruh B'], 'the paragraph and the card Kruh B with no body');
  assert.ok(!flat(await art.innerText()).includes('Circular embed'), 'no Circular embed message');
  await sleep(300);
  const loads = (await callsSince(core, n0, 'embed_load')).map((c) => ((c.args as any)?.paths ?? []).map((p: string) => nfc(p)));
  assert.ok(loads.length <= 2, `at most two embed_load calls (got ${JSON.stringify(loads)})`);
  assert.deepEqual(loads[0], [nfc(PV.kruhA)], 'the first loads the previewed note');
  assert.ok(loads.slice(1).every((p) => !p.includes(nfc(PV.kruhA))), 'none loads Kruh A a second time');
});

test('fr_lnk_10_ac5_empty_body_shows_all_attributes_and_no_strip', async ({ page }) => {
  const { core, dlg } = await previewOf(page, 'Osoby', 0, 'Jana Nováková');
  assert.equal(await strip(dlg).count(), 0, 'no strip (AP-818)');
  const pr = await need(anyContent(dlg).getByRole('region', { name: 'Properties', exact: true }).or(dlg.getByRole('region', { name: 'Properties', exact: true })), 'region "Properties" in the content area');
  const rows = await pr.evaluate((r) => {
    const f = (x: string | null | undefined) => (x ?? '').replace(/[\s ]+/g, ' ').trim().normalize('NFC');
    const rs = [...r.querySelectorAll('[role="row"], li, dt')] as HTMLElement[];
    return rs.map((e) => (e.tagName === 'DT' ? `${f(e.innerText)} ${f((e.nextElementSibling as HTMLElement | null)?.innerText)}` : f(e.innerText)));
  });
  assert.deepEqual(rows.slice(0, 3), ['Firma Beta a.s.', 'Role Analytička', 'E-mail jana@example.com'], 'Firma, Role, E-mail first');
  assert.deepEqual(rows.map((r) => r.split(' ')[0]), ['Firma', 'Role', 'E-mail', 'Created', 'Modified'], 'exactly these rows in the read-view order');
  assert.ok(rows[3]?.includes('Sep 10, 2026') && rows[4]?.includes('Sep 10, 2026'), `Created and Modified in the D-160 format: ${rows.slice(3).join(' | ')}`);
  await (await need(pr.getByRole('link', { name: 'jana@example.com' }), 'the e-mail link')).click();
  const ext = await eventually(() => core.externalOpened(), (x) => x.length > 0, 2000);
  assert.deepEqual(ext, ['mailto:jana@example.com'], 'a mailto: link through open_external');
});

test('fr_lnk_10_ac5_adding_a_body_replaces_the_properties_with_the_strip_and_body', async ({ page }) => {
  const { core, dlg } = await previewOf(page, 'Osoby', 0, 'Jana Nováková');
  await need(dlg.getByRole('region', { name: 'Properties', exact: true }), 'Properties region first');
  await core.setFile(PV.jana, (await fileText(core, PV.jana))! + 'Poznámky.\n');
  const items = await eventually(() => stripItems(dlg), (x) => JSON.stringify(x) === JSON.stringify(['Firma Beta a.s.', 'Role Analytička']), 2000);
  assert.deepEqual(items, ['Firma Beta a.s.', 'Role Analytička'], 'the strip appears within 2 s');
  assert.equal(await dlg.getByRole('region', { name: 'Properties', exact: true }).count(), 0, 'the Properties region is replaced');
  assert.equal(await textOf(anyContent(dlg)), 'Poznámky.', 'the body');
});

test('fr_lnk_10_ac6_empty_note_without_attributes_says_empty_note', async ({ page }) => {
  const { dlg } = await previewOf(page, 'Prázdná', 0, 'Prázdná');
  const h = await needHeader(dlg, 'Preview: Prázdná');
  assert.deepEqual([h.icon, h.title, h.rest], ['file-text', 'Prázdná', 'Page'], 'the Page icon, Prázdná, Page');
  assert.equal(await strip(dlg).count(), 0, 'no strip');
  assert.equal(await textOf(anyContent(dlg)), 'Empty note', 'the body text Empty note (embed.empty)');
});

test('fr_lnk_10_ac7_section_link_shows_exactly_the_section', async ({ page }) => {
  await startPreviews(page, { at: PV.odkazy });
  await (await needOdkazyLink(page, 'Sekce')).click();
  const dlg = await need(page.getByRole('dialog', { name: /^Preview: Rozpočet 2027( › Rozsah)?$/ }), 'the preview of [[Rozpočet 2027#Rozsah]]');
  const h = await needHeader(dlg, 'section preview');
  assert.equal(h.title, 'Rozpočet 2027 › Rozsah', 'the header title (D-156)');
  const seq = (await contentSequence(anyContent(dlg))).map((x) => (x.startsWith('IMG:') ? 'IMG' : x));
  assert.deepEqual(seq, ['P:Personál, cestování a nástroje. Odpovídá Jana Nováková.', 'IMG', 'H4:Podrobnosti', 'P:Cestování je omezeno na dvě akce ročně.'],
    'exactly the R105 section; nothing from Otevřené otázky on');
  await (await need(dlg.getByRole('button', { name: /^Open Rozpočet 2027/ }), 'button Open')).click();
  await mustBeOn(page, 'Rozpočet 2027', 'Open opens note/Pages/Rozpočet 2027.md#Rozsah', 5000);
  const hd = await need(main(page).locator('h2, h3, h4').filter({ hasText: /^\s*Rozsah\s*$/ }), 'the heading Rozsah');
  const top = await eventually(() => topBelowToolbar(hd), (t) => t !== null && Math.abs(t - 24) <= 8, 2000);
  assert.ok(top !== null && Math.abs(top - 24) <= 8, `Rozsah 24 px below the top (± 8 px, D-1625, D-1659): ${top}`);
});

test('fr_lnk_10_ac7_block_link_shows_only_the_block', async ({ page }) => {
  const { dlg } = await previewOf(page, 'Blok', 0, 'Rozpočet 2027');
  assert.equal((await needHeader(dlg, 'block preview')).title, 'Rozpočet 2027', 'the title Rozpočet 2027');
  assert.deepEqual(await contentSequence(anyContent(dlg)), ['P:Kdo schvaluje nákup licencí?'], 'only the block');
});

test('fr_lnk_10_ac7_missing_heading_shows_the_notice_above_the_whole_body', async ({ page }) => {
  await startPreviews(page, { at: PV.odkazy });
  await (await needOdkazyLink(page, 'Chybějící sekce')).click();
  const dlg = await need(page.getByRole('dialog', { name: /^Preview: Rozpočet 2027( › Neexistující nadpis)?$/ }), 'the preview of the missing heading');
  assert.equal((await needHeader(dlg, 'missing heading')).title, 'Rozpočet 2027 › Neexistující nadpis', 'header');
  const text = flat(await dlg.innerText());
  const i = text.indexOf('No heading "Neexistující nadpis" in Rozpočet 2027.');
  assert.ok(i >= 0, 'the notice embed.noHeading');
  const seq = await contentSequence(anyContent(dlg));
  assert.equal(seq.filter((x) => x.startsWith('P:') || x.startsWith('H')).length >= 8, true, `the whole body follows: ${seq.join(' | ')}`);
  assert.ok(i < text.indexOf('Návrh rozpočtu na rok 2027'), 'the notice is above the body');
});

test('fr_lnk_10_ac8_task_preview_shows_the_box_icon_strip_and_no_controls', async ({ page }) => {
  const { dlg } = await previewOf(page, 'Úkol', 0, 'Zavolat Janě');
  const h = await needHeader(dlg, 'task preview');
  assert.ok(h.icon && h.icon !== 'check-square', `the To do box icon (D-600) instead of the Task icon: ${h.icon}`);
  assert.deepEqual([h.title, h.rest], ['Zavolat Janě', 'Task'], 'title and type');
  assert.deepEqual(await stripItems(dlg), ['Status To do', 'Priority High', 'Due date Fri, Oct 30'], 'the strip (the Tasks page\'s R44 label in en-US, D-947; not overdue)');
  assert.equal(await textOf(anyContent(dlg)), 'Domluvit termín schůzky k rozpočtu.', 'the body');
  assert.equal(await dlg.getByRole('checkbox').count(), 0, 'no checkbox');
  const controls = (await dlg.getByRole('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label') ?? (b as HTMLElement).innerText)))
    .map((x) => flat(x)).filter((x) => !/^(Close preview|Open Zavolat Janě|Resize preview|Back to .*)$/.test(x));
  assert.deepEqual(controls, [], 'no control that changes the task');
});

test('fr_lnk_10_ac8_overdue_due_date_after_the_clock_moves', async ({ page }) => {
  const { dlg } = await previewOf(page, 'Úkol', 0, 'Zavolat Janě', { now: '2026-10-31T10:00:00+01:00' });
  const s = await need(strip(dlg), 'strip');
  const due = await need(s.getByText(/Fri, Oct 30 · Yesterday/), 'the due item "Fri, Oct 30 · Yesterday" (the Tasks page\'s R44 label in en-US, D-947)');
  const colour = await due.evaluate((e) => getComputedStyle(e).color);
  assert.equal(colour, await tokenColour(page, 'light', 'danger'), 'the overdue style (danger, FR-TSK-09 AC-2)');
});

test('fr_lnk_10_ac9_existing_daily_note_preview_and_open', async ({ page }) => {
  const { core, dlg } = await previewOf(page, 'Dny', 0, '2026-10-07');
  const h = await needHeader(dlg, 'daily preview');
  assert.deepEqual([h.icon, h.title, h.rest], ['calendar', '2026-10-07', 'Daily Note'], 'header');
  assert.deepEqual(await stripItems(dlg), ['Date Oct 7, 2026'], 'strip');
  assert.equal(await textOf(anyContent(dlg)), 'Zápis dne. Viz Rozpočet 2027.', 'body');
  await (await need(openBtn(dlg, '2026-10-07'), 'Open 2026-10-07')).click();
  await need(page.getByRole('textbox', { name: 'Title', exact: true }), 'daily/2026-10-07', 5000);
  assert.deepEqual(await writesSince(core, 0), [], 'nothing written');
});

for (const zone of ['Europe/Prague', 'America/Los_Angeles'] as const) {
  test.describe(zone, () => {
    test.use({ timezoneId: zone });
    test(`fr_lnk_10_ac9_virtual_day_preview_writes_nothing_${zone.replace(/\W/g, '_')}`, async ({ page }) => {
      const now = zone === 'Europe/Prague' ? '2026-10-28T10:00:00+01:00' : '2026-10-28T02:00:00-07:00';
      const { core, dlg } = await previewOf(page, 'Dny', 1, '2026-10-30', { now });
      const h = await needHeader(dlg, 'virtual day');
      assert.deepEqual([h.icon, h.title, h.rest], ['calendar', '2026-10-30', 'Daily Note'], 'header (dates never shift, FR-FMT-11)');
      assert.equal(await strip(dlg).count(), 0, 'no strip');
      assert.equal(await textOf(anyContent(dlg)), 'No note for this day yet.', 'embed.noDay');
      assert.equal((await callsSince(core, 0, 'daily_draft')).length, 0, 'the preview calls no daily_draft (v1-previews §2)');
      await (await need(openBtn(dlg, '2026-10-30'), 'Open 2026-10-30')).click();
      await need(page.getByRole('textbox', { name: 'Title', exact: true }), 'the virtual daily/2026-10-30', 5000);
      assert.deepEqual(await writesSince(core, 0), [], 'neither the preview nor Open writes');
      assert.equal(await fileText(core, 'Daily/2026-10-30.md'), undefined, 'no Daily/2026-10-30.md');
    });
  });
}

test('fr_lnk_10_ac10_tag_preview_lists_the_tagged_objects', async ({ page }) => {
  const { dlg } = await previewOf(page, 'Štítky', 0, '#Účty');
  const h = await needHeader(dlg, 'tag preview');
  assert.deepEqual([h.title, h.rest], ['#Účty', 'Tag'], 'title and type name');
  const blue = await header(dlg).evaluate((hd) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--type-blue)';
    probe.style.background = 'var(--type-blue-bg)';
    document.body.appendChild(probe);
    const want = [getComputedStyle(probe).color, getComputedStyle(probe).backgroundColor];
    probe.remove();
    return [...hd.querySelectorAll('*')].some((e) => { const s = getComputedStyle(e); return want.includes(s.backgroundColor) || want.includes(s.color) || e.getAttribute('data-color') === 'blue'; });
  });
  assert.equal(blue, true, 'the tag tile in blue');
  const text = flat(await anyContent(dlg).first().innerText().catch(() => ''));
  assert.ok(text.startsWith('2 objects'), `"2 objects": ${text}`);
  const chips = (await anyContent(dlg).getByRole('link').allInnerTexts()).map(flat);
  assert.deepEqual(chips, ['Rozpočet 2027', 'Odkazy'], 'the chips, most recently modified first');
  await (await need(openBtn(dlg, '#Účty'), 'Open #Účty')).click();
  await need(main(page).getByRole('heading', { level: 1, name: /^#?Účty$/ }), 'Open opens tag/účty', 5000);
});

test('fr_lnk_10_ac10_wikilink_to_the_tag_file_previews_the_tag', async ({ page }) => {
  const { dlg } = await previewOf(page, 'Štítky', 2, '#Účty');
  assert.equal(await previewPath(dlg), nfc(PV.ucty), '[[Účty]] previews Tags/Účty.md (FR-LNK-08 AC-10)');
  assert.ok(flat(await anyContent(dlg).first().innerText().catch(() => '')).startsWith('2 objects'), '[[Účty]] shows the same Tag preview');
});

test('fr_lnk_10_ac10_virtual_tag_preview_writes_nothing', async ({ page }) => {
  const { core, dlg } = await previewOf(page, 'Štítky', 1, '#nápad');
  const h = await needHeader(dlg, 'virtual tag');
  assert.deepEqual([h.title, h.rest], ['#nápad', 'Tag'], 'header');
  const text = flat(await anyContent(dlg).first().innerText().catch(() => ''));
  assert.ok(text.startsWith('1 object') && !text.startsWith('1 objects'), `"1 object" (the one plural form): ${text}`);
  assert.deepEqual((await anyContent(dlg).getByRole('link').allInnerTexts()).map(flat), ['Odkazy'], 'the chip Odkazy');
  await page.keyboard.press('Escape');
  assert.deepEqual(await writesSince(core, 0), [], 'nothing written');
  assert.equal(await fileText(core, 'Tags/nápad.md'), undefined, 'no Tags/nápad.md');
});

test('fr_lnk_10_ac11_image_object_preview_shows_the_fitted_image', async ({ page }) => {
  for (const n of [0, 1]) {
    const { dlg } = n === 0 ? await previewOf(page, 'Média', 0, 'Graf') : { dlg: await clickToPreview(page, await needOdkazyLink(page, 'Média', 1), 'Graf', '[[graf.png]]') };
    const h = await needHeader(dlg, `image preview ${n}`);
    assert.deepEqual([h.icon, h.title, h.rest], ['image', 'Graf', 'Image'], 'header');
    assert.deepEqual(await stripItems(dlg), ['Width 64', 'Height 48'], 'strip');
    const img = await need(anyContent(dlg).getByRole('img', { name: 'Graf', exact: true }), 'img alt Graf');
    const src = (await img.getAttribute('src')) ?? '';
    assert.ok(/graf\.png/.test(decodeURIComponent(src)), `the image of _attachments/graf.png: ${src}`);
    const geo = await img.evaluate((i) => {
      const a = i.closest('article')!.getBoundingClientRect();
      const r = i.getBoundingClientRect();
      const cs = getComputedStyle(i.closest('article')!);
      return { w: r.width, h: r.height, cw: a.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) };
    });
    assert.ok(geo.h <= 240 + 1, `at most 240 px high: ${geo.h}`);
    assert.ok(Math.abs(geo.w / geo.h - 64 / 48) * geo.h <= 1, `aspect ratio kept: ${JSON.stringify(geo)}`);
    assert.ok(Math.abs(geo.w - Math.min(geo.cw, 240 * 64 / 48)) <= 1, `fit to the content width: ${JSON.stringify(geo)}`);
    assert.equal(await textOf(anyContent(dlg)), '', 'no other text');
    await page.keyboard.press('Escape');
    await sleep(200);
  }
});

test('fr_lnk_10_ac11_pdf_object_preview_shows_the_card_and_body', async ({ page }) => {
  const { dlg } = await previewOf(page, 'Média', 2, 'Smlouva');
  const h = await needHeader(dlg, 'pdf preview');
  assert.deepEqual([h.icon, h.title, h.rest], ['file', 'Smlouva', 'PDF'], 'header');
  assert.deepEqual(await stripItems(dlg), ['Pages 2'], 'strip');
  const text = flat(await anyContent(dlg).first().innerText().catch(() => ''));
  assert.ok(/^Smlouva\b/.test(text) && /2 pages · 844 bytes/.test(text), `the R77 PDF card: the title Smlouva and "2 pages · 844 bytes" (D-946): ${text}`);
  assert.ok(text.endsWith('Podepsaná verze smlouvy.'), 'then the body');
});

test('fr_lnk_10_ac11_missing_image_file_shows_the_missing_state', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy });
  await core.setBinary(PV.png, null);
  await sleep(300);
  const dlg = await clickToPreview(page, await needOdkazyLink(page, 'Média', 0), 'Graf', '[[Graf]] without its file');
  assert.ok(flat(await dlg.innerText()).includes('Can\'t find "graf.png"'), 'the missing-file state of trash-media R77');
  assert.deepEqual(await stripItems(dlg), ['Width 64', 'Height 48'], 'the rest of the preview stays');
});

test('fr_lnk_10_ac12_invalid_frontmatter_shows_the_stem_notice_and_body', async ({ page }) => {
  const { dlg } = await previewOf(page, 'Prázdná', 1, 'Neplatná hlavička');
  const h = await needHeader(dlg, 'invalid frontmatter');
  assert.deepEqual([h.icon, h.title, h.rest], ['file-text', 'Neplatná hlavička', 'Page'], 'header (title from the stem)');
  const text = flat(await dlg.innerText());
  assert.ok(text.includes('This note\'s properties can\'t be read.'), 'the notice preview.readError');
  assert.equal(await textOf(anyContent(dlg)), 'Tělo s odkazem na Rozpočet 2027.', 'the body');
  assert.equal(await dlg.getByRole('button', { name: /fix|repair/i }).count(), 0, 'no fix offered');
});

test('fr_lnk_10_ac12_invalid_utf8_and_unreadable_files', async ({ page }) => {
  const bad = new Uint8Array([...new TextEncoder().encode('---\nid: 01JBPV0000000000000000P040\ntype: page\ntitle: Vadná\n---\nZačátek '), 0xff, 0xfe, ...new TextEncoder().encode(' konec.\n')]);
  const vault = previewsVault((f) => { f[nfc(PV.odkazy)] += '\nVadná [[Vadná]].\n'; });
  const core = await startPreviews(page, { at: PV.odkazy, vault });
  await core.setFile('Pages/Vadná.md', bad);
  await sleep(400);
  const dlg = await clickToPreview(page, await needOdkazyLink(page, 'Vadná'), 'Vadná', 'invalid UTF-8');
  const text = flat(await anyContent(dlg).first().innerText().catch(() => ''));
  assert.ok(text.includes('�'), `the decoded text with U+FFFD: ${text}`);
  assert.ok(flat(await dlg.innerText()).includes('This note\'s properties can\'t be read.'), 'the same notice');
});

test('fr_lnk_10_ac13_inbox_member_shows_unreviewed_and_reviewed_quick_note_does_not', async ({ page }) => {
  const { core, dlg } = await previewOf(page, 'Nápad', 0, 'Nápad na podcast');
  const h = await needHeader(dlg, 'inbox member');
  assert.ok(h.rest.startsWith('Unreviewed') || h.text.includes('Nápad na podcast Unreviewed'), `"Unreviewed" after the title: ${h.text}`);
  await page.keyboard.press('Escape');
  const d2 = await clickToPreview(page, await needOdkazyLink(page, 'Dvojníci', 1), 'Plán', 'Quick Notes/Plán');
  assert.ok(!(await needHeader(d2, 'reviewed')).text.includes('Unreviewed'), 'Plán (reviewed) shows no Unreviewed');
  assert.deepEqual(await writesSince(core, 0), [], 'previewing never changes review');
});

test('fr_lnk_10_ac14_long_body_is_windowed_and_complete', async ({ page }) => {
  const vault = previewsVault((f) => { f[nfc(PV.odkazy)] += '\nDlouhá [[Dlouhá]].\n'; });
  const core = await startPreviews(page, { at: PV.odkazy, vault });
  const dlg = await clickToPreview(page, await needOdkazyLink(page, 'Dlouhá'), 'Dlouhá', 'Dlouhá');
  const ready = await eventually(async () => (await callsSince(core, 0, 'perf_mark')).some((c) => (c.args as any)?.name === 'preview-ready'), (x) => x, 2000);
  assert.ok(ready, 'the preview-ready mark');
  const art = await need(anyContent(dlg), 'content');
  const first = await contentSequence(art);
  assert.deepEqual(first.slice(0, 3), ['H3:Kapitola 1', 'P:Odstavec 1.', 'P:Odstavec 2.'], 'the first paragraphs are shown');
  // Scroll the body to its end in steps; collect the windowed blocks' texts in order of first appearance.
  const texts: string[] = [];
  const have = new Set<string>();
  let maxDom = 0;
  for (let i = 0; i < 3000; i++) {
    const r = await art.evaluate((a) => {
      let s: HTMLElement | null = a as HTMLElement;
      while (s && !/(auto|scroll)/.test(getComputedStyle(s).overflowY)) s = s.parentElement;
      const blocks = [...a.querySelectorAll('p, h1, h2, h3, h4, h5, h6')] as HTMLElement[];
      const end = !s || s.scrollTop + s.clientHeight >= s.scrollHeight - 1;
      if (s) s.scrollTop += Math.max(1, s.clientHeight * 0.8);
      return { out: blocks.map((b) => (b.innerText ?? '').trim().normalize('NFC')), end };
    });
    maxDom = Math.max(maxDom, r.out.length);
    for (const t of r.out) if (!have.has(t)) { have.add(t); texts.push(t); }
    if (r.end) break;
    await sleep(16);
  }
  assert.ok(maxDom <= 300, `at most 300 block elements in the DOM while scrolling (max ${maxDom})`);
  const want = dlouhaBlocks();
  assert.equal(texts[texts.length - 1], 'Odstavec 3000.', 'the last block is Odstavec 3000.');
  assert.deepEqual(texts, want, 'every block appears once, in file order');
});

test('fr_lnk_10_ac15_duplicate_titles_show_their_details_and_unique_titles_do_not', async ({ page }) => {
  const { dlg } = await previewOf(page, 'Dvojníci', 0, 'Plán');
  assert.equal((await needHeader(dlg, 'Pages/Plán')).rest, 'Page · Oct 6, 2026', 'Pages/Plán details (D-289)');
  await page.keyboard.press('Escape');
  const d2 = await clickToPreview(page, await needOdkazyLink(page, 'Dvojníci', 1), 'Plán', 'Quick Notes/Plán');
  assert.equal((await needHeader(d2, 'Quick Notes/Plán')).rest, 'Quick Note · Oct 6, 2026', 'Quick Notes/Plán details');
  await page.keyboard.press('Escape');
  const d3 = await clickToPreview(page, await needOdkazyLink(page, 'Hlavní'), 'Rozpočet 2027', 'unique title');
  assert.equal((await needHeader(d3, 'Rozpočet')).rest, 'Page', 'only Page');
});
