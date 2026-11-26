// Slice AND-3, L5p (projects `phone-webkit`, `phone-chromium`): docs/acceptance/android-edit.md, saving on the phone:
// - FR-EDT-08 AC-15 (a composition is never saved half-done), AC-16 (L5p: the flush calls on `hidden`), AC-17 (L5p: the
//   recovery hooks);
// - FR-EDT-07 AC-24 (the Properties sheet edits values), AC-25 (what stays read-only), AC-26 (property writes are safe);
// - FR-FMT-07 AC-38 (L5p Chromium: the opening tour writes nothing), AC-39 (L5p: one edit changes one block);
// - FR-FMT-08 AC-11 (names of objects made on the phone).
// Contract docs/contracts/android-edit.md §10.5, §10.6, §11 (`Saver.flush({ composing })`, `flushHidden`,
// `keepForRecovery`, `takeRecovery`), §15.1 (`visibility`), §17.1 (the fake core's recovery commands).
// Red-test readings (reported): "the desktop panel's bytes" of FR-EDT-07 AC-24 are types.md FR-EDT-07 AC-5's written
// values (the desktop panel's own criterion), with one value also committed on the desktop panel in the same test; the
// round-trip tour reaches each corpus file through a hub note of links (a tap on a link opens it, D-140); the corpus
// files sit in `Pages/` as `<folder> <stem>.md`.
// Written from the ACs and the contract only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  EDIT_NOW, PE, REPO, assertZeroWrites, desktopPage, editVault, eventually, fileStateOf, goNote, h1Is, keyboard, loadVault,
  main, mergeBanner, must, needBody, nfc, noteBody, phonePage, propsSheet, rect, runById, saveState, savedText, searchField, seen,
  setCaret, settledWriteCalls, sleep, startDesktop, startPhone, systemBack, tap, tapToEdit, titleField, visibility, writeCalls, writesSeen, type PhoneHandle, type RecoveryDto,
  VAULT_PATH, panel,
} from './phone-helpers';
import { ime, imeReset } from './phone-ime';

test.use({ timezoneId: 'Europe/Prague' });

async function open(page: Page, path: string, o: Record<string, unknown> = {}): Promise<PhoneHandle> {
  const core = await startPhone(page, { vault: editVault(), route: `note/${path}`, now: EDIT_NOW, ...o });
  await needBody(page, path);
  return core;
}
const writesOf = async (core: PhoneHandle, cmd = 'note_write') => (await core.calls()).filter((c) => c.cmd === cmd);
const textOf = (c: { args: unknown }) => String((c.args as any)?.text ?? (c.args as any)?.bytes ?? '');

// ------------------------------------------------------------------------------------------------ FR-EDT-08 AC-15

