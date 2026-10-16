// @vitest-environment jsdom
// MS3 slice 3B, L1: the formatted read view (FR-EDT-02 AC-1…AC-6, AC-8, AC-9, AC-11…AC-13) and the invalid-frontmatter
// warning (NFR-REL-03 AC-3, message and line). Written from docs/acceptance/read-view.md and
// docs/contracts/ms3-shell.md §11 only (D-61). Modules are imported dynamically inside each test, and every lookup
// uses query* + node:assert, so a missing module or element fails an assertion, not the file (TS-I1).
import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { cleanup, render, fireEvent } from '@testing-library/react';
import { parse } from '@tegg/doc';
import { computeAccessibleDescription, computeAccessibleName } from 'dom-accessibility-api';
import { R5, expandReqs, showDue } from './shell-tables';
import { F, catalog, fixture, fixtureNotes, need, referenceVault, resolveOnFixture, type LinkTargetDto } from './read-helpers';

const RV = '../ui/src/read/ReadView.tsx';
const nfc = (s: string) => s.normalize('NFC');
const name = (e: Element) => nfc(computeAccessibleName(e).trim());
const desc = (e: Element) => nfc(computeAccessibleDescription(e).trim());
const text = (e: Element | null) => nfc(e?.textContent ?? '');

beforeEach(async () => { await catalog().catch(() => {}); });
afterEach(() => cleanup());

type Calls = { open: [string, string | undefined][]; tag: string[]; external: string[]; scroll: string[] };

/** Renders `ReadView` for a fixture note. Links are resolved by the contract rules over the fixture for the targets
 *  `linkTargets` asks for (plus their NFC forms), as the note page would pass them in. */
async function view(rel: string, override?: string) {
  const mod = await need(RV, 'ReadView', 'linkTargets');
  const src = override ?? fixture(rel);
  let targets: string[] = [];
  try { targets = mod.linkTargets(src) as string[]; } catch { targets = []; }
  const links = resolveOnFixture(rel, [...targets, ...targets.map(nfc)]);
  const calls: Calls = { open: [], tag: [], external: [], scroll: [] };
  const props = {
    text: src, path: rel, links: links as Map<string, LinkTargetDto>,
    onOpen: (p: string, f?: string) => calls.open.push([p, f]),
    onTag: (k: string) => calls.tag.push(k),
    onExternal: (u: string) => calls.external.push(u),
    onScrollInNote: (f: string) => calls.scroll.push(f),
  };
  let r: ReturnType<typeof render> | null = null;
  let error: unknown = null;
  try { r = render(createElement(mod.ReadView, props)); } catch (e) { error = e; }
  assert.equal(error, null, `ReadView threw on ${rel}: ${String(error)}`);
  const article = r!.container.querySelector('article, [role="article"]');
  assert.ok(article, `${rel}: no note body article`);
  return { article: article as HTMLElement, calls, container: r!.container };
}

/** The list item of Odkazy whose text starts with `label` (e.g. "Prostý:"). */
function item(article: Element, label: string): HTMLElement {
  const li = [...article.querySelectorAll('li')].find((l) => text(l).trim().startsWith(label));
  assert.ok(li, `no list item "${label}"`);
  return li as HTMLElement;
}
function linksIn(e: Element): HTMLElement[] {
  return [...e.querySelectorAll('a, [role="link"]')] as HTMLElement[];
}
function oneLink(e: Element, what: string): HTMLElement {
  const ls = linksIn(e);
  assert.equal(ls.length, 1, `${what}: exactly one link, got ${ls.length}`);
  return ls[0];
}

// ------------------------------------------------------------------------------------------------ FR-EDT-02

test('fr_edt_02_ac1_headings_levels_and_ids', async () => {
  const { article } = await view(F.bloky);
  assert.equal(name(article), 'Bloky', 'article named by the note title');
  assert.equal(article.querySelectorAll('h1').length, 0, 'the note title is the page’s only h1, never inside the body');
  const hs = [...article.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => [h.tagName.toLowerCase(), text(h).trim()]);
  assert.deepEqual(hs, [
    ['h2', 'Nadpis 1'], ['h3', 'Nadpis 2'], ['h4', 'Nadpis 3'], ['h5', 'Nadpis 4'], ['h6', 'Nadpis 5'], ['h6', 'Nadpis 6'],
    ['h2', 'Setext nadpis'],
  ]);
  const ids = [...article.querySelectorAll('h2, h3, h4, h5, h6')].map((h) => h.id);
  for (const id of ids) assert.notEqual(id, '', 'every heading has an id derived from its text');
  assert.equal(new Set(ids).size, ids.length, `heading ids are distinct: ${ids.join(', ')}`);
});

