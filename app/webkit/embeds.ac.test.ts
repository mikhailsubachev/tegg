// MS4 slice 4F, L5 (WebKit + fake core): note embeds. docs/acceptance/embeds.md FR-EMB-01 AC-1…AC-3, AC-5…AC-11, AC-13
// (L5 parts) and FR-EMB-02 AC-1…AC-12, AC-14, AC-15 (L5 parts); tables R30…R33. Interface docs/contracts/ms4-embeds.md
// §6–§9 (R30 roles and data attributes, `embed_load`, `__TEGG_TEST__.embeds()`). Written from the ACs and the contracts
// only (D-61). Every lookup goes through `must`/`seen` and node:assert, so a missing element is an AssertionError, not a
// Playwright timeout (TS-I1). Test clock 2026-10-17T10:00:00+02:00, Europe/Prague, region en-US.
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  M, MODIFIED, NOTE_PATHS, REZIMY, TITLES, absent, blockMenu, blockTexts, bodyOf, callsOf, cardStrip, caretAt, description, displayAsButton,
  displayAsMenu, editorBody, embedBody, embedList, embedLoads, embedModeGroup, embedsShown, embedsVault, needEmbeds, eventually, fileText, fileWhen, flat,
  focusInside, frame, frontOf, gotoNote, gotoSettings, headerText, hostBlock, idOf, isDisabled, linkSuggestions, main, mainName,
  modeItem, must, mustBeOn, mustBeSaved, mustCaret, navs, needFrame, needTop, nfc, nfd, noModified, openButton, openEmbeds, openPicker, original,
  paragraphBelow, pathOf, pickerList, pickerOptions, pickerQuery, picker, runCommand, seen, selectEmbedBlock, selectedBlocks, sleep, slashBelow, slashMenu, swap,
  topEmbed, topEmbeds, writeCalls, writePaths, writes, type EmbedInfo, type FakeCoreHandle,
} from './embeds-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const VK_BODY = 'Odstavec před.\n\nOdstavec po.\n';
const VK_WITH = (line: string) => `Odstavec před.\n\n${line}\n\nOdstavec po.\n`;

/** Expected top-level embed targets per host (FR-EMB-01 AC-1). */
const HOSTS: { path: string; targets: string[] }[] = [
  { path: M.rezimy, targets: REZIMY.map((r) => r.target) },
  { path: M.sekce, targets: Array(7).fill(M.cil) },
  { path: M.kosoctverec, targets: [M.vetev1, M.vetev2] },
  { path: M.upravy, targets: [M.upravitelna, M.upravitelna, M.bez, M.upravitelna] },
];

/** Whether the first element containing text `a` comes before the top-level embed `n` (document order). */
async function textBeforeEmbed(scope: Locator, a: string, n: number, before = true): Promise<boolean> {
  return scope.first().evaluate((root, [t, i, b]) => {
    const tops = [...root.querySelectorAll('[data-embed-mode]')].filter((e) => !e.parentElement?.closest('[data-embed-mode]'));
    const emb = tops[i as number];
    const el = [...root.querySelectorAll('p, h1, h2, h3, li')].find((e) => !e.closest('[data-embed-mode]') && (e.textContent ?? '').normalize('NFC').trim() === t);
    if (!emb || !el) return false;
    const pos = el.compareDocumentPosition(emb);
    return b ? !!(pos & Node.DOCUMENT_POSITION_FOLLOWING) : !!(pos & Node.DOCUMENT_POSITION_PRECEDING);
  }, [nfc(a), n, before] as const);
}

async function savedFile(page: Page, core: FakeCoreHandle, path: string, ok: (t: string | undefined) => boolean = () => true, ms = 3000): Promise<string> {
  await sleep(150);
  await mustBeSaved(page, ms);
  const t = await fileWhen(core, path, ok, ms);
  assert.ok(t !== undefined, `${path} exists`);
  return t!;
}
/** Chooses the picker option whose first line is `first` (and whose text contains `detail`, if given). */
async function choose(page: Page, first: string, detail?: string) {
  const opts = pickerList(page).getByRole('option');
  const n = await opts.count();
  for (let i = 0; i < n; i++) {
    const t = await opts.nth(i).innerText();
    if (flat(t.split('\n')[0]) === nfc(first) && (!detail || flat(t).includes(detail))) { await opts.nth(i).click(); return; }
  }
  assert.fail(`picker option "${first}"${detail ? ` with "${detail}"` : ''} among ${JSON.stringify(await pickerOptions(page))}`);
}
/** Inserts an embed into Vkládání below `Odstavec před.` through the slash menu and the picker. */
async function insertVia(page: Page, query: string, first: string, detail?: string) {
  await openPicker(page, 'Odstavec před.');
  await pickerQuery(page, query);
  await choose(page, first, detail);
}

// ------------------------------------------------------------------------------------------------ FR-EMB-01 AC-1

for (const view of ['editor', 'read_view'] as const) {
  test(`fr_emb_01_ac1_note_embeds_render_in_file_order_${view}`, async ({ page }) => {
    await openEmbeds(page, M.rezimy, { readView: view === 'read_view' });
    for (const h of HOSTS) {
      if (h.path !== M.rezimy) await gotoNote(page, TITLES[h.path]);
      const list = await eventually(() => topEmbeds(main(page)).catch(() => [] as EmbedInfo[]), (l) => l.length >= h.targets.length, 5000);
      assert.deepEqual(list.map((e) => e.target), h.targets.map(nfc), `${h.path}: one embed per sole-embed paragraph, in file order`);
      for (const [i, e] of list.entries()) assert.ok(['full', 'card', 'link'].includes(e.mode ?? ''), `${h.path} embed ${i + 1}: data-embed-mode full|card|link, got ${e.mode}`);
      assert.equal(await main(page).locator('[data-placeholder="embed-note"]').count(), 0, `${h.path}: no embed-note placeholder`);
    }
    await gotoNote(page, 'Režimy');
    await needEmbeds(main(page), 12, 'the host note');
    assert.ok(await textBeforeEmbed(main(page), 'Před vloženími.', 0), 'Před vloženími. precedes the first embed');
    assert.ok(await textBeforeEmbed(main(page), 'Po vloženích.', 11, false), 'Po vloženích. follows the last embed');
    await gotoNote(page, 'Úpravy');
    await needEmbeds(main(page), 4, 'the host note');
    assert.ok(await textBeforeEmbed(main(page), 'Hostitel mezi.', 1), 'Hostitel mezi. sits between embed 1 and embed 2');
    assert.ok(await textBeforeEmbed(main(page), 'Hostitel mezi.', 0, false), 'Hostitel mezi. after embed 1');
  });

  test(`fr_emb_01_ac1_no_embed_note_placeholder_in_any_fixture_note_${view}`, async ({ page }) => {
    test.setTimeout(180_000);
    await openEmbeds(page, M.rezimy, { readView: view === 'read_view' });
    const shown = await embedsShown(main(page), 12);
    assert.equal(shown.length >= 12, true, 'Režimy shows its 12 embeds');
    const bad: string[] = [];
    for (const p of NOTE_PATHS) {
      await gotoNote(page, TITLES[p]);
      await sleep(300);
      if ((await page.locator('[data-placeholder="embed-note"]').count()) > 0) bad.push(p);
    }
    assert.deepEqual(bad, [], 'no element with data-placeholder="embed-note" in any view of any fixture note');
    const ids = await page.evaluate(async () => ((await import('/src/shell/registry.ts' as string)).IN_NOTE_PLACEHOLDERS as { id: string }[]).map((r) => r.id));
    assert.equal(ids.includes('embed-note'), false, 'IN_NOTE_PLACEHOLDERS has no embed-note row (R32)');
  });

  test(`fr_emb_01_ac1_image_embed_stays_placeholder_and_reads_no_file_${view}`, async ({ page }) => {
    const core = await openEmbeds(page, M.rozbita, { readView: view === 'read_view' });
    await must(main(page).locator('[data-placeholder="embed-image"]').filter({ hasText: 'obrázek.png' }), 'R5 embed-image placeholder of ![[obrázek.png]]', 5000);
    await needFrame(main(page), 'Chyba hlavičky', 'the full embed of Chyba hlavičky next to it');
    const loads = (await embedLoads(core)).flat();
    assert.ok(loads.includes(nfc(M.chybaHlavicky)), 'the note embeds of Rozbitá vložení are loaded with embed_load');
    const touched = (await core.calls()).filter((c) => c.cmd !== 'link_resolve' && JSON.stringify(c.args ?? '').normalize('NFC').includes('obrázek.png'));
    assert.deepEqual(touched.map((c) => c.cmd), [], 'no command reads obrázek.png (D-144)');
    assert.equal(loads.some((p) => p.includes('obrázek')), false, 'embed_load never asks for obrázek.png');
  });
}

// ------------------------------------------------------------------------------------------------ FR-EMB-01 AC-2

test('fr_emb_01_ac2_nfd_embed_resolves_to_cil', async ({ page }) => {
  await openEmbeds(page, M.nfdHost);
  const l = await embedsShown(main(page), 2);
  assert.deepEqual(l.slice(0, 2).map((e) => e.target), [nfc(M.cil), nfc(M.cil)], 'NFD ![[Cíl]] and ![[Cíl#Úvod]] → Pages/Cíl.md');
  assert.deepEqual(l.slice(0, 2).map((e) => e.state), ['ok', 'ok']);
});

test('fr_emb_01_ac2_same_folder_rule_from_quick_notes', async ({ page }) => {
  await openEmbeds(page, M.vlozeniDvojnika);
  const l = await embedsShown(main(page), 1);
  assert.equal(l[0]?.target, nfc(M.dvojnikQ), 'Vložení dvojníka: ![[Dvojník]] → Quick Notes/Dvojník.md');
  await needFrame(main(page), 'Rychlý dvojník', 'frame "Embedded: Rychlý dvojník"');
});

test('fr_emb_01_ac2_same_folder_rule_from_pages_runtime_host', async ({ page }) => {
  const host = 'Pages/Dvojník host.md';
  const vault = embedsVault((f) => { f[host] = '---\nid: 01JB4F0000000000000000E041\ntype: page\ntitle: Dvojník host\n---\n![[Dvojník]]\n'; });
  await openEmbeds(page, host, { vault });
  await mustBeOn(page, 'Dvojník host', 'landing on Dvojník host', 5000);
  const l = await embedsShown(main(page), 1);
  assert.equal(l[0]?.target, nfc(M.dvojnikP), 'Pages/Dvojník host.md: ![[Dvojník]] → Pages/Dvojník.md');
});

