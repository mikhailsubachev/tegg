// v1.0 slice P, L5 (WebKit + fake core): Settings › Previews and the Object preview setting. docs/acceptance/previews.md
// FR-SET-07 AC-1 (the built section), AC-2 L5 part (`ui_state_set` with `preview.mode` hover and `preview.hoverDelay`
// 600, no vault write), AC-4 (palette commands, focus returns D-139, the radios carry the command ids FR-UX-03 AC-8),
// AC-5 (themes, axe, pseudo-locale); FR-LNK-12 AC-4 (changes apply at once and close an open preview), AC-5 L5 part
// (the slider's limits); FR-LNK-11 AC-4 L5 part, the write rule only (one `ui_state_set` on pointer-up / key-up of a
// resize, a double-click on the handle removes `width` and `height`; the sizes themselves are in previews.ac.test.ts).
// Interface docs/contracts/v1-previews.md §1 (UiStateDto.preview), §3.3 (the resize handle), §4 (settings), §6
// (commands), §9 (fake core). Written from the ACs and the contract only (D-61). Every lookup goes through
// `must`/node:assert (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { pseudoLocale } from './helpers';
import {
  ODK, PV, axeContrastIn, block, callCount, chipIn, colourLeaksIn, controlsWithoutCommand, description, editorBody, eventually, focusInside,
  isDisabled, main, mainName, must, mustBeOn, mustCaret, needPreview, noteWrites, openPv, previewCount, previewOfSet, previewsVault, runCommand,
  seen, sleep, startPv, uiSets, unmarkedIn, writeCmds, type FakeCoreHandle, type PreviewUi,
} from './previews-editor-helpers';
import { createHash } from 'node:crypto';

test.use({ timezoneId: 'Europe/Prague' });

const CLICK = 'Click to preview, double-click to open';
const HOVER = 'Hover to preview, click to open';
const OFF = 'Off: click opens';
const RADIOS = [CLICK, HOVER, OFF];
const CMD_IDS: Record<string, string> = { [CLICK]: 'preview.mode.click', [HOVER]: 'preview.mode.hover', [OFF]: 'preview.mode.off' };

const group = (page: Page) => main(page).getByRole('radiogroup', { name: /^⟦?Object preview⟧?$/ });
const radio = (page: Page, name: string) => group(page).getByRole('radio', { name: new RegExp(`^⟦?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}⟧?$`) });
const slider = (page: Page) => main(page).getByRole('slider', { name: /^⟦?Hover delay⟧?$/ });

async function needSection(page: Page, what: string): Promise<Locator> {
  await must(main(page).getByRole('heading', { name: /^⟦?Previews⟧?$/ }), `${what}: heading "Previews"`, 5000);
  return must(group(page), `${what}: radiogroup "Object preview"`, 2000);
}
async function gotoPreviews(page: Page, what: string) {
  await runCommand(page, 'Go to Settings: Previews');
  return needSection(page, what);
}
async function checkedRadios(page: Page): Promise<string[]> {
  const out: string[] = [];
  for (const n of RADIOS) {
    const r = radio(page, n);
    if (!(await seen(r, 300))) continue;
    const c = await r.first().evaluate((e) => (e as HTMLInputElement).checked === true || e.getAttribute('aria-checked') === 'true');
    if (c) out.push(n);
  }
  return out;
}
async function sliderState(page: Page) {
  const s = await must(slider(page), 'slider "Hover delay"');
  return s.evaluate((e) => ({
    min: e.getAttribute('aria-valuemin') ?? (e as HTMLInputElement).min ?? null,
    max: e.getAttribute('aria-valuemax') ?? (e as HTMLInputElement).max ?? null,
    now: e.getAttribute('aria-valuenow') ?? (e as HTMLInputElement).value ?? null,
    text: e.getAttribute('aria-valuetext'),
    disabled: e.getAttribute('aria-disabled') === 'true' || (e as HTMLInputElement).disabled === true,
  }));
}
const hash = (files: Record<string, string>) => createHash('sha256').update(JSON.stringify(Object.entries(files).sort())).digest('hex');
async function lastPreview(core: FakeCoreHandle): Promise<PreviewUi | undefined> {
  return (await core.uiState())?.preview;
}

