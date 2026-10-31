// @vitest-environment jsdom
// v1.0 slice P (object previews), L1: what a preview shows (docs/contracts/v1-previews.md §3.4; docs/acceptance/
// previews.md R105) on the previews fixture, through `loadPreview` (preview/load.ts) and the real body rendering with
// the real @tegg/doc (never mocked), mounted through the public `PreviewProvider` / `usePreview().show` (§3). FR-LNK-10
// AC-1 (the header: the type's icon, `h2`, type name; Alfa's `icon:` and `cover:` never shown, D-217), AC-2 (the strip:
// preview attributes with a value, in the type's order, at most 4), AC-3 (the rendered body of Rozpočet), AC-4 (nested
// embeds are cards, at most two `embed_load` calls, no recursion), AC-5 (empty body: all attributes, no strip), AC-7
// (section, block and missing-heading links), AC-12 (invalid frontmatter, invalid UTF-8, unreadable file), FR-LNK-09
// AC-4 (a card's or link-mode embed's preview is the full content, not a second card); FR-SET-07 AC-3 and FR-LNK-12
// AC-5 (bad stored values: the normalizer `readPreviewUi` of preview/state.ts, an interface choice of this test, and the
// provider reading them without rewriting). The IPC is faked with `@tauri-apps/api/mocks` (previews-helpers.ts).
// Written from the ACs and the contract only (D-61). Modules load inside each test (TS-I1).
//
// Test clock: 2026-10-28T10:00:00+01:00, Europe/Prague, en-US (previews.md); only `Date` is faked.
process.env.TZ = 'Europe/Prague';
import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { cleanup } from '@testing-library/react';
import { catalog, need } from './read-helpers';
import {
  DEFAULT_UI_STATE, NOW, P, ZONE, byRole, fixture, installIpc, mountProvider, name, nfc, note, setTypes, settle, show, text, theDialog, uninstallIpc,
} from './previews-helpers';

// FR-SET-07 AC-3: the stored UI state of this file has a bad mode and an out-of-range, off-step delay. It is read at
// start (§1), so it is in place before any UI module loads.
const BAD_PREVIEW = { mode: 'sometimes', hoverDelay: 1720 };
(globalThis as any).__TEGG_TZ__ = ZONE;
(globalThis as any).__TEGG_UI_STATE__ = { ...DEFAULT_UI_STATE, preview: BAD_PREVIEW };

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) });
  await catalog().catch(() => {});
  await setTypes().catch(() => {});
});
afterEach(async () => {
  cleanup();
  await uninstallIpc();
  vi.useRealTimers();
});

async function loader() {
  const m = await need('../ui/src/preview/load.ts', 'loadPreview');
  assert.equal(typeof m.loadPreview, 'function', 'loadPreview is a function');
  return (target: any) => m.loadPreview(target, new AbortController().signal) as Promise<any>;
}
/** Mounts the provider, shows `target` from the anchor with a click and returns the one dialog. */
async function popover(target: any) {
  const p = await mountProvider();
  await show(p.api(), target, p.anchor, 'click');
  return { ...p, dialog: theDialog() };
}
function article(dialog: HTMLElement, title: string): HTMLElement {
  const a = byRole(dialog, 'article', `Content of ${title}`);
  assert.equal(a.length, 1, `one article "Content of ${title}" (R102)`);
  return a[0];
}
function header(dialog: HTMLElement): HTMLElement {
  const h = dialog.querySelector('header');
  assert.ok(h, 'the popover has a header (R102)');
  return h as HTMLElement;
}
function strip(dialog: HTMLElement): HTMLElement | null {
  return byRole(dialog, 'region', 'Preview properties')[0] ?? null;
}
/** Asserts the texts occur in `whole` in this order. */
function inOrder(whole: string, parts: string[], what: string) {
  let at = -1;
  for (const s of parts) {
    const i = whole.indexOf(s, at + 1);
    assert.ok(i > at, `${what}: "${s}" after the previous part in:\n${whole}`);
    at = i;
  }
}

// ------------------------------------------------------------------------------------------------ the model (§3.4)