test('fr_emb_01_ac2_date_target_resolves_to_the_daily_note', async ({ page }) => {
  await openEmbeds(page, M.rezimy);
  const l = await eventually(() => topEmbeds(main(page)).catch(() => [] as EmbedInfo[]), (x) => x.length >= 12, 5000);
  assert.equal(l[7]?.target, nfc(M.denni), '![[2026-10-07]] → Daily/2026-10-07.md (D-162)');
});

test('fr_emb_01_ac2_alias_template_trash_unresolved', async ({ page }) => {
  await openEmbeds(page, M.rozbita);
  const l = await eventually(() => topEmbeds(main(page)).catch(() => [] as EmbedInfo[]), (x) => x.length >= 4, 5000);
  const broken = l.filter((e) => e.state === 'broken').map((e) => e.target);
  for (const t of ['Chybí', 'Šablona', 'Smazaná', 'Reading list']) assert.ok(broken.includes(nfc(t)), `![[${t}]] is unresolved (data-embed-state="broken", target as written): ${JSON.stringify(broken)}`);
});

test('fr_emb_01_ac2_one_link_resolve_call_for_links_and_embeds', async ({ page }) => {
  const core = await openEmbeds(page, M.vkladani);
  const n0 = (await core.calls()).length;
  await gotoNote(page, 'Režimy');
  await needEmbeds(main(page), 12, 'the host note');
  const calls = (await core.calls()).slice(n0).filter((c) => c.cmd === 'link_resolve' && nfc(String((c.args as any)?.from ?? '')) === nfc(M.rezimy));
  assert.equal(calls.length, 1, 'one link_resolve call from Režimy');
  const targets = ((calls[0].args as any)?.targets ?? []).map((t: string) => nfc(t));
  for (const t of ['Cíl', 'Jana Nováková', 'Šárka Malá', 'Svíčková', 'Saturnin', 'Zavolat Janě', 'Praha', '2026-10-07']) assert.ok(targets.includes(t), `the batch holds the embed target ${t}`);
});

test('fr_emb_01_ac2_embed_and_link_with_one_target_resolve_alike', async ({ page }) => {
  const vault = embedsVault((f) => { f[M.vlozeniDvojnika] = `${f[M.vlozeniDvojnika]}\nOdkaz na [[Dvojník]].\n`; });
  await openEmbeds(page, M.vlozeniDvojnika, { vault });
  const l = await embedsShown(main(page), 1);
  assert.equal(l[0]?.target, nfc(M.dvojnikQ), 'the embed → Quick Notes/Dvojník.md');
  const chip = await must(editorBody(page).locator('[data-link-kind="note"]').first(), 'the link chip [[Dvojník]]');
  await chip.click();
  await mustBeOn(page, 'Rychlý dvojník', 'the link opens the same file as the embed');
});

// ------------------------------------------------------------------------------------------------ FR-EMB-01 AC-3

for (const view of ['editor', 'read_view'] as const) {
  test(`fr_emb_01_ac3_inline_and_nested_embeds_are_link_mode_${view}`, async ({ page }) => {
    await openEmbeds(page, M.uvnitr, { readView: view === 'read_view' });
    const l = await embedsShown(main(page), 5);
    assert.equal(l.length, 5, 'five embeds in Uvnitř textu');
    assert.deepEqual(l.map((e) => e.mode), Array(5).fill('link'), 'every one is link mode (D-419)');
    assert.deepEqual(l.map((e) => e.inline), Array(5).fill(true), 'each sits inline in its paragraph, list item, quote or cell');
    assert.deepEqual(l.map((e) => e.target), [M.cil, M.jana, M.cil, M.cil, M.cil].map(nfc), 'targets in file order');
    assert.deepEqual(l.map((e) => e.icon), ['file-text', 'user', 'file-text', 'file-text', 'file-text'], 'the target type icon');
    assert.deepEqual(l.map((e) => e.text), ['Cíl', 'Jana Nováková', 'Cíl', 'Cíl', 'Cíl'], 'the title');
    const frames = await main(page).evaluate((m) => [...m.querySelectorAll('[data-embed-mode="full"], [data-embed-mode="card"]')]
      .filter((e) => e.parentElement?.closest('p, li, blockquote, td, th, h1, h2, h3, h4, h5, h6, [role="note"]')).length);
    assert.equal(frames, 0, 'no full or card frame inside a paragraph, list item, quote, callout, heading or cell');
    const around = await main(page).evaluate((m) => ({
      p: [...m.querySelectorAll('p')].some((p) => /Text s vloženým/.test(p.textContent ?? '') && /uvnitř odstavce\./.test(p.textContent ?? '')),
      li: m.querySelectorAll('li').length,
      quote: m.querySelectorAll('blockquote').length,
      table: m.querySelectorAll('table').length,
    }));
    assert.deepEqual(around, { p: true, li: 2, quote: 1, table: 1 }, 'the paragraph, list, quote and table render as before');
  });
}

// ------------------------------------------------------------------------------------------------ FR-EMB-01 AC-5

test('fr_emb_01_ac5_slash_lists_embed_object_enabled', async ({ page }) => {
  await openEmbeds(page, M.vkladani);
  const menu = await slashBelow(page, 'Odstavec před.');
  const o = await must(menu.getByRole('option', { name: 'Embed object', exact: true }), 'option "Embed object"');
  assert.notEqual(await o.getAttribute('aria-disabled'), 'true', 'Embed object is enabled');
  assert.ok(!(await description(o)).includes('Coming in'), 'no "Coming in" description');
  await page.keyboard.press('Enter');
  await must(picker(page), 'combobox "Embed object" after ⏎');
  await must(pickerList(page), 'listbox "Embed suggestions"');
});

test('fr_emb_01_ac5_picker_uses_switcher_matching', async ({ page }) => {
  await openEmbeds(page, M.vkladani);
  await openPicker(page, 'Odstavec před.');
  for (const q of ['cil', 'CÍL', nfd('cíl')]) {
    await pickerQuery(page, q);
    assert.equal((await pickerOptions(page))[0], 'Cíl', `"${q}" lists Cíl first`);
  }
  for (const q of ['Šablona', 'Smazaná']) {
    await pickerQuery(page, q);
    const opts = await pickerOptions(page);
    assert.ok(!opts.includes(q), `${q} (template / trash) is never listed: ${JSON.stringify(opts)}`);
  }
  await pickerQuery(page, 'senior');
  const rows = (await pickerList(page).getByRole('option').allInnerTexts()).map((t) => t.split('\n').map((x) => flat(x)).filter(Boolean));
  const spm = rows.filter((r) => r[0] === 'Senior Product Manager');
  assert.equal(spm.length, 2, 'both Senior Product Manager notes are listed');
  assert.deepEqual(spm.map((r) => r.slice(1).join(' ')).sort(), ['Page · Oct 2, 2026 · Senior Product Manager (2)', 'Page · Sep 1, 2026'], 'duplicate titles with their details line (D-289)');
});

test('fr_emb_01_ac5_choosing_cil_writes_exact_bytes_and_renders_full', async ({ page }) => {
  const core = await openEmbeds(page, M.vkladani);
  await insertVia(page, 'cil', 'Cíl');
  const t0 = Date.now();
  const f = await eventually(() => embedList(main(page)).catch(() => [] as EmbedInfo[]), (l) => l.some((e) => e.target === nfc(M.cil) && e.mode === 'full'), 1000);
  assert.ok(f.some((e) => e.target === nfc(M.cil) && e.mode === 'full'), `the embed renders in full mode within 1 s (${Date.now() - t0} ms)`);
  const t = await savedFile(page, core, M.vkladani, (x) => (x ?? '').includes('![[Cíl]]'));
  assert.equal(bodyOf(t), VK_WITH('![[Cíl]]'), 'body of Pages/Vkládání.md');
  assert.equal(noModified(frontOf(t)), noModified(frontOf(original(M.vkladani))), 'frontmatter differs only in modified');
  assert.match(frontOf(t), new RegExp(`^${MODIFIED.replace(/[+]/g, '\\+')}$`, 'm'), 'modified is the test clock');
  assert.deepEqual([...new Set(await writePaths(core))], [nfc(M.vkladani)], 'exactly one file is written');
});

test('fr_emb_01_ac5_slash_in_a_paragraph_with_text_inserts_after_it', async ({ page }) => {
  const core = await openEmbeds(page, M.vkladani);
  await mustCaret(hostBlock(page, 'Odstavec před.'), null, 'end of Odstavec před.');
  await page.keyboard.type(' /emb');
  await must(slashMenu(page), 'slash menu');
  await page.keyboard.press('Enter');
  await must(picker(page), 'combobox "Embed object"');
  await pickerQuery(page, 'cil');
  await choose(page, 'Cíl');
  const t = await savedFile(page, core, M.vkladani, (x) => (x ?? '').includes('![[Cíl]]'));
  const blocks = bodyOf(t).split('\n\n').map((b) => b.replace(/\n$/, ''));
  assert.equal(blocks[0].trimEnd(), 'Odstavec před.', '/emb removed from the paragraph');
  assert.equal(blocks[1], '![[Cíl]]', 'the embed paragraph follows it');
  assert.equal(blocks[2], 'Odstavec po.');
  assert.equal(blocks.length, 3, 'one block added');
});

// ------------------------------------------------------------------------------------------------ FR-EMB-01 AC-6

