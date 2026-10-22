// v0.52 feedback, L5 (WebKit + fake core): embeds. docs/acceptance/embeds.md FR-EMB-02 AC-16 (a link-mode block embed
// keeps `Display as`, D-598, D-428), AC-17 (the `Default embed mode` radios are a visible control), AC-18 (Unreviewed
// frames, D-600). Interface docs/contracts/ms3-shell.md §16.1, §16.2 (`LinkEmbed` renders the chip then the
// `Display as` button for a block embed), ms4-embeds §6–§9 (R30 roles and data attributes). Written from the ACs and the
// contracts only (D-61). Every lookup goes through `must`/node:assert (TS-I1). Test clock 2026-10-17T10:00:00+02:00,
// Europe/Prague, region en-US.
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  M, MODIFIED, bodyOf, displayAsButton, displayAsMenu, editorBody, embedModeGroup, eventually, fileWhen, gotoSettings, headerText,
  main, modeItem, must, mustBeSaved, needEmbeds, needFrame, nfc, openEmbeds, original, runCommand, seen, sleep, swap, topEmbeds, writes,
  type EmbedInfo, type FakeCoreHandle,
} from './embeds-helpers';
import { selectTop } from './convert-helpers';
import { amber, bgBehind, dots, styleOf, transparent } from './v052-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const REZ = () => original(M.rezimy);
/** Host blocks of Režimy (1-based): 6 = `![[Saturnin]]` (Kniha's default link), 12 = `![[Svíčková|link]]`. */
const SATURNIN_BLOCK = 6;
const SVICKOVA_LINK_BLOCK = 12;
const hostBlockAt = (page: Page, n: number) => editorBody(page).locator(':scope > *').nth(n - 1);

async function savedFile(page: Page, core: FakeCoreHandle, path: string, ok: (t: string | undefined) => boolean, ms = 3000): Promise<string> {
  await sleep(150);
  await mustBeSaved(page, ms);
  const t = await fileWhen(core, path, ok, ms);
  assert.ok(t !== undefined, `${path} exists`);
  return t!;
}
/** The chip (link-mode embed) of host block `n` and whether a `Display as` button follows it in the same block. */
async function chipThenDisplayAs(page: Page, n: number): Promise<{ chip: boolean; button: boolean; after: boolean }> {
  const blk = hostBlockAt(page, n);
  assert.ok(await seen(blk, 5000), `host block ${n}`);
  return blk.evaluate((b) => {
    const chip = b.querySelector('[data-embed-mode="link"]');
    const btn = [...b.querySelectorAll('button, [role="button"]')].find((x) => (x.getAttribute('aria-label') ?? (x as HTMLElement).innerText ?? '').trim() === 'Display as');
    return { chip: !!chip, button: !!btn, after: !!chip && !!btn && !!(chip.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING) };
  });
}

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-16

test('fr_emb_02_ac16_link_mode_block_embeds_show_their_chip_then_display_as', async ({ page }) => {
  await openEmbeds(page, M.rezimy);
  const l = await eventually(() => topEmbeds(main(page)).catch(() => [] as EmbedInfo[]), (x) => x.length >= 12, 5000);
  assert.deepEqual([l[4]?.mode, l[10]?.mode], ['link', 'link'], 'setup: Saturnin (Kniha default) and Svíčková|link are link-mode embeds');
  for (const [n, what] of [[SATURNIN_BLOCK, '![[Saturnin]]'], [SVICKOVA_LINK_BLOCK, '![[Svíčková|link]]']] as const) {
    assert.deepEqual(await chipThenDisplayAs(page, n), { chip: true, button: true, after: true }, `${what}: its chip followed by a "Display as" button (D-598)`);
  }
  // Inline embeds (inside text) stay chips without the button: their mode is always link (D-419).
  const page2 = await page.context().newPage();
  await openEmbeds(page2, M.uvnitr);
  await needEmbeds(main(page2), 5, 'Uvnitř textu');
  await sleep(300);
  assert.equal(await displayAsButton(main(page2)).count(), 0, 'Uvnitř textu: no "Display as" on an inline embed');
  await page2.close();
});