test('fr_edt_02_ac2_lists_nesting_start_numbers_and_readonly_checklists', async () => {
  const { article } = await view(F.bloky);
  const top = [...article.querySelectorAll('ul, ol')].filter((l) => !l.parentElement?.closest('ul, ol'));
  const plain = top.filter((l) => !l.querySelector('[role="checkbox"], input[type="checkbox"]'));
  const shape = plain.map((l) => [l.tagName.toLowerCase(), (l as HTMLOListElement).start ?? null, [...l.children].map((c) => text(c.firstChild as Element | null).trim() || text(c).trim().split('\n')[0])]);
  assert.equal(plain.length, 5, `five lists in Bloky (three bulleted, two numbered), got ${plain.length}`);
  assert.deepEqual(plain.map((l) => l.tagName.toLowerCase()), ['ul', 'ul', 'ul', 'ol', 'ol'], JSON.stringify(shape));
  const [dash, star, plus, three, paren] = plain;
  assert.equal(dash.children.length, 2, '- list has two items');
  const nested = dash.children[0].querySelector('ul');
  assert.ok(nested, 'the nested item is a nested ul inside the first item');
  assert.equal(text(nested).trim(), 'vnořená odrážka');
  assert.match(text(star), /hvězdička/);
  assert.match(text(plus), /plus/);
  assert.equal((three as HTMLOListElement).start, 3, '`3.` starts at 3');
  assert.equal(three.children.length, 2);
  assert.equal((paren as HTMLOListElement).start, 1, '`1)` starts at 1');

  const boxes = [...article.querySelectorAll('[role="checkbox"], input[type="checkbox"]')] as HTMLElement[];
  assert.equal(boxes.length, 3, 'three checklist items with a checkbox role');
  for (const b of boxes) {
    assert.ok(b.closest('li'), 'checklist checkboxes are inside list items');
    assert.equal(b.getAttribute('aria-readonly'), 'true', 'aria-readonly="true"');
  }
  const checked = (b: HTMLElement) => b.getAttribute('aria-checked') === 'true' || (b as HTMLInputElement).checked === true;
  assert.deepEqual(boxes.map(checked), [false, true, true], '[ ] unchecked, [x] and [X] checked');
  assert.deepEqual(boxes.map(name), ['nehotovo', 'hotovo', 'hotovo velké'], 'checkbox named by the item text');
});

test('fr_edt_02_ac3_quote_and_callouts', async () => {
  const cat = await catalog();
  const co = await need('../ui/src/read/callout.ts', 'CALLOUT_TYPES', 'calloutType');
  assert.deepEqual([...co.CALLOUT_TYPES], ['note', 'abstract', 'info', 'todo', 'tip', 'success', 'question', 'warning', 'failure', 'danger', 'bug', 'example', 'quote'], 'the 13 Obsidian callout types');
  const { article } = await view(F.bloky);
  const quotes = [...article.querySelectorAll('blockquote')];
  assert.equal(quotes.length, 1, 'only the plain `>` quote is a blockquote');
  assert.match(text(quotes[0]), /citace[\s\S]*druhý řádek citace/);

  const callouts = [...article.querySelectorAll('[data-callout]')] as HTMLElement[];
  assert.equal(callouts.length, 6, 'six callouts');
  for (const c of callouts) {
    assert.equal(c.getAttribute('role'), 'note', 'callout role note');
    assert.equal(c.closest('blockquote'), null, 'a callout is not a blockquote');
  }
  assert.deepEqual(callouts.map((c) => c.dataset.callout), ['warning', 'note', 'note', 'warning', 'tip', 'tip'], 'types: unknown → note, caution → warning');
  const noteLabel = Object.entries(cat.en as Record<string, unknown>).find(([, v]) => v === 'Note');
  assert.ok(noteLabel, 'the catalog has a type label "Note"');
  assert.deepEqual(callouts.map(name), ['Pozor', 'Note', 'Neznámý typ', 'Alias', 'Složené', 'Rozbalené'], 'named by the title, or the type label without one');
  assert.match(text(callouts[2]), /budget/, 'unknown type shows its raw type as the label');
  assert.match(text(callouts[0]), /Text varování\./);
  const fold = (c: HTMLElement) => c.querySelector('button[aria-expanded]');
  assert.ok(fold(callouts[4]), '[!tip]- has a fold toggle button');
  assert.equal(fold(callouts[4])!.getAttribute('aria-expanded'), 'false', '[!tip]- starts collapsed');
  assert.ok(fold(callouts[5]), '[!tip]+ has a fold toggle button');
  assert.equal(fold(callouts[5])!.getAttribute('aria-expanded'), 'true', '[!tip]+ starts expanded');
  assert.equal(fold(callouts[0]), null, 'a callout without fold marker has no fold toggle');
});

