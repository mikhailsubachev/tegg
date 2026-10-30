// MS5 slice 5A-2, L5 (WebKit + fake core): removing the embed keeps the object (D-27). docs/acceptance/conversion.md
// FR-CNV-08 AC-1 (asked the first time, for every removing action), AC-2 (Don't ask again, machine-local), AC-3 (one
// dialog for several), AC-4 (the object is untouched), AC-5 (only converted objects ask; moves, undo and redo never).
// AC-6 is [MS6] (trashed placeholder with Restore) and is written with slice 6A. Interface docs/contracts/ms5-tasks.md
// §11.3 (`guardEmbedRemoval`), §11.4 `removeGuard.ts` (a converted object = a resolved target whose `source` resolves
// to the host; `UiStateDto.convert.skipRemoveConfirm`), R54 strings. Written from the ACs and the contracts only (D-61).
//
// The "after FR-CNV-03 AC-2" state is set up as its exact bytes (Bloky with the embed, the task with
// `source: "[[Bloky]]"`), so these tests exercise only the removal guard.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { copyOrCut, paste } from './editor-helpers';
import { switchPreviewMode } from './helpers';
import {
  C, NOW, ZAVOLAT, ZAVOLAT_PARA, ZAVOLAT_TASK, absent, blockMenu, caretAfter, convertVault, eventually, fileText, hostText, must, mustBeOn, openConvert,
  original, removeDialog, saved, seen, selectTop, selectedBlocks, sleep, swap, topIndexOf, touched, writeLog, writesOf, type FakeCoreHandle,
  switchTo,
} from './convert-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const B0 = original(C.bloky);
const EMBED = `![[${ZAVOLAT}]]\n`;
/** Bloky right after FR-CNV-03 AC-2 and the task it created (FR-CNV-03 AC-1 bytes). */
const PRE = swap(B0, ZAVOLAT_PARA, EMBED);
const TASK = `---\nid: 01JB5A0000000000000000W401\ntype: task\ntitle: ${ZAVOLAT}\nstatus: To do\nsource: "[[Bloky]]"\ncreated: ${NOW}\nmodified: ${NOW}\n---\na domluvit termín.\n`;
const UVODNI = 'Tasks/Úvodní úkol.md';
const UVODNI_TASK = `---\nid: 01JB5A0000000000000000W402\ntype: task\ntitle: Úvodní úkol\nstatus: To do\nsource: "[[Bloky]]"\ncreated: ${NOW}\nmodified: ${NOW}\n---\n`;
const AFTER_REMOVE = touched(swap(PRE, `${EMBED}\n`, ''));
const ASK_TEXT = `"${ZAVOLAT}" stays in Tasks and keeps its link to this note. Only the embed is removed.`;

function convertedVault(two = false) {
  return convertVault((f) => {
    f[C.bloky] = two ? swap(PRE, 'Úvodní odstavec.\n', '![[Úvodní úkol]]\n') : PRE;
    f[ZAVOLAT_TASK] = TASK;
    if (two) f[UVODNI] = UVODNI_TASK;
  });
}
async function onBloky(page: Page, o: { skip?: boolean; two?: boolean } = {}): Promise<FakeCoreHandle> {
  const core = await openConvert(page, C.bloky, { vault: convertedVault(o.two), convert: o.skip === undefined ? undefined : { lastType: null, skipRemoveConfirm: o.skip } });
  await eventually(() => topIndexOf(page, ZAVOLAT), (i) => i > 0, 5000);
  return core;
}
/** Selects the embed of the new task as a block. */
async function selectEmbed(page: Page) {
  const n = await topIndexOf(page, ZAVOLAT);
  assert.ok(n > 0, 'the embed is shown');
  assert.deepEqual(await selectTop(page, n), [n], 'the embed is selected as a block');
}
async function needAsk(page: Page, how: string) {
  return must(page.getByRole('alertdialog', { name: 'Remove the embed?', exact: true }), `${how}: alertdialog "Remove the embed?"`, 2000);
}