test('fr_emb_02_ac16_choosing_full_on_svickova_writes_the_type_default', async ({ page }) => {
  const core = await openEmbeds(page, M.rezimy);
  await needEmbeds(main(page), 12, 'Režimy');
  const btn = await must(displayAsButton(hostBlockAt(page, SVICKOVA_LINK_BLOCK)), '![[Svíčková|link]]: button "Display as" after the chip');
  await btn.click();
  await must(displayAsMenu(page), 'menu "Display as"');
  assert.equal(await modeItem(page, 'Link').getAttribute('aria-checked'), 'true', 'Link is checked');
  await (await must(modeItem(page, 'Full'), 'menuitemradio Full')).click();
  const t = await savedFile(page, core, M.rezimy, (x) => !(x ?? '').includes('![[Svíčková|link]]'));
  assert.equal(t, swap(swap(REZ(), '![[Svíčková|link]]', '![[Svíčková]]'), 'modified: 2026-10-02T08:00:00+02:00', MODIFIED), '![[Svíčková]] (Recept\'s default is full, D-416) and modified only');
  assert.equal((await writes(core, M.rezimy)).length, 1, 'one autosave');
  const l = await eventually(() => topEmbeds(main(page)).catch(() => [] as EmbedInfo[]), (x) => x[10]?.mode === 'full', 2000);
  assert.equal(l[10]?.mode, 'full', 'the embed becomes a full frame');
});

test('fr_emb_02_ac16_display_embed_as_on_the_selected_saturnin_sets_card', async ({ page }) => {
  const core = await openEmbeds(page, M.rezimy);
  await needEmbeds(main(page), 12, 'Režimy');
  const sel = await selectTop(page, SATURNIN_BLOCK);
  assert.deepEqual(sel, [SATURNIN_BLOCK], "Saturnin's block is selected (D-428)");
  await runCommand(page, 'Display embed as…');
  assert.ok(await seen(displayAsMenu(page), 1500), 'Display embed as… opens the "Display as" menu on a selected link-mode block embed (D-598)');
  await (await must(modeItem(page, 'Card'), 'menuitemradio Card')).click();
  const t = await savedFile(page, core, M.rezimy, (x) => (x ?? '').includes('![[Saturnin|card]]'));
  assert.equal(bodyOf(t), bodyOf(REZ()).replace('![[Saturnin]]', '![[Saturnin|card]]'), 'writes ![[Saturnin|card]]');
});

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-17

const TASK_FULL = () => swap(original(M.taskYml), 'preview: [status, priority, due]\n', 'preview: [status, priority, due]\nembed: full\n');

/** The look of the three `Default embed mode` radios. */
async function radioLooks(page: Page): Promise<{ name: string; checked: boolean; cursor: string; bg: string; behind: string }[]> {
  const g = await must(embedModeGroup(page), 'radiogroup "Default embed mode"');
  const out: { name: string; checked: boolean; cursor: string; bg: string; behind: string }[] = [];
  for (const name of ['Full', 'Card', 'Link']) {
    const r = await must(g.getByRole('radio', { name, exact: true }), `radio ${name}`);
    const s = await styleOf(r);
    out.push({ name, checked: (await r.getAttribute('aria-checked')) === 'true', cursor: s.cursor, bg: s.bg, behind: await bgBehind(g) });
  }
  return out;
}
function assertControlLook(looks: Awaited<ReturnType<typeof radioLooks>>, checked: string, how: string) {
  assert.deepEqual(looks.filter((l) => l.checked).map((l) => l.name), [checked], `${how}: ${checked} is the checked radio`);
  for (const l of looks) assert.equal(l.cursor, 'pointer', `${how}: ${l.name} has cursor: pointer`);
  const on = looks.find((l) => l.checked)!;
  assert.ok(!transparent(on.bg), `${how}: the checked radio (${on.name}) has a background (got ${on.bg})`);
  assert.notEqual(on.bg, on.behind, `${how}: the checked radio's background differs from the page behind it`);
  for (const l of looks.filter((x) => !x.checked)) assert.notEqual(l.bg, on.bg, `${how}: ${l.name} (unchecked) looks different from ${on.name} (checked)`);
}

