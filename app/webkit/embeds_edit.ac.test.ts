// MS4 slice 4F, L5 (WebKit + fake core): editing a full embed in place (D-273). docs/acceptance/embeds.md FR-EMB-03
// AC-1, AC-3…AC-13 (L5 parts; AC-2, AC-14 and the close / ⌘Q parts of AC-7 and AC-13 are L6, D-213). Interface
// docs/contracts/ms4-embeds.md §6 (EmbedEditor, pageSave), §7 (`section`, `onLeave`), §8 (`writeControl({ path })`),
// §9 (`__TEGG_TEST__.embeds()`). Written from the ACs and the contracts only (D-61). Every lookup goes through
// `must`/`seen` and node:assert (TS-I1). Test clock 2026-10-17T10:00:00+02:00, Europe/Prague, region en-US.
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  M, MODIFIED, TOGGLE_SOURCE, absent, argText, blockTexts, bodyOf, callsOf, caretAt, deletedAlert, description, embedBody, embedList,
  embedTextbox, embedsShown, eventually, needEmbeds, fileText, fileWhen, flat, frame, frameAt, gotoNote, headerText, hostBlock, main,
  mergeDialog, must, mustBeSaved, mustCaret, needTop, nestedEditors, nfc, openEmbeds, original, pathOf, saveState, sleep, sourceRegion,
  stateIs, swap, topEmbed, writeCalls, writePaths, writes, type EmbedInfo, type FakeCoreHandle,
} from './embeds-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const P1 = 'První odstavec k úpravě.';
const UP_MOD = 'modified: 2026-10-03T09:00:00+02:00';
const up = () => original(M.upravitelna);
/** Upravitelná with `from` replaced by `to` and `modified` set to the test clock (D-55). */
const upWith = (from: string, to: string) => swap(swap(up(), UP_MOD, MODIFIED), from, to);

/** Úpravy open, its 4 top-level embeds shown; returns the core. */
async function onUpravy(page: Page, o: Parameters<typeof openEmbeds>[2] = {}): Promise<FakeCoreHandle> {
  const core = await openEmbeds(page, M.upravy, o);
  const l = await eventually(() => embedList(main(page)).catch(() => [] as EmbedInfo[]), (x) => x.length >= 4, 5000);
  assert.ok(l.length >= 4, 'Úpravy shows its embeds');
  return core;
}
/** The editable body of the n-th top-level Upravitelná embed. */
async function embedEditor(page: Page, n: number, title = 'Upravitelná'): Promise<Locator> {
  const f = await needTop(main(page), n, `top-level embed ${n + 1}`);
  return must(embedTextbox(f, title), `textbox "${title}" in embed ${n + 1}`, 3000);
}
async function typeIn(page: Page, box: Locator, after: string | null, text: string) {
  await mustCaret(box, after, `caret in the embed${after ? ` after "${after}"` : ''}`);
  await page.keyboard.type(text);
}
async function waitWrites(core: FakeCoreHandle, path: string, n: number, ms = 3000) {
  return eventually(() => writes(core, path), (w) => w.length >= n, ms);
}

// ------------------------------------------------------------------------------------------------ AC-1

test('fr_emb_03_ac1_typing_writes_the_embedded_file_only', async ({ page }) => {
  const core = await onUpravy(page);
  const box = await embedEditor(page, 0);
  await typeIn(page, box, P1, ' Doplněno.');
  const last = Date.now();
  const ws = await waitWrites(core, M.upravitelna, 1, 2500);
  assert.equal(ws.length, 1, 'one note_write for Pages/Upravitelná.md');
  const firstAt = Date.now();
  assert.ok(firstAt - last <= 1500, `within 1 s of the last key (D-179), seen after ${firstAt - last} ms`);
  assert.equal(argText(ws[0]), upWith(P1, `${P1} Doplněno.`), 'only that paragraph and modified differ');
  const load = (await callsOf(core, 'embed_load')).flatMap((c) => (c.result as any[] | undefined) ?? []).find((n) => nfc(String(n.path)) === nfc(M.upravitelna));
  assert.ok(load, 'Upravitelná was loaded with embed_load');
  assert.deepEqual((ws[0].args as any).base, load.version, 'the base is the version the embed was loaded with');
  await sleep(1200);
  assert.equal((await writes(core, M.upravy)).length, 0, 'Pages/Úpravy.md gets no note_write');
});