test('fr_lnk_10_ac1_model_of_alfa_has_its_title_type_and_id', async () => {
  await installIpc();
  const load = await loader();
  const m = await load(note(P.alfa));
  assert.equal(m.state, 'ok');
  assert.deepEqual([m.path, m.id, nfc(m.title), m.type, m.body, m.notice], [P.alfa, '01JBPV0000000000000000P004', 'Projekt Alfa', 'projekt', 'blocks', null]);
  assert.equal(m.details, null, 'a unique title has no details (AP-818)');
  assert.ok(m.version, 'the version of the file read');
  assert.equal(m.text, fixture(P.alfa), 'the file text from embed_load');
});

test('fr_lnk_10_ac2_alfa_strip_holds_three_items_rozpocet_none', async () => {
  const ipc = await installIpc();
  const load = await loader();
  const alfa = await load(note(P.alfa));
  assert.equal(alfa.strip.length, 3, 'Stav, Vlastník, Termín: `rozpočet` has no value, `poznámka` isn\'t a preview attribute');
  const roz = await load(note(P.rozpocet));
  assert.deepEqual(roz.strip, [], 'Page has no preview attributes');
  assert.equal(ipc.count('note_read'), 0, 'never note_read');

  const { dialog } = await popover(note(P.alfa));
  const s = strip(dialog);
  assert.ok(s, 'the region Preview properties');
  const t = text(s);
  inOrder(t, ['Stav', 'Aktivní', 'Vlastník', 'Jana Nováková', 'Termín', 'Dec 31, 2026'], 'the strip in the type\'s order');
  for (const absent of ['Rozpočet', 'Poznámka', 'Interní']) assert.ok(!t.includes(absent), `no ${absent} in the strip: ${t}`);
  const chip = [...s!.querySelectorAll('a, [role="link"], [role="button"], button')].find((e) => name(e).includes('Jana Nováková'));
  assert.ok(chip, 'Vlastník is the chip Jana Nováková');
});

test('fr_lnk_10_ac2_a_page_preview_has_no_strip_element', async () => {
  await installIpc();
  const { dialog } = await popover(note(P.rozpocet));
  assert.equal(strip(dialog), null, 'Rozpočet (Page, `preview: []`) has no strip');
});

test('fr_lnk_10_ac1_header_icon_title_and_type_name_without_icon_or_cover', async () => {
  await installIpc();
  const { dialog } = await popover(note(P.alfa));
  const h = header(dialog);
  assert.ok(h.querySelector('[data-icon="folder"]'), 'the Projekt type\'s icon `folder` (D-217)');
  const h2 = h.querySelector('h2');
  assert.equal(text(h2), 'Projekt Alfa', 'the title as an h2');
  assert.ok(text(h).includes('Projekt'), 'the type name under the title');
  assert.equal(dialog.querySelectorAll('[data-icon="rocket"]').length, 0, 'Alfa\'s `icon: rocket` isn\'t shown');
  const imgs = [...dialog.querySelectorAll('img')].map((i) => decodeURIComponent(i.getAttribute('src') ?? ''));
  assert.deepEqual(imgs.filter((s) => s.includes('graf.png')), [], 'no img of Alfa\'s `cover: [[graf.png]]`');
  assert.equal(dialog.querySelectorAll('[data-cover], [data-preview-cover]').length, 0, 'no cover band (AP-803)');
  // Nothing above the header except Back and Close (R102).
  const all = [...dialog.querySelectorAll('*')];
  const hi = all.indexOf(h);
  const before = all.slice(0, hi).filter((e) => !h.contains(e) && !e.contains(h) && e.children.length === 0 && text(e) !== '' && !e.closest('[hidden]'));
  const allowed = before.filter((e) => !/^(Back to |Close preview)/.test(name(e.closest('button, [role="button"]') ?? e)));
  assert.deepEqual(allowed.map((e) => text(e)), [], 'no element with content above the header except Back and Close');
});