for (const theme of ['light', 'dark'] as const) {
  test(`fr_emb_02_ac17_default_embed_mode_radios_are_a_visible_control_${theme}`, async ({ page }) => {
    const core = await openEmbeds(page, M.rezimy, { theme });
    await gotoSettings(page, 'Tasks', 'Task');
    assertControlLook(await radioLooks(page), 'Card', `${theme}, Task's default`);
    await (await must(embedModeGroup(page).getByRole('radio', { name: 'Full', exact: true }), 'radio Full')).click();
    assert.equal(await fileWhen(core, M.taskYml, (x) => (x ?? '').includes('embed: full'), 3000), TASK_FULL(), 'clicking Full writes embed: full to .tegg/types/task.yml');
    assertControlLook(await eventually(() => radioLooks(page), (l) => l.find((x) => x.checked)?.name === 'Full', 2000), 'Full', `${theme}, after clicking Full`);
  });
}

test('fr_emb_02_ac17_arrow_keys_still_move_the_choice', async ({ page }) => {
  await openEmbeds(page, M.rezimy);
  await gotoSettings(page, 'Tasks', 'Task');
  const g = await must(embedModeGroup(page), 'radiogroup "Default embed mode"');
  assertControlLook(await radioLooks(page), 'Card', 'before the keys');
  await g.getByRole('radio', { name: 'Card', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assertControlLook(await eventually(() => radioLooks(page), (l) => l.find((x) => x.checked)?.name === 'Link', 1500), 'Link', '→ moves to Link');
  await page.keyboard.press('ArrowLeft');
  assertControlLook(await eventually(() => radioLooks(page), (l) => l.find((x) => x.checked)?.name === 'Card', 1500), 'Card', '← back to Card');
});

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-18

/** The header of a frame: whether it shows `Unreviewed` after the title, and an amber 6 px dot. */
async function unreviewedMark(f: Locator, title: string): Promise<{ text: boolean; dot: boolean }> {
  const h = await headerText(f);
  const ti = h.indexOf(nfc(title));
  const ui = h.indexOf('Unreviewed');
  const head = f.locator(':scope > *').first();
  const ds = (await dots(head)).filter(([w, , bg]) => Math.abs(w - 6) <= 1 && amber(bg));
  return { text: ti >= 0 && ui > ti, dot: ds.length >= 1 };
}

test('fr_emb_02_ac18_an_unreviewed_quick_note_frame_shows_the_dot_and_unreviewed', async ({ page }) => {
  const core = await openEmbeds(page, M.vlozeniDvojnika);
  const f = await needFrame(main(page), 'Rychlý dvojník', 'the full frame of Quick Notes/Dvojník.md');
  assert.equal(await f.getAttribute('data-embed-mode'), 'full', 'setup: a full frame');
  assert.deepEqual(await unreviewedMark(f, 'Rychlý dvojník'), { text: true, dot: true }, 'an amber dot and "Unreviewed" after the title (a Quick Note without review is an Inbox member, D-600)');
  await core.setFile(M.dvojnikQ, swap(original(M.dvojnikQ), 'title: Rychlý dvojník\n', 'title: Rychlý dvojník\nreview: reviewed\n'));
  const after = await eventually(async () => unreviewedMark(await needFrame(main(page), 'Rychlý dvojník'), 'Rychlý dvojník'), (m) => !m.text && !m.dot, 2000);
  assert.deepEqual(after, { text: false, dot: false }, 'after review: reviewed is written outside Tegg both are gone within 2 s');
});

test('fr_emb_02_ac18_page_frames_without_review_show_neither', async ({ page }) => {
  // Red guard first: the Quick Note frame of AC-18 is marked (else "neither" below would pass without the feature).
  await openEmbeds(page, M.vlozeniDvojnika);
  assert.deepEqual(await unreviewedMark(await needFrame(main(page), 'Rychlý dvojník'), 'Rychlý dvojník'), { text: true, dot: true }, 'guard: the unreviewed Quick Note frame is marked');
  const p2 = await page.context().newPage();
  await openEmbeds(p2, M.rezimy);
  for (const t of ['Cíl', 'Jana Nováková']) {
    const f = await needFrame(main(p2), t, `frame ${t}`);
    assert.deepEqual(await unreviewedMark(f, t), { text: false, dot: false }, `${t} (a Page / Osoba without review): neither`);
  }
  await p2.close();
});
