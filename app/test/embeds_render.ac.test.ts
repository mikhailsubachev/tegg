// @vitest-environment jsdom
// MS4 slice 4F, L1: rendering embeds (docs/contracts/ms4-embeds.md §6; R30, R30a, R33): the read view hands every note
// embed to `renderEmbed` and keeps attachment placeholders (FR-EMB-01 AC-1, AC-3, AC-4); `embeds/Embed.tsx` renders a
// full frame (FR-EMB-02 AC-2), cards (FR-EMB-02 AC-4), the broken frame (FR-LNK-07 AC-6), the circular frame
// (FR-EMB-04 AC-1), a too-deep and an inline link-mode embed (FR-EMB-04 AC-5, FR-EMB-01 AC-3), and only catalog text
// outside user content (FR-EMB-02 AC-15). Nodes are built literally from the contract's `EmbedNode` type over the
// fixture, so these tests don't depend on the tree. Written from docs/acceptance/embeds.md and the contract only
// (D-61). Modules are imported dynamically (tsconfig.test.json has no `jsx`, so .tsx can't be imported statically);
// `Embed`'s stub exists, so the tests fail on the rendered DOM; lookups use query* + node:assert (TS-I1).
import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { createElement, type ReactNode } from 'react';
import { cleanup, render, fireEvent } from '@testing-library/react';
import { parse } from '@tegg/doc';
import { computeAccessibleDescription, computeAccessibleName } from 'dom-accessibility-api';
import { catalog, need } from './read-helpers';
import { TYPES, fixture, fixtureLoader, hostOf, resolveOnEmbeds, type EmbedNoteDto, type LinkTargetDto } from './embeds-helpers';

const nfc = (s: string) => s.normalize('NFC');
const name = (e: Element) => nfc(computeAccessibleName(e).trim());
const desc = (e: Element) => nfc(computeAccessibleDescription(e).trim());
const text = (e: Element | null) => nfc(e?.textContent ?? '');

beforeEach(async () => {
  await catalog().catch(() => {});
  // D-451 (AP-353): `Embed` reads type names, preview keys and icons from the app's type store, as the app fills it.
  const icons = await need('../ui/src/links/icons.ts', 'setChipTypes');
  icons.setChipTypes(TYPES());
});
afterEach(() => cleanup());

// ------------------------------------------------------------------------------------------------ the read view

async function readView(rel: string, renderEmbed?: (value: string, line: number, inline: boolean) => ReactNode, override?: string) {
  const rv = await need('../ui/src/read/ReadView.tsx', 'ReadView', 'linkTargets');
  const host = await hostOf(rel, override ?? fixture(rel));
  const opened: [string, string | undefined][] = [];
  const props: Record<string, unknown> = {
    text: host.text, path: rel, links: host.links,
    onOpen: (p: string, f?: string) => opened.push([p, f]), onTag: () => {}, onExternal: () => {}, onScrollInNote: () => {},
  };
  if (renderEmbed) props.renderEmbed = renderEmbed;
  let error: unknown = null;
  let r: ReturnType<typeof render> | null = null;
  try { r = render(createElement(rv.ReadView, props)); } catch (e) { error = e; }
  assert.equal(error, null, `ReadView threw on ${rel}: ${String(error)}`);
  return { container: r!.container, opened };
}
function marker(calls: [string, number, boolean][]) {
  return (value: string, line: number, inline: boolean) => {
    calls.push([value, line, inline]);
    return createElement(inline ? 'span' : 'div', { 'data-test-embed': value });
  };
}

test('fr_emb_01_ac1_read_view_renders_every_note_embed_through_render_embed', async () => {
  const calls: [string, number, boolean][] = [];
  const { container } = await readView('Pages/Režimy.md', marker(calls));
  const values = ['Cíl', 'Jana Nováková', 'Šárka Malá', 'Svíčková', 'Saturnin', 'Zavolat Janě', 'Praha', '2026-10-07', 'Cíl|card', 'Jana Nováková|full', 'Svíčková|link', 'Cíl|jiný text'];
  assert.deepEqual(calls, values.map((v, i) => [v, 10 + 2 * i, false]), 'renderEmbed(value, line, inline) for each embed, in file order');
  assert.deepEqual([...container.querySelectorAll('[data-test-embed]')].map((e) => e.getAttribute('data-test-embed')), values, 'at the paragraphs’ positions');
  assert.equal(container.querySelectorAll('[data-placeholder="embed-note"]').length, 0, 'no embed-note placeholder (R32)');
  assert.ok(!container.querySelector('[data-test-embed]')?.closest('p'), 'a block embed isn’t inside a paragraph');
  const text0 = text(container);
  assert.ok(text0.indexOf('Před vloženími.') < text0.indexOf('Po vloženích.'), 'the host text around them renders as before');

  const calls2: [string, number, boolean][] = [];
  const broken = await readView('Pages/Rozbitá vložení.md', marker(calls2));
  assert.deepEqual(calls2.map((c) => c[0]), ['Chybí', 'Šablona', 'Smazaná', 'Reading list', '2026-10-20', 'Chyba hlavičky'], 'attachments aren’t handed over');
  assert.equal(broken.container.querySelectorAll('[data-placeholder="embed-image"]').length, 1, '![[obrázek.png]] is still the R5 embed-image placeholder');
});