test('fr_edt_08_ac15_composition_never_saved_half_done', async ({ page }) => {
  const core = await open(page, PE.psani);
  await tapToEdit(page, 'Konec');
  await setCaret(page, 'Konec.', 'end');
  await ime(page, [{ text: ' ' }]);
  await savedText(core, PE.psani, 3000);
  const n0 = (await writesOf(core)).length;
  await ime(page, [{ compose: 'z' }, { compose: 'zá' }, { compose: 'zář' }, { compose: 'zářij' }, { compose: 'zářijo' }]);
  await sleep(1600);
  const during = (await writesOf(core)).slice(n0);
  assert.deepEqual(during.filter((c) => /zá/.test(textOf(c))), [], 'no note_write holds the uncommitted text, even after the 1 s debounce');
  const t0 = Date.now();
  await ime(page, [{ commit: 'zářijo' }]);
  const saved = await savedText(core, PE.psani, 1500, n0 + 1);
  assert.ok(saved?.includes('Konec. zářijo\n'), 'after the commit the word is saved, in NFC');
  assert.ok(Date.now() - t0 <= 1500, 'within 1 s of the commit (plus the test\'s polling)');
  // background during a composition: the flush saves the text as shown, the composing word included
  const n1 = (await writesOf(core)).length;
  await ime(page, [{ text: ' ' }, { compose: 'dalš' }]);
  await visibility(page, 'hidden');
  imeReset(page);
  const flushed = await eventually(async () => (await writesOf(core)).slice(n1), (w) => w.some((c) => textOf(c).includes('zářijo dalš')), 1000);
  assert.ok(flushed.some((c) => textOf(c).includes('zářijo dalš')), 'the hidden flush saves the composing word (Saver.flush({ composing: true }), CP-6)');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-08 AC-16 (L5p)

test('fr_edt_08_ac16_flush_calls_on_hidden', async ({ browser }) => {
  // (a) text typed at the end of Psaní
  let page = await phonePage(browser);
  let core = await open(page, PE.psani);
  await tapToEdit(page, 'Konec');
  await setCaret(page, 'Konec.', 'end');
  await ime(page, [{ text: ' Ahoj' }]);
  const t0 = await visibility(page, 'hidden');
  const w = await eventually(() => writesOf(core), (x) => x.length >= 1, 1000);
  assert.ok(w.length === 1 && textOf(w[0]).includes('Konec. Ahoj'), '(a) the flush writes Ahoj once');
  assert.ok((w[0].at ?? Infinity) - t0 <= 100, `(a) in the same task as hidden (${(w[0].at ?? 0) - t0} ms)`);
  await page.close();
  // (b) a new/quick-note draft with Nákup typed into Title, not committed: the flush is the first write
  page = await phonePage(browser);
  core = await startPhone(page, { vault: editVault(), route: 'new/quick-note', now: EDIT_NOW });
  await (await must(titleField(page), 'Title')).tap();
  await ime(page, [{ compose: 'Nákup' }, { commit: 'Nákup' }]);
  await sleep(800);
  assert.deepEqual(await writesSeen(core), [], '(b) nothing written before hidden');
  await visibility(page, 'hidden');
  const made = await settledWriteCalls(core, 1, 1000);
  assert.deepEqual(made, [{ cmd: 'note_create', path: 'Quick Notes/Nákup.md' }], '(b) the flush is the first write, Quick Notes/Nákup.md, once');
  assert.match((await core.files())['Quick Notes/Nákup.md'] ?? '', /^title: Nákup$/m, '(b) title: Nákup');
  await page.close();
  // (c) Porada with Sál B typed into the sheet's místo, not committed: the flush commits it, one write
  page = await phonePage(browser);
  core = await startPhone(page, { vault: typesVault(), route: `note/${PORADA}`, now: EDIT_NOW });
  await needBody(page, 'Porada');
  assert.equal(await runById(page, 'phone.properties'), 'ok', 'phone.properties');
  const field = await must(propsSheet(page).getByRole('textbox', { name: 'Místo' }), 'the sheet\'s Místo field');
  await field.tap();
  await field.pressSequentially('Sál B');
  await visibility(page, 'hidden');
  const pw = await eventually(() => writesOf(core), (x) => x.length >= 1, 1000);
  assert.equal(pw.length, 1, '(c) one write');
  assert.match(textOf(pw[0]), /^místo: Sál B$/m, '(c) místo: Sál B');
  await page.close();
});

// ------------------------------------------------------------------------------------------------ FR-EDT-08 AC-17 (L5p)

test('fr_edt_08_ac17_unwritable_edits_kept_for_recovery', async ({ browser }) => {
  // nothing pending: no recovery copy
  let page = await phonePage(browser);
  let core = await open(page, PE.psani);
  await visibility(page, 'hidden');
  await sleep(300);
  assert.deepEqual(await core.recoveries(), [], 'with nothing pending, no recovery copy');
  await page.close();
  // the merge banner is shown: the editor's content goes to android_recovery_put within 100 ms; the vault stays
  page = await phonePage(browser);
  core = await open(page, PE.psani);
  await core.writeControl({ hold: true });
  await tapToEdit(page, 'Konec');
  await setCaret(page, 'Konec.', 'end');
  await ime(page, [{ text: 'X' }]);
  const disk = (await core.files())[nfc(PE.psani)]!.replace('Konec.', 'Konec z disku.');
  await core.setFile(PE.psani, disk);
  await core.release();
  await must(mergeBanner(page), 'the merge banner', 2500);
  const t0 = await visibility(page, 'hidden');
  const put = await eventually(async () => (await core.calls()).filter((c) => c.cmd === 'android_recovery_put'), (x) => x.length >= 1, 500);
  assert.equal(put.length, 1, 'android_recovery_put once');
  assert.ok((put[0].at ?? Infinity) - t0 <= 100, 'within 100 ms of hidden');
  const copy = (put[0].args as { copy: RecoveryDto }).copy;
  assert.equal(copy.path, nfc(PE.psani), 'the copy\'s path');
  assert.equal(copy.vault, VAULT_PATH, 'the open vault\'s root');
  assert.ok(copy.text.includes('Konec.X'), 'the editor\'s content');
  assert.equal((await core.files())[nfc(PE.psani)], disk, 'the vault keeps the disk version');
  await page.close();
  // Not saved after an Io failure: kept too
  page = await phonePage(browser);
  core = await open(page, PE.psani);
  await core.writeControl({ fail: 'Io' });
  await tapToEdit(page, 'Konec');
  await setCaret(page, 'Konec.', 'end');
  await ime(page, [{ text: 'Y' }]);
  await must(saveState(page).filter({ hasText: 'Not saved' }), 'Save state Not saved', 5000);
  await visibility(page, 'hidden');
  assert.ok(await eventually(async () => (await core.recoveries()).length, (n) => n === 1, 500), 'a Not saved note is kept as a recovery copy');
  await page.close();
  // a new start with a copy: the recovered banner, Your version the copy, Keep mine writes it on the disk version
  page = await phonePage(browser);
  const kept = editVault().files[nfc(PE.psani)].replace('Konec.', 'Konec. Zachráněno.');
  const rec: RecoveryDto = { vault: VAULT_PATH, path: PE.psani, id: '01JBAN3000000000000000E001', title: 'Psaní', text: kept, base: null, savedAt: '2026-10-14T11:59:00+02:00' };
  core = await open(page, PE.psani, { recoveries: [rec] });
  const banner = await must(page.getByRole('alert').filter({ hasText: 'Tegg kept your unsaved changes to “Psaní” on this phone.' }), 'the recovered banner', 3000);
  for (const name of ['Compare', 'Keep mine', 'Keep theirs', 'Keep both']) await must(banner.getByRole('button', { name }), `the banner's ${name}`);
  await banner.getByRole('button', { name: 'Compare' }).click();
  const cmp = await must(page.getByRole('dialog', { name: 'Compare versions' }), 'Compare versions');
  assert.ok((await cmp.innerText()).includes('Zachráněno'), 'Your version is the kept text');
  const diskV = await core.version(PE.psani);
  await cmp.getByRole('button', { name: 'Keep mine' }).click();
  const w = await eventually(() => writesOf(core), (x) => x.length >= 1, 2000);
  assert.equal(w.length, 1, 'Keep mine sends one note_write');
  assert.ok(textOf(w[0]).includes('Konec. Zachráněno.'), 'with the kept text');
  assert.deepEqual((w[0].args as any).base, diskV, 'with the disk version as base');
  assert.deepEqual(await core.recoveries(), [], 'any choice removes the recovery copy');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-07 AC-24…AC-26

const typesVault = (edit?: (f: Record<string, string>) => void) => loadVault('Typy', ['types', 'new-empty/.tegg'], edit ? (f) => edit(f) : undefined);
const PORADA = 'Schůzky/2026-10-07 Porada.md';
const PRAZDNA_S = 'Schůzky/Prázdná schůzka.md';
const ROZPOCET = 'Projekty/Rozpočet 2027.md';
/** Opens the sheet and returns it. */
async function sheetOf(page: Page) {
  assert.equal(await runById(page, 'phone.properties'), 'ok', 'phone.properties opens the sheet');
  return must(propsSheet(page), 'dialog "Properties"');
}
/** Commits a text value in the sheet's field `name` with the keyboard's Done (Enter). */
async function commitText(page: Page, name: string, value: string) {
  const s = await sheetOf(page);
  const f = await must(s.getByRole('textbox', { name, exact: true }), `the field ${name}`);
  await f.tap();
  await f.fill(value);
  await f.press('Enter');
  await sleep(1200);
}

test('fr_edt_07_ac24_properties_sheet_edits_values', async ({ page, browser }) => {
  test.setTimeout(180_000);
  // (a) text: the desktop panel's bytes for `Praha 1`, compared live
  const core = await startPhone(page, { vault: typesVault(), route: `note/${PORADA}`, now: EDIT_NOW });
  await needBody(page, 'Porada');
  const s = await sheetOf(page);
  const hs = await s.locator('[data-command^="phone.prop:"], [role="textbox"]').evaluateAll((es) => es.map((e) => (e.closest('[role="row"], li, div') as HTMLElement).getBoundingClientRect().height));
  assert.ok(hs.length > 0 && hs.every((h) => h >= 48 - 0.5), `rows ≥ 48 px (${hs.map(Math.round)})`);
  await commitText(page, 'Místo', 'Praha 1');
  const phone = (await core.files())[nfc(PORADA)];
  const { page: desk, context } = await desktopPage(browser);
  const dc = await startDesktop(desk, { vault: typesVault(), route: `note/${PORADA}`, now: EDIT_NOW });
  const df = await must(desk.getByRole('region', { name: 'Properties' }).getByRole('textbox', { name: 'Místo', exact: true }), 'desktop: the panel\'s Místo', 8000);
  await df.click();
  await df.fill('Praha 1');
  await df.press('Enter');
  const deskFile = await savedText(dc, PORADA, 3000);
  assert.equal(phone, deskFile, '(a) Praha 1: the same bytes as the desktop panel');
  const w = await writesOf(core);
  assert.equal(w.length, 1, 'one note_write');
  assert.ok((w[0].args as any).base, 'with the note\'s version as base (types.md FR-EDT-07 AC-4)');
  // the rest of AC-5's values, each one note_write with types.md FR-EDT-07 AC-5's bytes
  const line = async (path: string, re: RegExp, what: string) => {
    const t = (await core.files())[nfc(path)] ?? '';
    assert.match(t, re, `${what}: ${JSON.stringify(t.split('\n').filter((l) => re.source.split(':')[0].replace(/\^|\\/g, '') === l.split(':')[0]).join(' | '))}`);
  };
  // each value also compared with the desktop panel's live bytes: a quoted value stays quoted when changed, as on the
  // desktop (the existing YAML style is kept; D-2554)
  let deskSaves = 1;
  for (const [v, re] of [['ano: ne', /^místo: "ano: ne"$/m], ['123', /^místo: "123"$/m], ['true', /^místo: "true"$/m], ['#doma', /^místo: "#doma"$/m], ['[[Jana Nováková]]', /^místo: "\[\[Jana Nováková\]\]"$/m], ['Plzeň', null]] as const) {
    await commitText(page, 'Místo', v);
    if (re) await line(PORADA, re, `(a) místo ${v}`);
    await df.click();
    await df.fill(v);
    await df.press('Enter');
    const dv = await savedText(dc, PORADA, 3000, ++deskSaves);
    assert.equal((await core.files())[nfc(PORADA)], dv, `(a) místo ${v}: the same bytes as the desktop panel`);
  }
  await context.close();
  // AC-9: clearing removes the entry's lines
  await commitText(page, 'Místo', '');
  assert.ok(!/^místo:/m.test((await core.files())[nfc(PORADA)] ?? ''), 'clearing místo removes its line (AC-9)');
  // (g) a select and a multi-select, (d) a checkbox, (c) a number, (h) a URL on Rozpočet 2027
  await systemBack(page);
  await goNote(page, 'Rozpočet 2027');
  let sh = await sheetOf(page);
  await tap(page, sh.locator('[data-command="phone.prop:stav"]').first(), 'stav');
  await tap(page, page.getByRole('listbox').getByRole('option', { name: 'Hotovo' }).first(), 'Hotovo');
  await sleep(1200);
  await line(ROZPOCET, /^stav: Hotovo$/m, '(g) stav Hotovo');
  sh = await sheetOf(page);
  await tap(page, sh.locator('[data-command="phone.prop:oblasti"]').first(), 'oblasti');
  await tap(page, page.getByRole('listbox').getByRole('option', { name: 'Rodina' }).first(), 'Rodina');
  await sleep(1200);
  await line(ROZPOCET, /^oblasti:\n {2}- Práce\n {2}- Rodina$/m, '(g) oblasti + Rodina');
  sh = await sheetOf(page);
  await tap(page, sh.getByRole('checkbox', { name: 'Aktivní' }).first(), 'Aktivní');
  await sleep(1200);
  await line(ROZPOCET, /^aktivní: false$/m, '(d) aktivní: false');
  await commitText(page, 'Rozpočet', '3,5');
  await line(ROZPOCET, /^rozpočet: 3\.5$/m, '(c) rozpočet 3,5 → 3.5');
  await commitText(page, 'Web', 'https://example.com/a?b=c');
  await line(ROZPOCET, /^web: https:\/\/example\.com\/a\?b=c$/m, '(h) web as typed');
  // (e) a date through the one date picker, on Prázdná schůzka
  await systemBack(page);
  await goNote(page, 'Prázdná schůzka');
  sh = await sheetOf(page);
  await tap(page, sh.locator('[data-command="phone.prop:datum"]').first(), 'datum');
  const picker = await must(page.getByRole('dialog').filter({ has: page.getByRole('grid') }).last(), 'the date picker (D-763)');
  const pr = await rect(picker);
  assert.ok(pr && pr.left >= -0.5 && pr.right <= 412.5 && pr.bottom <= 915.5, 'the picker is within the viewport');
  await tap(page, picker.getByRole('gridcell', { name: /(^|\D)8\D/ }).first(), '8 Oct');
  await sleep(1200);
  await line(PRAZDNA_S, /^datum: 2026-10-08$/m, '(e) datum 2026-10-08');
  // the universal rows: Tags
  sh = await sheetOf(page);
  // the Tags row's Add tag first, then its field, as on the desktop (FR-TYP-08 AC-8; AC-Test-Change, D-2557)
  await tap(page, sh.getByRole('button', { name: 'Add tag', exact: true }).first(), 'the Tags row\'s Add tag');
  const tags = await must(sh.getByRole('combobox', { name: /^Tags?$/ }).or(sh.getByRole('textbox', { name: /^Tags?$/ })).or(page.getByRole('combobox', { name: 'Tag', exact: true })).first(), 'the Tags row\'s field');
  await tags.tap();
  await tags.fill('porada');
  await tags.press('Enter');
  await sleep(1200);
  await line(PRAZDNA_S, /^tags:\n {2}- porada$/m, 'Tags edited as on the desktop (FR-TYP-08 AC-7)');
});

test('fr_edt_07_ac25_read_only_rows_on_the_phone', async ({ page }) => {
  const core = await startPhone(page, { vault: typesVault(), route: `note/${PORADA}`, now: EDIT_NOW });
  const before = await fileStateOf(core);
  await needBody(page, 'Porada');
  // the strip: values only; a tap on a value opens the sheet with that row in view
  const strip = main(page).locator('[data-command^="phone.prop.show:"]');
  assert.ok((await strip.count()) > 0, 'the strip\'s values carry phone.prop.show:<key>');
  assert.equal(await main(page).locator('[data-command^="phone.prop.show:"] input, [data-command^="phone.prop.show:"] [contenteditable="true"]').count(), 0, 'the strip shows values only');
  const key = (await strip.first().getAttribute('data-command'))!.split(':').slice(1).join(':');
  await tap(page, strip.first(), 'a strip value');
  const s = await must(propsSheet(page), 'the sheet');
  const row = s.locator(`[data-command="phone.prop:${key}"]`).first();
  const rr = await rect(row);
  const sr = await rect(s);
  assert.ok(rr && sr && rr.top >= sr.top - 0.5 && rr.bottom <= sr.bottom + 0.5, `the sheet opens with the ${key} row in view`);
  // read-only rows: Type (a link to type/schůzka), Title, Created, Modified
  for (const name of ['Title', 'Created', 'Modified']) {
    assert.equal(await s.getByRole('textbox', { name }).count() + await s.locator(`[data-command="phone.prop:${name.toLowerCase()}"]`).count(), 0, `${name} has no control`);
  }
  const typeLink = await must(s.getByRole('link', { name: /Schůzka/ }), 'the Type row: the type\'s name as a link');
  assert.equal(await s.locator('[data-command="phone.prop:type"]').count(), 0, 'Type has no control');
  for (const name of ['Change type…', 'Add property', 'Delete property']) assert.equal(await s.getByRole('button', { name }).count() + await s.getByRole('menuitem', { name }).count(), 0, `no ${name} (D-72)`);
  await typeLink.tap();
  assert.ok(await h1Is(page, 'Schůzky') || await h1Is(page, 'Schůzka'), 'the Type link opens type/schůzka');
  await assertZeroWrites(core, before, 'the read-only rows');
  // the review control is the strip's checkbox (a Quick Note of the inbox fixture)
  const p2 = await phonePage(page.context().browser()!);
  await startPhone(p2, { vault: (await import('./capture-helpers')).inboxVault(), route: 'note/Quick Notes/Koupit mléko.md', now: EDIT_NOW });
  const first = main(p2).locator('[data-command^="phone.prop.show:"], [data-command^="note.markReviewed"], [data-command^="note.markUnreviewed"]').first();
  assert.equal(await first.getAttribute('role') ?? await first.evaluate((e) => (e as HTMLInputElement).type), 'checkbox', 'the strip starts with the review checkbox');
  await p2.close();
});

test('fr_edt_07_ac26_property_writes_are_safe', async ({ browser }) => {
  // a changed file without vault:changed: Conflict, nothing written, the merge banner with the new value as Your version
  let page = await phonePage(browser);
  let core = await startPhone(page, { vault: typesVault(), route: `note/${PORADA}`, now: EDIT_NOW });
  await needBody(page, 'Porada');
  const ext = (await core.files())[nfc(PORADA)]!.replace('nálada: dobrá', 'nálada: skvělá');
  await core.setFile(PORADA, ext, { silent: true });
  await commitText(page, 'Místo', 'Sál C');
  assert.equal((await core.files())[nfc(PORADA)], ext, 'nothing is written; the external bytes stay');
  const banner = await must(mergeBanner(page), 'the merge banner (D-2528)', 2500);
  await banner.getByRole('button', { name: 'Compare' }).click();
  const cmp = await must(page.getByRole('dialog', { name: 'Compare versions' }), 'Compare versions');
  assert.ok((await cmp.innerText()).includes('Sál C'), 'the new value is kept as Your version');
  await page.close();
  // closing the sheet with a field typed but not committed commits it first, in one write
  for (const how of ['Close', 'scrim', 'Back'] as const) {
    page = await phonePage(browser);
    core = await startPhone(page, { vault: typesVault(), route: `note/${PORADA}`, now: EDIT_NOW });
    await needBody(page, 'Porada');
    const s = await sheetOf(page);
    const f = await must(s.getByRole('textbox', { name: 'Místo', exact: true }), 'Místo');
    await f.tap();
    await f.fill(`Sál ${how}`);
    if (how === 'Close') await s.getByRole('button', { name: 'Close' }).click();
    else if (how === 'scrim') await page.touchscreen.tap(206, 40);
    else await systemBack(page);
    const w = await eventually(() => writesOf(core), (x) => x.length >= 1, 2500);
    await sleep(1200);
    assert.equal((await writesOf(core)).length, 1, `${how}: one write`);
    assert.match(textOf(w[0]), new RegExp(`^místo: Sál ${how}$`, 'm'), `${how}: the typed value is committed`);
    await page.close();
  }
  // a property change and a body edit within 1 s: one note_write
  page = await phonePage(browser);
  core = await startPhone(page, { vault: typesVault(), route: `note/${PORADA}`, now: EDIT_NOW });
  await needBody(page, 'Porada');
  await tapToEdit(page, 'Probrali');
  await setCaret(page, 'příští rok.', 'end');
  await ime(page, [{ text: ' Ještě.' }]);
  await keyboard(page, false);
  const s = await sheetOf(page);
  const f = await must(s.getByRole('textbox', { name: 'Místo', exact: true }), 'Místo');
  await f.tap();
  await f.fill('Sál D');
  await f.press('Enter');
  const w = await eventually(() => writesOf(core), (x) => x.length >= 1, 2500);
  await sleep(1500);
  assert.equal((await writesOf(core)).length, 1, 'one note_write for both');
  assert.ok(textOf(w[0]).includes('místo: Sál D') && textOf(w[0]).includes('příští rok. Ještě.'), 'it holds both changes');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-38 (L5p Chromium)

function corpus(): [string, string][] {
  const root = resolve(REPO, 'tests/fixtures/format/roundtrip');
  const out: [string, string][] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith('.md') && n !== 'README.md') out.push([relative(root, p), readFileSync(p, 'utf8')]);
    }
  };
  walk(root);
  return out.sort();
}
const corpusVault = () => {
  const files = corpus();
  return loadVault('Korpus', ['new-empty/.tegg'], (f) => {
    const links: string[] = [];
    for (const [rel, text] of files) {
      const stem = nfc(rel.replace(/\.md$/, '').replace('/', ' '));
      f[`Pages/${stem}.md`] = text;
      links.push(`- [[${stem}]]`);
    }
    f['Pages/Rozcestník.md'] = `---\nid: 01JBAN3000000000000000R001\ntype: page\ntitle: Rozcestník\n---\n${links.join('\n')}\n`;
  });
};

test('fr_fmt_07_ac38_opening_on_the_phone_writes_nothing', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'the AC names the L5p tour on Chromium (the WebView\'s engine)');
  test.setTimeout(400_000);
  const vault = corpusVault();
  const core = await startPhone(page, { vault, route: 'note/Pages/Rozcestník.md', now: EDIT_NOW });
  const before = await fileStateOf(core);
  await needBody(page, 'Rozcestník');
  const stems = corpus().map(([rel]) => nfc(rel.replace(/\.md$/, '').replace('/', ' ')));
  for (const stem of stems) {
    const chip = noteBody(page).locator(`[data-wikilink="${stem.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`).first();
    await tap(page, chip, stem);
    await sleep(400);
    const body = noteBody(page);
    if (await seen(body, 1500)) {
      const blocks = await body.locator(':scope > *').count();
      // a tap at the block's text end, away from links: a left-edge tap can hit a link (Feedback loops) and leave the
      // note (as D-2555 did for FR-SYN-06 AC-56; AC-Test-Change, D-2557)
      for (const k of [0, Math.floor(blocks / 2), Math.max(0, blocks - 1)]) {
        const end = await body.locator(':scope > *').nth(k).evaluate((el) => {
          const LINK = 'a, [role="link"], [data-wikilink], [data-tag], button, input, label';
          const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let last: Text | null = null;
          for (let t = w.nextNode() as Text | null; t; t = w.nextNode() as Text | null) if ((t.textContent ?? '').trim() && !t.parentElement?.closest(LINK)) last = t;
          if (!last) return null;
          const len = (last.textContent ?? '').replace(/\s+$/, '').length;
          const r = document.createRange();
          r.setStart(last, Math.max(0, len - 1));
          r.setEnd(last, len);
          const b = r.getBoundingClientRect();
          if (!b.width && !b.height) return null;
          const p = { x: b.right - 1, y: b.top + b.height / 2 };
          return document.elementFromPoint(p.x, p.y)?.closest(LINK) ? null : p;
        });
        if (end) await page.touchscreen.tap(end.x, end.y);
      }
      await keyboard(page, true);
      await page.evaluate(() => { const m = [...document.querySelectorAll('main')].find((e) => e.getClientRects().length > 0) as HTMLElement | undefined; if (m) m.scrollTop = m.scrollHeight; });
      await keyboard(page, false);
    }
    await visibility(page, 'hidden');
    await visibility(page, 'visible');
    await systemBack(page);
    await needBody(page, 'back on Rozcestník');
    assert.ok(await h1Is(page, 'Rozcestník', 3000), `${stem}: Back returns to Rozcestník, the open note`);
  }
  await sleep(1500);
  await assertZeroWrites(core, before, 'the round-trip tour');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-39 (L5p)

test('fr_fmt_07_ac39_one_edit_one_block_on_the_phone', async ({ page }) => {
  const edge = (n: string) => readFileSync(resolve(REPO, `tests/fixtures/format/roundtrip/edge/${n}.md`), 'utf8');
  const vault = editVault((f) => { f['Pages/CRLF.md'] = edge('CRLF line endings'); f['Pages/BOM.md'] = edge('BOM'); f['Pages/Bez konce.md'] = edge('No final newline'); });
  const core = await startPhone(page, { vault, route: `note/${PE.deset}`, now: EDIT_NOW });
  await needBody(page, 'Deset bloků');
  await tapToEdit(page, 'Pátý');
  await setCaret(page, 'test upraví.', 'end');
  await ime(page, [{ text: ' ' }, { compose: 'Doplněno' }, { commit: 'Doplněno' }, { text: '.' }]);
  const out = await savedText(core, PE.deset, 3000);
  const want = vault.files[nfc(PE.deset)].replace('Pátý blok, který test upraví.', 'Pátý blok, který test upraví. Doplněno.').replace(/^modified: .*$/m, `modified: ${EDIT_NOW}`);
  assert.equal(out, want, 'only block 5 and the modified line differ (editor FR-FMT-07 AC-9)');
  // CRLF, BOM and no final newline are kept
  for (const [path, check, what] of [
    ['Pages/CRLF.md', (t: string) => !/[^\r]\n/.test(t) && t.includes('Ž\r\n'), 'CRLF kept on every line'],
    ['Pages/BOM.md', (t: string) => t.startsWith('﻿') && t.includes('Ž'), 'the BOM kept'],
    ['Pages/Bez konce.md', (t: string) => !t.endsWith('\n') && t.includes('Ž'), 'still no final newline'],
  ] as const) {
    await keyboard(page, false);
    await systemBack(page);
    const stem = path.replace(/^Pages\/|\.md$/g, '');
    const title = /^title: (.*)$/m.exec(vault.files[path])?.[1]?.trim() ?? stem;
    await goNote(page, title);
    const body = await needBody(page, path);
    const last = await body.locator(':scope > *').last().innerText();
    await tapToEdit(page, last.trim().split(/\s+/)[0]);
    await setCaret(page, last.trim(), 'end');
    await ime(page, [{ text: ' Ž' }]);
    const t = await savedText(core, path, 3000);
    assert.ok(t && check(t), `${path}: ${what}`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-FMT-08 AC-11

test('fr_fmt_08_ac11_names_of_objects_made_on_the_phone', async ({ browser }) => {
  // a draft: Q3: plán? #1
  let page = await phonePage(browser);
  let core = await startPhone(page, { vault: editVault(), route: 'new/quick-note', now: EDIT_NOW });
  await (await must(titleField(page), 'Title')).tap();
  await ime(page, [{ text: 'Q3: plán? #1' }, { enter: true }]);
  const made = await settledWriteCalls(core, 1, 3000);
  assert.deepEqual(made[0], { cmd: 'note_create', path: 'Quick Notes/Q3 plán 1.md' }, 'the draft title Q3: plán? #1 → Quick Notes/Q3 plán 1.md');
  assert.match((await core.files())['Quick Notes/Q3 plán 1.md'] ?? '', /^title: "Q3: plán\? #1"$/m, 'with title: "Q3: plán? #1"');
  // no later phone action changes the name or title
  await ime(page, [{ text: 'Tělo.' }]);
  await sleep(1500);
  const after = await core.files();
  assert.ok(after['Quick Notes/Q3 plán 1.md']?.includes('Tělo.') && /^title: "Q3: plán\? #1"$/m.test(after['Quick Notes/Q3 plán 1.md']), 'a body edit keeps the name and title');
  assert.ok(!(await core.calls()).some((c) => c.cmd === 'note_rename'), 'no note_rename');
  await page.close();
  // Search's Create with a 250-byte Czech title: the stem ≤ 200 bytes, cut at a character boundary
  let long = '';
  for (const ch of 'Žluťoučký kůň úpěl ďábelské ódy '.repeat(10)) { if (Buffer.byteLength(long) >= 250) break; long += ch; }
  long = long.trim();
  page = await phonePage(browser);
  core = await startPhone(page, { vault: editVault(), route: 'search', now: EDIT_NOW });
  const q = await must(searchField(page), 'Search query');
  await q.fill(long);
  await tap(page, page.getByRole('button', { name: /^Create “/ }).first(), 'Create “…”');
  const m2 = await settledWriteCalls(core, 1, 3000);
  const p2 = m2[0]?.path ?? '';
  const stem = p2.replace(/^Quick Notes\/|\.md$/g, '');
  assert.ok(stem && Buffer.byteLength(stem) <= 200 && long.startsWith(stem.trimEnd()), `the stem is cut at a character boundary to ≤ 200 bytes: ${stem} (${Buffer.byteLength(stem)})`);
  assert.ok(((await core.files())[p2] ?? '').includes(long), 'the full title in title:');
  assert.equal(p2, nfc(p2), 'the name is NFC');
  await page.close();
  // a [[ create of a stem used elsewhere (Pages/Cíl.md) gets (2)
  page = await phonePage(browser);
  core = await open(page, PE.psani);
  await tapToEdit(page, 'Konec');
  await setCaret(page, 'Konec.', 'end');
  await ime(page, [{ text: ' [[cíl' }]);
  await tap(page, panel(page, 'Link suggestions').getByRole('option').filter({ hasText: 'Create "cíl"' }).first(), 'Create "cíl"');
  const m3 = await settledWriteCalls(core, 1, 3000, 0, 'note_create');
  assert.equal(m3.find((x) => x.cmd === 'note_create')?.path, 'Quick Notes/cíl (2).md', 'a stem used anywhere in the vault (NFC, case-insensitive) gets (2)');
});