test('fr_edt_02_ac4_code_tables_and_dividers', async () => {
  const { article } = await view(F.bloky);
  const codes = [...article.querySelectorAll('pre > code')].map((c) => text(c).replace(/\n$/, ''));
  assert.ok(codes.includes('const a = "[[Kód]] #kód";'), `fenced code text exact; got ${JSON.stringify(codes)}`);
  assert.ok(codes.includes('odsazený kód'), 'indented code block');
  assert.ok(codes.includes('flowchart LR\n  A --> B'), 'a non-mindmap Mermaid block is code');
  assert.ok(codes.includes('LIST'), 'unknown fence (dataview) is a code block');
  const js = [...article.querySelectorAll('pre')].find((p) => text(p).includes('const a ='))!;
  assert.equal(linksIn(js).length, 0, 'no links inside code');
  assert.equal(js.querySelectorAll('[data-tag]').length, 0, 'no tags inside code');
  const jsBlock = js.parentElement!;
  assert.match(text(jsBlock), /\bjs\b/, 'the fence language is shown as a label');

  const table = article.querySelector('table');
  assert.ok(table, 'GFM table');
  const th = [...table!.querySelectorAll('th')];
  assert.deepEqual(th.map((h) => text(h).trim()), ['Vlevo', 'Střed', 'Vpravo']);
  const align = (e: Element) => (e as HTMLElement).style.textAlign || e.getAttribute('align') || '';
  assert.deepEqual(th.map(align), ['left', 'center', 'right'], 'column alignments');
  const cells = [...table!.querySelectorAll('td')];
  assert.equal(cells.length, 3);
  assert.equal(text(cells[1]).trim(), 'a | b', '`\\|` in a cell is shown as |');
  const l = oneLink(cells[0], 'wikilink with \\| alias in a cell');
  assert.equal(name(l), 'alias v tabulce');
  assert.equal(article.querySelectorAll('hr').length, 3, '---, *** and ___ are hr');
});

test('fr_edt_02_ac5_inline_formatting_comments_math_footnotes_block_id', async () => {
  const { article } = await view(F.bloky);
  const all = (sel: string) => [...article.querySelectorAll(sel)].map((e) => text(e));
  assert.deepEqual(all('em'), ['kurzívou', 'kurzívou'], '*em* and _em_');
  assert.deepEqual(all('strong'), ['tučně', 'tučně'], '**strong** and __strong__');
  assert.deepEqual(all('del'), ['přeškrtnuté']);
  assert.deepEqual(all('mark'), ['zvýrazněné']);
  const inlineCode = [...article.querySelectorAll('code')].filter((c) => !c.closest('pre')).map((c) => text(c));
  assert.ok(inlineCode.includes('kód'), '`c` → code');
  const para = [...article.querySelectorAll('p')].find((p) => text(p).includes('zalomení řádku'));
  assert.ok(para, 'the inline paragraph');
  assert.equal(para!.querySelectorAll('br').length, 2, 'two trailing spaces and `\\` are br');
  const body = text(article);
  assert.ok(!body.includes('skrytý komentář'), 'inline %%comment%% is hidden');
  assert.ok(!body.includes('Komentářový blok'), 'comment block is hidden');
  const codeText = [...article.querySelectorAll('code')].map((c) => text(c)).join('\n');
  assert.ok(codeText.includes('x^2'), 'inline math $x^2$ shown as source in code style');
  assert.ok(codeText.includes('E = mc^2'), 'block math shown as source in code style');
  assert.ok(body.includes('$5 and $3'), '`$5 and $3` stays plain text');
  assert.ok(!codeText.includes('5 and'), '`$5 and $3` is not math');
  assert.ok(body.includes('[^1]'), 'footnote reference shown as source');
  assert.ok(body.includes('[^1]: Text poznámky pod čarou.'), 'footnote definition shown as source');
  assert.ok(!body.includes('^abc123'), 'block id not shown');
  const holder = article.querySelector('[id="^abc123"]');
  assert.ok(holder, 'the block gets its id as element id');
  assert.match(text(holder), /Odstavec s blokovým ID\./);
});