const AC6: { name: string; query: string; first: string; detail?: string; line: string; target: string; vault?: (f: Record<string, string>) => void }[] = [
  { name: 'cil', query: 'Cíl', first: 'Cíl', line: '![[Cíl]]', target: M.cil },
  { name: 'alias_reading_list', query: 'Reading list', first: 'Cíl', line: '![[Cíl]]', target: M.cil },
  { name: 'c_tips', query: 'C# tips', first: 'C# tips', line: '![[C tips]]', target: M.ctips },
  { name: 'spm_2', query: 'Senior Product Manager', first: 'Senior Product Manager', detail: 'Senior Product Manager (2)', line: '![[Senior Product Manager (2)]]', target: M.spm2 },
  { name: 'dvojnik_pages', query: 'dvojník', first: 'Dvojník', line: '![[Dvojník]]', target: M.dvojnikP },
  { name: 'dvojnik_quick_notes', query: 'dvojník', first: 'Rychlý dvojník', line: '![[Quick Notes/Dvojník]]', target: M.dvojnikQ },
  {
    name: 'nfd_named_copy', query: 'Kopie cíle', first: 'Kopie cíle', line: '![[Kopie cíle]]', target: 'Pages/Kopie cíle.md',
    vault: (f) => { f[nfd('Pages/Kopie cíle.md')] = '---\nid: 01JB4F0000000000000000E042\ntype: page\ntitle: Kopie cíle\n---\nKopie.\n'; },
  },
];
for (const c of AC6) {
  test(`fr_emb_01_ac6_what_is_written_${c.name}`, async ({ page }) => {
    const core = await openEmbeds(page, M.vkladani, c.vault ? { vault: embedsVault(c.vault) } : {});
    await insertVia(page, c.query, c.first, c.detail);
    const t = await savedFile(page, core, M.vkladani, (x) => bodyOf(x) !== VK_BODY);
    assert.equal(bodyOf(t), VK_WITH(c.line), `writes ${c.line} (D-184 target, never an alias, NFC)`);
    assert.equal(bodyOf(t), bodyOf(t).normalize('NFC'), 'the target is written in NFC');
    const l = await embedsShown(main(page), 1);
    assert.equal(l[0]?.target, nfc(c.target), 'link_resolve from Vkládání returns the chosen file (FR-LNK-14)');
  });
}

// ------------------------------------------------------------------------------------------------ FR-EMB-01 AC-7

test('fr_emb_01_ac7_create_row_position', async ({ page }) => {
  await openEmbeds(page, M.vkladani);
  await openPicker(page, 'Odstavec před.');
  await pickerQuery(page, 'Cíl');
  let o = await pickerOptions(page);
  assert.equal(o[o.length - 1], 'Create "Cíl"', `the last row is Create "<query>": ${JSON.stringify(o)}`);
  await pickerQuery(page, 'Nová kapitola');
  o = await pickerOptions(page);
  assert.deepEqual(o, ['Create "Nová kapitola"'], 'the first (only) row when nothing matches');
  await pickerQuery(page, '');
  o = await pickerOptions(page);
  assert.ok(o.length > 0 && !o.some((x) => x.startsWith('Create "')), `no Create row for an empty query: ${JSON.stringify(o)}`);
});

for (const c of [{ slug: 'nova_kapitola', q: 'Nová kapitola', file: 'Quick Notes/Nová kapitola.md', line: '![[Nová kapitola]]', title: 'Nová kapitola' }, { slug: 'c_napad', q: 'C# nápad', file: 'Quick Notes/C nápad.md', line: '![[C nápad]]', title: 'C# nápad' }]) {
  test(`fr_emb_01_ac7_create_from_picker_${c.slug}`, async ({ page }) => {
    const core = await openEmbeds(page, M.vkladani);
    await openPicker(page, 'Odstavec před.');
    await pickerQuery(page, c.q);
    await choose(page, `Create "${c.q}"`);
    const created = await fileWhen(core, c.file, (x) => x !== undefined, 3000);
    assert.ok(created !== undefined, `${c.file} is created`);
    assert.match(created!, /^type: quick-note$/m, 'with the default type Quick Note');
    assert.equal(idOf(created) !== null, true, 'with an id');
    const t = await savedFile(page, core, M.vkladani, (x) => (x ?? '').includes(c.line));
    assert.equal(bodyOf(t), VK_WITH(c.line), `writes ${c.line}`);
    assert.equal(await mainName(page), 'Vkládání', "doesn't navigate");
    const f = await needFrame(main(page), c.title, `the new embed "${c.title}"`);
    assert.equal(await f.getAttribute('data-embed-mode'), 'full', 'full mode (Quick Note)');
    assert.ok(await seen(f.getByText('Empty note', { exact: true }), 2000), 'Empty note (R30a)');
    assert.deepEqual([...new Set(await writePaths(core))].sort(), [nfc(c.file), nfc(M.vkladani)].sort(), 'exactly two files are written');
  });
}

test('fr_emb_01_ac7_undo_removes_the_embed_never_the_note', async ({ page }) => {
  const core = await openEmbeds(page, M.vkladani);
  await openPicker(page, 'Odstavec před.');
  await pickerQuery(page, 'Nová kapitola');
  await choose(page, 'Create "Nová kapitola"');
  await savedFile(page, core, M.vkladani, (x) => (x ?? '').includes('![[Nová kapitola]]'));
  await page.keyboard.press('Meta+z');
  const t = await savedFile(page, core, M.vkladani, (x) => !(x ?? '').includes('![[Nová kapitola]]'));
  assert.equal(bodyOf(t), VK_BODY, '⌘Z removes the embed paragraph');
  assert.ok((await fileText(core, 'Quick Notes/Nová kapitola.md')) !== undefined, 'the new note stays (D-178)');
  assert.equal((await writeCalls(core)).some((c) => /trash|delete/.test(c.cmd)), false, 'nothing deleted');
});

// ------------------------------------------------------------------------------------------------ FR-EMB-01 AC-8

const LINE_OF: Record<string, string> = { 'Dvojník': '![[Dvojník]]', 'Rychlý dvojník': '![[Quick Notes/Dvojník]]' };

test('fr_emb_01_ac8_arrows_move_and_enter_chooses', async ({ page }) => {
  const core = await openEmbeds(page, M.vkladani);
  await openPicker(page, 'Odstavec před.');
  await pickerQuery(page, 'dvojník');
  const sel0 = flat((await pickerList(page).getByRole('option', { selected: true }).first().innerText().catch(() => '')).split('\n')[0]);
  await page.keyboard.press('ArrowDown');
  const sel1 = flat((await pickerList(page).getByRole('option', { selected: true }).first().innerText().catch(() => '')).split('\n')[0]);
  assert.notEqual(sel1, sel0, '↓ moves the selection');
  assert.ok(sel1 in LINE_OF, `the second option is one of the Dvojník notes: ${sel1}`);
  await page.keyboard.press('Enter');
  const t = await savedFile(page, core, M.vkladani, (x) => bodyOf(x) !== VK_BODY);
  assert.equal(bodyOf(t), VK_WITH(LINE_OF[sel1]), '⏎ chooses the selected option');
});

test('fr_emb_01_ac8_tab_chooses', async ({ page }) => {
  const core = await openEmbeds(page, M.vkladani);
  await openPicker(page, 'Odstavec před.');
  await pickerQuery(page, 'cil');
  await page.keyboard.press('Tab');
  const t = await savedFile(page, core, M.vkladani, (x) => bodyOf(x) !== VK_BODY);
  assert.equal(bodyOf(t), VK_WITH('![[Cíl]]'), 'Tab chooses');
});

test('fr_emb_01_ac8_escape_inserts_nothing', async ({ page }) => {
  const core = await openEmbeds(page, M.vkladani);
  await openPicker(page, 'Odstavec před.');
  await pickerQuery(page, 'cil');
  await page.keyboard.press('Escape');
  assert.ok(await absent(picker(page), 1000), 'Esc closes the picker');
  await sleep(1500);
  assert.ok(!(await editorBody(page).first().innerText()).includes('/emb'), 'the typed /emb is removed');
  assert.deepEqual(await writeCalls(core), [], 'nothing is written');
  assert.equal(await fileText(core, M.vkladani), original(M.vkladani), 'Vkládání keeps its bytes');
  assert.equal(await embedList(main(page)).then((l) => l.length), 0, 'no embed inserted');
});

test('fr_emb_01_ac8_undo_right_after_insertion', async ({ page }) => {
  const core = await openEmbeds(page, M.vkladani);
  await insertVia(page, 'cil', 'Cíl');
  await must(frame(main(page), 'Cíl'), 'the inserted embed', 3000);
  await page.keyboard.press('Meta+z');
  assert.ok(await absent(frame(main(page), 'Cíl'), 2000), '⌘Z removes the embed paragraph in one step');
  const t = await savedFile(page, core, M.vkladani);
  assert.equal(bodyOf(t), VK_BODY, 'after the next save the body equals the original body');
});

// ------------------------------------------------------------------------------------------------ FR-EMB-01 AC-9

