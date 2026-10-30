// QA review of slice G3 (§16.4, D-907, D-1123): a Tegg rename changes `preset` in the views that name the renamed
// preset by the one name rule of `presets.ts` (`nameKey`: Unicode White_Space trim, not U+FEFF; NFC; lower case), the
// rule `currentPreset` uses. A view whose stored name differs only by a U+FEFF (which `String.prototype.trim` strips)
// doesn't name the preset, so its `preset` stays as it was.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { P, click, eventually, fullState, menuItem, must, openGraph, openPresetMenu, panelState, presetIs, presetsText, presetsVault, renameField, uiG3, uiWrites } from './graph-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US' });

const JEN = { hiddenTypes: [] as string[], hiddenKinds: ['link', 'embed', 'tag'], preset: 'Jen vztahy' };

test('bug_qag3_fr_grp_02_rename_updates_only_views_naming_the_preset_by_name_key', async ({ page }) => {
  const core = await openGraph(page, P.plan, { vault: presetsVault(presetsText('valid')), uiState: uiG3({ full: JEN, panel: { ...JEN, preset: '﻿Jen vztahy' } }) });
  assert.ok(await presetIs(page, 'Jen vztahy'), 'Jen vztahy is current in the full view');
  await openPresetMenu(page);
  await click(menuItem(page, 'Rename “Jen vztahy”…'), 'Rename “Jen vztahy”…');
  const w0 = (await uiWrites(core)).length;
  await (await must(renameField(page), 'Preset name')).fill('Vztahy');
  await page.keyboard.press('Enter');
  await eventually(async () => (await uiWrites(core)).length, (n) => n > w0, 3000);
  assert.deepEqual([(await fullState(core))?.preset, (await panelState(core))?.preset], ['Vztahy', '﻿Jen vztahy'], 'the full view follows the rename; the panel view, which names no listed preset, keeps its name');
});