test('fr_edt_02_ac6_link_targets_are_one_batch_without_attachments', async () => {
  const mod = await need(RV, 'linkTargets');
  const norm = (t: string) => nfc(t).toLowerCase().replace(/\.md$/, '');
  const odkazy = mod.linkTargets(fixture(F.odkazy)) as string[];
  assert.ok(Array.isArray(odkazy), 'linkTargets returns a list');
  assert.equal(new Set(odkazy).size, odkazy.length, 'deduplicated');
  assert.deepEqual([...new Set(odkazy.map(norm))].sort(), ['2026-10-07', '2026-10-08', 'cíl', 'dvojník', 'neexistuje', 'reading list', 'smazaná', 'šablona'].sort(),
    `targets of Odkazy (no attachments, nothing from code, math, comments or HTML): ${JSON.stringify(odkazy)}`);
  for (const t of odkazy) assert.ok(!/[#|]/.test(t), `target without subpath or alias: ${t}`);
  const vl = mod.linkTargets(fixture(F.vlastnosti)) as string[];
  assert.deepEqual([...new Set(vl.map(norm))].sort(), ['cíl', 'dvojník'], `frontmatter relations of Vlastnosti (cover is an attachment): ${JSON.stringify(vl)}`);
});

test('fr_edt_02_ac6_wikilinks_and_markdown_links_render_as_chips', async () => {
  const { article, calls } = await view(F.odkazy);
  const cases: [string, string, string, string | undefined][] = [
    ['Prostý:', 'Cíl', F.cil, undefined],
    ['Alias:', 'jiný text', F.cil, undefined],
    ['Nadpis:', '', F.cil, 'Druhá kapitola'],
    ['Blok:', '', F.cil, '^blok1'],
    ['Velikost písmen:', 'Cíl', F.cil, undefined],
    ['NFD:', 'Cíl', F.cil, undefined],
    ['Markdown:', 'text', F.cil, undefined],
    ['Markdown kódovaný:', 'kódovaný', F.cil, undefined],
    ['Dvojník:', 'Dvojník', F.dvojnikP, undefined],
  ];
  for (const [label, display, path, fragment] of cases) {
    const l = oneLink(item(article, label), label);
    assert.equal(l.getAttribute('data-link-kind'), 'note', `${label} is a resolved note chip`);
    if (display) assert.equal(name(l), display, `${label} display text`);
    else assert.match(name(l), /Cíl/, `${label} shows the target title`);
    calls.open.length = 0;
    fireEvent.click(l);
    assert.deepEqual(calls.open.map(([p, f]) => [nfc(p), f === undefined ? undefined : nfc(f)]), [[path, fragment]], `${label} opens ${path}${fragment ? '#' + fragment : ''}`);
  }
});

test('fr_edt_02_ac8_unresolved_and_date_links', async () => {
  const { article, calls } = await view(F.odkazy);
  const section = (h: string) => {
    const head = [...article.querySelectorAll('h2, h3')].find((x) => text(x).trim() === h);
    assert.ok(head, `section ${h}`);
    let n = head!.nextElementSibling;
    while (n && !/^(UL|OL)$/.test(n.tagName)) n = n.nextElementSibling;
    assert.ok(n, `list under ${h}`);
    return [...n!.querySelectorAll('li')].map((li) => oneLink(li, text(li)));
  };
  const unresolved = section('Nevyřešené');
  assert.deepEqual(unresolved.map(name), ['Neexistuje', 'Reading list', 'Šablona', 'Smazaná']);
  for (const l of unresolved) {
    assert.equal(l.getAttribute('data-link-kind'), 'unresolved', `${name(l)}: broken-link chip (aliases, templates and .trash/ never resolve)`);
    assert.equal(desc(l), `No note named ${name(l)}`, `${name(l)}: accessible description`);
  }
  calls.open.length = 0;
  for (const l of unresolved) fireEvent.click(l);
  assert.deepEqual([...calls.open], [], 'activating an unresolved link opens nothing');

  const [d7, d8] = section('Data');
  assert.ok(['note', 'daily'].includes(d7.getAttribute('data-link-kind') ?? ''), '[[2026-10-07]] resolves to Denní');
  fireEvent.click(d7);
  assert.deepEqual(calls.open.map(([p]) => nfc(p)), [F.denni], '[[2026-10-07]] opens the Daily Note');
  assert.equal(d8.getAttribute('data-link-kind'), 'date-missing', '[[2026-10-08]] is not broken');
  // From 4B (D-142 ended; daily-notes.md FR-DLY-08 AC-5, AC-6): no disabled control and no `Coming in MS4`; activating it
  // opens the virtual Daily Note daily/2026-10-08, which is checked at L5 (app/webkit/read_view.ac.test.ts).
  assert.notEqual(d8.getAttribute('aria-disabled'), 'true', 'a date link without a note is not a disabled control');
  assert.ok(!/Coming in MS4/.test(desc(d8)), `no Coming in MS4 description: ${desc(d8)}`);
  assert.notEqual(desc(d8), 'No note named 2026-10-08', 'not described as a broken link');
});

test('fr_edt_02_ac9_tag_detection', async () => {
  const { article, calls } = await view(F.odkazy);
  const chips = [...article.querySelectorAll('[data-tag]')] as HTMLElement[];
  assert.deepEqual(chips.map((c) => c.dataset.tag), ['projekt', 'projekt/alfa', 'čeština'], 'exactly three tags (keys); #1, # Nadpis, site.com/#x, `#kód`, $#x$ and #tag in link text are not tags');
  for (const c of chips) assert.equal(c.getAttribute('role') ?? (c.tagName === 'A' ? 'link' : null), 'link', 'tag chip role link');
  assert.deepEqual(chips.map(name), ['#projekt', '#Projekt/alfa', '#Čeština'], 'named #<name> as written');
  fireEvent.click(chips[1]);
  assert.deepEqual(calls.tag, ['projekt/alfa'], 'activating a tag passes its key');
});

test('fr_edt_02_ac11_html_is_text_and_nothing_runs', async () => {
  delete (window as any).__teggPwned;
  const { article } = await view(F.bloky);
  const bad = article.querySelectorAll('script, iframe, object, embed, style, b');
  assert.equal(bad.length, 0, `HTML in the note never becomes elements: ${[...bad].map((e) => e.tagName).join(', ')}`);
  const imgs = [...article.querySelectorAll('img')].filter((i) => /^(https?:)?\/\//i.test(i.getAttribute('src') ?? ''));
  assert.equal(imgs.length, 0, 'no img with a non-local src');
  const onAttrs = [...article.querySelectorAll('*')].filter((e) => [...e.attributes].some((a) => /^on/i.test(a.name)));
  assert.equal(onAttrs.length, 0, 'no element with an on* attribute');
  assert.equal((window as any).__teggPwned, undefined, 'no script from the note ran');
  const codeText = [...article.querySelectorAll('code')].map((c) => text(c)).join('\n');
  for (const src of ['<div onclick="window.__teggPwned = 1">HTML blok</div>', '<script>window.__teggPwned = 1</script>', '<style>body { color: red }</style>', '<iframe src="https://example.com"></iframe>', '<b>HTML</b>', '<img src="https://example.com/x.png">']) {
    assert.ok(codeText.includes(src), `shown as source text in code style: ${src}`);
  }
});

/** Words of the body text that must be shown (AC-12): body only, without comments, block ids, link/embed syntax,
 *  fence info strings and callout markers. Words are letter/number runs, NFC, lower case. */
function expectedWords(src: string, bodyStart: number): string[] {
  let b = src.slice(bodyStart);
  b = b.replace(/%%[\s\S]*?%%/g, ' ');
  b = b.replace(/ \^[A-Za-z0-9-]+[ \t]*$/gm, ' ');
  b = b.replace(/!?\[\[[^\]\n]*\]\]/g, ' ');
  b = b.replace(/!?\[[^\]\n]*\]\((?:[^()\s]|\([^()\s]*\))*\)/g, ' ');
  b = b.replace(/^(\s*)(```|~~~)[^\n]*$/gm, '$1$2');
  b = b.replace(/^(\s*>\s*)\[![^\]]*\][+-]?/gm, '$1');
  return words(b);
}
function words(s: string): string[] {
  return (nfc(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}
function shownWords(root: Element): string[] {
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) { out.push(...words(n.textContent ?? '')); return; }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    if (e.getAttribute('aria-hidden') === 'true') return;
    for (const c of n.childNodes) walk(c);
  };
  walk(root);
  return out;
}
function missingInOrder(want: string[], got: string[]): string[] {
  let i = 0;
  const missing: string[] = [];
  for (const w of want) {
    const j = got.indexOf(w, i);
    if (j < 0) missing.push(w);
    else i = j + 1;
  }
  return missing;
}

test('fr_edt_02_ac12_nothing_lost_in_fixture_notes', async () => {
  const doc = { parse };
  const failures: string[] = [];
  for (const rel of fixtureNotes()) {
    const src = readFileSync(join(import.meta.dirname, '../../tests/fixtures/vaults/read-view', rel), 'utf8');
    const d = doc.parse(src);
    const { article } = await view(rel, src);
    const missing = missingInOrder(expectedWords(src, d.bodyStart), shownWords(article));
    if (missing.length) failures.push(`${rel}: ${missing.slice(0, 8).join(' ')}${missing.length > 8 ? ' …' : ''}`);
    cleanup();
  }
  assert.deepEqual(failures, [], 'every body word is shown, in order');
});

test('fr_edt_02_ac12_nothing_lost_in_200_reference_vault_notes', { timeout: 600_000 }, async () => {
  const doc = { parse };
  await view(F.bloky); // fails fast while the read view isn't built, before generating the vault
  cleanup();
  const root = await referenceVault();
  assert.ok(root, 'reference vault (gen-vault --seed 1 --small-images) could not be produced');
  const { readdirSync, statSync } = await import('node:fs');
  const all: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const n of readdirSync(d).sort()) {
      if (n.startsWith('.') || n === '_templates' || n === '_attachments') continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p, `${rel}${n}/`);
      else if (n.endsWith('.md')) all.push(`${rel}${n}`);
    }
  };
  walk(root!, '');
  assert.ok(all.length >= 200, `reference vault has ${all.length} notes`);
  const step = Math.floor(all.length / 200);
  const pick = Array.from({ length: 200 }, (_, i) => all[i * step]);
  const failures: string[] = [];
  for (const rel of pick) {
    const src = readFileSync(join(root!, rel), 'utf8');
    const d = doc.parse(src);
    const { article } = await view(rel, src);
    const missing = missingInOrder(expectedWords(src, d.bodyStart), shownWords(article));
    if (missing.length) failures.push(`${rel}: ${missing.length} words missing`);
    cleanup();
  }
  assert.deepEqual(failures, [], 'every body word is shown, in order (200 reference notes)');
});

test('fr_edt_02_ac13_r5_placeholders_render_with_their_parts', async () => {
  const cat = await catalog();
  const reg = await need('../ui/src/shell/registry.ts', 'IN_NOTE_PLACEHOLDERS');
  const defs = reg.IN_NOTE_PLACEHOLDERS as { id: string; name: string }[];
  assert.equal(defs.length, R5.length, 'IN_NOTE_PLACEHOLDERS has the R5 rows');
  const bloky = await view(F.bloky);
  const bl = [...bloky.article.querySelectorAll('[data-placeholder]')] as HTMLElement[];
  const blIds = bl.map((p) => p.dataset.placeholder);
  cleanup();
  const odkazy = await view(F.odkazy);
  const od = [...odkazy.article.querySelectorAll('[data-placeholder]')] as HTMLElement[];
  assert.deepEqual(blIds, ['mindmap', 'query', 'embed-image'], 'Bloky: mindmap, query, remote image');
  assert.deepEqual(od.map((p) => p.dataset.placeholder), ['embed-note', 'embed-note', 'embed-image', 'embed-image', 'embed-pdf', 'embed-other'], 'Odkazy: two note embeds, two images, a PDF, another attachment');
  for (const p of od) {
    const row = R5.find((r) => r.id === p.dataset.placeholder)!;
    const def = defs.find((x) => x.id === row.id);
    assert.ok(def, `${row.id} in the registry`);
    assert.equal(p.getAttribute('role') ?? (p.tagName === 'SECTION' ? 'region' : null), 'region', `${row.id}: region`);
    assert.equal(name(p), nfc(cat.t(def!.name)), `${row.id}: named by its catalog name`);
    const tx = text(p);
    assert.ok(tx.includes(`Coming in ${showDue(row.due)}`), `${row.id}: "Coming in ${showDue(row.due)}"`);
    for (const id of expandReqs(row.reqs)) assert.ok(tx.includes(id) || tx.includes(`-${id.split('-').pop()}`), `${row.id}: requirement ${id}`);
  }
  const [n1, n2, i1, i2, pdf, other] = od;
  const embeds: [HTMLElement, string | undefined][] = [[n1, undefined], [n2, 'Druhá kapitola']];
  for (const [p, frag] of embeds) {
    const l = oneLink(p, 'note embed chip');
    assert.equal(name(l), 'Cíl', 'note embed shows its target as a chip');
    odkazy.calls.open.length = 0;
    fireEvent.click(l);
    assert.deepEqual(odkazy.calls.open.map(([x, f]) => [nfc(x), f === undefined ? undefined : nfc(f)]), [[F.cil, frag]], 'the chip opens the note');
  }
  assert.ok(text(i1).includes('fotka.png'), 'image: file name');
  assert.ok(text(i2).includes('obrázek.jpg') && text(i2).includes('popis obrázku'), 'image: file name and alt text');
  assert.ok(text(pdf).includes('dokument.pdf') && /\b3\b/.test(text(pdf)), 'PDF: file name and page');
  assert.ok(text(other).includes('tabulka.xlsx'), 'other attachment: file name');
  assert.equal(odkazy.article.querySelectorAll('img').length, 0, 'no image is loaded');
});

// ------------------------------------------------------------------------------------------------ NFR-REL-03

test('nfr_rel_03_ac3_warning_kind_and_line', async () => {
  const doc = { parse };
  const w = await need('../ui/src/read/warning.ts', 'frontmatterWarning');
  const sv = await need('../ui/src/read/SourceView.tsx', 'SourceView');
  const cases: [string, 'invalidYaml' | 'notClosed', number, string][] = [
    [F.uvozovky, 'invalidYaml', 3, 'invalid YAML'],
    [F.odsazeni, 'invalidYaml', 6, 'invalid YAML'],
    [F.klic, 'invalidYaml', 5, 'invalid YAML'],
    [F.tabulator, 'invalidYaml', 5, 'invalid YAML'],
    [F.neuzavrena, 'notClosed', 1, 'frontmatter not closed'],
  ];
  for (const [rel, kind, line, shown] of cases) {
    const d = doc.parse(fixture(rel));
    const got = w.frontmatterWarning(d);
    assert.deepEqual(got, { kind, line }, `${rel}: warning`);
    const { container } = render(createElement(sv.SourceView, { text: fixture(rel), warning: got }));
    const alert = container.querySelector('[role="alert"]');
    assert.ok(alert, `${rel}: alert-role warning`);
    const tx = text(alert);
    assert.ok(tx.includes(shown), `${rel}: names the problem kind "${shown}": ${tx}`);
    assert.match(tx, new RegExp(`\\b${line}\\b`), `${rel}: names line ${line}`);
    const core = (d.frontmatter?.error ?? d.frontmatterError)?.message as string | undefined;
    if (core && core !== shown) assert.ok(!tx.includes(core), `${rel}: the core's message text isn't shown`);
    cleanup();
  }
  for (const rel of [F.bloky, F.vlastnosti, F.bez]) assert.equal(w.frontmatterWarning(doc.parse(fixture(rel))), null, `${rel}: no warning`);
});