test('fr_emb_01_ac1_without_a_renderer_note_embeds_are_link_mode_not_placeholders', async () => {
  const { container } = await readView('Pages/Režimy.md');
  assert.equal(container.querySelectorAll('[data-placeholder="embed-note"]').length, 0, 'no embed-note placeholder');
  const links = [...container.querySelectorAll('[data-embed-mode="link"]')];
  assert.equal(links.length, 12, `12 link-mode embeds, got ${links.length}`);
  assert.equal(name(links[0]), 'Cíl');
});

test('fr_emb_01_ac3_read_view_hands_inline_embeds_over_as_inline', async () => {
  const calls: [string, number, boolean][] = [];
  const { container } = await readView('Pages/Uvnitř textu.md', marker(calls));
  assert.deepEqual(calls, [['Cíl', 8, true], ['Jana Nováková', 10, true], ['Cíl', 11, true], ['Cíl', 13, true], ['Cíl', 17, true]]);
  const inPara = container.querySelector('p [data-test-embed]');
  assert.ok(inPara, 'the embed inside the paragraph stays inside it');
  assert.equal(container.querySelectorAll('li [data-test-embed]').length, 2, 'list items keep their embeds');
  assert.equal(container.querySelectorAll('blockquote [data-test-embed]').length, 1, 'the quote keeps its embed');
  assert.equal(container.querySelectorAll('td [data-test-embed], [role="cell"] [data-test-embed]').length, 1, 'the table cell keeps its embed');
});

test('fr_emb_01_ac4_code_frontmatter_and_comments_are_never_embeds_in_the_read_view', async () => {
  const src = '---\nid: 01JB4F0000000000000000T002\ntype: page\nvztah: "![[Cíl]]"\n---\n```\n![[Cíl]]\n```\n\n%%![[Cíl]]%%\n\nText `![[Cíl]]` a konec.\n\n![[Svíčková]]\n';
  const calls: [string, number, boolean][] = [];
  const { container } = await readView('Pages/Kód.md', marker(calls), src);
  assert.deepEqual(calls, [['Svíčková', 14, false]], 'only the real embed');
  assert.ok(text(container.querySelector('code')).includes('![[Cíl]]'), 'code shows the text');
  const rozbita = await readView('Pages/Rozbitá vložení.md', marker([]));
  assert.ok(text(rozbita.container.querySelector('code')).includes('![[Cíl]]'), '`![[Cíl]]` in Rozbitá vložení is inline code');
});

// ------------------------------------------------------------------------------------------------ Embed.tsx

async function loaded(path: string): Promise<EmbedNoteDto> {
  const l = await fixtureLoader();
  const [n] = await l.load([path]);
  return n;
}
const target = (from: string, value: string): LinkTargetDto => resolveOnEmbeds(from, [value]).get(value)!;
function node(value: string, over: Record<string, unknown>) {
  return { value, line: 10, inline: false, depth: 1, mode: 'full', state: 'ok', target: target('Pages/Režimy.md', value), subpath: null, note: null, section: null, readOnly: true, children: [], ...over };
}
async function show(n: Record<string, unknown>, editable = false) {
  const { Embed } = await need('../ui/src/embeds/Embed.tsx', 'Embed');
  const opened: [string, string | undefined][] = [];
  let error: unknown = null;
  let r: ReturnType<typeof render> | null = null;
  try {
    r = render(createElement(Embed, { node: n, host: 'Pages/Režimy.md', editable, onOpen: (p: string, f?: string) => opened.push([p, f]), onMode: () => {}, onEnter: () => {}, onCreate: () => {} }));
  } catch (e) { error = e; }
  assert.equal(error, null, `Embed threw: ${String(error)}`);
  return { container: r!.container, opened };
}
function frameOf(c: Element): HTMLElement {
  const f = c.querySelector('[role="group"]');
  assert.ok(f, 'an embed frame with role group');
  return f as HTMLElement;
}
function button(c: Element, n: string): HTMLElement | null {
  return ([...c.querySelectorAll('button, [role="button"]')] as HTMLElement[]).find((b) => name(b) === n) ?? null;
}