test('fr_lnk_10_ac3_rozpocet_body_renders_by_the_read_view_rules', async () => {
  const ipc = await installIpc();
  const { dialog } = await popover(note(P.rozpocet));
  const a = article(dialog, 'Rozpočet 2027');
  const t = text(a);
  inOrder(t, [
    'Návrh rozpočtu na rok 2027 pro celý tým.', 'Rozsah', 'Personál, cestování a nástroje. Odpovídá Jana Nováková.', 'Podrobnosti',
    'Cestování je omezeno na dvě akce ročně.', 'Otevřené otázky', 'Kdo schvaluje nákup licencí?', 'Projekt Alfa', 'Poslední odstavec rozpočtu.',
  ], 'the body in file order');
  const hs = [...a.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => [h.tagName.toLowerCase(), text(h)]);
  assert.deepEqual(hs.filter(([, s]) => s !== 'Projekt Alfa'), [['h3', 'Rozsah'], ['h4', 'Podrobnosti'], ['h3', 'Otevřené otázky']], 'headings one level below the popover\'s h2');
  const jana = [...a.querySelectorAll('a, [role="link"]')].find((e) => name(e) === 'Jana Nováková');
  assert.ok(jana, 'Jana Nováková is a chip');
  assert.notEqual(jana!.getAttribute('data-link-kind'), 'unresolved', 'resolved from Rozpočet\'s own path');
  const img = [...a.querySelectorAll('img')].find((i) => decodeURIComponent(i.getAttribute('src') ?? '').normalize('NFC').endsWith('_attachments/graf.png'));
  assert.ok(img, 'an img of _attachments/graf.png (through the shell\'s asset path)');
  assert.ok(!/^https?:/.test(img!.getAttribute('src') ?? ''), 'no network URL');
  for (const hidden of ['skrytá poznámka', '%%', '^otazka1', '01JBPV', 'tags:', 'title:', 'created:', 'Rozpočet 2027Návrh']) {
    assert.ok(!t.includes(hidden), `"${hidden}" isn't shown`);
  }
  assert.equal(a.querySelectorAll('[contenteditable="true"], [contenteditable=""]').length, 0, 'nothing contenteditable');
  const inputs = [...a.querySelectorAll('input, textarea, select')].filter((i) => !(i.getAttribute('type') === 'checkbox' && i.getAttribute('aria-readonly') === 'true'));
  assert.equal(inputs.length, 0, 'no input other than read-only checkboxes');
  assert.equal(ipc.count('note_read'), 0, 'never note_read (D-138)');
  assert.equal(ipc.count('nav_opened'), 0, 'showing isn\'t opening');
});

test('fr_lnk_10_ac4_nested_embeds_are_cards_and_load_at_most_twice', async () => {
  const ipc = await installIpc();
  const { dialog } = await popover(note(P.rozpocet));
  const a = article(dialog, 'Rozpočet 2027');
  const card = [...a.querySelectorAll('[data-embed-mode]')].find((e) => text(e).includes('Projekt Alfa'));
  assert.ok(card, 'an embed frame for Projekt Alfa');
  assert.equal(card!.getAttribute('data-embed-mode'), 'card', 'a card, whatever Projekt\'s embed mode (AP-815)');
  assert.ok(!text(a).includes('Hlavní projekt roku.'), 'no body text of Alfa');
  assert.ok(ipc.count('embed_load') <= 2, `at most two embed_load calls (got ${ipc.count('embed_load')})`);
});

test('fr_lnk_10_ac4_kruh_a_shows_kruh_b_as_a_card_without_recursion', async () => {
  const ipc = await installIpc();
  const { dialog } = await popover(note(P.kruhA));
  const a = article(dialog, 'Kruh A');
  const t = text(a);
  assert.ok(t.includes('Začátek kruhu A.'), 'Kruh A\'s body');
  const card = [...a.querySelectorAll('[data-embed-mode]')].find((e) => text(e).includes('Kruh B'));
  assert.equal(card?.getAttribute('data-embed-mode'), 'card', 'Kruh B is a card');
  assert.ok(!t.includes('Začátek kruhu B.'), 'no body of Kruh B');
  assert.ok(!/Circular embed/i.test(t), 'no Circular embed message');
  const loads = ipc.calls.filter((c) => c.cmd === 'embed_load').map((c) => (c.args.paths as string[]).map(nfc));
  assert.ok(loads.length >= 1 && loads.length <= 2, `one or two embed_load calls: ${JSON.stringify(loads)}`);
  assert.deepEqual(loads[0], [P.kruhA], 'the previewed note first');
  assert.ok(!loads.slice(1).some((ps) => ps.includes(P.kruhA)), 'Kruh A is never loaded a second time');
});

