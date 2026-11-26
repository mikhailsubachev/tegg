// Bug #180 (QA review of slice AND-3, finding 5; owner D-2570 (3)): the merge banner makes the editor non-editable
// (android-edit §10.6, FR-SYN-03 AC-41), but a tap on a checklist box (§7.7) still toggled its item, and `Keep mine`
// then wrote a toggle the user never saw in `Compare`. A box does nothing until a choice is made. L5p (phone-webkit,
// phone-chromium).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  EDIT_NOW, PE, editVault, eventually, keyboard, mergeBanner, must, needBody, nfc, noteBody, setCaret, sleep, startPhone, tap, tapToEdit, type PhoneHandle,
} from './phone-helpers';
import { ime } from './phone-ime';

test.use({ timezoneId: 'Europe/Prague' });

const PSANI = nfc(PE.psani);
// Psaní with paragraphs before its lists, so the checklist sits below the banner (which covers the top of the body).
const vault = () => editVault((f) => { f[PSANI] = f[PSANI].replace('# Nákup\n', `# Nákup\n\n${Array.from({ length: 8 }, (_v, i) => `Odstavec ${i + 1}.`).join('\n\n')}\n`); });

async function open(page: Page): Promise<PhoneHandle> {
  const core = await startPhone(page, { vault: vault(), route: `note/${PE.psani}`, now: EDIT_NOW });
  await needBody(page, PE.psani);
  return core;
}
const box = (page: Page, item: string) => noteBody(page).locator('.checklist-item').filter({ hasText: item }).getByRole('checkbox');

test('bug_180_fr_syn_03_checklist_box_does_nothing_under_the_merge_banner', async ({ page }) => {
  const core = await open(page);
  // An unsaved X (writes held), then another device's version: the banner.
  await core.writeControl({ hold: true });
  await tapToEdit(page, 'Konec');
  await setCaret(page, 'Konec.', 'end');
  await ime(page, [{ text: 'X' }]);
  const theirs = vault().files[PSANI].replace('Konec.', 'Konec z jiného zařízení.');
  await core.setFile(PE.psani, theirs);
  await core.release();
  const banner = await must(mergeBanner(page), 'the alert "Changed outside Tegg"', 2000);
  await keyboard(page, false); // the banner hides the keyboard (android_ime(false)): the full screen again
  await sleep(150);
  // A tap on Zavolat's box changes nothing.
  assert.equal(await box(page, 'Zavolat').getAttribute('aria-checked'), 'false', 'Zavolat starts unchecked');
  const hit = await box(page, 'Zavolat').evaluate((b) => {
    const r = b.getBoundingClientRect();
    const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!e && (e === b || b.contains(e)) ? true : `${JSON.stringify(r)} ${e?.outerHTML.slice(0, 200)}`;
  });
  assert.equal(hit, true, 'the box is not covered (the tap reaches it)');
  await tap(page, box(page, 'Zavolat'), 'Zavolat\'s box');
  await sleep(300);
  assert.equal(await box(page, 'Zavolat').getAttribute('aria-checked'), 'false', 'the box stays unchecked under the banner');
  // Keep mine writes the editor's version: X, and no toggle.
  const n = (await core.calls()).length;
  await banner.getByRole('button', { name: 'Keep mine', exact: true }).click();
  const writes = await eventually(async () => (await core.calls()).slice(n).filter((c) => c.cmd === 'note_write' && c.ok !== undefined), (x) => x.length >= 1, 2000);
  assert.equal(writes.length, 1, 'Keep mine sends one note_write');
  const text = String((writes[0].args as any)?.text ?? '');
  assert.ok(text.includes('Konec.X'), 'the unsaved X is written');
  assert.ok(text.includes('- [ ] Zavolat'), `Zavolat stays unchecked in the written file: ${JSON.stringify(text.slice(-120))}`);
});
