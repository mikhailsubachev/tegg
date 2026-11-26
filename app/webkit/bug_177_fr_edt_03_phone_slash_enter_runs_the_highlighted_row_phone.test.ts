// Bug #177 (QA review of slice AND-3, finding 2; owner D-2570 (2)): on the phone the `/` panel drew contract §4.4's
// rows (android-edit §4.4, FR-EDT-03 AC-6) while ↑/↓, `slash.sel` and Enter used the desktop's full list, so `/tab`,
// `/ima` + Enter ran rows the phone never offers (Image sends `media_add*`, D-2518), and `+` opened the New object menu.
// Now one list, §4.4's rows, serves the panel, the keys and Enter; `+` opens nothing on the phone. L5p (phone-webkit,
// phone-chromium).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { EDIT_NOW, PE, editVault, flat, needBody, panel, savedText, setCaret, sleep, startPhone, tapToEdit, type PhoneHandle } from './phone-helpers';
import { ime } from './phone-ime';
import { absent } from './helpers';

test.use({ timezoneId: 'Europe/Prague' });

async function open(page: Page): Promise<PhoneHandle> {
  const core = await startPhone(page, { vault: editVault(), route: `note/${PE.psani}`, now: EDIT_NOW });
  await needBody(page, PE.psani);
  await tapToEdit(page, 'Konec');
  await setCaret(page, 'Konec.', 'end');
  return core;
}
const slashPanel = (page: Page) => panel(page, 'Insert block');
const highlighted = async (page: Page) => flat(await slashPanel(page).locator('[role="option"][aria-selected="true"]').first().innerText()).split(' ').slice(0, 2).join(' ');

test('bug_177_fr_edt_03_phone_slash_enter_runs_the_highlighted_row', async ({ page }) => {
  const core = await open(page);
  // `/` then ↑ wraps to the last of §4.4's rows: Divider is highlighted, and Enter runs it.
  await ime(page, [{ enter: true }, { text: '/' }]);
  assert.ok(await slashPanel(page).isVisible(), 'the Insert block panel is open');
  await page.keyboard.press('ArrowUp');
  await sleep(100);
  assert.equal(await highlighted(page), 'Divider', 'ArrowUp from the first row highlights the last phone row');
  await ime(page, [{ enter: true }]);
  const out = await savedText(core, PE.psani, 3000);
  assert.ok(out && /Konec\.\n\n(---|\*\*\*|___)\n/.test(out), `Enter runs the highlighted row (a divider): ${JSON.stringify(out?.slice(-40))}`);
});

test('bug_177_fr_edt_03_phone_slash_enter_never_runs_a_row_the_phone_drops', async ({ page }) => {
  const core = await open(page);
  // `/tab` + Enter: no phone row matches, so no table is inserted.
  await ime(page, [{ enter: true }, { text: '/tab' }]);
  await sleep(150);
  await ime(page, [{ enter: true }]);
  await sleep(300);
  await ime(page, [{ text: 'x' }]);
  const out = await savedText(core, PE.psani, 3000);
  assert.ok(out !== null, 'the edit is saved');
  assert.ok(!/^\|.*\|$/m.test(out!), `no table is inserted: ${JSON.stringify(out!.slice(-60))}`);
  // `/ima` + Enter: no `media_add*` command is ever sent from the phone (D-2518).
  await ime(page, [{ enter: true }, { text: '/ima' }]);
  await sleep(150);
  await ime(page, [{ enter: true }]);
  await sleep(500);
  const media = (await core.calls()).filter((c) => c.cmd.startsWith('media_add'));
  assert.deepEqual(media.map((c) => c.cmd), [], '`/ima` + Enter sends no media_add* command');
});

test('bug_177_fr_edt_03_phone_plus_opens_nothing', async ({ page }) => {
  const core = await open(page);
  await ime(page, [{ enter: true }, { text: '+' }]);
  assert.ok(await absent(slashPanel(page), 800), '`+` opens no Insert block panel on the phone');
  assert.ok(await absent(page.getByRole('listbox'), 300), '`+` opens no menu at all');
  await ime(page, [{ enter: true }]);
  await sleep(300);
  assert.ok(await absent(page.getByRole('dialog'), 500), '`+` then Enter opens no New object dialog');
  const creates = (await core.calls()).filter((c) => /^(note_create|link_create)/.test(c.cmd));
  assert.deepEqual(creates.map((c) => c.cmd), [], 'no object is created');
});
