// MS4 slice 4F, L2 property (AR-06): FR-FMT-07 AC-15. Random host bodies made of round-trip-corpus blocks plus 1…5
// sole-embed paragraphs of every form (`![[T]]`, `![[T|alias]]`, `![[T|card]]`, `![[T#Heading]]`, `![[T#^id]]`, NFD
// targets) and a table cell with `\|`, edited with the editor operations of FR-FMT-07 AC-10 on non-embed blocks and
// with moves, duplicates and deletes of embed blocks, saved through the real @tegg/doc: every embed line not deleted
// is byte-identical, untouched blocks are byte-identical, and the result reads back with the same block embeds.
// docs/acceptance/embeds.md FR-FMT-07 AC-15; docs/contracts/ms4-embeds.md §7 (`EditorUi.embed`, `selectBlockAt`,
// embed blocks keep their bytes through moves, duplicates and deletes). Written from the ACs and the contract only
// (D-61). Seeds: a fixed seed plus QA_SEED (TS-L2); more runs with EDITOR_PROPERTY_RUNS.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { blocksRaw, corpus, editorModule, NOW, newId } from './helpers';

const NFD_CIL = 'Cíl';
const EMBEDS = [
  '![[Cíl]]', '![[Cíl|jiný text]]', '![[Cíl|card]]', '![[Cíl|LINK]]', '![[Jana Nováková|full]]', '![[Cíl#Úvod]]',
  '![[Cíl#^blok1]]', `![[${NFD_CIL}]]`, `![[${NFD_CIL}#Úvod]]`, '![[Svíčková|link]]',
];
const isEmbedLine = (raw: string) => /^!\[\[[^\]\n]+\]\]$/.test(raw);
const FRONT = '---\nid: 01JB4F0000000000000000P001\ntype: page\ntitle: Hostitel\nmodified: 2026-10-01T09:00:00+02:00\n---\n';
const OWN = [
  'Odstavec s háčky a čárkami: příliš žluťoučký kůň.',
  '## Nadpis sekce',
  '| Sloupec | Vložení |\n| --- | --- |\n| řádek | ![[Cíl\\|card]] |',
  '> Citace s ![[Cíl]] uvnitř.',
  '- položka jedna\n- položka ![[Jana Nováková]]',
  '```\n![[Cíl]] v kódu\n```',
];

/** Non-embed blocks of the corpus that survive being joined with blank lines (checked again per case). */
async function pool(): Promise<string[]> {
  const { parse } = await import('@tegg/doc');
  const out = new Set<string>(OWN);
  for (const [, text] of corpus()) {
    for (const b of parse(text).blocks) {
      if (!['paragraph', 'heading', 'quote', 'code', 'table', 'list'].includes(b.kind)) continue;
      if (b.raw.length > 400 || isEmbedLine(b.raw) || /^\s|\r|\t/.test(b.raw)) continue;
      out.add(b.raw);
      if (out.size > 60) break;
    }
  }
  return [...out];
}

