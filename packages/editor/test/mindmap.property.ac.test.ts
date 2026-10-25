// Slice MM, L2 property (AR-06): docs/acceptance/mindmap.md FR-FMT-07 AC-24 (c). Random mindmap callouts (depth 1–5,
// 1–40 items, Czech words in NFC and NFD, markers `-`, `*`, `+`, `1.`, `1)`, checklist items, 2- and 4-space and tab
// indents, titles with and without fold markers, CRLF and LF, with and without a final newline):
// - load + save without edits is the identity, and the callout reads back as the generated tree;
// - an edit of one item changes only bytes inside the callout and reads back to the same tree with only that item
//   changed (D-766);
// - wrapping a random list and unwrapping it again returns its original bytes when the mindmap has no title (D-767);
// The fourth part (the layout read back equals the layout before the save) is in app/test/mindmap_property.ac.test.ts.
// Interfaces: docs/contracts/mm-mindmap.md §1.2, §1.3, §2, §3. Written from the AC and the contract only (D-61).
// Seeds (TS-L2): a fixed seed plus one random seed per run (`QA_SEED` when set, else the clock), printed as `seed = N`;
// more runs with EDITOR_PROPERTY_RUNS.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { TextSelection } from '@tiptap/pm/state';
import { editorModule, NOW, newId, type } from './helpers';

const RUNS = Number(process.env.EDITOR_PROPERTY_RUNS ?? 60);
const RANDOM = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31;
const SEEDS = [20261025, RANDOM];
console.log(`mindmap property: seed = ${SEEDS[0]}, seed = ${SEEDS[1]}`);

const WORDS = ['Kořen', 'Větev', 'Žluťoučký kůň', 'Příprava', 'Účet', 'Řeka', 'Čtení', 'Dovolená', 'Šňůra', 'Plán', 'ďábel', 'Ústí'];
type Marker = '-' | '*' | '+' | '1.' | '1)';
type Spec = {
  title: string | null; fold: '' | '+' | '-'; spelling: string; marker: Marker; indent: '2' | '4' | 'tab'; check: boolean;
  depths: number[]; words: number[]; checked: boolean[]; crlf: boolean; finalNewline: boolean; nfd: boolean; trailing: boolean;
};

const specArb: fc.Arbitrary<Spec> = fc
  .record({
    title: fc.option(fc.integer({ min: 0, max: WORDS.length - 1 }), { nil: null }),
    fold: fc.constantFrom<'' | '+' | '-'>('', '+', '-'),
    spelling: fc.constantFrom('mindmap', 'MindMap', 'MINDMAP'),
    marker: fc.constantFrom<Marker>('-', '*', '+', '1.', '1)'),
    indent: fc.constantFrom<'2' | '4' | 'tab'>('2', '4', 'tab'),
    check: fc.boolean(),
    steps: fc.array(fc.integer({ min: -4, max: 1 }), { minLength: 0, maxLength: 39 }),
    words: fc.array(fc.integer({ min: 0, max: WORDS.length - 1 }), { minLength: 40, maxLength: 40 }),
    checked: fc.array(fc.boolean(), { minLength: 40, maxLength: 40 }),
    crlf: fc.boolean(),
    finalNewline: fc.boolean(),
    nfd: fc.boolean(),
    trailing: fc.boolean(),
  })
  .map((r) => {
    const tab = r.indent === 'tab';
    const maxDepth = tab ? 2 : 4; // tab indents: bullets, depth ≤ 3 (as Obsidian writes them)
    const depths = [0];
    for (const s of r.steps) depths.push(Math.max(0, Math.min(maxDepth, depths[depths.length - 1] + s)));
    return {
      title: r.title === null ? null : WORDS[r.title], fold: r.fold, spelling: r.spelling, marker: tab ? '-' : r.marker, indent: r.indent,
      check: r.check, depths, words: r.words, checked: r.checked, crlf: r.crlf, finalNewline: r.finalNewline, nfd: r.nfd, trailing: r.trailing,
    } as Spec;
  });

const isOrdered = (m: Marker) => m === '1.' || m === '1)';
/** The list lines (without `> `) and the outline (`level:text|checked`) the generator meant. */
function listOf(s: Spec): { lines: string[]; outline: string[] } {
  const lines: string[] = [];
  const outline: string[] = [];
  const counters: number[] = [];
  const indents: string[] = [''];
  for (const [i, d] of s.depths.entries()) {
    counters.length = d + 1;
    counters[d] = (counters[d] ?? 0) + 1;
    const n = counters[d];
    const marker = isOrdered(s.marker) ? `${n}${s.marker.slice(1)}` : s.marker;
    const word = s.nfd ? WORDS[s.words[i] % WORDS.length].normalize('NFD') : WORDS[s.words[i] % WORDS.length];
    const box = !isOrdered(s.marker) && s.check ? (s.checked[i] ? '[x] ' : '[ ] ') : '';
    const indent = indents[d] ?? '';
    lines.push(`${indent}${marker} ${box}${word} ${i + 1}`);
    outline.push(`${d + 1}:${WORDS[s.words[i] % WORDS.length]} ${i + 1}|${box ? s.checked[i] : null}`);
    const child = s.indent === 'tab' ? `${indent}\t` : s.indent === '4' ? `${indent}    ` : `${indent}${' '.repeat(marker.length + 1)}`;
    indents.length = d + 1;
    indents[d + 1] = child;
  }
  return { lines, outline };
}
function noteOf(s: Spec): { text: string; callout: string; outline: string[] } {
  const { lines, outline } = listOf(s);
  const head = `> [!${s.spelling}]${s.fold}${s.title ? ` ${s.nfd ? s.title.normalize('NFD') : s.title}` : ''}`;
  const callout = [head, ...lines.map((l) => `> ${l}`)].join('\n');
  let text = '---\nid: 01JBMM0000000000000000P001\ntype: page\ntitle: Náhodná mapa\nmodified: 2026-10-01T09:00:00+02:00\n---\nÚvod.\n\n' + callout;
  if (s.trailing) text += '\n\nZávěr.';
  if (s.finalNewline) text += '\n';
  if (s.crlf) text = text.replace(/\n/g, '\r\n');
  return { text, callout: s.crlf ? callout.replace(/\n/g, '\r\n') : callout, outline };
}