// ------------------------------------------------------------------------------------------------ FR-SET-07 AC-1

test('fr_set_07_ac1_the_previews_section_is_built', async ({ page }) => {
  const core = await startPv(page, PV.odkazy);
  await gotoPreviews(page, 'Go to Settings: Previews');
  assert.equal(await main(page).getByText(/Coming in/).count(), 0, 'no "Coming in" text remains');
  const names = (await group(page).getByRole('radio').evaluateAll((rs) => rs.map((r) => {
    const id = r.getAttribute('aria-labelledby');
    return (r.getAttribute('aria-label') ?? (id ? document.getElementById(id)?.textContent : null) ?? (r as HTMLInputElement).labels?.[0]?.textContent ?? r.textContent ?? '').replace(/\s+/g, ' ').trim();
  })));
  assert.deepEqual(names, RADIOS, 'the three radios in order');
  assert.deepEqual(await checkedRadios(page), [CLICK], 'Click to preview is checked by default');
  const s = await sliderState(page);
  assert.deepEqual({ min: s.min, max: s.max, now: s.now, text: s.text }, { min: '200', max: '1500', now: '400', text: '400 ms' }, 'slider Hover delay 200…1500, 400, "400 ms"');
  assert.equal(s.disabled, true, 'the slider is aria-disabled unless hover is checked');
  assert.equal(await description(slider(page)), 'Used with Hover to preview.', 'the note "Used with Hover to preview."');
  assert.ok(await seen(main(page).getByText('Used with Hover to preview.', { exact: true }), 500), 'the note is shown');
  // Arrow keys move within the radiogroup.
  await radio(page, CLICK).first().focus();
  await page.keyboard.press('ArrowDown');
  await sleep(60);
  assert.equal(await focusInside(radio(page, HOVER)), true, '↓ moves to "Hover to preview, click to open"');
  await page.keyboard.press('ArrowUp');
  await sleep(60);
  assert.equal(await focusInside(radio(page, CLICK)), true, '↑ moves back');
  await page.keyboard.press('ArrowRight');
  await sleep(60);
  assert.equal(await focusInside(radio(page, HOVER)), true, '→ moves too');
  await page.keyboard.press('ArrowLeft');
  await sleep(60);
  assert.equal(await focusInside(radio(page, CLICK)), true, '← moves too');
  // The slider: ←/→ by 100 ms, Home/End to the limits (enabled in hover mode).
  await radio(page, HOVER).first().click();
  assert.equal((await sliderState(page)).disabled, false, 'the slider is enabled with hover checked');
  await slider(page).first().focus();
  await page.keyboard.press('ArrowRight');
  assert.equal((await sliderState(page)).now, '500', '→ adds 100 ms');
  await page.keyboard.press('ArrowLeft');
  assert.equal((await sliderState(page)).now, '400', '← takes 100 ms');
  await page.keyboard.press('End');
  assert.deepEqual([(await sliderState(page)).now, (await sliderState(page)).text], ['1500', '1500 ms'], 'End: 1500');
  await page.keyboard.press('Home');
  assert.deepEqual([(await sliderState(page)).now, (await sliderState(page)).text], ['200', '200 ms'], 'Home: 200');
  // Also reached from the Settings section list.
  await runCommand(page, 'Go to Settings: Appearance');
  await (await must(main(page).getByRole('link', { name: 'Previews', exact: true }).or(main(page).getByRole('tab', { name: 'Previews', exact: true })), 'section "Previews" in the Settings list')).click();
  await needSection(page, 'the Settings section list');
  assert.deepEqual(await core.writesTo(), [], 'nothing written to the vault');
});

// ------------------------------------------------------------------------------------------------ FR-SET-07 AC-2 (L5)