test('fr_lnk_10_ac5_empty_body_shows_all_attributes_and_no_strip', async () => {
  await installIpc();
  const load = await loader();
  const jana = await load(note(P.jana));
  assert.equal(jana.body, 'properties', 'Jana: empty body with attributes');
  assert.deepEqual(jana.strip, [], 'no strip (AP-818)');
  const prazdna = await load(note(P.prazdna));
  assert.equal(prazdna.body, 'empty', 'Prázdná: no attributes, empty body');
  assert.deepEqual(prazdna.strip, []);

  const { dialog } = await popover(note(P.jana));
  assert.equal(strip(dialog), null, 'no strip element');
  const props = byRole(dialog, 'region', 'Properties');
  assert.equal(props.length, 1, 'a region Properties in the content');
  const t = text(props[0]);
  inOrder(t, ['Firma', 'Beta a.s.', 'Role', 'Analytička', 'E-mail', 'jana@example.com', 'Created', 'Modified'], 'the read-view Properties order');
  const mail = [...props[0].querySelectorAll('a, [role="link"], button')].find((e) => name(e).includes('jana@example.com') || text(e) === 'jana@example.com');
  assert.ok(mail, 'the e-mail is a link');
});

test('fr_lnk_09_ac4_card_and_link_mode_previews_are_the_full_content', async () => {
  await installIpc();
  const j = await popover(note(P.jana));
  assert.equal(byRole(j.dialog, 'region', 'Properties').length, 1, 'Jana\'s preview: all attributes (R105)');
  assert.equal(j.dialog.querySelectorAll('[data-embed-mode="card"]').length, 0, 'not a second card');
  cleanup();
  await uninstallIpc();
  await installIpc();
  const p = await popover(note(P.petr));
  const s = strip(p.dialog);
  assert.ok(s, 'Petr\'s strip');
  inOrder(text(s), ['Firma', 'Alfa s.r.o.', 'Role', 'Vedoucí nákupu'], 'Osoba preview [firma, role]');
  assert.ok(text(article(p.dialog, 'Petr Dvořák')).includes('Vede tým nákupu.'), 'Petr\'s body');
  assert.equal(p.dialog.querySelectorAll('[data-embed-mode]').length, 0, 'no embed frame around the content');
});

test('fr_lnk_10_ac7_section_link_shows_exactly_the_section', async () => {
  await installIpc();
  const load = await loader();
  const m = await load(note(P.rozpocet, 'Rozsah'));
  assert.equal(m.state, 'ok');
  assert.equal(m.notice, null, 'the heading exists');
  const { dialog } = await popover(note(P.rozpocet, 'Rozsah'));
  assert.equal(text(header(dialog).querySelector('h2')), 'Rozpočet 2027 › Rozsah', 'title `<title> › <heading>` (D-156)');
  const t = text(article(dialog, 'Rozpočet 2027'));
  inOrder(t, ['Personál, cestování a nástroje. Odpovídá Jana Nováková.', 'Podrobnosti', 'Cestování je omezeno na dvě akce ročně.'], 'the section (embeds.md FR-EMB-02 AC-3)');
  for (const out of ['Návrh rozpočtu', 'Otevřené otázky', 'Kdo schvaluje', 'Poslední odstavec']) assert.ok(!t.includes(out), `nothing outside the section: "${out}"`);
  assert.ok(!/^Rozsah/.test(t), 'the section without its own heading line');
});

test('fr_lnk_10_ac7_section_matching_is_case_insensitive_nfc_and_trimmed', async () => {
  await installIpc();
  const load = await loader();
  for (const f of ['rozsah', ' Rozsah ', 'Rozsah'.normalize('NFD'), 'ROZSAH']) {
    const m = await load(note(P.rozpocet, f));
    assert.equal(m.notice, null, `#${JSON.stringify(f)} finds Rozsah`);
  }
  const { dialog } = await popover(note(P.rozpocet, 'rozsah'));
  const t = text(article(dialog, 'Rozpočet 2027'));
  assert.ok(t.includes('Personál, cestování') && !t.includes('Návrh rozpočtu'), 'the same section');
});