// ------------------------------------------------------------------------------------------------ AC-1

test('fr_cnv_08_ac1_backspace_asks_with_the_r54_texts', async ({ page }) => {
  await onBloky(page);
  await selectEmbed(page);
  await page.keyboard.press('Backspace');
  const d = await needAsk(page, '⌫');
  assert.ok((await d.innerText()).replace(/\s+/g, ' ').includes(ASK_TEXT), `the text names the title and Tasks: ${ASK_TEXT}`);
  await must(d.getByRole('checkbox', { name: 'Don\'t ask again', exact: true }), 'checkbox "Don\'t ask again"');
  const rm = await must(d.getByRole('button', { name: 'Remove embed', exact: true }), 'button "Remove embed"');
  await must(d.getByRole('button', { name: 'Cancel', exact: true }), 'button "Cancel"');
  assert.equal(await rm.evaluate((e) => document.activeElement === e), true, 'Remove embed is the default (focused)');
});

test('fr_cnv_08_ac1_cancel_and_esc_change_nothing', async ({ page }) => {
  const core = await onBloky(page);
  for (const how of ['Cancel', 'Escape'] as const) {
    await selectEmbed(page);
    await page.keyboard.press('Backspace');
    const d = await needAsk(page, `⌫ (${how})`);
    if (how === 'Cancel') await d.getByRole('button', { name: 'Cancel', exact: true }).click();
    else await page.keyboard.press('Escape');
    assert.ok(await absent(removeDialog(page), 1000), `${how} closes the dialog`);
    assert.equal(await hostText(page), PRE, `${how}: the document is unchanged`);
  }
  await sleep(1300);
  assert.deepEqual(await writeLog(core), [], 'nothing written');
});

test('fr_cnv_08_ac1_remove_embed_removes_the_paragraph_and_saves_bloky_only', async ({ page }) => {
  const core = await onBloky(page);
  const v = await core.version(ZAVOLAT_TASK);
  await selectEmbed(page);
  await page.keyboard.press('Backspace');
  const d = await needAsk(page, '⌫');
  await d.getByRole('button', { name: 'Remove embed', exact: true }).click();
  const b = await saved(page, core, C.bloky, (x) => x === AFTER_REMOVE);
  assert.equal(b, AFTER_REMOVE, 'the embed paragraph is removed');
  await sleep(1300);
  assert.deepEqual([...new Set(await writeLog(core))], [`note_write ${C.bloky}`], 'Bloky only');
  assert.deepEqual(await core.version(ZAVOLAT_TASK), v, 'the task file isn\'t touched');
  await caretAfter(page, 'Úvodní odstavec.');
  await page.keyboard.press('Meta+z');
  assert.equal(await eventually(() => hostText(page), (t) => t === touched(PRE), 2000), touched(PRE), 'one ⌘Z brings the embed back (one undo step)');
  assert.equal(await seen(removeDialog(page), 300), false, 'undo doesn\'t ask');
});

const TRIGGERS: { slug: string; act: (page: Page) => Promise<void>; typed?: string }[] = [
  { slug: 'delete_key', act: async (p) => { await p.keyboard.press('Delete'); } },
  { slug: 'block_menu_delete', act: async (p) => { await p.keyboard.press('Meta+/'); await (await must(blockMenu(p).getByRole('menuitem', { name: 'Delete', exact: true }), 'Block actions › Delete')).click(); } },
  { slug: 'cut', act: async (p) => { await copyOrCut(p, 'cut'); } },
  { slug: 'typing_over', act: async (p) => { await p.keyboard.type('x'); }, typed: 'x' },
  { slug: 'pasting_over', act: async (p) => { await paste(p, { plain: 'Vloženo' }); }, typed: 'Vloženo' },
];
for (const t of TRIGGERS) {
  test(`fr_cnv_08_ac1_${t.slug}_asks_too`, async ({ page }) => {
    const core = await onBloky(page);
    await selectEmbed(page);
    await t.act(page);
    const d = await needAsk(page, t.slug);
    await d.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.ok(await absent(removeDialog(page), 1000), 'Cancel closes it');
    assert.equal(await hostText(page), PRE, `${t.slug} + Cancel: unchanged${t.typed ? `, "${t.typed}" not inserted` : ''}`);
    await sleep(1300);
    assert.deepEqual(await writesOf(core, C.bloky), [], 'nothing written');
  });
}