test('fr_set_07_ac2_hover_and_600_ms_are_stored_machine_local_and_the_vault_is_untouched', async ({ page }) => {
  const core = await startPv(page, PV.odkazy);
  const before = hash(await core.files());
  await gotoPreviews(page, 'Settings: Previews');
  const from = await callCount(core);
  await (await must(radio(page, HOVER), 'radio Hover')).click();
  await slider(page).first().focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const st = await eventually(() => lastPreview(core), (p) => p?.mode === 'hover' && p?.hoverDelay === 600, 2000);
  assert.deepEqual({ mode: st?.mode, hoverDelay: st?.hoverDelay }, { mode: 'hover', hoverDelay: 600 }, 'ui_state_set stores preview.mode = hover and preview.hoverDelay = 600');
  const sets = await uiSets(core, from);
  assert.ok(sets.length >= 1, 'stored through ui_state_set (Application Support, the store of the theme)');
  assert.deepEqual({ mode: previewOfSet(sets[sets.length - 1])?.mode, hoverDelay: previewOfSet(sets[sets.length - 1])?.hoverDelay }, { mode: 'hover', hoverDelay: 600 }, 'the last ui_state_set holds both');
  assert.deepEqual(await writeCmds(core, from), [], 'no vault write command');
  assert.deepEqual(await core.writesTo(), [], 'no file written or created');
  assert.equal(hash(await core.files()), before, 'every vault file and .tegg/ byte-identical');
});

// ------------------------------------------------------------------------------------------------ FR-SET-07 AC-4

test('fr_set_07_ac4_palette_commands_set_the_mode_and_return_the_focus', async ({ page }) => {
  const core = await startPv(page, PV.odkazy);
  await must(editorBody(page), 'the editor on Odkazy', 5000);
  for (const [cmd, mode] of [['Object preview: Hover to preview', 'hover'], ['Object preview: Off', 'off'], ['Object preview: Click to preview', 'click']] as const) {
    await mustCaret(block(page, 3), 'Sek', `caret in "Sekce" before ${cmd}`);
    await runCommand(page, cmd);
    const st = await eventually(() => lastPreview(core), (p) => p?.mode === mode, 2000);
    assert.equal(st?.mode, mode, `${cmd} stores preview.mode = ${mode}`);
    assert.equal(await seen(page.getByRole('dialog', { name: 'Command palette' }), 300), false, `${cmd} closes the palette`);
    assert.equal(await focusInside(editorBody(page)), true, `${cmd}: the focus returns to the editor (D-139)`);
  }
  // From another route with a vault, and the radios follow.
  await runCommand(page, 'Go to Inbox');
  await mustBeOn(page, 'Inbox', 'Go to Inbox');
  await runCommand(page, 'Object preview: Hover to preview');
  assert.equal((await eventually(() => lastPreview(core), (p) => p?.mode === 'hover', 2000))?.mode, 'hover', 'from the Inbox too');
  await gotoPreviews(page, 'Settings: Previews');
  assert.deepEqual(await checkedRadios(page), [HOVER], 'the radio follows the palette');
  // The radios carry the command ids (FR-UX-03 AC-8).
  for (const n of RADIOS) {
    const r = await must(radio(page, n), `radio ${n}`);
    assert.equal(await r.getAttribute('data-command'), CMD_IDS[n], `radio "${n}" carries data-command="${CMD_IDS[n]}"`);
  }
  assert.deepEqual(await controlsWithoutCommand(main(page)), [], 'FR-UX-03 AC-8: every control on settings/previews carries a command');
  assert.deepEqual(await core.writesTo(), [], 'no vault write');
});

// ------------------------------------------------------------------------------------------------ FR-SET-07 AC-5

for (const theme of ['light', 'dark'] as const) {
  test(`fr_set_07_ac5_the_section_in_${theme}_with_each_radio_checked`, async ({ page }) => {
    await startPv(page, null, { route: 'settings/previews', theme });
    await needSection(page, `settings/previews in ${theme}`);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme, `theme ${theme}`);
    for (const n of RADIOS) {
      await (await must(radio(page, n), `radio ${n}`)).click();
      await sleep(100);
      const scope = main(page);
      assert.deepEqual(await axeContrastIn(page, scope), [], `${theme}, ${n}: axe color-contrast`);
      assert.deepEqual(await colourLeaksIn(scope, theme), [], `${theme}, ${n}: only theme tokens (FR-UX-05 AC-5)`);
    }
  });
}