test('fr_lnk_10_ac7_block_link_shows_only_the_block', async () => {
  await installIpc();
  const { dialog } = await popover(note(P.rozpocet, '^otazka1'));
  assert.equal(text(header(dialog).querySelector('h2')), 'Rozpočet 2027', 'a block link keeps the plain title');
  assert.equal(text(article(dialog, 'Rozpočet 2027')), 'Kdo schvaluje nákup licencí?', 'only the block, without its id');
});

test('fr_lnk_10_ac7_missing_heading_shows_the_notice_then_the_whole_body', async () => {
  await installIpc();
  const load = await loader();
  assert.equal((await load(note(P.rozpocet, 'Neexistující nadpis'))).notice, 'noHeading');
  assert.equal((await load(note(P.rozpocet, '^neni'))).notice, 'noBlock');
  const { dialog } = await popover(note(P.rozpocet, 'Neexistující nadpis'));
  assert.equal(text(header(dialog).querySelector('h2')), 'Rozpočet 2027 › Neexistující nadpis');
  const all = text(dialog);
  const notice = 'No heading "Neexistující nadpis" in Rozpočet 2027.';
  assert.ok(all.includes(notice), `the notice ${notice}`);
  const body = text(article(dialog, 'Rozpočet 2027'));
  inOrder(body, ['Návrh rozpočtu na rok 2027 pro celý tým.', 'Otevřené otázky', 'Poslední odstavec rozpočtu.'], 'then the whole body (AP-818)');
  assert.ok(all.indexOf(notice) < all.indexOf('Návrh rozpočtu'), 'the notice comes first');
});

test('fr_lnk_10_ac12_invalid_frontmatter_title_from_the_stem_and_the_notice', async () => {
  await installIpc();
  const load = await loader();
  const m = await load(note(P.neplatna));
  assert.equal(m.state, 'ok');
  assert.equal(nfc(m.title), 'Neplatná hlavička', 'the file stem');
  assert.equal(m.notice, 'readError', 'D-936 c');
  assert.equal(m.type, 'page', 'shown as a Page');
  const { dialog } = await popover(note(P.neplatna));
  assert.equal(text(header(dialog).querySelector('h2')), 'Neplatná hlavička');
  assert.ok(header(dialog).querySelector('[data-icon="file-text"]'), 'the Page icon');
  const all = text(dialog);
  assert.ok(all.includes('This note\'s properties can\'t be read.'), 'the notice');
  assert.ok(text(article(dialog, 'Neplatná hlavička')).includes('Tělo s odkazem na Rozpočet 2027.'), 'the body');
  assert.ok(!all.includes('"Neplatná hlavička'), 'never the raw frontmatter as properties');
  assert.equal(byRole(dialog, 'region', 'Properties').length, 0, 'no Properties');
});

test('fr_lnk_10_ac12_invalid_utf8_previews_the_decoded_text_with_the_notice', async () => {
  const bad = fixture(P.planP).replace('Plán ze stránek.', 'Plán ze str�nek.');
  const ipc = await installIpc({ files: { [P.planP]: bad } });
  ipc.invalidUtf8.add(P.planP);
  const load = await loader();
  const m = await load(note(P.planP));
  assert.equal(m.notice, 'readError', 'utf8: false → the same notice');
  const { dialog } = await popover(note(P.planP));
  assert.ok(text(dialog).includes('This note\'s properties can\'t be read.'));
  assert.ok(text(article(dialog, 'Plán')).includes('Plán ze str�nek.'), 'the decoded text with U+FFFD');
});

test('fr_lnk_10_ac12_an_unreadable_file_shows_couldnt_read_and_keeps_open', async () => {
  const ipc = await installIpc();
  ipc.io.add(P.alfa);
  const load = await loader();
  const m = await load(note(P.alfa));
  assert.equal(m.state, 'error', 'embed_load state `io` → error');
  const { dialog } = await popover(note(P.alfa));
  assert.ok(text(dialog).includes('Couldn\'t read this note.'), '`preview.loadFailed`');
  const open = [...dialog.querySelectorAll('button, [role="button"]')].filter((b) => name(b).startsWith('Open'));
  assert.equal(open.length, 1, 'Open is kept');
  assert.notEqual(open[0].getAttribute('aria-disabled'), 'true', 'and enabled');
});