test('fr_emb_02_ac2_full_frame_header_and_body_of_cil', async () => {
  const note = await loaded('Pages/Cíl.md');
  const src = note.text!;
  const n = node('Cíl', { note, section: { kind: 'whole', from: parse(src).bodyStart, to: src.length }, readOnly: false });
  const { container, opened } = await show(n);
  const f = frameOf(container);
  assert.equal(name(f), 'Embedded: Cíl', 'R30 name (embed.name)');
  assert.deepEqual(
    ['data-embed-mode', 'data-embed-state', 'data-embed-depth', 'data-embed-target'].map((a) => f.getAttribute(a)),
    ['full', 'ok', '1', 'Pages/Cíl.md'],
    'R30 data attributes',
  );
  const header = f.firstElementChild as HTMLElement;
  assert.ok(header && header.querySelector('[data-icon="file-text"]'), 'the header holds the Page icon (D-217)');
  assert.ok(text(header).includes('Cíl'), 'the title');
  const open = button(header, 'Open Cíl');
  assert.ok(open, 'button Open Cíl (embed.open)');
  const disp = button(header, 'Display as');
  assert.equal(disp?.getAttribute('aria-haspopup'), 'menu', 'button Display as opens a menu');
  const body = f.querySelector('[data-embed-body]') as HTMLElement | null;
  assert.ok(body, 'the full body');
  assert.equal(body!.getAttribute('data-embed-editable'), 'false', 'not editable here');
  const b = text(body);
  const order = ['Úvodní odstavec cíle.', 'Úvod', 'Text v úvodu s odkazem na Jana Nováková.', 'Podkapitola', 'Vnořený text podkapitoly.', 'Druhá kapitola', 'Odstavec s identifikátorem.', 'Poslední odstavec cíle.'];
  let at = -1;
  for (const s of order) {
    const i = b.indexOf(s, at + 1);
    assert.ok(i > at, `"${s}" in order in the body:\n${b}`);
    at = i;
  }
  assert.deepEqual([...body!.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => text(h).trim()), ['Úvod', 'Podkapitola', 'Druhá kapitola'], 'headings');
  assert.ok(!b.includes('^blok1'), 'the block id isn’t shown');
  assert.ok(!b.includes('Reading list') && !b.includes('aliases') && !b.includes('01JB4F'), 'no frontmatter or properties in the body');
  const chip = ([...body!.querySelectorAll('a, [role="link"]')] as HTMLElement[]).find((e) => name(e) === 'Jana Nováková');
  assert.ok(chip, 'a resolved Jana Nováková chip (links resolve from the embedded note’s path)');
  assert.notEqual(chip!.getAttribute('data-link-kind'), 'unresolved');
  fireEvent.click(open!);
  assert.deepEqual(opened, [['Pages/Cíl.md', undefined]], 'Open Cíl opens the note');
});

test('fr_emb_02_ac2_daily_and_recipe_frames', async () => {
  const daily = await loaded('Daily/2026-10-07.md');
  const d = await show(node('2026-10-07', { note: daily, section: { kind: 'whole', from: parse(daily.text!).bodyStart, to: daily.text!.length } }));
  const f = frameOf(d.container);
  assert.ok(f.firstElementChild?.querySelector('[data-icon="calendar"]'), 'Daily Note icon');
  assert.equal(text(f.querySelector('[data-embed-body]')).trim(), 'Zápis dne.');
  cleanup();
  const sv = await loaded('Recepty/Svíčková.md');
  const s = await show(node('Svíčková', { note: sv, section: { kind: 'whole', from: parse(sv.text!).bodyStart, to: sv.text!.length } }));
  const body = frameOf(s.container).querySelector('[data-embed-body]');
  assert.deepEqual([...(body?.querySelectorAll('h1, h2, h3, h4, h5, h6') ?? [])].map((h) => text(h).trim()), ['Postup']);
  assert.ok(text(body).includes('Maso naložit přes noc.'));
  assert.ok(!text(body).includes('3 hodiny'), 'properties aren’t in the body');
});