type Item = { inline: { k: string; text?: string; target?: string }[]; checked: boolean | null; children: Item[] };
const plain = (i: Item) => i.inline.map((r) => r.text ?? r.target ?? '').join('').normalize('NFC');
function outlineOf(items: Item[], level = 1): string[] {
  return items.flatMap((i) => [`${level}:${plain(i)}|${i.checked}`, ...outlineOf(i.children, level + 1)]);
}

async function doc() {
  return import('@tegg/doc');
}

test('fr_fmt_07_ac24_c_load_save_identity_and_a_one_item_edit_stays_inside_the_callout', { timeout: 600_000 }, async () => {
  const m = await editorModule();
  const { parse, mindmapTree } = await doc();
  const failures: string[] = [];
  for (const seed of SEEDS) {
    await fc.assert(
      fc.asyncProperty(specArb, fc.nat(1000), async (s, pick) => {
        const mark = failures.length;
        const { text, callout, outline } = noteOf(s);
        const blocks = parse(text).blocks;
        const k = blocks.findIndex((b) => b.raw === callout);
        if (k !== 1 || blocks[1].kind !== 'mindmap') failures.push(`not read as one mindmap block: ${JSON.stringify(blocks.map((b) => b.kind))}`);
        const t0 = mindmapTree(callout, 'Náhodná mapa') as any;
        if (!t0 || JSON.stringify(outlineOf(t0.items)) !== JSON.stringify(outline)) failures.push(`tree ≠ generated outline: ${JSON.stringify(t0 && outlineOf(t0.items))}`);
        const ed = (m.createEditor as any)({ text, now: () => NOW, newId });
        const noEdit = await ed.save();
        if (noEdit !== null && noEdit !== text) failures.push('load + save without edits changed the bytes');
        // Edit item `pick % n` (outline order): ' x' at the end of its first paragraph.
        const items: { pos: number }[] = [];
        ed.view.state.doc.descendants((n: any, p: number) => {
          if (/item/i.test(n.type.name) && n.firstChild?.isTextblock) items.push({ pos: p + 2 + n.firstChild.content.size });
          return true;
        });
        const n = outline.length;
        if (items.length !== n) { failures.push(`the editor shows ${items.length} items, the list has ${n}`); ed.destroy(); return false; }
        const target = pick % n;
        ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, items[target].pos)));
        type(ed, ' x');
        const out: string | null = await ed.save();
        ed.destroy();
        if (!out) { failures.push('the edit wrote nothing'); return false; }
        const start = text.indexOf(callout);
        const end = start + callout.length;
        const frontEnd = text.indexOf('Úvod.');
        const pre = text.slice(frontEnd, start);
        const post = text.slice(end);
        if (!out.endsWith(post)) failures.push('bytes after the callout changed');
        const outStart = out.indexOf(pre);
        if (outStart < 0) failures.push('bytes between the frontmatter and the callout changed');
        const newCallout = out.slice(outStart + pre.length, out.length - post.length);
        const t1 = mindmapTree(newCallout, 'Náhodná mapa') as any;
        const want = outline.map((l, i) => (i === target ? l.replace(/\|/, ' x|') : l));
        if (!t1 || JSON.stringify(outlineOf(t1.items)) !== JSON.stringify(want)) failures.push(`edit of item ${target + 1} reads back as ${JSON.stringify(t1 && outlineOf(t1.items))}`);
        if (failures.length > mark) failures.push(`case: ${JSON.stringify(text)}`);
        return failures.length === mark;
      }),
      { seed, numRuns: RUNS, endOnFailure: true },
    ).catch((e) => failures.push(String(e).split('\n').slice(0, 6).join('\n')));
  }
  assert.deepEqual(failures.slice(0, 6), [], `${failures.length} failures`);
});

test('fr_fmt_07_ac24_c_untitled_wrap_then_unwrap_returns_the_original_list', { timeout: 600_000 }, async () => {
  const { wrapMindmap, unwrapMindmap, parse } = await doc();
  const failures: string[] = [];
  for (const seed of SEEDS) {
    try {
      fc.assert(
      fc.property(specArb, (s) => {
        const { lines } = listOf(s);
        const list = lines.join('\n');
        if (parse(list).blocks.length !== 1) return true; // the generated list is one block (guard)
        const w = wrapMindmap([list], []);
        if (!w.startsWith('> [!mindmap]\n')) failures.push(`wrap: ${JSON.stringify(w)}`);
        const back = unwrapMindmap(w, 'keep');
        if (back !== list) failures.push(`unwrap(wrap(${JSON.stringify(list)})) = ${JSON.stringify(back)}`);
        return back === list;
      }),
      { seed, numRuns: RUNS * 5, endOnFailure: true },
      );
    } catch (e) {
      failures.push(String(e).split('\n').slice(0, 6).join('\n'));
    }
  }
  assert.deepEqual(failures.slice(0, 6), [], `${failures.length} failures`);
});
// The layout part of (c) is app/test/mindmap_property.ac.test.ts (the layout module lives in app/ui).