// ------------------------------------------------------------------------------------------------ AC-3

test('fr_emb_03_ac3_external_change_with_unsaved_edit_opens_the_dialog', async ({ page }) => {
  const core = await onUpravy(page);
  await core.writeControl({ hold: true, path: M.upravitelna });
  const box = await embedEditor(page, 0);
  await typeIn(page, box, P1, ' Moje.');
  await sleep(200);
  const theirs = swap(up(), 'Text třetí části.', 'Text třetí části jinde.');
  await core.setFile(M.upravitelna, theirs);
  const dlg = await must(mergeDialog(page), 'dialog "Note changed outside Tegg"', 2000);
  assert.equal(await description(dlg), 'Upravitelná', 'the dialog names Upravitelná');
  assert.equal(await fileText(core, M.upravitelna), theirs, "the file keeps the other program's bytes while the dialog is open");
  await core.release();
  await sleep(500);
  assert.equal((await writes(core, M.upravitelna)).filter((w) => w.ok === true && argText(w).includes('Moje.')).length, 0, "no note_write of the editor's version succeeds");
  assert.equal(await fileText(core, M.upravitelna), theirs, 'still the other program’s bytes');
  await (await must(dlg.getByRole('button', { name: 'Keep both', exact: true }), 'Keep both')).click();
  const copy = 'Pages/Upravitelná (conflict 2026-10-17 10-00).md';
  const c = await fileWhen(core, copy, (x) => x !== undefined, 3000);
  assert.ok(c !== undefined, `${copy} is created`);
  assert.match(c!, /^id: 01JB4F0000000000000000E022$/m, 'with the same id');
  assert.equal((await writes(core, M.upravy)).length, 0, 'Úpravy is not written');
});

test('fr_emb_03_ac3_silent_external_change_conflicts_on_save', async ({ page }) => {
  const core = await onUpravy(page);
  const theirs = swap(up(), 'Text třetí části.', 'Text třetí části potichu.');
  await core.setFile(M.upravitelna, theirs, { silent: true });
  const box = await embedEditor(page, 0);
  await typeIn(page, box, P1, ' Moje.');
  await must(mergeDialog(page), 'dialog "Note changed outside Tegg" after a Conflict', 3000);
  const ws = await writes(core, M.upravitelna);
  assert.ok(ws.length >= 1 && ws.every((w) => w.ok === false), 'the save got Conflict (base check)');
  assert.equal(await fileText(core, M.upravitelna), theirs, 'the file keeps the other program’s bytes');
  assert.equal((await writes(core, M.upravy)).length, 0, 'Úpravy is not written');
});

// ------------------------------------------------------------------------------------------------ AC-4

test('fr_emb_03_ac4_clean_external_change_reloads_every_instance', async ({ page }) => {
  const core = await onUpravy(page);
  const box = await embedEditor(page, 0);
  await typeIn(page, box, P1, 'X');
  await waitWrites(core, M.upravitelna, 1);
  await mustBeSaved(page);
  const before = await nestedEditors(page);
  assert.ok((before[0]?.historyDepth ?? 0) > 0, 'the embed has undo history');
  const disk = (await fileText(core, M.upravitelna))!;
  await core.setFile(M.upravitelna, swap(disk, 'Text druhé části.', 'Text druhé části jinde.'));
  for (const i of [0, 1, 3]) {
    const ok = await eventually(async () => flat(await embedBody(topEmbed(main(page), i)).innerText().catch(() => '')), (t) => t.includes('Text druhé části jinde.'), 2000);
    assert.ok(ok.includes('Text druhé části jinde.'), `embed ${i + 1} shows the change within 2 s`);
  }
  const inBlock = await page.evaluate(() => (window.getSelection()?.anchorNode?.parentElement?.closest('p')?.textContent ?? '').normalize('NFC'));
  assert.ok(inBlock.startsWith('První odstavec k úpravě.'), `the caret stays in the same block (D-112): ${inBlock}`);
  const after = await nestedEditors(page);
  assert.equal(after[0]?.historyDepth, 0, "that embed's undo history is emptied (D-178)");
  const n = (await writes(core)).length;
  await page.keyboard.press('Meta+z');
  await sleep(1500);
  assert.equal((await writes(core)).length, n, '⌘Z does nothing after the reload');
});

