// Issue #108: a pointer move onto a preset sets the menu's active item, whose effect focuses it; a click before that
// render's effects ran asked for the focus to go back to `Preset: …`, and the late item focus took it away again, so
// the focus ended on the body when the menu closed (FR-GRP-02 AC-27).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { focused, menuRadio, must, openPresetMenu, presetIs, presetsText, sleep, waitDrawn } from './graph-helpers';
import { GP, P, VIEWPORT, openPanel, openPopover, popover } from './graph-panel-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US', viewport: VIEWPORT });

test('bug_108_fr_grp_02_a_click_right_after_the_pointer_moves_onto_a_preset_focuses_the_preset_button', async ({ page }) => {
  await openPanel(page, P.plan, { presets: presetsText('valid'), panel: { sizeByLinks: true, view: 'graph' } });
  await waitDrawn(page, 10, 4000, GP(page));
  await openPopover(page);
  await must(popover(page).getByRole('button', { name: /^Preset: / }), 'the popover\'s preset row');
  await openPresetMenu(page);
  const item = await must(menuRadio(page, 'Bez štítků'), 'the menu item Bez štítků');
  // The click lands right after the move's render is committed (the item turns active), before React runs that
  // render's effects: a mutation observer's callback comes first.
  await item.evaluate((el) => new Promise<void>((done) => {
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    const mo = new MutationObserver(() => {
      if (!el.classList.contains('active')) return;
      mo.disconnect();
      (el as HTMLElement).focus();
      el.dispatchEvent(new MouseEvent('click', at));
      done();
    });
    mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    el.dispatchEvent(new PointerEvent('pointermove', at));
  }));
  await sleep(400);
  assert.ok(await presetIs(page, 'Bez štítků'), 'Bez štítků is applied');
  const f = await focused(page);
  assert.ok(f.name.startsWith('Preset: '), `the focus is on the preset button (got ${JSON.stringify(f)})`);
});