test('fr_emb_02_ac4_cards_show_the_header_and_the_preview_strip', async () => {
  const jana = await loaded('Osoby/Jana Nováková.md');
  const j = await show(node('Jana Nováková', { mode: 'card', note: jana }));
  const f = frameOf(j.container);
  assert.equal(f.getAttribute('data-embed-mode'), 'card');
  assert.equal(name(f), 'Embedded: Jana Nováková');
  assert.ok(f.firstElementChild?.querySelector('[data-icon="user"]'), 'Osoba icon');
  assert.ok(button(f, 'Open Jana Nováková') && button(f, 'Display as'), 'Open and Display as');
  const list = ([...f.querySelectorAll('[role="list"], ul, ol')] as HTMLElement[]).find((l) => name(l) === 'Properties');
  assert.ok(list, 'the list Properties');
  const items = [...list!.querySelectorAll('[role="listitem"], li')].map((li) => text(li).replace(/\s+/g, ' ').trim());
  assert.deepEqual(items.length, 2, `exactly two items: ${items.join(' | ')}`);
  assert.ok(/^Firma\s*Beta a\.s\.$/.test(items[0]) && /^Role\s*Analytička$/.test(items[1]), `in preview order: ${items.join(' | ')}`);
  assert.ok(!text(j.container).includes('Poznámky o Janě.'), 'the body isn’t in the DOM');
  assert.equal(f.querySelector('input, textarea, [contenteditable="true"]'), null, 'values are never editable in a card');
  cleanup();

  const sarka = await loaded('Osoby/Šárka Malá.md');
  const s = await show(node('Šárka Malá', { mode: 'card', note: sarka }));
  const sf = frameOf(s.container);
  assert.equal(sf.querySelector('[role="list"], ul, ol'), null, 'no strip without values');
  assert.ok(!text(sf).includes('Bez vlastností.'), 'no body');
  assert.equal(text(sf).replace(/\s+/g, ' ').trim().replace(/Open Šárka Malá|Display as/g, '').trim(), 'Šárka Malá', 'the header only, no empty-state text');
  cleanup();

  // 5A-2 (conversion.md FR-CNV-05 AC-1, R52; D-499): a Task in card mode is the D-74 card, not the generic card.
  const task = await loaded('Tasks/Zavolat Janě.md');
  const t = await show(node('Zavolat Janě', { mode: 'card', note: task }));
  const tf = frameOf(t.container);
  assert.ok(tf.hasAttribute('data-task-card'), 'the D-74 Task card (R52)');
  assert.ok(tf.querySelector('[role="checkbox"][aria-label="Complete \\"Zavolat Janě\\""]'), 'the checkbox');
  assert.ok(button(tf, 'Status: To do') && button(tf, 'Priority: High'), 'Status and Priority buttons');
  assert.ok([...tf.querySelectorAll('button')].some((b) => name(b).startsWith('Due: ')), 'a Due button');
  assert.equal(([...tf.querySelectorAll('[role="list"], ul, ol')] as HTMLElement[]).find((l) => name(l) === 'Properties'), undefined, 'no preview strip on a Task card');
  assert.ok(text(tf).includes('Domluvit schůzku.'), 'the task body below the header');
  cleanup();

  const cil = await loaded('Pages/Cíl.md');
  const c = await show(node('Cíl|card', { mode: 'card', note: cil, target: target('Pages/Režimy.md', 'Cíl|card') }));
  const cf = frameOf(c.container);
  assert.equal(cf.querySelector('[role="list"], ul, ol'), null, 'Page has no preview properties: the header only');
  assert.ok(!text(cf).includes('Úvodní odstavec cíle.'));
});

test('fr_lnk_07_ac6_broken_frame_has_the_unresolved_chip_and_no_buttons', async () => {
  const n = node('Chybí', { state: 'broken', target: target('Pages/Rozbitá vložení.md', 'Chybí') });
  const { container } = await show(n);
  const f = frameOf(container);
  assert.equal(name(f), 'Chybí', 'an unresolved frame is named by the target as written');
  assert.deepEqual([f.getAttribute('data-embed-state'), f.getAttribute('data-embed-target')], ['broken', 'Chybí']);
  assert.equal(f.querySelector('[data-icon]'), null, 'no type icon');
  assert.equal(button(f, 'Display as'), null, 'no Display as in a broken frame');
  assert.ok(!([...f.querySelectorAll('button, [role="button"]')] as HTMLElement[]).some((b) => name(b).startsWith('Open')), 'no Open button');
  const chip = f.querySelector('[data-link-kind="unresolved"]');
  assert.ok(chip, 'the header holds the unresolved chip (D-310)');
  assert.equal(desc(chip!), 'No note named Chybí', 'link.noNote');
});