// ------------------------------------------------------------------------------------------------ FR-SET-07 AC-3, FR-LNK-12 AC-5

async function state() {
  const m = await need('../ui/src/preview/state.ts', 'readPreviewUi');
  assert.equal(typeof m.readPreviewUi, 'function', 'readPreviewUi is a function');
  return m.readPreviewUi as (dto: unknown) => { mode: string; hoverDelay: number; width: number | null; height: number | null };
}

test('fr_lnk_12_ac5_hover_delay_defaults_to_1000_and_steps_by_100_from_200_to_1500', async () => {
  const read = await state();
  // D-1164: hover with 1,000 ms is the default.
  assert.deepEqual(read(undefined), { mode: 'hover', hoverDelay: 1000, width: null, height: null }, 'missing reads as the defaults');
  assert.deepEqual(read({}), { mode: 'hover', hoverDelay: 1000, width: null, height: null });
  const delays: [number, number][] = [[200, 200], [400, 400], [600, 600], [1500, 1500], [100, 200], [0, 200], [-300, 200], [1600, 1500], [1720, 1500], [99999, 1500],
    [430, 400], [470, 500], [1449, 1400], [1451, 1500], [201, 200], [299, 300]];
  const bad = delays.filter(([v, w]) => read({ mode: 'hover', hoverDelay: v }).hoverDelay !== w).map(([v, w]) => `${v} → ${read({ mode: 'hover', hoverDelay: v }).hoverDelay}, want ${w}`);
  assert.deepEqual(bad, [], 'clamped to 200…1500 and rounded to the nearest 100 ms step');
  assert.equal(read({ mode: 'hover' }).hoverDelay, 1000, 'a missing delay is 1000');
});

test('fr_set_07_ac3_a_bad_stored_mode_reads_as_the_default', async () => {
  const read = await state();
  for (const mode of ['click', 'hover', 'off'] as const) assert.equal(read({ mode }).mode, mode, `${mode} is kept`);
  // D-1172: a bad stored mode reads as the default, hover (D-1164).
  for (const mode of ['sometimes', 'Hover', 'OFF', '', 'náhled', 3, null, true]) assert.equal(read({ mode }).mode, 'hover', `${JSON.stringify(mode)} reads as hover`);
});

test('fr_set_07_ac3_stored_sizes_are_clamped_and_missing_is_the_default', async () => {
  const read = await state();
  assert.deepEqual([read({}).width, read({}).height], [null, null], 'missing: the default (380, content height up to 480)');
  const w: [number, number][] = [[380, 380], [300, 300], [720, 720], [250, 300], [0, 300], [721, 720], [5000, 720], [512, 512]];
  const h: [number, number][] = [[200, 200], [480, 480], [800, 800], [150, 200], [801, 800], [9999, 800], [333, 333]];
  assert.deepEqual(w.filter(([v, x]) => read({ width: v }).width !== x).map(([v]) => `width ${v} → ${read({ width: v }).width}`), [], 'width 300…720 (D-922)');
  assert.deepEqual(h.filter(([v, x]) => read({ height: v }).height !== x).map(([v]) => `height ${v} → ${read({ height: v }).height}`), [], 'height 200…800 (D-922)');
});

test('fr_set_07_ac3_the_provider_reads_bad_values_without_rewriting_them', async () => {
  const ipc = await installIpc({ uiState: { ...DEFAULT_UI_STATE, preview: BAD_PREVIEW } });
  const p = await mountProvider();
  await settle();
  assert.equal(p.api().mode, 'hover', 'a stored mode `sometimes` reads as hover, the default (D-1172, D-1192)');
  assert.equal(p.api().hoverDelay, 1500, 'a stored delay 1720 reads as 1500');
  await show(p.api(), note(P.rozpocet), p.anchor, 'click');
  theDialog();
  assert.equal(ipc.count('ui_state_set'), 0, 'neither value is rewritten until the user changes the setting');
});
