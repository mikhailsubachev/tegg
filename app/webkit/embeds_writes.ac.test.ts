// MS4 slice 4F, L5 (WebKit + fake core): embeds and writes. docs/acceptance/embeds.md FR-FMT-07 AC-13 (showing embeds
// writes nothing), AC-14 (a host edit changes one block), FR-SYN-06 AC-10 (L5 part: zero write commands on the tour,
// then one per explicit action, each to its path). Interface docs/contracts/ms4-embeds.md §4 (`embed_load` is a read),
// §6, §7. Written from the ACs and the contracts only (D-61). Every lookup goes through `must`/`seen` and node:assert
// (TS-I1). Test clock 2026-10-17T10:00:00+02:00, Europe/Prague, region en-US.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  M, MODIFIED, TITLES, addBelow, bodyOf, caretAt, displayAsButton, displayAsMenu, editorBody, embedList, embedTextbox,
  needEmbeds, needTop, embedModeGroup, eventually, fileText, fileWhen, gotoNote, gotoSettings, hostBlock, main, modeItem, must, mustBeSaved, mustCaret,
  nfd, openEmbeds, openPicker, original, picker, pickerQuery, pickerList, selectEmbedBlock, sleep, swap, topEmbed, writeCalls, writes, type EmbedInfo,
  type FakeCoreHandle,
} from './embeds-helpers';

test.use({ timezoneId: 'Europe/Prague' });

/** Every fixture note a user opens by title (the tour of FR-FMT-07 AC-13 and FR-SYN-06 AC-10), in three groups for run
 *  time; each group holds hosts with embeds. */
const GROUPS: string[][] = [
  [M.rezimy, M.sekce, M.rozbita, M.uvnitr, M.nfdHost],
  [M.kruhA, M.kruhB, M.samaSebe, M.obsah, M.kartaSebe, M.retez1, M.retez2, M.retez3, M.retez4, M.retez5],
  [M.kosoctverec, M.vetev1, M.vetev2, M.list, M.upravy, M.upravitelna, M.bez, M.vkladani, M.vlozeniDvojnika,
    M.cil, M.jana, M.sarka, M.svickova, M.saturnin, M.zavolat, M.praha, M.denni, M.dvojnikP, M.dvojnikQ, M.ctips],
];

/** Visits the open note: caret in every host block, into and out of every editable embed, every Display as menu
 *  opened and closed with Esc, scroll to the end. Returns how many embeds and editable embeds it met. */