type Rec = { embeds: string[] };
function ui(rec: Rec) {
  return {
    resolve: () => ({ kind: 'note' as const, path: 'Pages/Cíl.md', type: 'page', title: 'Cíl' }),
    unresolved: (t: string) => `No note named ${t}`,
    sourceBlock: 'Source block',
    hint: 'Type / for commands',
    placeholder: (kind: string, value: string) => ({ name: `${kind} ${value}`, text: value }),
    onLink: () => {},
    onTag: () => {},
    onExternal: () => {},
    embed: (source: string) => {
      rec.embeds.push(source);
      return { update: () => {}, selected: () => {}, destroy: () => {} };
    },
    embedChip: (value: string) => ({ title: value, type: 'page', state: 'ok' as const, description: 'Embedded note' }),
  };
}
async function openRec(text: string): Promise<{ ed: any; rec: Rec }> {
  const m = await editorModule();
  const rec: Rec = { embeds: [] };
  const ed = (m.createEditor as any)({ text, now: () => NOW, newId, ui: ui(rec) });
  return { ed, rec };
}
function countLines(lines: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1);
  return m;
}
const bodyBlocks = async (text: string) => blocksRaw(text);
/** Combining marks made visible in failure messages (NFD vs NFC). */
const esc = (v: unknown) => JSON.stringify(v).replace(/[\u0300-\u036f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/**
 * The saved body blocks match the model, allowing only the D-67 exceptions where two lists meet: a `<!-- -->` line
 * between two lists (D-1020), or one of the lists written with another marker and its items' text unchanged.
 */
const SEPARATOR = '<!-- -->';
const isList = (raw: string | undefined) => raw !== undefined && /^(?:[-*+]|\d+[.)])[ \t]/.test(raw);
const markersOff = (raw: string) => raw.replace(/^([ \t]*)[-*+](?=[ \t])/gm, '$1-').replace(/^([ \t]*)(\d+)[.)](?=[ \t])/gm, '$1$2.');
function sameUnderD67(after: string[], model: string[]): boolean {
  const kept = after.filter((r, k) => !(r === SEPARATOR && isList(after[k - 1]) && isList(after[k + 1])) || model.includes(SEPARATOR));
  if (kept.length !== model.length) return false;
  return kept.every((r, k) => r === model[k] || (isList(r) && (isList(model[k - 1]) || isList(model[k + 1])) && markersOff(r) === markersOff(model[k])));
}

const RUNS = Number(process.env.EDITOR_PROPERTY_RUNS ?? 100);
const SEEDS = [20261017, Number(process.env.QA_SEED ?? 0) || 11];

type Cmd = { kind: 'op' | 'move' | 'dup' | 'del'; a: number; b: number; c: number };

