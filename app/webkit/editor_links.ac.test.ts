// MS3 slice 3C, L5 (WebKit + fake core): link and tag autocomplete and paste in the editor. FR-EDT-06 AC-1…AC-7,
// FR-EDT-15 AC-1…AC-4, FR-EDT-14 AC-1…AC-7. Written from docs/acceptance/editor.md and docs/contracts/ms3-shell.md §13
// only (D-61). Missing elements fail through `must`/node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { absent, mainName } from './helpers';
import { watchNetwork } from './read-helpers';
import {
  E, block, bodyOf, caretIn, editorBody, fileText, fixtureText, linkSuggestions, must, mustBeSaved, noModified, openEditor,
  original, paste, seen, selectIn, sleep, sourceBlocks, tagSuggestions, writes, type FakeCoreHandle,
} from './editor-helpers';

const flat = (n: any): string => (n.type === 'text' || n.type === 'inlineCode' ? n.value : (n.children ?? []).map(flat).join(''));
async function tree(text: string) {
  const { markdownTree } = await import('@tegg/doc');
  return markdownTree(text) as any;
}
function types(n: any, out: string[] = []): string[] {
  out.push(n.type);
  for (const c of n.children ?? []) types(c, out);
  return out;
}
async function saved(page: Page, core: FakeCoreHandle, path: string): Promise<string> {
  await sleep(150);
  await mustBeSaved(page);
  return (await fileText(core, path))!;
}
async function options(page: Page, which: 'link' | 'tag'): Promise<string[]> {
  const lb = await must(which === 'link' ? linkSuggestions(page) : tagSuggestions(page), which === 'link' ? 'listbox "Link suggestions"' : 'listbox "Tag suggestions"');
  return (await lb.getByRole('option').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
}
async function startEmpty(page: Page): Promise<FakeCoreHandle> {
  const core = await openEditor(page, E.prazdna);
  await editorBody(page).first().click();
  return core;
}

// ------------------------------------------------------------------------------------------------ FR-EDT-06

test('fr_edt_06_ac1_opens_and_matches_like_the_switcher', async ({ page }) => {
  await startEmpty(page);
  for (const q of ['cil', 'CÍL']) {
    await page.keyboard.type(`[[${q}`);
    const o = await options(page, 'link');
    assert.ok(o[0]?.includes('Cíl'), `[[${q} lists Cíl first: ${o.join(' | ')}`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
  }
  await page.keyboard.type('[[');
  await page.keyboard.insertText('cíl'.normalize('NFD'));
  assert.ok((await options(page, 'link'))[0]?.includes('Cíl'), '[[cíl in NFD lists Cíl first');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[[reading');
  const r = await options(page, 'link');
  assert.ok(r[0]?.includes('Cíl') && r[0]?.includes('Reading list'), `[[reading lists Cíl with the alias: ${r.join(' | ')}`);
  await page.keyboard.press('Escape');
  for (const q of ['Šablona', 'Smazan']) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(`[[${q}`);
    const o = await options(page, 'link');
    assert.ok(!o.some((x) => x.startsWith('Šablona') || x.startsWith('Smazaná')), `${q}: templates and .trash never listed: ${o.join(' | ')}`);
    await page.keyboard.press('Escape');
  }
  await page.keyboard.press('Enter');
  await page.keyboard.type('[[Cíl');
  const row = linkSuggestions(page).getByRole('option').first();
  assert.ok((await row.locator('svg, img, [data-icon]').count()) > 0, 'each row shows the type icon');
});

test('fr_edt_06_ac2_duplicates_are_distinguishable', async ({ page }) => {
  await startEmpty(page);
  await page.keyboard.type('[[Senior');
  const o = await options(page, 'link');
  const spm = o.filter((x) => x.includes('Senior Product Manager') && !x.startsWith('Create'));
  assert.equal(spm.length, 2, `both SPM objects: ${o.join(' | ')}`);
  const fmt = await page.evaluate(() => [new Date(2026, 8, 1), new Date(2026, 9, 2)].map((d) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d)));
  for (const [i, iso] of ['2026-09-01', '2026-10-02'].entries()) {
    assert.ok(spm.some((x) => x.includes(iso) || x.includes(fmt[i])), `a row shows created ${iso}: ${spm.join(' | ')}`);
  }
  assert.ok(spm.every((x) => x.includes('Page')), 'each with its type');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[[Dvojník');
  const d = (await options(page, 'link')).filter((x) => x.includes('Dvojník') && !x.startsWith('Create'));
  assert.equal(d.length, 2, 'both Dvojník objects');
  assert.ok(d.some((x) => x.includes('Quick Note')) && d.some((x) => /\bPage\b/.test(x)), `types Page and Quick Note: ${d.join(' | ')}`);
});

const CHOICES: [string, (o: string) => boolean, string, string][] = [
  ['Cíl', (o) => o.startsWith('Cíl') && !o.includes('Reading'), '[[Cíl]]', E.cil],
  ['reading', (o) => o.includes('Reading list'), '[[Cíl|Reading list]]', E.cil],
  ['C# tips', (o) => o.includes('C# tips'), '[[C tips|C# tips]]', E.ctips],
  ['Senior', (o) => o.includes('Senior') && (o.includes('2026-10-02') || o.includes('Oct 2, 2026')), '[[Senior Product Manager (2)|Senior Product Manager]]', E.spm2],
  ['Dvojník', (o) => o.includes('Dvojník') && /\bPage\b/.test(o) && !o.includes('Quick'), '[[Dvojník]]', E.dvojnikP],
  ['Dvojník', (o) => o.includes('Dvojník') && o.includes('Quick Note'), '[[Quick Notes/Dvojník|Dvojník]]', E.dvojnikQ],
];

for (const [k, [q, pick, want, target]] of CHOICES.entries()) {
  test(`fr_edt_06_ac3_the_link_that_is_written_${'abcdef'[k]}`, async ({ page }) => {
    const core = await startEmpty(page);
    await page.keyboard.type(`[[${q}`);
    const lb = await must(linkSuggestions(page), 'Link suggestions');
    const texts = await lb.getByRole('option').allInnerTexts();
    const i = texts.findIndex((t) => pick(t.replace(/\s+/g, ' ')));
    assert.ok(i >= 0, `${q}: option found in ${texts.join(' | ')}`);
    await lb.getByRole('option').nth(i).click();
    const t = await saved(page, core, E.prazdna);
    assert.equal(await bodyOf(t), `${want}\n`, `${q} → ${want}`);
    const inner = want.slice(2, -2).split('|')[0];
    const res = await page.evaluate(async ([from, tg]) => (window as any).__TAURI_INTERNALS__.invoke('link_resolve', { from, targets: [tg] }), [E.prazdna, inner] as const);
    assert.equal(res[0]?.path, target, `${want} resolves to ${target}`);
  });
}

for (const [q, file, link] of [
  ['Nová stránka', 'Quick Notes/Nová stránka.md', '[[Nová stránka]]'],
  ['C# nápad', 'Quick Notes/C nápad.md', '[[C nápad|C# nápad]]'],
  ['Dvojník', 'Quick Notes/Dvojník (2).md', '[[Dvojník (2)|Dvojník]]'],
] as const) {
  test(`fr_edt_06_ac4_create_from_the_link_${file.slice(12, -3).replace(/\W+/g, '_')}`, async ({ page }) => {
    const core = await startEmpty(page);
    await page.keyboard.type(`[[${q}`);
    const o = await options(page, 'link');
    // 5B (FR-VLT-05 AC-3 (b), D-550): `Create "<q>"` is followed by the row `Create "<q>" as…`.
    assert.deepEqual(o.slice(-2), [`Create "${q}"`, `Create "${q}" as…`], `the last rows: ${o.join(' | ')}`);
    await linkSuggestions(page).getByRole('option', { name: `Create "${q}"` }).click();
    await page.keyboard.type(' konec');
    const t = await saved(page, core, E.prazdna);
    assert.equal(await bodyOf(t), `${link} konec\n`, `${q}: link saved, caret after it`);
    assert.equal(await mainName(page), 'Prázdná', 'no navigation');
    const created = (await core.calls()).filter((c) => c.cmd === 'note_create');
    assert.equal(created.length, 1, 'note_create used (same path as New object)');
    assert.match(String((created[0].args as any).text), /^---\nid: \S+\ntype: quick-note\n/, 'default type Quick Note');
    assert.deepEqual(await core.writesTo(), [file, E.prazdna], 'exactly two files written: the new note, then the edited note');
  });
}

test('fr_edt_06_ac5_keyboard_escape_and_closing_brackets', async ({ page }) => {
  const core = await startEmpty(page);
  await page.keyboard.type('[[Dvoj');
  await must(linkSuggestions(page), 'list');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Tab');
  let t = await saved(page, core, E.prazdna);
  assert.equal(await bodyOf(t), '[[Dvojník]]\n', 'Tab chooses the selected row');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[[Cí');
  await page.keyboard.press('Escape');
  assert.ok(await absent(linkSuggestions(page)), 'Esc closes');
  t = await saved(page, core, E.prazdna);
  const { wikilinks, parse } = await import('@tegg/doc');
  assert.equal(wikilinks(parse(t)).length, 1, 'the Esc text is not a link');
  assert.ok(flat(await tree(await bodyOf(t))).includes('[[Cí'), '[[Cí reads back as text');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[[Neexistuje]]');
  assert.ok(await absent(linkSuggestions(page)), ']] closes the list');
  const chip = await must(editorBody(page).getByRole('link', { name: 'Neexistuje' }), 'chip for the typed link');
  const desc = await chip.evaluate((el) => el.getAttribute('aria-description') ?? (el.getAttribute('aria-describedby') ? document.getElementById(el.getAttribute('aria-describedby')!)?.textContent : '') ?? '');
  assert.match(String(desc), /No note named Neexistuje/, 'unresolved chip has the broken style description (D-142)');
  t = await saved(page, core, E.prazdna);
  assert.ok(t.includes('[[Neexistuje]]'), 'saved as typed');
});

test('fr_edt_06_ac6_undo_after_choose_and_after_create', async ({ page }) => {
  const core = await startEmpty(page);
  await page.keyboard.type('[[Cíl');
  await linkSuggestions(page).getByRole('option').first().click();
  await mustBeSaved(page);
  await page.keyboard.press('Meta+z');
  let t = await saved(page, core, E.prazdna);
  assert.equal(flat(await tree(await bodyOf(t))).trim(), '[[Cíl', '⌘Z restores [[Cíl as text');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[[Úplně nová');
  await linkSuggestions(page).getByRole('option', { name: 'Create "Úplně nová"' }).click();
  await mustBeSaved(page);
  await page.keyboard.press('Meta+z');
  t = await saved(page, core, E.prazdna);
  assert.ok(!t.includes('[[Úplně nová]]'), '⌘Z removes the link');
  assert.ok((await core.files())['Quick Notes/Úplně nová.md'] !== undefined, 'the new note stays (undo never deletes a file)');
});

test('fr_edt_06_ac7_alias_link_in_a_table_cell_escapes_the_pipe', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  const cell = await must(block(page, 8).getByRole('cell', { name: '1' }), 'cell');
  await cell.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' [[C# tips');
  await linkSuggestions(page).getByRole('option').filter({ hasText: 'C# tips' }).first().click();
  const t = await saved(page, core, E.deset);
  assert.ok(t.includes('| a \\| b | 1 [[C tips\\|C# tips]] |'), 'escaped pipe in the cell');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-15

test('fr_edt_15_ac1_opens_only_at_a_tag_start', async ({ page }) => {
  await startEmpty(page);
  await page.keyboard.type('#p');
  await must(tagSuggestions(page), 'Tag suggestions at line start');
  await page.keyboard.press('Escape');
  for (const typed of [' a#b', ' #1', ' `#kód`']) {
    await page.keyboard.type(typed);
    assert.ok(await absent(tagSuggestions(page), 500), `no tag list for "${typed}"`);
  }
  await page.keyboard.type(' (#p');
  assert.ok(await seen(tagSuggestions(page)), 'after ( it opens');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await page.keyboard.type('# ');
  assert.ok(await absent(tagSuggestions(page), 500), '"# " is the heading shortcut, no tag list');
});

test('fr_edt_15_ac2_suggestions_from_one_index_command', async ({ page }) => {
  const core = await startEmpty(page);
  const reads0 = (await core.calls()).filter((c) => c.cmd === 'note_read').length;
  const check = async (q: string, want: string[]) => {
    await page.keyboard.type(q);
    const o = (await options(page, 'tag')).filter((x) => !x.startsWith('Create tag'));
    assert.deepEqual(o, want, `${q}`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
  };
  await check('#p', ['#projekt']);
  await check('#r', ['#rozpočet']);
  await check('#cest', ['#čeština']);
  await check('#ČEŠ', ['#čeština']);
  await check('#š', []);
  const calls = await core.calls();
  assert.ok(calls.some((c) => c.cmd === 'index_tags'), 'index_tags used');
  assert.equal(calls.filter((c) => c.cmd === 'note_read').length, reads0, 'no note is read to build the list (AP-137)');
});

test('fr_edt_15_ac3_choosing_and_escape', async ({ page }) => {
  const core = await startEmpty(page);
  await page.keyboard.type('#pro');
  await must(tagSuggestions(page), 'list');
  await page.keyboard.press('Enter');
  let t = await saved(page, core, E.prazdna);
  assert.equal((await bodyOf(t)).trim(), '#projekt', '⏎ saves #projekt');
  const { tags, parse } = await import('@tegg/doc');
  assert.deepEqual(tags(parse(t)).map((x) => x.key), ['projekt'], 'a tag');
  await page.keyboard.press('Enter');
  await page.keyboard.type('#proj');
  await page.keyboard.press('Escape');
  t = await saved(page, core, E.prazdna);
  assert.deepEqual(tags(parse(t)).map((x) => x.name), ['projekt', 'proj'], 'Esc keeps #proj, a tag by the dialect');
});

test('fr_edt_15_ac4_a_new_tag', async ({ page }) => {
  const core = await startEmpty(page);
  await page.keyboard.type('#nový-štítek');
  const o = await options(page, 'tag');
  assert.equal(o[o.length - 1], 'Create tag "nový-štítek"', 'last row');
  await tagSuggestions(page).getByRole('option', { name: 'Create tag "nový-štítek"' }).click();
  const t = await saved(page, core, E.prazdna);
  assert.ok(t.includes('#nový-štítek'.normalize('NFC')), 'saved in NFC');
  assert.deepEqual(Object.keys(await core.files()).filter((p) => p.startsWith('Tags/')), [], 'no Tag object file in 3C');
  await page.keyboard.press('Enter');
  await page.keyboard.type('#nov');
  assert.ok((await options(page, 'tag')).includes('#nový-štítek'), 'the tag command lists it after the save');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-14

const MD = '# Nadpis\n\n- a\n- b\n\nText s [[Cíl]] a #projekt.';

for (const [name, clip] of [['lf', MD], ['crlf', MD.replace(/\n/g, '\r\n')]] as const) {
  test(`fr_edt_14_ac1_markdown_text_${name}`, async ({ page }) => {
    const core = await startEmpty(page);
    await paste(page, { plain: clip });
    await must(editorBody(page).getByRole('heading', { name: 'Nadpis' }), 'heading created');
    await must(editorBody(page).getByRole('link', { name: 'Cíl' }), 'link chip');
    const t = await saved(page, core, E.prazdna);
    assert.equal(await bodyOf(t), `${MD}\n`, 'canonical form, the note keeps LF');
  });
}

test('fr_edt_14_ac2_paste_as_plain_text', async ({ page }) => {
  const core = await startEmpty(page);
  await page.keyboard.press('Meta+Shift+v');
  await paste(page, { plain: MD });
  const t = await saved(page, core, E.prazdna);
  const tr = await tree(await bodyOf(t));
  assert.deepEqual(tr.children.map((n: any) => n.type), ['paragraph', 'paragraph', 'paragraph', 'paragraph'], 'one paragraph per line');
  assert.deepEqual(tr.children.map(flat), ['# Nadpis', '- a', '- b', 'Text s [[Cíl]] a #projekt.'], 'texts read back literally');
  const ty = types(tr);
  assert.deepEqual(['heading', 'list', 'wikiLink', 'tag'].filter((x) => ty.includes(x)), [], 'no syntax interpreted');
});

test('fr_edt_14_ac3_html_from_the_web', async ({ page }) => {
  const hits = watchNetwork(page);
  const core = await startEmpty(page);
  await paste(page, { html: fixtureText('tests/fixtures/editor/paste/web.html') });
  const t = await saved(page, core, E.prazdna);
  const strip = (n: any): any => {
    const { position: _p, ...rest } = n;
    return rest.children ? { ...rest, children: rest.children.map(strip) } : rest;
  };
  const got = strip(await tree(await bodyOf(t)));
  const want = strip(await tree(fixtureText('tests/fixtures/editor/paste/web.expected.md')));
  assert.deepEqual(got, want, 'mdast of the pasted blocks equals web.expected.md');
  assert.equal(await page.evaluate(() => (window as any).__pasteRan), undefined, 'no script ran');
  assert.deepEqual(hits, [], 'no network request');
});

test('fr_edt_14_ac4_url_on_a_selection_becomes_a_link', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await selectIn(page, 5, 'blok');
  await paste(page, { plain: 'https://example.com/x' });
  const t = await saved(page, core, E.deset);
  assert.ok(t.includes('Pátý [blok](https://example.com/x), který'), 'URL on a selection → link');
});

test('fr_edt_14_ac4_url_without_selection_is_text', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await caretIn(page, 5);
  await paste(page, { plain: ' https://example.com/x' });
  const t = await saved(page, core, E.deset);
  assert.ok(t.includes('upraví. https://example.com/x'), 'no selection: inserted as text (GFM autolink)');
  await must(editorBody(page).getByRole('link', { name: 'https://example.com/x' }), 'shown as an external link');
});

test('fr_edt_14_ac4_javascript_url_on_a_selection_is_literal', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await selectIn(page, 5, 'blok');
  await paste(page, { plain: 'javascript:alert(1)' });
  const t = await saved(page, core, E.deset);
  assert.ok(t.includes('Pátý javascript:alert(1), který'), 'javascript: on a selection is literal text');
  assert.ok(!t.includes('](javascript:'), 'no link created');
});

test('fr_edt_14_ac5_images_wait_for_ms6', async ({ page }) => {
  const core = await startEmpty(page);
  await paste(page, { png: true });
  await must(page.getByRole('status').filter({ hasText: 'Pasting images comes in MS6' }), 'non-modal notice');
  await sleep(1500);
  assert.equal((await writes(core)).length, 0, 'no note change');
  assert.deepEqual(Object.keys(await core.files()).filter((p) => p.startsWith('_attachments/') || p.startsWith('Images/')), [], 'no attachment or Image object');
});

test('fr_edt_14_ac6_nfd_paste_saved_in_nfc', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  const orig = original(E.deset);
  await caretIn(page, 5);
  await paste(page, { plain: ' Čeština'.normalize('NFD') });
  const t = await saved(page, core, E.deset);
  assert.equal(noModified(t), noModified(orig).replace('test upraví.', 'test upraví. Čeština'), 'NFC text, other blocks unchanged');
});

test('fr_edt_14_ac7_paste_into_code_block_is_verbatim', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await caretIn(page, 7, 'const x = 1;');
  const clip = `${MD}\n\tTabulátor`;
  await paste(page, { plain: `\n${clip}` });
  const t = await saved(page, core, E.deset);
  assert.ok(t.includes(`const x = 1;\n${clip}`) || t.includes(`const x = 1;   \n${clip}`), 'pasted verbatim into the code block, tabs kept');
});

test('fr_edt_14_ac7_paste_into_source_block_does_nothing', async ({ page }) => {
  const core = await openEditor(page, E.surove);
  await sourceBlocks(page).first().click();
  await paste(page, { plain: MD });
  await sleep(1500);
  assert.equal((await writes(core)).length, 0, 'pasting into a source block does nothing');
});