test('fr_emb_01_ac9_typed_embed_becomes_an_embed', async ({ page }) => {
  const core = await openEmbeds(page, M.vkladani);
  await paragraphBelow(page, 'Odstavec před.');
  await page.keyboard.type('![[Cíl]]');
  await page.keyboard.press('Escape').catch(() => {});
  const f = await needFrame(main(page), 'Cíl', 'the typed ![[Cíl]] turned into an embed', 0, 3000);
  assert.equal(await f.getAttribute('data-embed-mode'), 'full', "in Cíl's mode (full)");
  const t = await savedFile(page, core, M.vkladani, (x) => (x ?? '').includes('![[Cíl]]'));
  assert.equal(bodyOf(t), VK_WITH('![[Cíl]]'), 'saves ![[Cíl]]');
  // `![[obrázek.png]]` typed by hand stays the embed-image placeholder and reads no file.
  await mustCaret(hostBlock(page, 'Odstavec po.'), null, 'end of Odstavec po.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('![[obrázek.png]]');
  await must(editorBody(page).locator('[data-placeholder="embed-image"]'), 'embed-image placeholder', 3000);
  assert.equal((await core.calls()).filter((c) => c.cmd !== 'link_resolve' && c.cmd !== 'note_write' && JSON.stringify(c.args ?? '').includes('obrázek')).length, 0, 'no file read for the image');
});

test('fr_emb_01_ac9_bang_brackets_suggestions_write_an_embed', async ({ page }) => {
  const core = await openEmbeds(page, M.vkladani);
  await paragraphBelow(page, 'Odstavec před.');
  await page.keyboard.type('![[');
  await must(linkSuggestions(page), 'listbox "Link suggestions" after ![[');
  await page.keyboard.type('Cíl');
  await sleep(250);
  await page.keyboard.press('Enter');
  await needFrame(main(page), 'Cíl', 'the chosen Cíl becomes an embed', 0, 3000);
  const t = await savedFile(page, core, M.vkladani, (x) => (x ?? '').includes('![[Cíl'));
  assert.equal(bodyOf(t), VK_WITH('![[Cíl]]'), 'writes ![[Cíl]] (no alias)');
});

// ------------------------------------------------------------------------------------------------ FR-EMB-01 AC-10

test('fr_emb_01_ac10_palette_inserts_after_the_caret_block', async ({ page }) => {
  const core = await openEmbeds(page, M.vkladani);
  await mustCaret(hostBlock(page, 'Odstavec před.'), 'Odstavec', 'inside Odstavec před.');
  await runCommand(page, 'Embed object…');
  await must(picker(page), 'the picker from the palette');
  await pickerQuery(page, 'cil');
  await choose(page, 'Cíl');
  const t = await savedFile(page, core, M.vkladani, (x) => bodyOf(x) !== VK_BODY);
  assert.equal(bodyOf(t), VK_WITH('![[Cíl]]'), 'a new paragraph after the top-level block holding the caret');
});

test('fr_emb_01_ac10_palette_not_run_without_a_note_editor', async ({ page }) => {
  const core = await openEmbeds(page, M.vkladani);
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Embed object');
  await sleep(150);
  const listed = (await page.getByRole('listbox', { name: 'Commands' }).getByRole('option').allInnerTexts()).map((t) => flat(t.split('\n')[0]));
  assert.ok(listed.some((t) => t.startsWith('Embed object…')), `the palette lists Embed object…: ${JSON.stringify(listed)}`);
  await page.keyboard.press('Escape');
  await runCommand(page, 'Go to Search');
  await sleep(300);
  const route = await mainName(page);
  await runCommand(page, 'Embed object…');
  await sleep(300);
  assert.ok(await absent(picker(page), 500), 'not run on a route without a note');
  assert.equal(await mainName(page), route, 'the route stays');
  assert.equal(await page.getByRole('alert').count(), 0, 'no error shown');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

test('fr_emb_01_ac10_palette_not_run_in_the_read_view', async ({ page }) => {
  const core = await openEmbeds(page, M.vkladani, { readView: true });
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Embed object');
  await sleep(150);
  const listed = (await page.getByRole('listbox', { name: 'Commands' }).getByRole('option').allInnerTexts()).map((t) => flat(t.split('\n')[0]));
  assert.ok(listed.some((t) => t.startsWith('Embed object…')), `the command exists: ${JSON.stringify(listed)}`);
  await page.keyboard.press('Enter');
  await sleep(300);
  assert.ok(await absent(picker(page), 500), 'not run in the read view');
  assert.equal(await page.getByRole('alert').count(), 0, 'no error shown');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-EMB-01 AC-11

test('fr_emb_01_ac11_block_embed_is_disabled_for_v1_0', async ({ page }) => {
  const core = await openEmbeds(page, M.vkladani);
  const menu = await slashBelow(page, 'Odstavec před.', '/');
  const o = await must(menu.getByRole('option', { name: 'Block embed', exact: true }), 'option "Block embed"');
  assert.equal(await o.getAttribute('aria-disabled'), 'true', 'aria-disabled');
  assert.match(await description(o), /Coming in v1\.0/, 'Coming in v1.0 (AP-329)');
  const n0 = (await core.calls()).length;
  await o.dispatchEvent('click');
  await sleep(300);
  assert.deepEqual((await core.calls()).slice(n0).map((c) => c.cmd).filter((c) => !c.startsWith('plugin:') && c !== 'perf_mark'), [], 'no command sent');
  // The existing ![[Cíl#^blok1]] renders as FR-EMB-02 AC-3.
  await page.keyboard.press('Escape');
  await gotoNote(page, 'Sekce');
  const f = await needTop(main(page), 4, 'Sekce ![[Cíl#^blok1]]');
  assert.deepEqual(await blockTexts(embedBody(f)), ['Odstavec s identifikátorem.'], 'the block embed shows its block');
});

// ------------------------------------------------------------------------------------------------ FR-EMB-01 AC-13

const upBody = () => bodyOf(original(M.upravy));
async function selectFirstUpravyEmbed(page: Page) {
  await mustCaret(hostBlock(page, 'Hostitel před.'), null, 'end of Hostitel před.');
  await page.keyboard.press('ArrowDown');
  let sel = await selectedBlocks(page);
  if (!sel.includes(2)) sel = await selectEmbedBlock(page, 2);
  assert.deepEqual(sel, [2], 'the first embed is selected as a block');
}
async function targetUntouched(core: FakeCoreHandle) {
  assert.equal((await writes(core, M.upravitelna)).length, 0, 'Pages/Upravitelná.md is never written');
  assert.equal(await fileText(core, M.upravitelna), original(M.upravitelna), 'Upravitelná keeps its bytes');
  assert.equal((await writeCalls(core)).filter((c) => pathOf(c) === nfc(M.upravitelna) || JSON.stringify(c.args ?? '').normalize('NFC').includes('Upravitelná.md')).length, 0, 'never written, trashed or deleted');
}

test('fr_emb_01_ac13_move_down_never_touches_the_target', async ({ page }) => {
  const core = await openEmbeds(page, M.upravy);
  await needEmbeds(main(page), 4, 'the host note');
  await selectFirstUpravyEmbed(page);
  await page.keyboard.press('Meta+Shift+ArrowDown');
  const t = await savedFile(page, core, M.upravy, (x) => bodyOf(x) !== upBody());
  assert.equal(bodyOf(t), upBody().replace('![[Upravitelná]]\n\nHostitel mezi.\n\n', 'Hostitel mezi.\n\n![[Upravitelná]]\n\n'), 'the line moved below Hostitel mezi., byte for byte');
  await targetUntouched(core);
});

test('fr_emb_01_ac13_duplicate_never_touches_the_target', async ({ page }) => {
  const core = await openEmbeds(page, M.upravy);
  await needEmbeds(main(page), 4, 'the host note');
  await selectFirstUpravyEmbed(page);
  await page.keyboard.press('Meta+/');
  await (await must(blockMenu(page).getByRole('menuitem', { name: 'Duplicate', exact: true }), 'Block actions › Duplicate')).click();
  const t = await savedFile(page, core, M.upravy, (x) => bodyOf(x) !== upBody());
  assert.equal(bodyOf(t), upBody().replace('![[Upravitelná]]\n\nHostitel mezi.', '![[Upravitelná]]\n\n![[Upravitelná]]\n\nHostitel mezi.'), 'an identical line added');
  await targetUntouched(core);
});

test('fr_emb_01_ac13_delete_never_touches_the_target', async ({ page }) => {
  const core = await openEmbeds(page, M.upravy);
  await needEmbeds(main(page), 4, 'the host note');
  await selectFirstUpravyEmbed(page);
  await page.keyboard.press('Backspace');
  const t = await savedFile(page, core, M.upravy, (x) => bodyOf(x) !== upBody());
  assert.equal(bodyOf(t), upBody().replace('![[Upravitelná]]\n\nHostitel mezi.', 'Hostitel mezi.'), '⌫ removes only that paragraph');
  await targetUntouched(core);
});

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-1

for (const view of ['editor', 'read_view'] as const) {
  test(`fr_emb_02_ac1_modes_on_rezimy_${view}`, async ({ page }) => {
    const core = await openEmbeds(page, M.rezimy, { readView: view === 'read_view' });
    const l = await eventually(() => topEmbeds(main(page)).catch(() => [] as EmbedInfo[]), (x) => x.length >= 12, 5000);
    assert.deepEqual(l.map((e) => e.mode), REZIMY.map((r) => r.mode), 'modes in file order (AP-319, AP-320, AP-328)');
    assert.deepEqual(l.map((e) => e.target), REZIMY.map((r) => nfc(r.target)), 'targets in file order');
    assert.equal(await fileText(core, M.rezimy), original(M.rezimy), '![[Cíl|jiný text]] is kept in the file');
  });
}

test('fr_emb_02_ac1_quick_note_embed_is_full', async ({ page }) => {
  await openEmbeds(page, M.vlozeniDvojnika);
  const l = await embedsShown(main(page), 1);
  assert.equal(l[0]?.mode, 'full', 'a Quick Note embeds full (R31)');
});

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-2

const CIL_BLOCKS = ['Úvodní odstavec cíle.', 'Úvod', 'Text v úvodu s odkazem na Jana Nováková.', 'Podkapitola', 'Vnořený text podkapitoly.', 'Druhá kapitola', 'Odstavec s identifikátorem.', 'Poslední odstavec cíle.'];

for (const view of ['editor', 'read_view'] as const) {
  test(`fr_emb_02_ac2_full_mode_frame_and_body_${view}`, async ({ page }) => {
    await openEmbeds(page, M.rezimy, { readView: view === 'read_view' });
    const f = await needTop(main(page), 0, 'Cíl full embed');
    assert.equal(await f.getAttribute('aria-label'), 'Embedded: Cíl', 'group "Embedded: Cíl"');
    assert.equal(await f.evaluate((e) => e.firstElementChild?.querySelector('[data-icon]')?.getAttribute('data-icon') ?? null), 'file-text', 'the type icon in the header');
    assert.ok((await headerText(f)).includes('Cíl'), 'the title in the header');
    await must(openButton(f, 'Cíl').first(), 'button "Open Cíl"');
    await must(displayAsButton(f).first(), 'button "Display as"');
    const body = await must(embedBody(f), 'the full body (data-embed-body)');
    assert.deepEqual(await blockTexts(body), CIL_BLOCKS, "Cíl's body in order");
    for (const h of ['Úvod', 'Podkapitola', 'Druhá kapitola']) await must(body.getByRole('heading', { name: h, exact: true }), `heading ${h}`);
    await must(body.locator('[data-link-kind="note"]').filter({ hasText: 'Jana Nováková' }), 'a resolved Jana Nováková chip');
    const txt = flat(await body.innerText());
    assert.ok(!txt.includes('^blok1'), 'the block id is not shown');
    for (const x of ['Reading list', 'id:', 'title:', '01JB4F']) assert.ok(!txt.includes(x), `frontmatter not shown (${x})`);
    const daily = await needTop(main(page), 7, '2026-10-07 full embed');
    assert.deepEqual(await blockTexts(embedBody(daily)), ['Zápis dne.'], 'the Daily Note body');
    assert.equal(await daily.evaluate((e) => e.firstElementChild?.querySelector('[data-icon]')?.getAttribute('data-icon') ?? null), 'calendar', 'the Daily Note icon');
    const sv = await needTop(main(page), 3, 'Svíčková full embed');
    assert.deepEqual(await blockTexts(embedBody(sv)), ['Postup', 'Maso naložit přes noc.'], "Svíčková's body");
  });
}

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-3

const UVOD = ['Text v úvodu s odkazem na Jana Nováková.', 'Podkapitola', 'Vnořený text podkapitoly.'];
for (const view of ['editor', 'read_view'] as const) {
  test(`fr_emb_02_ac3_sections_and_blocks_${view}`, async ({ page }) => {
    await openEmbeds(page, M.sekce, { readView: view === 'read_view' });
    const want: [string, string[], RegExp][] = [
      ['Cíl#Úvod', UVOD, /Cíl › Úvod/],
      ['Cíl#úvod', UVOD, /Cíl › úvod/],
      ['Cíl#Podkapitola', ['Vnořený text podkapitoly.'], /Cíl › Podkapitola/],
      ['Cíl#Druhá kapitola', ['Odstavec s identifikátorem.', 'Poslední odstavec cíle.'], /Cíl › Druhá kapitola/],
      ['Cíl#^blok1', ['Odstavec s identifikátorem.'], /^(?!.*›).*Cíl/],
    ];
    for (const [i, [v, blocks, head]] of want.entries()) {
      const f = await needTop(main(page), i, v);
      assert.match(await headerText(f), head, `${v}: header`);
      assert.deepEqual(await blockTexts(embedBody(f)), blocks, `${v}: body (the section's heading line is never part of it)`);
    }
    await gotoNote(page, 'NFD vložení');
    const n = await needTop(main(page), 1, 'NFD ![[Cíl#Úvod]]');
    assert.deepEqual(await blockTexts(embedBody(n)), UVOD, 'the NFD section embed shows the same body');
  });
}

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-4

async function stripItems(f: Locator): Promise<string[]> {
  return (await cardStrip(f).getByRole('listitem').allInnerTexts()).map(flat);
}
test('fr_emb_02_ac4_card_mode', async ({ page }) => {
  await openEmbeds(page, M.rezimy);
  const jana = await needTop(main(page), 1, "Jana's card");
  assert.equal(await jana.getAttribute('data-embed-mode'), 'card');
  assert.equal(await jana.evaluate((e) => e.firstElementChild?.querySelector('[data-icon]')?.getAttribute('data-icon') ?? null), 'user', 'Osoba icon');
  assert.ok((await headerText(jana)).includes('Jana Nováková'), 'title');
  await must(openButton(jana, 'Jana Nováková'), 'Open Jana Nováková');
  await must(displayAsButton(jana), 'Display as');
  assert.deepEqual(await stripItems(jana), ['Firma Beta a.s.', 'Role Analytička'], 'the Properties strip in preview order');
  assert.ok(!flat(await jana.innerText()).includes('Poznámky o Janě.'), "Jana's body isn't in the card");
  const sarka = await needTop(main(page), 2, "Šárka's card");
  assert.equal(await cardStrip(sarka).count(), 0, 'Šárka: no strip');
  assert.equal(flat(await sarka.innerText()).replace(/Šárka Malá/g, '').trim(), flat(await headerText(sarka)).replace(/Šárka Malá/g, '').trim(), 'Šárka: the header only, no empty-state text');
  const task = await needTop(main(page), 5, 'Zavolat Janě card');
  assert.equal(await task.evaluate((e) => e.firstElementChild?.querySelector('[data-icon]')?.getAttribute('data-icon') ?? null), 'check-square', 'Task icon');
  await must(openButton(task, 'Zavolat Janě'), 'Open Zavolat Janě');
  assert.deepEqual(await stripItems(task), ['Status To do', 'Priority High', 'Due date Oct 9, 2026'], 'the task strip (D-160 medium date)');
  assert.equal(await task.getByRole('checkbox').count(), 0, 'no checkbox until MS5');
  assert.ok(!flat(await task.innerText()).includes('Domluvit schůzku.'), 'no task body');
  const cilCard = await needTop(main(page), 8, '![[Cíl|card]]');
  assert.equal(await cardStrip(cilCard).count(), 0, 'Cíl|card: header only');
  assert.equal(await embedBody(cilCard).count(), 0, 'Cíl|card: no body');
  for (const f of [jana, task]) {
    assert.equal(await f.locator('[contenteditable="true"], input, textarea, [role="textbox"]').count(), 0, 'card values are never editable');
  }
});

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-5

test('fr_emb_02_ac5_link_mode', async ({ page }) => {
  await openEmbeds(page, M.rezimy);
  const l = await eventually(() => topEmbeds(main(page)).catch(() => [] as EmbedInfo[]), (x) => x.length >= 12, 5000);
  for (const [i, title, icon] of [[4, 'Saturnin', 'book'], [10, 'Svíčková', 'utensils']] as const) {
    const e = l[i];
    assert.equal(e?.mode, 'link', `${title}: link mode`);
    assert.equal(e?.text, title, `${title}: the title`);
    assert.equal(e?.icon, icon, `${title}: the type icon`);
    const el = topEmbed(main(page), i);
    assert.equal(await el.locator('[data-embed-body], [role="list"], button').count(), 0, `${title}: no header, body or strip`);
    const alone = await el.evaluate((x) => { const p = x.closest('p') ?? x.parentElement; return ((p as HTMLElement).innerText ?? '').trim() === ((x as HTMLElement).innerText ?? '').trim(); });
    assert.ok(alone, `${title}: alone in its paragraph`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-6

test('fr_emb_02_ac6_unknown_type_value_warns_and_never_rewrites', async ({ page }) => {
  const core = await openEmbeds(page, M.rezimy);
  const l = await eventually(() => topEmbeds(main(page)).catch(() => [] as EmbedInfo[]), (x) => x.length >= 12, 5000);
  assert.equal(l[6]?.mode, 'card', 'Praha (Místo, embed: obrovský) → card');
  await gotoSettings(page, 'Místa', 'Místo');
  const st = await must(main(page).getByRole('status').filter({ hasText: 'Unknown embed mode' }), 'status for the unknown value');
  assert.equal(flat(await st.innerText()), 'Unknown embed mode "obrovský". Using Card.');
  const g = await must(embedModeGroup(page), 'radiogroup "Default embed mode"');
  assert.equal(await g.getByRole('radio', { name: 'Card', exact: true }).getAttribute('aria-checked'), 'true', 'Card checked');
  await sleep(500);
  assert.deepEqual(await writeCalls(core), [], 'reading and opening write nothing');
  assert.equal(await fileText(core, M.mistoYml), original(M.mistoYml), 'místo.yml unchanged');
});

test('fr_emb_02_ac6_type_defaults_and_overrides', async ({ page }) => {
  const core = await openEmbeds(page, M.rezimy);
  await needEmbeds(main(page), 12, 'the host note');
  const r = (await callsOf(core, 'vault_types')).pop()?.result as any[] | undefined;
  const types = (r ?? []).map((t) => [t.key, t.embed, t.embedRaw ?? null]);
  const by = Object.fromEntries(types.map(([k, e, raw]) => [nfc(k), [e, raw]]));
  assert.deepEqual(
    { page: by.page, 'quick-note': by['quick-note'], 'daily-note': by['daily-note'], task: by.task, tag: by.tag, image: by.image, pdf: by.pdf, osoba: by.osoba, recept: by.recept, kniha: by.kniha, [nfc('místo')]: by[nfc('místo')] },
    { page: ['full', null], 'quick-note': ['full', null], 'daily-note': ['full', null], task: ['card', null], tag: ['card', null], image: ['card', null], pdf: ['card', null], osoba: ['card', null], recept: ['full', 'full'], kniha: ['link', 'link'], [nfc('místo')]: ['card', 'obrovský'] },
    'TypeDto embed / embedRaw (R31)');
});

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-7

const OSOBA_FULL = () => swap(original(M.osobaYml), 'preview: [firma, role]\n', 'preview: [firma, role]\nembed: full\n');

test('fr_emb_02_ac7_embeds_section_in_type_settings', async ({ page }) => {
  await openEmbeds(page, M.rezimy);
  await gotoSettings(page, 'Osoby', 'Osoba');
  const sec = await must(main(page).getByRole('region', { name: 'Embeds', exact: true }), 'section "Embeds"');
  const g = await must(sec.getByRole('radiogroup', { name: 'Default embed mode', exact: true }), 'radiogroup');
  const radios = (await g.getByRole('radio').allInnerTexts()).map(flat);
  assert.deepEqual(radios, ['Full', 'Card', 'Link'], 'radios Full, Card, Link');
  assert.equal(await g.getByRole('radio', { name: 'Card', exact: true }).getAttribute('aria-checked'), 'true', 'Card checked');
  assert.ok(await seen(sec.getByText('How Osoby look when embedded in a note.', { exact: true }), 1000), 'the hint');
  const order = await main(page).evaluate((m) => [...m.querySelectorAll('[role="region"], section[aria-label], section[aria-labelledby]')].map((r) => {
    const l = r.getAttribute('aria-label') ?? (r.getAttribute('aria-labelledby') ?? '').split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    return l.trim();
  }));
  const iH = order.indexOf('Hidden properties'), iE = order.indexOf('Embeds'), iR = order.indexOf('Review workflow');
  assert.ok(iH >= 0 && iE > iH && (iR < 0 || iR > iE), `Embeds between Hidden properties and Review workflow: ${JSON.stringify(order)}`);
});

test('fr_emb_02_ac7_choose_full_then_card_writes_the_line', async ({ page }) => {
  const core = await openEmbeds(page, M.rezimy);
  await gotoSettings(page, 'Osoby', 'Osoba');
  const g = await must(embedModeGroup(page), 'radiogroup "Default embed mode"');
  await g.getByRole('radio', { name: 'Full', exact: true }).click();
  const t1 = await fileWhen(core, M.osobaYml, (x) => (x ?? '').includes('embed:'), 3000);
  assert.equal(t1, OSOBA_FULL(), 'exactly the line embed: full after preview: [firma, role]');
  assert.deepEqual((await callsOf(core, 'type_patch')).map((c) => (c.args as any)?.ops), [[{ op: 'embed', mode: 'full' }]], 'one type_patch with the embed op');
  await g.getByRole('radio', { name: 'Card', exact: true }).click();
  const t2 = await fileWhen(core, M.osobaYml, (x) => (x ?? '').includes('embed: card'), 3000);
  assert.equal(t2, swap(OSOBA_FULL(), 'embed: full\n', 'embed: card\n'), 'Card changes the line (the key stays)');
  const n = (await callsOf(core, 'type_patch')).length;
  await g.getByRole('radio', { name: 'Card', exact: true }).click();
  await sleep(800);
  assert.equal((await callsOf(core, 'type_patch')).length, n, 'choosing the checked option writes nothing');
  assert.deepEqual([...new Set(await writePaths(core))], ['type:osoba'], 'no note file is written');
});

test('fr_emb_02_ac7_open_note_follows_the_new_default', async ({ page }) => {
  const core = await openEmbeds(page, M.rezimy);
  const l0 = await eventually(() => topEmbeds(main(page)).catch(() => [] as EmbedInfo[]), (x) => x.length >= 12, 5000);
  assert.equal(l0[1]?.mode, 'card', 'Jana is a card first');
  await gotoSettings(page, 'Osoby', 'Osoba');
  await (await must(embedModeGroup(page).getByRole('radio', { name: 'Full', exact: true }), 'radio Full')).click();
  await fileWhen(core, M.osobaYml, (x) => (x ?? '').includes('embed: full'), 3000);
  await page.keyboard.press('Meta+BracketLeft');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Režimy', 'back on Režimy', 3000);
  const l = await eventually(() => topEmbeds(main(page)).catch(() => [] as EmbedInfo[]), (x) => x[1]?.mode === 'full', 2000);
  assert.equal(l[1]?.mode, 'full', "Jana's embed becomes full within 2 s");
  assert.deepEqual((await writeCalls(core)).filter((c) => c.cmd !== 'type_patch').map((c) => c.cmd), [], 'no note file is written');
});

test('fr_emb_02_ac7_system_type_without_file_is_created', async ({ page }) => {
  const vault = embedsVault((f) => { delete f[M.taskYml]; });
  const core = await openEmbeds(page, M.rezimy, { vault });
  await gotoSettings(page, 'Tasks', 'Task');
  await (await must(embedModeGroup(page).getByRole('radio', { name: 'Full', exact: true }), 'radio Full')).click();
  const t = await fileWhen(core, M.taskYml, (x) => x !== undefined, 3000);
  const builtIn = embedsVault().files[M.taskYml];
  assert.equal(t, swap(builtIn, 'preview: [status, priority, due]\n', 'preview: [status, priority, due]\nembed: full\n'), 'task.yml from the built-in file with embed: full (D-90)');
});

test('fr_emb_02_ac7_arrow_keys_move_within_the_radiogroup', async ({ page }) => {
  await openEmbeds(page, M.rezimy);
  await gotoSettings(page, 'Osoby', 'Osoba');
  const g = await must(embedModeGroup(page), 'radiogroup');
  await g.getByRole('radio', { name: 'Card', exact: true }).focus();
  const checked = async () => flat(await g.getByRole('radio', { checked: true }).first().innerText().catch(() => ''));
  await page.keyboard.press('ArrowRight');
  assert.equal(await eventually(checked, (c) => c === 'Link', 1000), 'Link', '→ moves to Link');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await eventually(checked, (c) => c === 'Card', 1000), 'Card', '← back to Card');
  await page.keyboard.press('ArrowUp');
  assert.equal(await eventually(checked, (c) => c === 'Full', 1000), 'Full', '↑ to Full');
  await page.keyboard.press('ArrowDown');
  assert.equal(await eventually(checked, (c) => c === 'Card', 1000), 'Card', '↓ to Card');
});

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-8

async function chooseMode(page: Page, f: Locator, mode: 'Full' | 'Card' | 'Link') {
  await (await must(displayAsButton(f), 'button "Display as"')).click();
  await must(displayAsMenu(page), 'menu "Display as"');
  await (await must(modeItem(page, mode), `menuitemradio ${mode}`)).click();
}
const REZ = () => original(M.rezimy);

test('fr_emb_02_ac8_display_as_menu_on_janas_card', async ({ page }) => {
  const core = await openEmbeds(page, M.rezimy);
  const jana = await needTop(main(page), 1, "Jana's card");
  await (await must(displayAsButton(jana), 'Display as')).click();
  const menu = await must(displayAsMenu(page), 'menu "Display as"');
  const items = (await menu.getByRole('menuitemradio').allInnerTexts()).map(flat);
  assert.deepEqual(items, ['Full', 'Card', 'Link'], 'Full, Card, Link');
  assert.equal(await modeItem(page, 'Card').getAttribute('aria-checked'), 'true', 'Card checked');
  await modeItem(page, 'Full').click();
  const t = await savedFile(page, core, M.rezimy, (x) => (x ?? '').includes('![[Jana Nováková|full]]\n\n![[Šárka'));
  assert.equal(t, swap(swap(REZ(), '![[Jana Nováková]]\n', '![[Jana Nováková|full]]\n'), 'modified: 2026-10-02T08:00:00+02:00', MODIFIED), 'that line and modified only');
  assert.equal((await writes(core, M.rezimy)).length, 1, 'one autosave');
  await caretAt(hostBlock(page, 'Před vloženími.'), null);
  await page.keyboard.press('Meta+z');
  const u = await savedFile(page, core, M.rezimy, (x) => bodyOf(x) === bodyOf(REZ()));
  assert.equal(bodyOf(u), bodyOf(REZ()), 'one undo step restores the line');
});

test('fr_emb_02_ac8_choosing_the_type_default_removes_the_keyword', async ({ page }) => {
  const core = await openEmbeds(page, M.rezimy);
  await chooseMode(page, await needTop(main(page), 9, '![[Jana Nováková|full]]'), 'Card');
  const t = await savedFile(page, core, M.rezimy, (x) => !(x ?? '').includes('|full]]'));
  assert.equal(bodyOf(t), bodyOf(REZ()).replace('![[Jana Nováková|full]]', '![[Jana Nováková]]'), 'back to ![[Jana Nováková]]');
});

test('fr_emb_02_ac8_other_alias_text_is_replaced_and_undo_restores_it', async ({ page }) => {
  const core = await openEmbeds(page, M.rezimy);
  await chooseMode(page, await needTop(main(page), 11, '![[Cíl|jiný text]]'), 'Card');
  const t = await savedFile(page, core, M.rezimy, (x) => !(x ?? '').includes('|jiný text'));
  assert.equal(bodyOf(t), bodyOf(REZ()).replace('![[Cíl|jiný text]]', '![[Cíl|card]]'), 'writes ![[Cíl|card]]');
  await caretAt(hostBlock(page, 'Po vloženích.'), null);
  await page.keyboard.press('Meta+z');
  const u = await savedFile(page, core, M.rezimy, (x) => (x ?? '').includes('|jiný text'));
  assert.equal(bodyOf(u), bodyOf(REZ()), '⌘Z restores |jiný text');
});

test('fr_emb_02_ac8_typed_link_keyword_equals_choosing_link', async ({ page }) => {
  const core = await openEmbeds(page, M.vkladani);
  await paragraphBelow(page, 'Odstavec před.');
  await page.keyboard.type('![[Jana Nováková|link]]');
  await page.keyboard.press('Escape').catch(() => {});
  const l = await eventually(() => topEmbeds(main(page)).catch(() => [] as EmbedInfo[]), (x) => x.length >= 1, 3000);
  assert.equal(l[0]?.mode, 'link', 'typed |link gives a link-mode embed');
  const t = await savedFile(page, core, M.vkladani, (x) => bodyOf(x) !== VK_BODY);
  assert.equal(bodyOf(t), VK_WITH('![[Jana Nováková|link]]'), 'the same line choosing Link writes');
});

test('fr_emb_02_ac8_read_view_display_as_is_disabled', async ({ page }) => {
  const core = await openEmbeds(page, M.rezimy, { readView: true });
  const jana = await needTop(main(page), 1, "Jana's card in the read view");
  const b = await must(displayAsButton(jana), 'Display as');
  assert.equal(await isDisabled(b), true, 'aria-disabled');
  assert.equal(await description(b), "This note can't be edited here.", 'description');
  await b.dispatchEvent('click');
  assert.ok(await absent(displayAsMenu(page), 500), 'no menu');
  await sleep(500);
  assert.deepEqual(await writeCalls(core), [], 'nothing is written');
});

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-9

test('fr_emb_02_ac9_open_button_opens_and_records', async ({ page }) => {
  const core = await openEmbeds(page, M.rezimy);
  const f = await needTop(main(page), 0, 'Cíl full embed');
  const n0 = (await navs(core)).length;
  await (await must(openButton(f, 'Cíl'), 'Open Cíl')).click();
  await mustBeOn(page, 'Cíl', 'Open Cíl opens note/Pages/Cíl.md');
  assert.deepEqual((await navs(core)).slice(n0), [nfc(M.cil)], 'recorded with nav_opened (D-138)');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Režimy', 'Back returns to Režimy');
  const f2 = await needTop(main(page), 0, 'Cíl full embed again');
  await openButton(f2, 'Cíl').focus();
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Cíl', '⏎ on Open Cíl opens Cíl');
  assert.equal(await page.getByRole('dialog').count(), 0, 'no preview popover');
  assert.deepEqual(await writeCalls(core), [], 'opening writes nothing');
});

test('fr_emb_02_ac9_open_section_scrolls_to_the_heading', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 500 });
  await openEmbeds(page, M.sekce);
  const f = await needTop(main(page), 0, 'Cíl#Úvod');
  await (await must(openButton(f, 'Cíl'), 'Open Cíl')).click();
  await mustBeOn(page, 'Cíl', 'opens Cíl');
  const d = await eventually(() => page.evaluate(() => {
    const h = [...document.querySelectorAll('main h1, main h2, main h3, main h4')].find((x) => (x.textContent ?? '').trim().normalize('NFC') === 'Úvod');
    if (!h) return null;
    let s: Element | null = h.parentElement;
    while (s && !(s.scrollHeight > s.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    const top = s ? Math.max(s.getBoundingClientRect().top, 0) : 0;
    return Math.abs(h.getBoundingClientRect().top - top);
  }), (x) => x !== null && x <= 8, 2000);
  assert.ok(d !== null && d <= 8, `Úvod at the top of the centre pane (± 8 px), off by ${d}`);
});

test('fr_emb_02_ac9_card_and_link_mode_open_their_target', async ({ page }) => {
  const core = await openEmbeds(page, M.rezimy);
  const jana = await needTop(main(page), 1, "Jana's card");
  await (await must(jana.locator(':scope > :first-child').getByText('Jana Nováková', { exact: true }), "the card's title")).click();
  await mustBeOn(page, 'Jana Nováková', 'a click on the card outside its strip opens Jana');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Režimy', 'Back');
  await (await needTop(main(page), 1, "Jana's card")).focus();
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Jana Nováková', '⏎ on the card opens Jana');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Režimy', 'Back');
  await (await needTop(main(page), 4, 'Saturnin link-mode embed')).click();
  await mustBeOn(page, 'Saturnin', 'a click on the link-mode embed opens Saturnin');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Režimy', 'Back');
  await (await needTop(main(page), 4, 'Saturnin link-mode embed')).focus();
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Saturnin', '⏎ on the link-mode embed opens Saturnin');
  assert.deepEqual(await writeCalls(core), [], 'opening writes nothing');
});

test('fr_emb_02_ac9_cmd_enter_on_a_selected_embed_and_back_keeps_scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  const core = await openEmbeds(page, M.rezimy);
  await needEmbeds(main(page), 12, 'the host note');
  await mustCaret(hostBlock(page, 'Před vloženími.'), null, 'end of Před vloženími.');
  await page.keyboard.press('ArrowDown');
  let sel = await selectedBlocks(page);
  if (!sel.includes(2)) sel = await selectEmbedBlock(page, 2);
  assert.deepEqual(sel, [2], 'the Cíl embed is selected as a block');
  await page.keyboard.press('Meta+Enter');
  await mustBeOn(page, 'Cíl', '⌘↩ opens the selected embed’s target (D-209)');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Režimy', 'Back');
  const last = await needTop(main(page), 11, '![[Cíl|jiný text]]');
  await last.scrollIntoViewIfNeeded();
  const scrollTop = () => page.evaluate(() => {
    const m = document.querySelector('main');
    let s: Element | null = m?.querySelector('[data-embed-mode]') ?? null;
    while (s && !(s.scrollHeight > s.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    return s ? s.scrollTop : -1;
  });
  const before = await scrollTop();
  assert.ok(before > 0, 'Režimy is scrolled');
  await (await must(openButton(last, 'Cíl'), 'Open Cíl on the last embed')).click();
  await mustBeOn(page, 'Cíl', 'opens Cíl');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Režimy', 'Back');
  const after = await eventually(scrollTop, (s) => Math.abs(s - before) <= 8, 2000);
  assert.ok(Math.abs(after - before) <= 8, `Back returns to the scroll position (${before} → ${after})`);
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

test('fr_emb_02_ac9_click_in_a_full_body_places_the_caret', async ({ page }) => {
  const core = await openEmbeds(page, M.rezimy);
  const f = await needTop(main(page), 0, 'Cíl full embed');
  const body = await must(embedBody(f), 'body');
  await (await must(body.getByText('Úvodní odstavec cíle.', { exact: true }), 'Úvodní odstavec cíle.')).click();
  await sleep(500);
  assert.equal(await mainName(page), 'Režimy', 'a click inside the body never navigates');
  assert.ok(await focusInside(body), 'it places the caret in the embed');
  assert.equal(await page.getByRole('dialog').count(), 0, 'no preview popover');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-10

async function scrolled(page: Page): Promise<number> {
  return page.evaluate(() => {
    let s: Element | null = document.querySelector('main [data-embed-mode]');
    while (s && !(s.scrollHeight > s.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    return s ? s.scrollTop : -1;
  });
}
async function midScroll(page: Page) {
  await page.setViewportSize({ width: 1440, height: 600 });
  await (await needTop(main(page), 5, 'a middle embed')).scrollIntoViewIfNeeded();
  return scrolled(page);
}

test('fr_emb_02_ac10_live_update_appended_paragraph', async ({ page }) => {
  const core = await openEmbeds(page, M.rezimy);
  await needEmbeds(main(page), 12, 'the host note');
  const s0 = await midScroll(page);
  await core.setFile(M.cil, `${original(M.cil)}\nNový odstavec.\n`);
  for (const i of [0, 11]) {
    const last = await eventually(async () => (await blockTexts(embedBody(topEmbed(main(page), i))).catch(() => [] as string[])).pop(), (x) => x === 'Nový odstavec.', 2000);
    assert.equal(last, 'Nový odstavec.', `full Cíl frame ${i + 1} ends with the new paragraph within 2 s`);
  }
  assert.ok(Math.abs((await scrolled(page)) - s0) <= 2, 'scroll position kept');
  assert.deepEqual(await writeCalls(core), [], 'nothing is written');
});

test('fr_emb_02_ac10_live_update_title', async ({ page }) => {
  const core = await openEmbeds(page, M.rezimy);
  await needEmbeds(main(page), 12, 'the host note');
  await core.setFile(M.svickova, swap(original(M.svickova), 'title: Svíčková\n', 'title: Svíčková na smetaně\n'));
  assert.ok(await seen(frame(main(page), 'Svíčková na smetaně'), 2000), "Svíčková's header updates within 2 s");
  const l = await eventually(() => topEmbeds(main(page)), (x) => x[10]?.text === 'Svíčková na smetaně', 2000);
  assert.equal(l[10]?.text, 'Svíčková na smetaně', 'the link-mode embed too');
  assert.deepEqual(await writeCalls(core), [], 'nothing is written');
});

test('fr_emb_02_ac10_live_update_card_value', async ({ page }) => {
  const core = await openEmbeds(page, M.rezimy);
  await needEmbeds(main(page), 12, 'the host note');
  await core.setFile(M.jana, swap(original(M.jana), 'role: Analytička\n', 'role: Vedoucí\n'));
  const items = await eventually(async () => (await cardStrip(topEmbed(main(page), 1)).getByRole('listitem').allInnerTexts().catch(() => [] as string[])).map(flat), (x) => x.includes('Role Vedoucí'), 2000);
  assert.deepEqual(items, ['Firma Beta a.s.', 'Role Vedoucí'], "Jana's card updates within 2 s");
  assert.deepEqual(await writeCalls(core), [], 'nothing is written');
});

test('fr_emb_02_ac10_live_update_deleted_target_is_broken', async ({ page }) => {
  const core = await openEmbeds(page, M.rezimy);
  const l0 = await embedsShown(main(page), 12);
  assert.equal(l0.find((e) => e.target === nfc(M.saturnin))?.state, 'ok', 'Saturnin resolves first');
  await core.setFile(M.saturnin, null);
  const l = await eventually(() => topEmbeds(main(page)), (x) => x[4]?.state === 'broken', 2000);
  assert.equal(l[4]?.state, 'broken', 'the link-mode embed turns broken within 2 s');
  assert.deepEqual(await writeCalls(core), [], 'nothing is written');
});

test('fr_emb_02_ac10_live_update_created_target', async ({ page }) => {
  const core = await openEmbeds(page, M.rozbita);
  const l0 = await eventually(() => topEmbeds(main(page)).catch(() => [] as EmbedInfo[]), (x) => x.length >= 1, 5000);
  assert.equal(l0[0]?.state, 'broken', '![[Chybí]] is broken first');
  await core.setFile('Pages/Chybí.md', '---\ntype: page\n---\nNově vytvořená.\n');
  const l = await eventually(() => topEmbeds(main(page)), (x) => x[0]?.state === 'ok' && x[0]?.mode === 'full', 2000);
  assert.deepEqual([l[0]?.state, l[0]?.mode], ['ok', 'full'], '![[Chybí]] renders as a full embed within 2 s');
  assert.deepEqual(await writeCalls(core), [], 'nothing is written');
});

test('fr_emb_02_ac10_live_update_type_default', async ({ page }) => {
  const core = await openEmbeds(page, M.rezimy);
  await needEmbeds(main(page), 12, 'the host note');
  const s0 = await midScroll(page);
  await core.setFile(M.receptYml, swap(original(M.receptYml), 'embed: full\n', 'embed: card\n'));
  const l = await eventually(() => topEmbeds(main(page)), (x) => x[3]?.mode === 'card', 2000);
  assert.equal(l[3]?.mode, 'card', 'Svíčková re-renders as a card within 2 s');
  assert.ok(Math.abs((await scrolled(page)) - s0) <= 2, 'scroll position kept');
  assert.deepEqual(await writeCalls(core), [], 'nothing is written');
});

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-11

test('fr_emb_02_ac11_showing_an_embed_is_not_opening_it', async ({ page }) => {
  const core = await openEmbeds(page, M.vkladani);
  const n0 = (await navs(core)).length;
  await gotoNote(page, 'Režimy');
  await needEmbeds(main(page), 12, 'the host note');
  await sleep(500);
  assert.deepEqual((await navs(core)).slice(n0), [nfc(M.rezimy)], 'nav_opened exactly once, for Režimy');
  await page.keyboard.press('Meta+o');
  await sleep(300);
  const recent = (await page.getByRole('dialog', { name: 'Quick switcher' }).getByRole('option').allInnerTexts()).map((t) => flat(t.split('\n')[0]));
  for (const t of ['Cíl', 'Jana Nováková', 'Šárka Malá', 'Svíčková', 'Saturnin', 'Zavolat Janě', 'Praha', '2026-10-07']) assert.ok(!recent.includes(t), `${t} isn't in the recent list`);
  await page.keyboard.press('Escape');
  const bad = (await writeCalls(core)).filter((c) => ['note_write', 'note_create', 'note_create_exact', 'link_create', 'type_patch'].includes(c.cmd));
  assert.deepEqual(bad.map((c) => c.cmd), [], 'no write');
});

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-12

test('fr_emb_02_ac12_rezimy_one_resolve_one_load', async ({ page }) => {
  const core = await openEmbeds(page, M.vkladani);
  const n0 = (await core.calls()).length;
  await gotoNote(page, 'Režimy');
  await needEmbeds(main(page), 12, 'the host note');
  await sleep(500);
  const calls = (await core.calls()).slice(n0);
  assert.equal(calls.filter((c) => c.cmd === 'link_resolve').length, 1, 'one link_resolve');
  const loads = calls.filter((c) => c.cmd === 'embed_load');
  assert.equal(loads.length, 1, 'one embed_load for all 12 embeds');
  const paths = ((loads[0].args as any)?.paths ?? []).map((p: string) => nfc(p));
  for (const p of [M.cil, M.jana, M.sarka, M.svickova, M.zavolat, M.praha, M.denni]) assert.ok(paths.includes(nfc(p)), `${p} in the batch`);
  assert.equal(new Set(paths).size, paths.length, 'each path once');
  assert.equal(calls.filter((c) => c.cmd === 'note_read' && pathOf(c) !== nfc(M.rezimy)).length, 0, 'no note_read for an embedded note');
});

test('fr_emb_02_ac12_chain_one_load_per_level', async ({ page }) => {
  const core = await openEmbeds(page, M.retez1);
  await eventually(() => embedList(main(page)).catch(() => [] as EmbedInfo[]), (l) => l.length >= 4, 5000);
  await sleep(500);
  assert.deepEqual(await embedLoads(core), [[M.retez2], [M.retez3], [M.retez4]].map((x) => x.map(nfc)), 'one embed_load per nesting level, 3 in total');
});

test('fr_emb_02_ac12_repeated_note_loaded_once', async ({ page }) => {
  const core = await openEmbeds(page, M.kosoctverec);
  await eventually(() => embedList(main(page)).catch(() => [] as EmbedInfo[]), (l) => l.length >= 4, 5000);
  await sleep(500);
  const all = (await embedLoads(core)).flat();
  assert.equal(all.filter((p) => p === nfc(M.list)).length, 1, 'Pages/List.md loaded once although shown twice');
  assert.ok((await embedLoads(core)).length <= 2, 'at most one call per level');
});

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-14

test('fr_emb_02_ac14_arrows_enter_escape_between_host_and_embed', async ({ page }) => {
  await openEmbeds(page, M.upravy);
  await needEmbeds(main(page), 4, 'the host note');
  await mustCaret(hostBlock(page, 'Hostitel před.'), null, 'end of Hostitel před.');
  await page.keyboard.press('ArrowDown');
  assert.deepEqual(await selectedBlocks(page), [2], '↓ selects the first embed as a block');
  await page.keyboard.press('Enter');
  const f = topEmbed(main(page), 0);
  const where = () => page.evaluate(() => {
    const s = window.getSelection();
    const n = s?.anchorNode;
    const el = n ? (n.nodeType === 3 ? n.parentElement : (n as Element)) : null;
    return { text: (el?.closest('p, li, h2, h3')?.textContent ?? '').normalize('NFC').trim(), offset: s?.anchorOffset ?? -1, inEmbed: !!el?.closest('[data-embed-body]') };
  });
  let w = await eventually(where, (x) => x.inEmbed, 1000);
  assert.deepEqual(w, { text: 'První odstavec k úpravě.', offset: 0, inEmbed: true }, '⏎ puts the caret at the start of the embedded text');
  await page.keyboard.press('Escape');
  assert.deepEqual(await eventually(() => selectedBlocks(page), (s) => s.includes(2), 1000), [2], 'Esc returns to the host with that embed selected');
  assert.equal(await focusInside(embedBody(f)), false, 'the focus left the embed');
  await page.keyboard.press('Enter');
  await mustCaret(embedBody(f), 'Text třetí části.', 'end of the embed’s last block');
  await page.keyboard.press('ArrowDown');
  w = await eventually(where, (x) => !x.inEmbed, 1000);
  assert.equal(w.text, 'Hostitel mezi.', '↓ at the end of the last block moves to Hostitel mezi.');
});

test('fr_emb_02_ac14_display_embed_as_and_cmd_enter_on_a_selected_embed', async ({ page }) => {
  await openEmbeds(page, M.rezimy);
  await needEmbeds(main(page), 12, 'the host note');
  await mustCaret(hostBlock(page, 'Před vloženími.'), null, 'end of Před vloženími.');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  let sel = await selectedBlocks(page);
  if (!sel.includes(3)) sel = await selectEmbedBlock(page, 3);
  assert.deepEqual(sel, [3], "Jana's card is selected");
  await runCommand(page, 'Display embed as…');
  await must(displayAsMenu(page), 'Display embed as… opens the Display as menu');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  assert.ok(await absent(displayAsMenu(page), 1000), 'Esc closes it');
  await page.keyboard.press('Meta+Enter');
  await mustBeOn(page, 'Jana Nováková', '⌘↩ opens the target');
});

test('fr_emb_02_ac14_read_view_tab_reaches_open_and_display_as', async ({ page }) => {
  await openEmbeds(page, M.rezimy, { readView: true });
  await needEmbeds(main(page), 12, 'the host note');
  await page.getByRole('main').getByRole('heading', { level: 1 }).first().focus().catch(() => {});
  const seenNames: string[] = [];
  for (let i = 0; i < 150; i++) {
    await page.keyboard.press('Tab');
    const n = await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') ?? (document.activeElement as HTMLElement | null)?.innerText ?? '').trim().normalize('NFC'));
    if (/^Open /.test(n) || n === 'Display as') seenNames.push(n);
    if (seenNames.length >= 20) break;
  }
  const frames = ['Cíl', 'Jana Nováková', 'Šárka Malá', 'Svíčková', 'Zavolat Janě', 'Praha', '2026-10-07', 'Cíl', 'Jana Nováková', 'Cíl'];
  assert.deepEqual(seenNames, frames.flatMap((t) => [`Open ${t}`, 'Display as']), 'Tab reaches each frame’s Open and Display as in document order');
});

test('fr_emb_02_ac14_commands_without_a_selected_embed_are_not_run', async ({ page }) => {
  const core = await openEmbeds(page, M.rezimy);
  await needEmbeds(main(page), 12, 'the host note');
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill('embed');
  await sleep(150);
  const listed = (await page.getByRole('listbox', { name: 'Commands' }).getByRole('option').allInnerTexts()).map((t) => flat(t.split('\n')[0]));
  for (const c of ['Open embedded note', 'Display embed as…']) assert.ok(listed.some((t) => t.startsWith(c)), `the palette lists ${c}: ${JSON.stringify(listed)}`);
  await page.keyboard.press('Escape');
  for (const c of ['Open embedded note', 'Display embed as…']) {
    await mustCaret(hostBlock(page, 'Před vloženími.'), 'Před', 'caret in text');
    await runCommand(page, c);
    await sleep(300);
    assert.equal(await mainName(page), 'Režimy', `${c}: not run`);
    assert.ok(await absent(displayAsMenu(page), 300), `${c}: no menu`);
    assert.equal(await page.getByRole('alert').count(), 0, `${c}: no error`);
  }
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

const CONTROLS = 'button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="checkbox"], [role="radio"], [role="switch"]';
for (const [at, slug] of [[M.rezimy, 'rezimy'], [M.sekce, 'sekce']] as const) {
  test(`fr_emb_02_ac14_every_embed_control_is_a_command_${slug}`, async ({ page }) => {
    await openEmbeds(page, at);
    await embedsShown(main(page), at === M.rezimy ? 12 : 7);
    const missing = await page.evaluate((sel) => [...document.querySelectorAll(sel)]
      .filter((e) => (e as HTMLElement).getClientRects().length > 0 && !(e.getAttribute('data-command') ?? '').trim())
      .map((e) => `${e.tagName.toLowerCase()} "${(e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 40)}"`), CONTROLS);
    const embedControls = await page.locator('[data-embed-mode] button').count();
    assert.ok(embedControls > 0, 'the embeds have controls');
    assert.deepEqual(missing, [], 'every control carries data-command (FR-UX-03 AC-8)');
  });
}

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-15

const PSEUDO = `import { setCatalog as __tsc, pseudo as __tps, en as __ten } from '/src/i18n/catalog.ts'; __tsc(__tps(__ten), 'en');`;
/** User content allowed outside ⟦ ⟧: titles, headings, preview names and values, targets as written. */
const USER = new Set([
  ...Object.values(TITLES), 'Cíl › Úvod', 'Cíl › úvod', 'Cíl › Podkapitola', 'Cíl › Druhá kapitola', 'Cíl › Neexistující nadpis', 'Obsah › Kapitola jedna',
  'Firma', 'Beta a.s.', 'Role', 'Analytička', 'Status', 'To do', 'Priority', 'High', 'Due date', 'Oct 9, 2026', 'Chybí', 'Šablona', 'Smazaná',
  'Reading list', '2026-10-20', 'Chyba hlavičky', 'Úvod', 'úvod', 'Podkapitola', 'Druhá kapitola', 'Neexistující nadpis', 'Kapitola jedna', '›', 'Osoby',
].map(nfc));
async function leaks(page: Page): Promise<string[]> {
  return page.evaluate((allowed) => {
    const ok = new Set(allowed);
    const out: string[] = [];
    for (const root of document.querySelectorAll('[data-embed-mode]')) {
      if (root.parentElement?.closest('[data-embed-mode]')) continue;
      const walk = (n: Node) => {
        if (n.nodeType === 3) {
          const t = (n.textContent ?? '').trim().normalize('NFC');
          const el = n.parentElement;
          if (!t || !el || el.closest('[data-embed-body], [data-link-kind], [data-user-content]')) return;
          if (ok.has(t) || /⟦|⟧/.test(el.textContent ?? '')) return;
          out.push(t);
        } else n.childNodes.forEach(walk);
      };
      walk(root);
      const label = root.getAttribute('aria-label');
      if (label && root.getAttribute('data-embed-mode') !== 'link' && !/⟦/.test(label)) out.push(`aria-label ${label}`);
    }
    return out;
  }, [...USER]);
}
for (const [at, slug] of [[M.rezimy, 'rezimy'], [M.sekce, 'sekce'], [M.rozbita, 'rozbita_vlozeni'], [M.kruhA, 'kruh_a'], [M.retez1, 'retez_1']] as const) {
  test(`fr_emb_02_ac15_pseudo_locale_${slug}`, async ({ page }) => {
    await openEmbeds(page, at, { prelude: PSEUDO });
    const l = await embedsShown(main(page), 1);
    assert.ok(l.length > 0, 'embeds shown');
    assert.deepEqual(await leaks(page), [], 'only user content is outside ⟦ ⟧');
  });
}
test('fr_emb_02_ac15_pseudo_locale_type_settings_osoba', async ({ page }) => {
  await openEmbeds(page, M.rezimy, { prelude: PSEUDO });
  await runCommand(page, 'Go to type Osoby');
  await (await must(main(page).locator('[data-command]').filter({ hasText: /Type settings/ }), 'Type settings control', 5000)).click();
  const sec = await must(main(page).getByRole('region', { name: /^⟦Embeds⟧$/ }), 'section ⟦Embeds⟧', 5000);
  const out = await sec.evaluate((root) => {
    const res: string[] = [];
    const walk = (n: Node) => {
      if (n.nodeType === 3) {
        const t = (n.textContent ?? '').trim();
        const el = n.parentElement;
        if (t && el && !/⟦|⟧/.test(el.textContent ?? '')) res.push(t);
      } else n.childNodes.forEach(walk);
    };
    walk(root);
    return res;
  });
  assert.deepEqual(out, [], 'every text of the Embeds section is a catalog message');
});