test('fr_emb_03_ac4_external_delete_without_edits_turns_broken', async ({ page }) => {
  const core = await onUpravy(page);
  await core.setFile(M.upravitelna, null);
  const ofUp = (x: EmbedInfo[]) => x.filter((e) => (e.target ?? '').includes('Upravitelná') || e.label.includes('Upravitelná'));
  const l = await eventually(() => embedList(main(page)), (x) => ofUp(x).length >= 3 && ofUp(x).every((e) => e.state === 'broken'), 2000);
  const of = ofUp(l);
  assert.ok(of.length >= 3, 'the three Upravitelná embeds are still there');
  assert.deepEqual(of.map((e) => e.state), Array(of.length).fill('broken'), 'they turn broken within 2 s');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

test('fr_emb_03_ac4_external_delete_with_unsaved_edits_asks', async ({ page }) => {
  const core = await onUpravy(page);
  const box = await embedEditor(page, 0);
  await typeIn(page, box, P1, 'X');
  await core.setFile(M.upravitelna, null);
  const al = await must(deletedAlert(page), 'alert "This note was deleted outside Tegg"', 2000);
  assert.ok(flat(await al.innerText()).includes('Upravitelná'), 'it names Upravitelná');
  await must(al.getByRole('button', { name: 'Restore file', exact: true }), 'Restore file');
  await must(al.getByRole('button', { name: 'Discard', exact: true }), 'Discard');
  await sleep(1500);
  assert.equal((await writeCalls(core)).filter((c) => pathOf(c) === nfc(M.upravitelna)).length, 0, 'no write targets the missing path before a choice');
});

// ------------------------------------------------------------------------------------------------ AC-5

test('fr_emb_03_ac5_first_edit_of_a_file_without_id', async ({ page }) => {
  const core = await onUpravy(page);
  const box = await embedEditor(page, 2, 'Bez hlavičky');
  await typeIn(page, box, 'Text bez hlavičky.', ' Doplněno.');
  const ws = await waitWrites(core, M.bez, 1);
  const t = (await fileWhen(core, M.bez, (x) => (x ?? '').includes('Doplněno'), 3000)) ?? '';
  assert.ok(ws.length >= 1, 'Pages/Bez hlavičky.md is written');
  assert.match(t, /^---\nid: [0-9A-HJKMNP-TV-Z]{26}\ntype: page\nmodified: 2026-10-17T10:00:00\+02:00\n---\nText bez hlavičky\. Doplněno\.\n$/, 'exactly the D-54 first-edit form');
  assert.equal((await writes(core, M.upravy)).length, 0, 'Úpravy is not written');
});

// ------------------------------------------------------------------------------------------------ AC-6

test('fr_emb_03_ac6_undo_per_embed', async ({ page }) => {
  const core = await onUpravy(page);
  const box = await embedEditor(page, 0);
  await typeIn(page, box, P1, 'X');
  await waitWrites(core, M.upravitelna, 1);
  await mustBeSaved(page);
  await mustCaret(hostBlock(page, 'Hostitel mezi.'), null, 'end of Hostitel mezi.');
  await page.keyboard.type('Y');
  await waitWrites(core, M.upravy, 1);
  await mustBeSaved(page);
  const nu = (await writes(core, M.upravitelna)).length;
  await mustCaret(hostBlock(page, 'Hostitel mezi.Y'), null, 'caret in the host');
  await page.keyboard.press('Meta+z');
  const h = await waitWrites(core, M.upravy, 2);
  assert.equal(h.length, 2, '⌘Z in the host: one write, to Úpravy');
  assert.ok(!argText(h[1]).includes('Hostitel mezi.Y'), 'it undoes only Y');
  assert.equal((await writes(core, M.upravitelna)).length, nu, 'Upravitelná not written by the host undo');
  await mustCaret(await embedEditor(page, 0), `${P1}X`, 'caret in the embed');
  await page.keyboard.press('Meta+z');
  const e = await waitWrites(core, M.upravitelna, nu + 1);
  assert.equal(e.length, nu + 1, '⌘Z in the embed: one write, to Upravitelná');
  assert.equal(bodyOf(argText(e[e.length - 1])), bodyOf(up()), 'its body equals the original body');
  assert.equal((await writes(core, M.upravy)).length, 2, 'Úpravy not written by the embed undo');
  await gotoNote(page, 'Cíl');
  await gotoNote(page, 'Úpravy');
  await needEmbeds(main(page), 4, 'the host note');
  const n = (await writeCalls(core)).length;
  await mustCaret(await embedEditor(page, 0), P1, 'caret in the embed after returning');
  await page.keyboard.press('Meta+z');
  await sleep(1500);
  assert.equal((await writeCalls(core)).length, n, 'after leaving and returning, ⌘Z in the embed writes nothing');
  assert.equal((await writeCalls(core)).filter((c) => /create|trash|delete/.test(c.cmd)).length, 0, 'undo never creates or deletes a file');
});

// ------------------------------------------------------------------------------------------------ AC-7

type Leave = { name: string; act: (page: Page) => Promise<void> };
const LEAVES: Leave[] = [
  { name: 'caret_into_the_host', act: async (p) => { await caretAt(hostBlock(p, 'Hostitel po.'), null); } },
  { name: 'caret_into_another_embed', act: async (p) => { await caretAt(embedTextbox(topEmbed(main(p), 2), 'Bez hlavičky'), null); } },
  { name: 'open_another_note', act: async (p) => { await gotoNote(p, 'Cíl'); } },
  { name: 'toggle_source_view', act: async (p) => { await p.keyboard.press(TOGGLE_SOURCE); } },
];
for (const l of LEAVES) {
  test(`fr_emb_03_ac7_flush_before_leaving_${l.name}`, async ({ page }) => {
    const core = await onUpravy(page);
    await core.writeControl({ delayMs: 100, path: M.upravitelna });
    const box = await embedEditor(page, 0);
    await typeIn(page, box, P1, 'Z');
    const n0 = (await core.calls()).length;
    const t0 = Date.now();
    await l.act(page);
    const w = await eventually(async () => (await core.calls()).slice(n0 - 2).find((c) => c.cmd === 'note_write' && pathOf(c) === nfc(M.upravitelna) && argText(c).includes(`${P1}Z`)), (x) => !!x && x.endSeq !== undefined, 700);
    assert.ok(w, `the embed edit is saved before the step completes (${Date.now() - t0} ms, well before the 1 s autosave)`);
    if (l.name === 'open_another_note') {
      const read = (await core.calls()).find((c) => c.cmd === 'note_read' && pathOf(c) === nfc(M.cil));
      if (read) assert.ok(w!.endSeq! < read.seq!, 'the write resolved before the next note is read');
    }
    if (l.name === 'toggle_source_view') await must(sourceRegion(page), 'source view');
  });
}

// ------------------------------------------------------------------------------------------------ AC-8

test('fr_emb_03_ac8_two_instances_of_one_file', async ({ page }) => {
  const core = await onUpravy(page);
  await typeIn(page, await embedEditor(page, 0), P1, 'A');
  const second = await embedEditor(page, 1);
  await mustCaret(second, null, 'click into the second embed');
  const shown = await eventually(async () => flat(await second.innerText()), (t) => t.includes('k úpravě.A'), 1500);
  assert.ok(shown.includes('k úpravě.A'), 'the second instance shows A');
  await typeIn(page, second, 'k úpravě.A', 'B');
  const ws = await waitWrites(core, M.upravitelna, 2);
  assert.equal(ws.length, 2, 'two writes');
  assert.ok(argText(ws[0]).includes('k úpravě.A\n'), 'first …k úpravě.A');
  assert.ok(argText(ws[1]).includes('k úpravě.AB\n'), 'then …k úpravě.AB');
  assert.deepEqual((ws[1].args as any).base, (ws[0].result as any)?.version, "the second has the first's resulting version as base");
  assert.ok(ws.every((w) => w.ok === true), 'no Conflict');
  assert.ok(await absent(mergeDialog(page), 300), 'no dialog');
  await typeIn(page, await embedEditor(page, 0), 'Text druhé části.', ' Změna');
  await waitWrites(core, M.upravitelna, 3);
  const sec = await eventually(async () => flat(await embedBody(topEmbed(main(page), 3)).innerText().catch(() => '')), (t) => t.includes('Text druhé části. Změna'), 1500);
  assert.ok(sec.includes('Text druhé části. Změna'), 'the section embed shows the edit within 1 s of the save');
});

// ------------------------------------------------------------------------------------------------ AC-9

test('fr_emb_03_ac9_never_into_the_wrong_file', async ({ page }) => {
  test.setTimeout(120_000);
  const core = await onUpravy(page);
  let h = '', e = '';
  for (let n = 1; n <= 10; n++) {
    await mustCaret(hostBlock(page, `Hostitel mezi.${h}`), null, `round ${n}: Hostitel mezi.`);
    await page.keyboard.type(`H${n}`); h += `H${n}`;
    await mustCaret(await embedEditor(page, 0), `${P1}${e}`, `round ${n}: the embed`);
    await page.keyboard.type(`E${n}`); e += `E${n}`;
  }
  await mustCaret(hostBlock(page, 'Hostitel po.'), null, 'leave the embed');
  await sleep(1500);
  await mustBeSaved(page, 4000);
  const u = (await fileText(core, M.upravy))!, t = (await fileText(core, M.upravitelna))!;
  assert.ok(u.includes(`Hostitel mezi.${h}\n`), 'Úpravy has exactly the H strings in order');
  assert.ok(!/E\d/.test(bodyOf(u)), 'no E string in Úpravy');
  assert.ok(t.includes(`${P1}${e}\n`), 'Upravitelná has exactly the E strings in order');
  assert.ok(!/H\d/.test(bodyOf(t)), 'no H string in Upravitelná');
  assert.deepEqual([...new Set(await writePaths(core))].sort(), [nfc(M.upravitelna), nfc(M.upravy)].sort(), 'no other file written');
});

// ------------------------------------------------------------------------------------------------ AC-10

test('fr_emb_03_ac10_section_embed_writes_only_its_line', async ({ page }) => {
  const core = await onUpravy(page);
  const f = await needTop(main(page), 3, '![[Upravitelná#Druhá část]]');
  assert.match(await headerText(f), /Upravitelná › Druhá část/, 'the heading is shown in the header');
  const box = await must(embedTextbox(f, 'Upravitelná'), 'the section editor');
  assert.equal(await box.getByRole('heading', { name: 'Druhá část' }).count(), 0, "the section's heading isn't in the editable body");
  await typeIn(page, box, 'Text druhé části.', ' Doplněno.');
  const ws = await waitWrites(core, M.upravitelna, 1);
  assert.equal(argText(ws[0]), upWith('Text druhé části.', 'Text druhé části. Doplněno.'), 'only that line and modified');
  await mustBeSaved(page);
  await mustCaret(box, 'Text druhé části. Doplněno.', 'end of the section');
  await page.keyboard.press('Enter');
  await page.keyboard.type('## ');
  await page.keyboard.type('Vsuvka');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Text vsuvky.');
  const t = await fileWhen(core, M.upravitelna, (x) => (x ?? '').includes('Text vsuvky.'), 3000);
  assert.ok((t ?? '').includes('Text druhé části. Doplněno.\n\n## Vsuvka\n\nText vsuvky.\n\n## Třetí část\n'), 'saved just before ## Třetí část');
  await mustBeSaved(page);
  await mustCaret(hostBlock(page, 'Hostitel po.'), null, 'leave the section');
  const secText = await eventually(async () => flat(await embedBody(topEmbed(main(page), 3)).innerText().catch(() => '')), (x) => !x.includes('Vsuvka'), 1500);
  assert.ok(!secText.includes('Vsuvka'), 'after the save the section embed ends before Vsuvka');
  for (const i of [0, 1]) {
    const b = await blockTexts(embedBody(topEmbed(main(page), i)));
    assert.ok(b.includes('Vsuvka') && b.includes('Text vsuvky.'), `full embed ${i + 1} shows Vsuvka and Text vsuvky.`);
  }
});

// ------------------------------------------------------------------------------------------------ AC-11

async function readOnlyFrame(page: Page, core: FakeCoreHandle, f: Locator, what: string, typeAt?: string) {
  const info = await f.evaluate((e) => ({ editable: e.querySelector('[data-embed-body]')?.getAttribute('data-embed-editable') ?? null, ce: e.querySelectorAll('[data-embed-body] [contenteditable="true"], [data-embed-body][contenteditable="true"]').length }));
  assert.deepEqual(info, { editable: 'false', ce: 0 }, `${what}: data-embed-editable="false", no contenteditable`);
  if (typeAt) {
    const before = (await core.calls()).length;
    await caretAt(embedBody(f), typeAt);
    await page.keyboard.type('X');
    await page.keyboard.press('Backspace');
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', 'Vloženo');
      (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await sleep(1500);
    assert.ok(!flat(await f.innerText()).includes('Vloženo'), `${what}: paste changes nothing`);
    assert.deepEqual((await core.calls()).slice(before).filter((c) => /write|create|patch/.test(c.cmd)).map((c) => c.cmd), [], `${what}: no write`);
  }
}

test('fr_emb_03_ac11_depth_2_and_3_are_read_only', async ({ page }) => {
  const core = await openEmbeds(page, M.retez1);
  const r2 = await must(frameAt(main(page), 'Řetěz 2', 1), 'Řetěz 2 at depth 1', 5000);
  assert.equal(await embedBody(r2).first().getAttribute('data-embed-editable'), 'true', 'Řetěz 2 at depth 1 is editable');
  await readOnlyFrame(page, core, await must(frameAt(main(page), 'Řetěz 3', 2), 'Řetěz 3 at depth 2', 5000), 'Řetěz 3 (depth 2)', 'Úroveň 3.');
  await readOnlyFrame(page, core, await must(frameAt(main(page), 'Řetěz 4', 3), 'Řetěz 4 at depth 3', 5000), 'Řetěz 4 (depth 3)');
});

test('fr_emb_03_ac11_block_embed_card_and_link_are_read_only', async ({ page }) => {
  const core = await openEmbeds(page, M.sekce);
  await readOnlyFrame(page, core, await needTop(main(page), 4, '![[Cíl#^blok1]]'), 'block embed', 'Odstavec s identifikátorem.');
  await gotoNote(page, 'Režimy');
  const card = await needTop(main(page), 1, "Jana's card");
  assert.equal(await card.locator('[contenteditable="true"]').count(), 0, 'cards have no contenteditable');
  const link = await needTop(main(page), 4, 'Saturnin link-mode embed');
  assert.equal(await link.locator('[contenteditable="true"]').count(), 0, 'link-mode embeds have no contenteditable');
});

test('fr_emb_03_ac11_read_view_embeds_are_read_only', async ({ page }) => {
  const core = await openEmbeds(page, M.upravy, { readView: true });
  const l = await embedsShown(main(page), 4);
  const full = l.filter((e) => e.mode === 'full');
  assert.ok(full.length >= 3, 'full embeds shown in the read view');
  assert.deepEqual(full.map((e) => e.editable), Array(full.length).fill('false'), 'every embed in the read view is read-only');
  await readOnlyFrame(page, core, topEmbed(main(page), 0), 'read view Upravitelná', P1);
});

test('fr_emb_03_ac11_invalid_frontmatter_is_read_only', async ({ page }) => {
  const core = await openEmbeds(page, M.rozbita);
  const f = await must(frame(main(page), 'Chyba hlavičky').or(main(page).locator(`[data-embed-target="${nfc(M.chybaHlavicky)}"]`)), 'Chyba hlavičky full embed', 5000);
  assert.equal(await f.getAttribute('data-embed-state'), 'read-only', 'data-embed-state read-only');
  assert.ok((await headerText(f)).includes('Read-only'), 'the header shows Read-only');
  assert.deepEqual(await blockTexts(embedBody(f)), ['Tělo s chybnou hlavičkou.'], 'the body');
  await readOnlyFrame(page, core, f, 'Chyba hlavičky', 'Tělo s chybnou');
});

test('fr_emb_03_ac11_invalid_utf8_copy_is_read_only', async ({ page }) => {
  const core = await openEmbeds(page, M.vkladani);
  const enc = new TextEncoder();
  const text = up();
  const i = text.indexOf('První odstavec');
  const bytes = new Uint8Array([...enc.encode(text.slice(0, i + 'První '.length)), 0xff, ...enc.encode(text.slice(i + 'První '.length))]);
  await core.setFile(M.upravitelna, bytes);
  await gotoNote(page, 'Úpravy');
  const f = await needTop(main(page), 0, 'Upravitelná embed with an invalid UTF-8 byte');
  assert.equal(await f.getAttribute('data-embed-state'), 'read-only', 'data-embed-state read-only');
  assert.ok((await headerText(f)).includes('Read-only'), 'Read-only marker');
  await readOnlyFrame(page, core, f, 'invalid UTF-8 Upravitelná', 'k úpravě.');
});

// ------------------------------------------------------------------------------------------------ AC-12

test('fr_emb_03_ac12_nested_embeds_stay_byte_identical', async ({ page }) => {
  const core = await openEmbeds(page, M.retez1);
  const r2 = await must(frameAt(main(page), 'Řetěz 2', 1), 'Řetěz 2 at depth 1', 5000);
  const box = await must(embedTextbox(r2, 'Řetěz 2'), 'Řetěz 2 editor');
  await typeIn(page, box, 'Úroveň 2.', ' Doplněno.');
  const ws = await waitWrites(core, M.retez2, 1);
  const orig = original(M.retez2);
  assert.equal(argText(ws[0]), swap(swap(orig, 'modified: 2026-10-03T08:00:00+02:00', MODIFIED), 'Úroveň 2.', 'Úroveň 2. Doplněno.'), 'that paragraph changed, the ![[Řetěz 3]] line byte-identical');
  await sleep(1200);
  assert.deepEqual([...new Set(await writePaths(core))], [nfc(M.retez2)], 'Řetěz 3 and Řetěz 1 aren’t written');
});

// ------------------------------------------------------------------------------------------------ AC-13

test('fr_emb_03_ac13_save_state_covers_every_file_of_the_page', async ({ page }) => {
  const core = await onUpravy(page);
  assert.ok(await stateIs(page, 'Saved'), 'Saved on open');
  await core.writeControl({ delayMs: 1500, path: M.upravitelna });
  await mustCaret(hostBlock(page, 'Hostitel mezi.'), null, 'host');
  await page.keyboard.type('h');
  await typeIn(page, await embedEditor(page, 0), P1, 'e');
  assert.ok(await stateIs(page, 'Saving…', 800), 'Saving… while a write is pending');
  await waitWrites(core, M.upravy, 1);
  await sleep(100);
  assert.equal(flat(await saveState(page).first().innerText()), 'Saving…', 'still Saving… after the host is written, while the embed write is pending');
  assert.ok(await stateIs(page, 'Saved', 4000), 'Saved only when all are written');
});

test('fr_emb_03_ac13_failed_embed_write_alert_and_retry', async ({ page }) => {
  test.setTimeout(60_000);
  const core = await onUpravy(page, { clock: false });
  await core.writeControl({ fail: 'Io', path: M.upravitelna });
  await typeIn(page, await embedEditor(page, 0), P1, ' Neuloženo.');
  assert.ok(await stateIs(page, 'Not saved', 3000), 'Not saved');
  const al = await must(page.getByRole('alert').filter({ hasText: 'Couldn’t save "Upravitelná". Tegg will try again.' }), 'the non-modal alert');
  await must(al.getByRole('button', { name: 'Try again', exact: true }), 'Try again');
  assert.ok(flat(await (await embedEditor(page, 0)).innerText()).includes('Neuloženo.'), 'the edits stay');
  const t0 = (await writes(core, M.upravitelna)).length;
  const s0 = Date.now();
  await sleep(11_000);
  const n = (await writes(core, M.upravitelna)).length - t0;
  assert.ok(n >= 2 && n <= 3, `retried every 5 s: ${n} retries in ${Date.now() - s0} ms`);
  assert.equal((await writes(core, M.upravy)).length, 0, 'the host is not written');
  await core.writeControl({ fail: null, path: M.upravitelna });
  assert.ok(await stateIs(page, 'Saved', 7000), 'Saved after a successful retry');
});
