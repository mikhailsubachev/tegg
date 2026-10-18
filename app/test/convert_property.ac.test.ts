// @vitest-environment jsdom
// MS5 slice 5A-2, L2 property (AR-06, T1): docs/acceptance/conversion.md FR-FMT-07 AC-20. For random host bodies made
// of round-trip-corpus kinds of blocks (paragraphs of one and two lines, headings, bulleted, checklist and numbered
// lists with nested items, quotes, callouts, code fences, tables, embeds, NFD text; LF and CRLF, with and without a
// final newline, BOM and frontmatter) and a random contiguous run of top-level blocks or top-level list items, or one
// nested item, converted into a random target type:
//   (1) every host byte outside the converted run is unchanged, apart from the inserted embed paragraph and its
//       separating blank lines (line endings stay the host's; BOM and final-newline state kept);
//   (2) the new object's body contains every converted block's bytes in order (the title line, markers and the
//       de-indentation of R51 excepted) and `newObject` writes exactly that body;
//   (3) undo of the editor's conversion step gives the original host body byte for byte, reports the record (the app
//       then deletes the new file), and leaves nothing to save;
//   (4) at most two files are written: the new object (create) and the host (its save); undo touches the same two.
// On `@tegg/doc` (§11.1 helpers, `newObject` with `body`) and `@tegg/editor` (`convertUnit`, undo, `afterUndo`)
// with real ProseMirror transactions (docs/contracts/ms5-tasks.md §11.1…§11.3, §11.8). The fake core of the contract
// is Playwright-bound (installFakeCore takes a page), so (4) counts the writes the flow sends here: `note_create` of the
// record's path and the host's non-null saves (see the red-test report). Synthetic Czech text (D-50).
//
// Seeds (TS-L2): a fixed seed plus `QA_SEED` when set; `QA_PROPERTY_SCALE` ≥ 100 (nightly) runs 1,000 cases per seed.
// fast-check generates the case seed and reports it on failure; each host comes from a seeded PRNG (mulberry32).
// Written from the AC and the contract only (D-61). Modules load inside the test (TS-I1).
import { test } from 'vitest';
import fc from 'fast-check';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function load(which: 'doc' | 'editor', ...names: string[]): Promise<Mod> {
  const path = `packages/${which}/src/index.ts`;
  let m: Mod | null = null;
  let why = '';
  try {
    m = (which === 'doc' ? await import('../../packages/doc/src/index.ts') : await import('../../packages/editor/src/index.ts')) as Mod;
  } catch (e) {
    why = String((e as Error)?.message ?? e).split('\n')[0];
  }
  assert.ok(m, `${path} loads: ${why}`);
  for (const n of names) assert.equal(typeof m![n], 'function', `${path} exports ${n}`);
  return m!;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['Zavolat', 'Janě', 'koupit', 'žluťoučký', 'kůň', 'úkol', 'schůzka', 'účet', 'příští', 'týden', 'řeka', 'dárek'];
const NOW = '2026-10-14T12:00:00+02:00';
type Kind = 'para' | 'para2' | 'heading' | 'quote' | 'callout' | 'code' | 'table' | 'embed' | 'nfd' | 'bullet' | 'check' | 'numbered';
/** One host line: its text and what it belongs to (block index, top-level item index, nested child index). */
type Line = { text: string; block: number; item: number; child: number };
type Block = { kind: Kind; lines: Line[]; items: number };
type Host = { text: string; eol: string; blocks: Block[]; lineStart: number[]; lines: Line[]; bodyLine: number };

function genHost(rnd: () => number): Host {
  const int = (k: number) => Math.floor(rnd() * k);
  const pick = <T,>(xs: readonly T[]) => xs[int(xs.length)];
  const words = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(' ');
  const sentence = () => { const s = words(2 + int(4)); return s[0].toUpperCase() + s.slice(1) + '.'; };
  const kinds: Kind[] = ['para', 'para2', 'heading', 'quote', 'callout', 'code', 'table', 'embed', 'nfd', 'bullet', 'check', 'numbered'];
  const nBlocks = 1 + int(6);
  const blocks: Block[] = [];
  const lines: Line[] = [];
  const front = rnd() < 0.9;
  const fm = front ? ['---', 'id: 01JB5A0000000000000000P001', 'type: page', 'title: Hostitel', 'created: 2026-10-01T09:00:00+02:00', 'modified: 2026-10-01T09:00:00+02:00', '---'] : [];
  for (const t of fm) lines.push({ text: t, block: -1, item: -1, child: -1 });
  const bodyLine = lines.length;
  for (let b = 0; b < nBlocks; b++) {
    if (b > 0) lines.push({ text: '', block: -1, item: -1, child: -1 });
    // Two lists separated only by a blank line would be one list in CommonMark: a list never follows a list.
    let kind = pick(kinds);
    while (b > 0 && blocks[b - 1].items > 0 && ['bullet', 'check', 'numbered'].includes(kind)) kind = pick(kinds);
    const own: Line[] = [];
    const add = (text: string, item = -1, child = -1) => own.push({ text, block: b, item, child });
    let items = 0;
    switch (kind) {
      case 'para': add(sentence()); break;
      case 'para2': add(words(3)); add(words(2) + '.'); break;
      case 'heading': add(`${'#'.repeat(1 + int(3))} ${words(2)}`); break;
      case 'quote': add(`> ${sentence()}`); break;
      case 'callout': add(`> [!note]`); add(`> ${sentence()}`); add(`> ${words(2)}`); break;
      case 'code': add('```js'); add(`${pick(WORDS)}();`); add('```'); break;
      case 'table': add('| A | B |'); add('| --- | --- |'); add(`| ${pick(WORDS)} | ${pick(WORDS)} |`); break;
      case 'embed': add(`![[${pick(['Cíl', 'Zasedačka', 'Zavolat Janě'])}]]`); break;
      case 'nfd': add(sentence().normalize('NFD')); break;
      default: {
        items = 1 + int(4);
        for (let i = 0; i < items; i++) {
          const marker = kind === 'bullet' ? '- ' : kind === 'check' ? (rnd() < 0.3 ? '- [x] ' : '- [ ] ') : `${i + 1}. `;
          add(marker + words(2 + int(3)), i);
          if (kind !== 'numbered' && rnd() < 0.3) for (let c = 0; c < 1 + int(2); c++) add(`  - ${words(2)}`, i, c);
        }
      }
    }
    blocks.push({ kind, lines: own, items });
    lines.push(...own);
  }
  const eol = rnd() < 0.3 ? '\r\n' : '\n';
  const finalNl = rnd() < 0.8;
  const bom = rnd() < 0.1 ? '﻿' : '';
  const lineStart: number[] = [];
  let pos = bom.length;
  for (const l of lines) { lineStart.push(pos); pos += l.text.length + eol.length; }
  const text = bom + lines.map((l) => l.text).join(eol) + (finalNl ? eol : '');
  return { text, eol, blocks, lineStart, lines, bodyLine };
}

type Pick = { selFrom: number; selTo: number; from: number; to: number; kind: 'blocks' | 'items' | 'nested-item'; parts: string[][]; firstKind: Kind };
/** A random run and the unit it must give; `parts` are the converted blocks' lines (for check 2). */
function pickRun(h: Host, rnd: () => number): Pick {
  const p = pickRaw(h, rnd);
  return { ...p, selFrom: Math.min(p.selFrom, p.selTo), selTo: Math.max(p.selFrom, p.selTo) };
}
function pickRaw(h: Host, rnd: () => number): Pick {
  const int = (k: number) => Math.floor(rnd() * k);
  const idx = (pred: (l: Line) => boolean) => h.lines.map((l, i) => (pred(l) ? i : -1)).filter((i) => i >= 0);
  const inside = (li: number) => h.lineStart[li] + Math.min(h.lines[li].text.length, 1 + int(Math.max(1, h.lines[li].text.length)));
  const lineEnd = (li: number) => h.lineStart[li] + h.lines[li].text.length;
  const k = int(h.blocks.length);
  const b = h.blocks[k];
  const isList = b.items > 0;
  if (isList) {
    const withKids = Array.from({ length: b.items }, (_, i) => i).filter((i) => idx((l) => l.block === k && l.item === i && l.child >= 0).length > 0);
    if (withKids.length > 0 && rnd() < 0.3) {
      const i = withKids[int(withKids.length)];
      const kids = idx((l) => l.block === k && l.item === i && l.child >= 0);
      const li = kids[int(kids.length)];
      return { selFrom: inside(li), selTo: inside(li), from: h.lineStart[li], to: lineEnd(li), kind: 'nested-item', parts: [[h.lines[li].text]], firstKind: b.kind };
    }
    const i = int(b.items);
    const j = Math.min(b.items - 1, i + int(3));
    const first = idx((l) => l.block === k && l.item === i);
    const last = idx((l) => l.block === k && l.item === j);
    const parts = Array.from({ length: j - i + 1 }, (_, n) => idx((l) => l.block === k && l.item === i + n).map((li) => h.lines[li].text));
    return { selFrom: inside(first[0]), selTo: inside(last[0]), from: h.lineStart[first[0]], to: lineEnd(last[last.length - 1]), kind: 'items', parts, firstKind: b.kind };
  }
  let m = k;
  while (m + 1 < h.blocks.length && h.blocks[m + 1].items === 0 && m < k + 2 && rnd() < 0.5) m++;
  const first = idx((l) => l.block === k);
  const last = idx((l) => l.block === m);
  const parts = Array.from({ length: m - k + 1 }, (_, n) => idx((l) => l.block === k + n).map((li) => h.lines[li].text));
  return { selFrom: inside(first[0]), selTo: inside(last[0]), from: h.lineStart[first[0]], to: lineEnd(last[last.length - 1]), kind: 'blocks', parts, firstKind: b.kind };
}

const stripEol = (s: string, side: 'start' | 'end') => (side === 'end' ? s.replace(/(\r?\n)+$/, '') : s.replace(/^(\r?\n)+/, ''));
const nfc = (s: string) => s.normalize('NFC');

/** (2): the lines of every converted block after R51's title rule, in order, as they must appear in the body. */
function expectedPieces(kind: Pick['kind'], parts: string[][], firstKind: Kind): string[] {
  const out: string[] = [];
  parts.forEach((lines, n) => {
    if (n > 0) { out.push(nfc(lines.join('\n'))); return; }
    if (kind === 'nested-item') return; // a leaf: title only
    if (kind === 'items') {
      const kids = lines.slice(1).map((l) => l.replace(/^ {2}/, ''));
      if (kids.length) out.push(nfc(kids.join('\n')));
      return;
    }
    if (['code', 'table', 'embed'].includes(firstKind)) out.push(nfc(lines.join('\n')));
    else if (firstKind === 'para2') out.push(nfc(lines.slice(1).join('\n')));
    else if (firstKind === 'callout') out.push(nfc([lines[0], ...lines.slice(2)].join('\n')));
  });
  return out;
}

const scale = Number(process.env.QA_PROPERTY_SCALE ?? '1') || 1;
const RUNS = scale >= 100 ? 1000 : 100;
const SEEDS = [20261017, Number(process.env.QA_SEED ?? 0) || 7];
const TYPES = [
  { key: 'task', review: 'off', attributes: [{ key: 'status', type: 'select', options: [{ label: 'To do', color: 'gray', state: 'open' }, { label: 'Done', color: 'green', state: 'done' }] }] },
  { key: 'page', review: 'off', attributes: [] },
  { key: 'quick-note', review: 'locked', attributes: [] },
  { key: 'projekt', review: 'off', attributes: [{ key: 'due', type: 'date' }] },
];

test('fr_fmt_07_ac20_property_conversion_keeps_host_bytes_moves_blocks_and_undoes', async () => {
  const doc = await load('doc', 'conversionUnit', 'objectFromUnit', 'replaceUnitWithEmbed', 'newObject', 'parse');
  const editor = await load('editor', 'createEditor');
  const body = (t: string) => t.slice(doc.parse(t).bodyStart);
  for (const seed of SEEDS) {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 0x7fffffff }), async (caseSeed) => {
        const rnd = mulberry32(caseSeed);
        const h = genHost(rnd);
        const p = pickRun(h, rnd);
        const ctx = `case ${caseSeed}:\n${JSON.stringify(h.text)}\nselection ${p.selFrom}…${p.selTo}`;
        const unit = doc.conversionUnit(h.text, p.selFrom, p.selTo);
        assert.ok(unit, `${ctx}\nconversionUnit gives a unit`);
        assert.deepEqual([unit.kind, unit.from, unit.to], [p.kind, p.from, p.to], `${ctx}\nthe unit is the run`);
        const target = `Nový objekt ${caseSeed % 1000}`;
        const r = doc.replaceUnitWithEmbed(h.text, unit, target);

        // (1) bytes outside the run, line endings, BOM, final newline.
        const lineStart = r.text.lastIndexOf('\n', r.embedFrom - 1) + 1;
        const nl = r.text.indexOf('\n', r.embedTo);
        const lineEnd = nl < 0 ? r.text.length : r.text[nl - 1] === '\r' ? nl - 1 : nl;
        const line = r.text.slice(lineStart, lineEnd);
        assert.equal(line, p.kind === 'nested-item' ? `  - ![[${target}]]` : `![[${target}]]`, `${ctx}\nthe embed line`);
        const before = h.text.slice(0, unit.from);
        const after = h.text.slice(unit.to);
        if (p.kind === 'nested-item') {
          assert.equal(r.text.slice(0, lineStart), before, `${ctx}\nbytes before the nested item`);
          assert.equal(r.text.slice(lineEnd), after, `${ctx}\nbytes after the nested item`);
        } else {
          assert.equal(stripEol(r.text.slice(0, lineStart), 'end'), stripEol(before, 'end'), `${ctx}\nbytes before the run`);
          assert.equal(stripEol(r.text.slice(lineEnd), 'start'), stripEol(after, 'start'), `${ctx}\nbytes after the run`);
          const sepBefore = r.text.slice(0, lineStart).match(/(\r?\n)*$/)![0];
          const sepAfter = r.text.slice(lineEnd).match(/^(\r?\n)*/)![0];
          if (unit.from !== h.lineStart[h.bodyLine]) assert.equal(sepBefore, h.eol + h.eol, `${ctx}\none blank line before the embed`);
          if (stripEol(after, 'start') !== '') assert.equal(sepAfter, h.eol + h.eol, `${ctx}\none blank line after the embed`);
        }
        if (h.eol === '\r\n') assert.ok(!/(^|[^\r])\n/.test(r.text), `${ctx}\nCRLF stays CRLF on every line`);
        assert.equal(r.text.startsWith('﻿'), h.text.startsWith('﻿'), `${ctx}\nBOM state`);
        assert.equal(r.text.endsWith('\n'), h.text.endsWith('\n'), `${ctx}\nfinal newline state`);

        // (2) the body holds the converted blocks in order; newObject writes it.
        const o = doc.objectFromUnit(h.text, unit, () => null);
        let at = 0;
        for (const piece of expectedPieces(p.kind, p.parts, p.firstKind)) {
          const i = o.body.indexOf(piece, at);
          assert.ok(i >= 0, `${ctx}\nthe body holds ${JSON.stringify(piece)} after offset ${at}:\n${JSON.stringify(o.body)}`);
          at = i + piece.length;
        }
        assert.ok(!o.body.includes('\r'), `${ctx}\nthe new file uses \\n`);
        assert.ok(o.body === '' || (o.body.endsWith('\n') && !o.body.endsWith('\n\n')), `${ctx}\nthe body ends with one \\n or is empty`);
        const type = TYPES[Math.floor(rnd() * TYPES.length)];
        const created: string = doc.newObject({ type, title: o.title || 'Bez názvu', template: null, now: NOW, newId: () => '01JB5A0000000000000000P999', values: [['source', { link: 'Hostitel' }]], body: o.body });
        assert.ok(created.endsWith('---\n' + o.body), `${ctx}\nnewObject writes the body after the frontmatter`);

        // (3) + (4) the editor's step, undo, and the writes.
        const writes = new Set<string>();
        const undone: string[] = [];
        const rec = { path: `${type.key}/${target}.md`, created, type: type.key, title: o.title || 'Bez názvu' };
        const ed = editor.createEditor({ text: h.text, now: () => NOW, newId: () => '01JB5A0000000000000000P998', conversion: { afterUndo: (x: any) => { undone.push(x.path); writes.add(x.path); }, beforeRedo: async () => false } });
        try {
          writes.add(rec.path); // note_create, before the source changes (D-498)
          const pos = ed.commands.convertUnit(unit, target, rec);
          assert.equal(typeof pos, 'number', `${ctx}\nconvertUnit applies`);
          assert.equal(body(ed.text()), body(r.text), `${ctx}\nthe editor holds the helper's text (D-82)`);
          const saved = await ed.save();
          assert.ok(saved !== null, `${ctx}\nthe host is saved`);
          writes.add('host');
          ed.markSaved(saved);
          assert.equal(await ed.save(), null, `${ctx}\none save`);
          assert.equal(ed.commands.undo(), true, `${ctx}\nundo`);
          await new Promise((res) => setTimeout(res, 0));
          assert.deepEqual(undone, [rec.path], `${ctx}\nafterUndo once with the new file`);
          const back = await ed.save();
          if (back !== null) writes.add('host');
          assert.equal(body(back ?? saved), body(h.text), `${ctx}\nundo gives the original body byte for byte`);
          assert.ok(writes.size <= 2, `${ctx}\nat most two files: ${[...writes].join(', ')}`);
        } finally {
          ed.destroy();
        }
        const ed2 = editor.createEditor({ text: h.text, now: () => NOW, newId: () => '01JB5A0000000000000000P997', conversion: { afterUndo: () => {}, beforeRedo: async () => false } });
        try {
          ed2.commands.convertUnit(unit, target, rec);
          ed2.commands.undo();
          assert.equal(await ed2.save(), null, `${ctx}\nundo without a save in between leaves nothing to write`);
        } finally {
          ed2.destroy();
        }
      }),
      { seed, numRuns: RUNS, endOnFailure: true },
    );
  }
}, 600_000);