test('fr_set_07_ac5_every_text_of_the_section_is_a_catalog_string', async ({ page }) => {
  await startPv(page, null, { route: 'settings/previews', prelude: pseudoLocale });
  await needSection(page, 'settings/previews (pseudo-locale)');
  assert.deepEqual(await unmarkedIn(main(page)), [], 'every text and accessible name of settings/previews is inside ⟦ ⟧');
  await (await must(radio(page, HOVER), 'radio Hover')).click();
  await sleep(100);
  assert.deepEqual(await unmarkedIn(main(page)), [], 'also with hover checked (the slider value text)');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-12 AC-4

test('fr_lnk_12_ac4_a_mode_change_applies_at_once_and_closes_an_open_preview', async ({ page }) => {
  await startPv(page, PV.odkazy);
  await must(editorBody(page), 'the editor on Odkazy', 5000);
  const chip = await must(chipIn(page, 1, 'Rozpočet 2027'), 'chip Rozpočet 2027');
  assert.equal(await description(chip), CLICK, 'in click mode the chip describes its mode');
  await chip.click();
  await needPreview(page, 'Rozpočet 2027', 'click mode');
  await runCommand(page, 'Object preview: Off');
  assert.equal(await eventually(() => previewCount(page), (n) => n === 0, 1500), 0, 'the mode change closes the open preview');
  assert.equal(await mainName(page), 'Odkazy', 'still on Odkazy (no reload, no route change)');
  assert.equal(await description(chipIn(page, 1, 'Rozpočet 2027')), '', 'Off: no mode description');
  await chipIn(page, 1, 'Rozpočet 2027').first().click();
  await mustBeOn(page, 'Rozpočet 2027', 'Off: the next click opens', 5000);
  assert.equal(await previewCount(page), 0, 'Off: no popover');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Odkazy', 'Back');
  await runCommand(page, 'Object preview: Hover to preview');
  await must(chipIn(page, 1, 'Rozpočet 2027'), 'chip');
  assert.equal(await description(chipIn(page, 1, 'Rozpočet 2027')), HOVER, 'hover: the chip describes hover mode');
  await runCommand(page, 'Object preview: Click to preview');
  await chipIn(page, 1, 'Rozpočet 2027').first().click();
  await needPreview(page, 'Rozpočet 2027', 'back in click mode the next click previews');
  // Settings changes apply the same way.
  await gotoPreviews(page, 'Settings: Previews');
  await (await must(radio(page, OFF), 'radio Off')).click();
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Odkazy', 'Back to Odkazy');
  await chipIn(page, 1, 'Rozpočet 2027').first().click();
  await mustBeOn(page, 'Rozpočet 2027', 'Off chosen in Settings: the click opens', 5000);
});

// ------------------------------------------------------------------------------------------------ FR-LNK-12 AC-5 (L5)

test('fr_lnk_12_ac5_hover_delay_limits_and_steps', async ({ page }) => {
  const core = await startPv(page, null, { route: 'settings/previews', preview: { mode: 'hover', hoverDelay: 1500 } });
  await needSection(page, 'settings/previews');
  assert.equal((await sliderState(page)).now, '1500', 'a stored 1500 is shown');
  await slider(page).first().focus();
  await page.keyboard.press('ArrowRight');
  assert.equal((await sliderState(page)).now, '1500', '1500 is the maximum');
  await page.keyboard.press('ArrowUp');
  assert.equal((await sliderState(page)).now, '1500', '↑ stays at the maximum');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowLeft');
  assert.equal((await sliderState(page)).now, '200', '200 is the minimum');
  await page.keyboard.press('ArrowRight');
  assert.deepEqual([(await sliderState(page)).now, (await sliderState(page)).text], ['300', '300 ms'], 'steps of 100 ms');
  assert.equal((await eventually(() => lastPreview(core), (p) => p?.hoverDelay === 300, 2000))?.hoverDelay, 300, 'stored 300');
  // It applies only in hover mode: the slider is disabled in the other modes.
  await (await must(radio(page, OFF), 'radio Off')).click();
  assert.equal(await isDisabled(slider(page)), true, 'Off: the slider is disabled');
  await (await must(radio(page, CLICK), 'radio Click')).click();
  assert.equal(await isDisabled(slider(page)), true, 'Click: the slider is disabled');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-11 AC-4 (L5, the write rule)

test('fr_lnk_11_ac4_a_resize_is_stored_once_on_key_up_and_pointer_up_and_a_double_click_resets', async ({ page }) => {
  const core = await startPv(page, PV.odkazy, { preview: { mode: 'click' } });
  await must(editorBody(page), 'the editor on Odkazy', 5000);
  await (await must(chipIn(page, 1, 'Rozpočet 2027'), 'chip')).click();
  const dlg = await needPreview(page, 'Rozpočet 2027', 'click');
  const handle = await must(dlg.locator('[data-preview-resize][role="button"]'), 'the handle "Resize preview"');
  assert.equal(await handle.getAttribute('aria-label'), 'Resize preview', 'named "Resize preview"');
  const w0 = (await dlg.boundingBox())!.width;
  assert.ok(Math.abs(w0 - 380) <= 1, `default width 380 px (got ${w0})`);
  // Keyboard: nothing is stored while the key is down; one ui_state_set on key-up.
  await handle.focus();
  let from = await callCount(core);
  await page.keyboard.down('ArrowRight');
  await sleep(150);
  assert.deepEqual(await uiSets(core, from), [], 'no ui_state_set while the key is down');
  await page.keyboard.up('ArrowRight');
  const k = await eventually(() => uiSets(core, from), (s) => s.length > 0, 1500);
  assert.equal(k.length, 1, 'exactly one ui_state_set on key-up');
  assert.equal(previewOfSet(k[0])?.width, 396, 'preview.width = 380 + 16');
  // Pointer: nothing while dragging; one ui_state_set on pointer-up.
  const hb = (await handle.boundingBox())!;
  from = await callCount(core);
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(hb.x + hb.width / 2 + i * 10, hb.y + hb.height / 2 + i * 8); await sleep(30); }
  assert.deepEqual(await uiSets(core, from), [], 'no ui_state_set while dragging');
  await page.mouse.up();
  const p = await eventually(() => uiSets(core, from), (s) => s.length > 0, 1500);
  assert.equal(p.length, 1, 'exactly one ui_state_set on pointer-up');
  const stored = previewOfSet(p[0]);
  const box = (await dlg.boundingBox())!;
  assert.ok(stored?.width !== undefined && Math.abs(stored.width - box.width) <= 1, `the stored width is the new width (${stored?.width} vs ${box.width})`);
  assert.ok(stored?.height !== undefined && Math.abs(stored.height - box.height) <= 1, `the stored height is the new height (${stored?.height} vs ${box.height})`);
  assert.equal(stored?.mode, 'click', 'the mode is kept');
  // A double-click on the handle removes width and height.
  from = await callCount(core);
  await handle.dblclick();
  const r = await eventually(() => uiSets(core, from), (s) => s.some((c) => previewOfSet(c)?.width === undefined), 1500);
  const last = previewOfSet(r[r.length - 1]);
  assert.ok(r.length >= 1 && last !== undefined && !('width' in last) && !('height' in last), `the double-click removes preview.width and preview.height: ${JSON.stringify(last)}`);
  assert.equal(last?.mode, 'click', 'the mode stays');
  assert.deepEqual(await noteWrites(core), [], 'resizing writes nothing to the vault');
  assert.deepEqual(await core.writesTo(), [], 'no vault file written');
});

// Keep the shared vault loader referenced for readers of this file (the fixture of previews.md).
void previewsVault; void ODK; void PV;