async function tourNote(page: Page): Promise<{ embeds: number; editable: number; menus: number }> {
  const l = await eventually(() => embedList(main(page)).catch(() => [] as EmbedInfo[]), (x) => x.length > 0, 1500);
  const blocks = editorBody(page).locator(':scope > *');
  const n = await blocks.count();
  for (let i = 0; i < n; i++) {
    const b = blocks.nth(i);
    const isEmbedBlock = await b.evaluate((e) => {
      if (e.matches('[data-embed-mode]') || e.querySelector('[data-embed-mode="full"], [data-embed-mode="card"]')) return true;
      const l = e.querySelector('[data-embed-mode="link"]');
      return !!l && (e.textContent ?? '').trim() === (l.textContent ?? '').trim();
    });
    if (isEmbedBlock) continue;
    await caretAt(b, null);
  }
  let editable = 0;
  const tops = main(page).locator('[data-embed-mode]:not([data-embed-mode] [data-embed-mode])');
  const nt = await tops.count();
  for (let i = 0; i < nt; i++) {
    const f = tops.nth(i);
    const box = f.locator('[data-embed-body][data-embed-editable="true"]');
    if ((await box.count()) > 0) {
      editable++;
      await caretAt(box.first(), null);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
    }
  }
  let menus = 0;
  const buttons = main(page).getByRole('button', { name: 'Display as', exact: true });
  for (let i = 0; i < (await buttons.count()); i++) {
    await buttons.nth(i).click().catch(() => {});
    if (await displayAsMenu(page).first().isVisible().catch(() => false)) { menus++; await page.keyboard.press('Escape'); }
  }
  await page.evaluate(() => {
    let s: Element | null = document.querySelector('main [data-embed-mode], main [aria-label="Note body"]');
    while (s && !(s.scrollHeight > s.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    s?.scrollTo(0, s.scrollHeight);
  });
  return { embeds: l.length, editable, menus };
}

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-13

for (const [gi, group] of GROUPS.entries()) {
  test(`fr_fmt_07_ac13_showing_embeds_writes_nothing_group_${gi + 1}`, async ({ page }) => {
    test.setTimeout(240_000);
    const core = await openEmbeds(page, group[0]);
    let embeds = 0, editable = 0, menus = 0;
    for (const p of group) {
      if (p !== group[0]) await gotoNote(page, TITLES[p]);
      const r = await tourNote(page);
      embeds += r.embeds; editable += r.editable; menus += r.menus;
    }
    await gotoNote(page, TITLES[GROUPS[(gi + 1) % GROUPS.length][0]]);
    await sleep(1500);
    assert.ok(embeds > 0, 'the tour met embeds');
    assert.ok(menus > 0, 'the tour opened Display as menus');
    assert.ok(editable > 0, 'the tour entered editable embeds');
    assert.deepEqual((await writeCalls(core)).map((c) => c.cmd), [], 'zero write commands of any kind');
  });
}

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-14

async function saved(page: Page, core: FakeCoreHandle, path: string, ok: (t: string | undefined) => boolean): Promise<string> {
  await sleep(150);
  await mustBeSaved(page);
  const t = await fileWhen(core, path, ok, 3000);
  assert.ok(t !== undefined, `${path} exists`);
  return t!;
}

test('fr_fmt_07_ac14_host_edit_keeps_every_embed_line', async ({ page }) => {
  const core = await openEmbeds(page, M.rezimy);
  await needEmbeds(main(page), 12, 'Režimy');
  await mustCaret(hostBlock(page, 'Před vloženími.'), null, 'end of Před vloženími.');
  await page.keyboard.type(' Doplněno.');
  const t = await saved(page, core, M.rezimy, (x) => (x ?? '').includes('Doplněno'));
  assert.equal(t, swap(swap(original(M.rezimy), 'modified: 2026-10-02T08:00:00+02:00', MODIFIED), 'Před vloženími.', 'Před vloženími. Doplněno.'), 'only that line and modified differ; all 12 embed lines byte-identical');
});

test('fr_fmt_07_ac14_nfd_embed_lines_survive_a_new_paragraph', async ({ page }) => {
  const core = await openEmbeds(page, M.nfdHost);
  await needEmbeds(main(page), 2, 'NFD vložení');
  await (await needTop(main(page), 1, 'the last embed')).hover();
  await (await must(addBelow(page), 'Add block below on the last embed')).click();
  await page.keyboard.type('Nový.');
  const t = await saved(page, core, M.nfdHost, (x) => (x ?? '').includes('Nový.'));
  const orig = original(M.nfdHost);
  assert.equal(t, `${swap(orig, 'modified: 2026-10-02T08:40:00+02:00', MODIFIED)}\nNový.\n`, 'the paragraph added at the end, both embed lines byte-identical');
  assert.ok(t.includes(`![[${nfd('Cíl')}]]\n`) && t.includes(`![[${nfd('Cíl')}#${nfd('Úvod')}]]\n`), 'NFD bytes kept (FR-FMT-12 AC-5)');
});

test('fr_fmt_07_ac14_moving_an_embed_keeps_every_embed_line', async ({ page }) => {
  const core = await openEmbeds(page, M.sekce);
  await needEmbeds(main(page), 7, 'Sekce');
  const sel = await selectEmbedBlock(page, 7);
  assert.deepEqual(sel, [7], '![[Cíl#^chybí]] selected as a block');
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Meta+Shift+ArrowUp'); await sleep(50); }
  const t = await saved(page, core, M.sekce, (x) => bodyOf(x).startsWith('![[Cíl#^chybí]]'));
  const lines = bodyOf(original(M.sekce)).trimEnd().split('\n\n');
  const want = [lines[6], ...lines.slice(0, 6)].join('\n\n') + '\n';
  assert.equal(bodyOf(t), want, 'moved to the top, every embed line byte-identical');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-10 (L5)

test('fr_syn_06_ac10_tour_writes_nothing_then_one_write_per_action', async ({ page }) => {
  test.setTimeout(300_000);
  const core = await openEmbeds(page, M.rezimy);
  await needEmbeds(main(page), 12, 'Režimy');
  // The tour: every host note opened, every embed's Open followed and Back, Display as menus, editable embeds,
  // the picker opened and cancelled, type-settings/osoba visited.
  for (const p of GROUPS.flat()) {
    await gotoNote(page, TITLES[p]);
    await tourNote(page);
    const opens = main(page).getByRole('button', { name: /^Open / });
    const no = await opens.count();
    for (let i = 0; i < no; i++) {
      const b = main(page).getByRole('button', { name: /^Open / }).nth(i);
      if (!(await b.isVisible().catch(() => false))) continue;
      await b.click().catch(() => {});
      await sleep(150);
      await page.keyboard.press('Meta+BracketLeft');
      await sleep(250);
    }
  }
  await gotoNote(page, 'Vkládání');
  await openPicker(page, 'Odstavec před.');
  await page.keyboard.press('Escape');
  await gotoSettings(page, 'Osoby', 'Osoba');
  await gotoNote(page, 'Režimy');
  await sleep(1500);
  assert.deepEqual((await writeCalls(core)).map((c) => c.cmd), [], 'the tour sends no write command');

  const step = async (what: string, want: string, act: () => Promise<void>, done: () => Promise<boolean>) => {
    const n0 = (await writeCalls(core)).length;
    await act();
    assert.ok(await eventually(done, (x) => x, 4000), `${what}: done`);
    await sleep(1500);
    const w = (await writeCalls(core)).slice(n0);
    const paths = [...new Set(w.map((c) => (c.cmd === 'type_patch' ? `.tegg/types/${String((c.args as any)?.key)}.yml` : String((c.args as any)?.path ?? '')).normalize('NFC')))];
    assert.deepEqual(paths, [want.normalize('NFC')], `${what}: exactly ${want}`);
  };
  await gotoNote(page, 'Vkládání');
  await step('slash-menu insertion', M.vkladani, async () => {
    await openPicker(page, 'Odstavec před.');
    await pickerQuery(page, 'cil');
    await (await must(pickerList(page).getByRole('option').first(), 'first option')).click();
  }, async () => (await fileText(core, M.vkladani))?.includes('![[Cíl]]') ?? false);
  await gotoNote(page, 'Režimy');
  await step('Display as change', M.rezimy, async () => {
    await (await must(displayAsButton(topEmbed(main(page), 1)), 'Display as on Jana')).click();
    await (await must(modeItem(page, 'Full'), 'Full')).click();
  }, async () => (await fileText(core, M.rezimy))?.includes('![[Jana Nováková|full]]') ?? false);
  await gotoNote(page, 'Úpravy');
  await step('embed edit', M.upravitelna, async () => {
    const box = await must(embedTextbox(topEmbed(main(page), 0), 'Upravitelná'), 'the Upravitelná editor', 5000);
    await mustCaret(box, 'První odstavec k úpravě.', 'in the embed');
    await page.keyboard.type(' Jednou.');
  }, async () => (await writes(core, M.upravitelna)).length > 0);
  await gotoSettings(page, 'Osoby', 'Osoba');
  await step('default change', M.osobaYml, async () => {
    await (await must(embedModeGroup(page).getByRole('radio', { name: 'Full', exact: true }), 'radio Full')).click();
  }, async () => (await fileText(core, M.osobaYml))?.includes('embed: full') ?? false);
  assert.equal(await picker(page).count(), 0);
});
