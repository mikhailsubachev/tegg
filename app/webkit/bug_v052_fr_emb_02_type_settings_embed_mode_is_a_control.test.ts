// v0.52 feedback H1a, H15 (docs/feedback/ms5-v052.md; embeds.md FR-EMB-02 AC-17): the `Full · Card · Link` radios of
// Type settings › Embeds rendered as three plain words (no rule styled them): the checked one looked like the others,
// there was no pointer cursor, and a click changed nothing visible. Written from the AC only (D-61); every lookup goes
// through `must`/node:assert (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { M, embedModeGroup, eventually, fileWhen, gotoSettings, must, openEmbeds } from './embeds-helpers';
import { bgBehind, styleOf, transparent } from './v052-helpers';

test.use({ timezoneId: 'Europe/Prague' });

test('bug_v052_fr_emb_02_type_settings_embed_mode_is_a_control', async ({ page }) => {
  const core = await openEmbeds(page, M.rezimy);
  await gotoSettings(page, 'Tasks', 'Task');
  const g = await must(embedModeGroup(page), 'radiogroup "Default embed mode"');
  const look = async () => {
    const out: Record<string, { checked: boolean; cursor: string; bg: string }> = {};
    for (const name of ['Full', 'Card', 'Link']) {
      const r = await must(g.getByRole('radio', { name, exact: true }), `radio ${name}`);
      const s = await styleOf(r);
      out[name] = { checked: (await r.getAttribute('aria-checked')) === 'true', cursor: s.cursor, bg: s.bg };
    }
    return out;
  };
  const before = await look();
  assert.equal(before.Card.checked, true, "Card is Task's default");
  assert.deepEqual([before.Full.cursor, before.Card.cursor, before.Link.cursor], ['pointer', 'pointer', 'pointer'], 'every radio has a pointer cursor');
  assert.ok(!transparent(before.Card.bg) && before.Card.bg !== (await bgBehind(g)), `the checked radio is filled (got ${before.Card.bg})`);
  assert.ok(before.Full.bg !== before.Card.bg && before.Link.bg !== before.Card.bg, 'the unchecked radios look different from the checked one');
  await (await must(g.getByRole('radio', { name: 'Full', exact: true }), 'radio Full')).click();
  assert.ok((await fileWhen(core, M.taskYml, (x) => (x ?? '').includes('embed: full'), 3000))?.includes('embed: full'), 'the click writes embed: full');
  const after = await eventually(look, (l) => l.Full.checked, 2000);
  assert.ok(after.Full.checked && after.Full.bg === before.Card.bg && after.Card.bg !== after.Full.bg, 'the checked look moves to Full');
});