test('fr_fmt_07_ac15_property_embed_lines_survive_editing_byte_for_byte', async () => {
  const m = await editorModule();
  const blocks = await pool();
  assert.ok(blocks.length >= 10, `setup: block pool from the corpus (${blocks.length})`);
  // Red guard (4F): the block embeds of a host are rendered through EditorUi.embed, and selectBlockAt exists.
  {
    const { ed, rec } = await openRec(`${FRONT}Před.\n\n![[Cíl|card]]\n\n${`![[${NFD_CIL}]]`}\n`);
    assert.deepEqual(rec.embeds, ['![[Cíl|card]]', `![[${NFD_CIL}]]`], 'every sole-embed paragraph is a block embed (EditorUi.embed)');
    assert.equal(ed.commands.selectBlockAt(1), true, 'selectBlockAt selects an embed block');
    ed.destroy();
  }
  const cmd = fc.record({ kind: fc.constantFrom<'op' | 'move' | 'dup' | 'del'>('op', 'op', 'move', 'dup', 'del'), a: fc.nat(1000), b: fc.nat(1000), c: fc.nat(1000) });
  const failures: string[] = [];
  for (const seed of SEEDS) {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.nat(blocks.length - 1), { minLength: 1, maxLength: 6 }),
        fc.array(fc.nat(EMBEDS.length - 1), { minLength: 1, maxLength: 5 }),
        fc.array(fc.nat(100), { minLength: 5, maxLength: 5 }),
        fc.array(cmd, { minLength: 1, maxLength: 12 }),
        async (bi, ei, slots, cmds) => {
          // Interleave the embed paragraphs among the corpus blocks.
          const seq: string[] = bi.map((i) => blocks[i]);
          ei.forEach((e, k) => seq.splice(slots[k] % (seq.length + 1), 0, EMBEDS[e]));
          const text = `${FRONT}${seq.join('\n\n')}\n`;
          const mark = failures.length;
          const parsed = await bodyBlocks(text);
          fc.pre(parsed.length === seq.length && parsed.every((r, i) => r === seq[i]));
          const { ed, rec } = await openRec(text);
          if (JSON.stringify(rec.embeds) !== JSON.stringify(seq.filter(isEmbedLine))) {
            failures.push(`embeds rendered ${esc(rec.embeds)} for ${esc(seq.filter(isEmbedLine))}`);
            ed.destroy();
            return false;
          }
          // Phase 1: moves, duplicates and deletes of embed blocks against an exact model of the body blocks.
          // Phase 2: editor operations on non-embed blocks; then only the multiset of embed lines is known.
          const ordered = [...cmds.filter((c) => c.kind !== 'op'), ...cmds.filter((c) => c.kind === 'op')];
          let model: string[] | null = [...seq];
          const expected = countLines(seq.filter(isEmbedLine));
          for (const c of ordered) {
            const n = ed.view.state.doc.childCount;
            if (c.kind === 'op') {
              const cur = await bodyBlocks(ed.text());
              if (cur.length !== n) continue; // can't map editor blocks to body blocks now: skip
              const others = cur.map((r, k) => (isEmbedLine(r) ? -1 : k)).filter((k) => k >= 0);
              if (!others.length) continue;
              const k = others[c.a % others.length];
              const op = m.OPERATIONS[c.b % m.OPERATIONS.length];
              if (ed.readonlyBlocks().includes(k)) continue;
              // Never join a block with an embed: that would edit the embed line.
              if (op === 'joinWithNext' && isEmbedLine(cur[k + 1] ?? '')) continue;
              if (m.applyOperation(ed, op, k)) model = null;
              continue;
            }
            if (!model || model.length !== n) { failures.push(`editor has ${n} blocks, model ${model?.length}`); ed.destroy(); return false; }
            const embedIdx = model.map((r, k) => (isEmbedLine(r) ? k : -1)).filter((k) => k >= 0);
            if (!embedIdx.length) continue;
            const k = embedIdx[c.a % embedIdx.length];
            const line = model[k];
            if (c.kind === 'move') {
              const before = c.b % (n + 1);
              if (before === k || before === k + 1) continue;
              if (!ed.commands.moveBlocksTo(k, k, before)) { failures.push(`moveBlocksTo(${k},${k},${before}) refused`); ed.destroy(); return false; }
              model.splice(k, 1);
              model.splice(before > k ? before - 1 : before, 0, line);
            } else if (c.kind === 'dup') {
              if (!ed.commands.selectBlockAt(k) || !ed.commands.duplicateBlock()) { failures.push(`duplicate ${k} refused`); ed.destroy(); return false; }
              model.splice(k + 1, 0, line);
              expected.set(line, (expected.get(line) ?? 0) + 1);
            } else {
              if (!ed.commands.selectBlockAt(k) || !ed.commands.deleteBlocks()) { failures.push(`delete ${k} refused`); ed.destroy(); return false; }
              model.splice(k, 1);
              expected.set(line, (expected.get(line) ?? 0) - 1);
            }
          }
          const out = (await ed.save()) ?? text;
          ed.destroy();
          const after = await bodyBlocks(out);
          const got = countLines(after.filter(isEmbedLine));
          const want = new Map([...expected].filter(([, v]) => v > 0));
          const same = got.size === want.size && [...want].every(([k, v]) => got.get(k) === v);
          if (!same) failures.push(`embed lines ${esc([...got])}, want ${esc([...want])}`);
          if (model && !sameUnderD67(after, model)) failures.push(`blocks ${esc(after)}, want ${esc(model)}`);
          if (!out.startsWith('---\nid: 01JB4F0000000000000000P001\ntype: page\ntitle: Hostitel\n')) failures.push('frontmatter changed');
          const back = await openRec(out);
          const reread = JSON.stringify(back.rec.embeds) === JSON.stringify(after.filter(isEmbedLine));
          back.ed.destroy();
          if (!reread) failures.push('reads back with different block embeds');
          if (failures.length > mark) failures.push(`case: ${esc(seq)} cmds ${JSON.stringify(cmds)}`);
          return failures.length === mark;
        },
      ),
      { seed, numRuns: RUNS, endOnFailure: true },
    ).catch((e) => failures.push(String(e).split('\n').slice(0, 6).join('\n')));
  }
  assert.deepEqual(failures.slice(0, 5), [], `${failures.length} failures`);
});
