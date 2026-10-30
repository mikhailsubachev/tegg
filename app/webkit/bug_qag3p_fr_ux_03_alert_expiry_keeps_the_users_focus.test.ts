// QA review of slice "G3 in the panel" (FR-UX-03, D-1138 c, D-1157; docs/contracts/v1-graph.md §17.5, §17.11): a
// palette-started rename that ends in Conflict leaves the preset alert (a preset layer) up to 10 s. When it expires, the
// popover the command opened closes and the focus returns where it was before the palette, but only if the user hasn't
// moved the focus since: a Tab to another control in the popover keeps the popover and the focus where the user put them.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { GRAPH_YML, P, must, presetAlert, presetsText, renameField, runCommand, seen, sleep, waitDrawn } from './graph-helpers';
import { GP, VIEWPORT, graphTab, openPanel, popover } from './graph-panel-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US', viewport: VIEWPORT });

const VALID = presetsText('valid');
const THEIRS = `${VALID}  - name: Cizí\n    hidden-types: [page]\n    hidden-kinds: []\n`;
const JEN = { hiddenTypes: [] as string[], hiddenKinds: ['link', 'embed', 'tag'], preset: 'Jen vztahy' };

type Active = { name: string; inPopover: boolean; presetButton: boolean; body: boolean };
const active = (page: Page): Promise<Active> => page.evaluate(() => {
  const e = document.activeElement as HTMLElement | null;
  return {
    name: e?.getAttribute('aria-label') ?? e?.textContent?.trim() ?? '',
    inPopover: !!e?.closest('[role="dialog"]'),
    presetButton: !!e?.closest('[data-command="graph.preset.apply"]'),
    body: !e || e === document.body,
  };
});

/** Plán with Jen vztahy, the focus on the Graph tab, then a palette rename that the changed file refuses (Conflict). */
async function renameConflict(page: Page) {
  const core = await openPanel(page, P.plan, { presets: VALID, panel: { ...JEN }, install: true });
  assert.equal((await waitDrawn(page, 3, 4000, GP(page))).length, 3, 'Jen vztahy in the panel (setup)');
  await (await must(graphTab(page), 'the Graph tab')).focus();
  await runCommand(page, 'Graph: Rename preset…');
  await (await must(renameField(page), 'the rename field the command opened')).fill('Vztahy');
  await core.setFile(GRAPH_YML, THEIRS, { silent: true }); // changed on disk without vault:changed (D-1110)
  await page.keyboard.press('Enter');
  await must(presetAlert(page), 'the Conflict alert', 3000);
  await sleep(150);
}

test('bug_qag3p_fr_ux_03_alert_expiry_keeps_the_users_focus', async ({ page }) => {
  await renameConflict(page);
  await page.keyboard.press('Shift+Tab'); // back to the popover control before the preset row
  const moved = await active(page);
  assert.ok(moved.inPopover && !moved.presetButton && !moved.body, `Tab moved the focus to another popover control (${JSON.stringify(moved)})`);
  await page.clock.runFor(10_500);
  await sleep(250);
  assert.ok(!(await seen(presetAlert(page), 200)), 'the alert expired after 10 s');
  assert.ok(await seen(popover(page), 200), 'the popover stays open: the user went on');
  assert.deepEqual(await active(page), moved, 'the focus stays where the user put it');
});

test('bug_qag3p_fr_ux_03_alert_expiry_without_a_move_closes_and_returns', async ({ page }) => {
  await renameConflict(page);
  await page.clock.runFor(10_500);
  await sleep(250);
  assert.ok(!(await seen(presetAlert(page), 200)), 'the alert expired after 10 s');
  assert.ok(!(await seen(popover(page), 300)), 'the popover the command opened closes with its last layer (D-1138 c)');
  assert.equal(await graphTab(page).evaluate((e) => e === document.activeElement), true, 'the focus returns where it was before the palette');
});