test('fr_cnv_08_ac1_typing_over_with_remove_embed_is_one_step_with_the_text', async ({ page }) => {
  const core = await onBloky(page);
  await selectEmbed(page);
  await page.keyboard.type('x');
  const d = await needAsk(page, 'typing');
  await d.getByRole('button', { name: 'Remove embed', exact: true }).click();
  const b = await saved(page, core, C.bloky, (x) => !!x && !x.includes(EMBED));
  assert.equal(b, touched(swap(PRE, EMBED, 'x\n')), 'the typed text replaces the embed');
  await caretAfter(page, 'Úvodní odstavec.');
  await page.keyboard.press('Meta+z');
  assert.equal(await eventually(() => hostText(page), (t) => t === touched(PRE), 2000), touched(PRE), 'one ⌘Z undoes the removal and the typed text together');
});

// ------------------------------------------------------------------------------------------------ AC-2

test('fr_cnv_08_ac2_dont_ask_again_is_stored_per_machine', async ({ page }) => {
  const core = await onBloky(page);
  await selectEmbed(page);
  await page.keyboard.press('Backspace');
  const d = await needAsk(page, '⌫');
  await d.getByRole('checkbox', { name: 'Don\'t ask again', exact: true }).check();
  await d.getByRole('button', { name: 'Remove embed', exact: true }).click();
  await saved(page, core, C.bloky, (x) => x === AFTER_REMOVE);
  const st = await eventually(() => core.uiState(), (s) => s?.convert?.skipRemoveConfirm === true, 2000);
  assert.equal(st?.convert?.skipRemoveConfirm, true, 'stored in ui-state (Application Support, D-128)');
  const vault = convertedVault();
  const files = await core.files();
  assert.deepEqual(Object.keys(files).filter((p) => files[p] !== vault.files[p]), [C.bloky], 'never in the vault: only Bloky changed');
  await switchTo(page, 'Porada');
  await mustBeOn(page, 'Porada', 'Porada', 5000);
  const n = await eventually(() => topIndexOf(page, 'Zavolat Janě'), (i) => i > 0, 5000);
  assert.deepEqual(await selectTop(page, n), [n], 'T01\'s embed selected');
  await page.keyboard.press('Backspace');
  assert.equal(await seen(removeDialog(page), 500), false, 'in any note, no dialog any more');
  const p = await saved(page, core, C.porada, (x) => !!x && !x.includes('![[Zavolat Janě]]'));
  assert.ok(p && !p.includes('![[Zavolat Janě]]'), 'removed at once');
});

// ------------------------------------------------------------------------------------------------ AC-3

test('fr_cnv_08_ac3_several_embeds_one_dialog', async ({ page }) => {
  const core = await onBloky(page, { two: true });
  assert.deepEqual(await selectTop(page, 2), [2], 'the second embed selected');
  await page.keyboard.press('Shift+ArrowUp');
  assert.deepEqual(await selectedBlocks(page), [1, 2], 'both embeds selected');
  await page.keyboard.press('Backspace');
  await must(removeDialog(page), 'the dialog', 2000);
  assert.equal(await removeDialog(page).count(), 1, 'one dialog for several');
  assert.ok((await removeDialog(page).innerText()).replace(/\s+/g, ' ').includes('Remove 2 embeds? The objects stay and keep their link to this note.'), 'the plural message');
  await removeDialog(page).getByRole('button', { name: 'Remove embed', exact: true }).click();
  const b = await saved(page, core, C.bloky, (x) => !!x && !x.includes(EMBED));
  assert.ok(b && !b.includes('![[Úvodní úkol]]') && !b.includes(EMBED), 'both removed');
  assert.equal(await fileText(core, UVODNI), UVODNI_TASK, 'the objects stay');
  assert.equal(await fileText(core, ZAVOLAT_TASK), TASK, 'the objects stay');
});