test('fr_emb_04_ac1_circular_frame_has_the_header_and_the_message', async () => {
  const n = node('Sama sebe', { state: 'circular', target: target('Pages/Sama sebe.md', 'Sama sebe') });
  const { container } = await show(n);
  const f = frameOf(container);
  assert.equal(f.getAttribute('data-embed-state'), 'circular');
  assert.ok(button(f, 'Open Sama sebe'), 'Open Sama sebe');
  assert.equal(text(f.querySelector('[data-embed-message]')).trim(), 'Circular embed: "Sama sebe" is already shown above.', 'embed.circular');
  assert.equal(f.querySelector('[data-embed-body]'), null, 'never expanded');
});

test('fr_emb_04_ac5_too_deep_is_a_link_mode_embed_with_its_description', async () => {
  const n = node('Řetěz 5', { depth: 4, mode: 'link', state: 'too-deep', target: target('Pages/Řetěz 4.md', 'Řetěz 5') });
  const { container, opened } = await show(n);
  const l = container.querySelector('[role="link"], a') as HTMLElement | null;
  assert.ok(l, 'a link-mode embed');
  assert.equal(container.querySelector('[role="group"]'), null, 'no frame');
  assert.deepEqual([name(l!), desc(l!)], ['Řetěz 5', 'Embedded too deeply to show here'], 'embed.tooDeep');
  assert.deepEqual([l!.getAttribute('data-embed-mode'), l!.getAttribute('data-embed-state'), l!.getAttribute('data-icon') ?? l!.querySelector('[data-icon]')?.getAttribute('data-icon')], ['link', 'too-deep', 'file-text']);
  assert.ok(!text(container).includes('Úroveň 5.'));
  fireEvent.click(l!);
  assert.deepEqual(opened.map((o) => o[0]), ['Pages/Řetěz 5.md'], 'activating it opens Řetěz 5');
});

test('fr_emb_01_ac3_an_inline_embed_is_a_link_mode_embed', async () => {
  const n = node('Cíl', { inline: true, mode: 'link', line: 8, target: target('Pages/Uvnitř textu.md', 'Cíl') });
  const { container } = await show(n);
  assert.equal(container.querySelector('[role="group"]'), null, 'no frame inline');
  const l = container.querySelector('[data-embed-mode="link"]') as HTMLElement | null;
  assert.ok(l, 'data-embed-mode="link"');
  assert.deepEqual([name(l!), desc(l!), l!.getAttribute('data-embed-target')], ['Cíl', 'Embedded note', 'Pages/Cíl.md'], 'title, embed.chip description, target');
  assert.ok(l!.getAttribute('data-icon') === 'file-text' || l!.querySelector('[data-icon="file-text"]'), 'the target type’s icon');
});

test('fr_emb_02_ac15_embed_strings_come_from_the_catalog', async () => {
  const cat = await catalog();
  assert.ok(typeof cat.pseudo === 'function', 'catalog.pseudo (NFR-OTH-02 AC-3)');
  cat.setCatalog(cat.pseudo(cat.en), 'en-XA');
  try {
    const jana = await loaded('Osoby/Jana Nováková.md');
    const { container } = await show(node('Jana Nováková', { mode: 'card', note: jana }));
    const f = frameOf(container);
    assert.ok(name(f).includes('⟦') && name(f).includes('Jana Nováková'), `frame name from embed.name: ${name(f)}`);
    const buttons = [...f.querySelectorAll('button, [role="button"]')] as HTMLElement[];
    assert.ok(buttons.length >= 2, 'Open and Display as');
    for (const b of buttons) assert.ok(name(b).includes('⟦'), `button "${name(b)}" from the catalog`);
    const list = f.querySelector('[role="list"], ul, ol');
    assert.ok(list && name(list).includes('⟦'), 'Properties from the catalog');
    cleanup();
    const c = await show(node('Sama sebe', { state: 'circular', target: target('Pages/Sama sebe.md', 'Sama sebe') }));
    const msg = text(c.container.querySelector('[data-embed-message]'));
    assert.ok(msg.includes('⟦') && msg.includes('Sama sebe'), `embed.circular from the catalog: ${msg}`);
  } finally {
    cat.setCatalog(cat.en, 'en');
  }
});