// ------------------------------------------------------------------------------------------------ AC-4

test('fr_cnv_08_ac4_the_object_is_untouched', async ({ page }) => {
  const core = await onBloky(page);
  const v = await core.version(ZAVOLAT_TASK);
  await selectEmbed(page);
  await page.keyboard.press('Backspace');
  await (await needAsk(page, '⌫')).getByRole('button', { name: 'Remove embed', exact: true }).click();
  await saved(page, core, C.bloky, (x) => x === AFTER_REMOVE);
  await sleep(500);
  assert.equal(await fileText(core, ZAVOLAT_TASK), TASK, 'bytes kept, including source: "[[Bloky]]"');
  assert.deepEqual(await core.version(ZAVOLAT_TASK), v, 'version (mtime) kept');
  await switchTo(page, ZAVOLAT);
  await mustBeOn(page, ZAVOLAT, 'the task', 5000);
  // D-949: the Source chip is opened with a single click, so this step runs under preview.mode = off.
  await switchPreviewMode(page, core, 'off');
  const chip = await must(page.getByRole('region', { name: 'Properties', exact: true }).locator('[data-link-kind]').filter({ hasText: 'Bloky' }), 'Source chip');
  await chip.click();
  await mustBeOn(page, 'Bloky', 'Bloky', 5000);
  assert.equal(await page.getByRole('main').locator('[data-block-selected]').count(), 0, 'Bloky opens at the top (FR-CNV-04 AC-2)');
});

// ------------------------------------------------------------------------------------------------ AC-5

test('fr_cnv_08_ac5_only_converted_objects_ask', async ({ page }) => {
  const core = await openConvert(page, C.porada);
  const p0 = original(C.porada);
  const n = await eventually(() => topIndexOf(page, 'Zavolat Janě'), (i) => i > 0, 5000);
  assert.deepEqual(await selectTop(page, n), [n], 'T01\'s embed selected');
  await page.keyboard.press('Backspace');
  await (await needAsk(page, 'Porada ⌫ on ![[Zavolat Janě]] (T01\'s source is Porada)')).getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await hostText(page), p0, 'cancelled');
  await selectTop(page, n);
  await page.keyboard.press('Meta+Shift+ArrowUp');
  assert.equal(await seen(removeDialog(page), 400), false, 'moving an embed never asks');
  await saved(page, core, C.porada, (x) => x !== p0);
  await caretAfter(page, 'Konec zápisu.');
  await page.keyboard.press('Meta+z');
  assert.equal(await seen(removeDialog(page), 400), false, 'undo never asks');
  await page.keyboard.press('Meta+Shift+z');
  assert.equal(await seen(removeDialog(page), 400), false, 'redo never asks');
  await switchTo(page, 'Bloky');
  await mustBeOn(page, 'Bloky', 'Bloky', 5000);
  const z = await eventually(() => page.evaluate(() => {
    const b = document.querySelector('[aria-label="Note body"]');
    return b ? [...b.children].findIndex((e) => !!e.querySelector('[data-embed-mode]') || e.hasAttribute('data-embed-mode')) + 1 : 0;
  }), (i) => i > 0, 5000);
  assert.deepEqual(await selectTop(page, z), [z], '![[Zasedačka]] selected');
  await page.keyboard.press('Backspace');
  assert.equal(await seen(removeDialog(page), 500), false, 'Zasedačka has no source: no dialog');
  const b = await saved(page, core, C.bloky, (x) => x !== B0);
  assert.equal(b, touched(swap(B0, '![[Zasedačka]]\n\n', '')), 'removed at once');
});
