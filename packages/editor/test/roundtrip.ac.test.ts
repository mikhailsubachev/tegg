// FR-FMT-07 AC-10 (L1) and AC-11 (L2 property): every editor operation on every editable block of the round-trip
// corpus, saved through the real @tegg/doc, keeps every untouched block byte-identical (except the D-67 list-marker
// case, FR-EDT-01 AC-7) and reads back to the same editor content (ADR 0002 §5). FR-FMT-02 AC-5's engine part
// (identity keys on the first edit, D-54/D-174). docs/acceptance/editor.md; docs/contracts/ms3-shell.md §13.3
// (`OPERATIONS`, `applyOperation`). Property seeds: a fixed seed plus QA_SEED per run (TS-L2); more runs nightly with
// EDITOR_PROPERTY_RUNS.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { blocksRaw, caret, corpus, editorModule, editorNote, NOW, open, selectText, type, type TeggEditor } from './helpers';

/** Top-level editor content as [node type, text], blank paragraphs dropped (they are never written, AP-135). */
function shape(ed: TeggEditor): string[] {
  const out: string[] = [];
  ed.view.state.doc.forEach((n: any) => {
    if (n.type.name === 'paragraph' && n.textContent.trim() === '') return;
    out.push(`${n.type.name}:${n.textContent}`);
  });
  return out;
}

const swapMarkers = (raw: string) => raw.replace(/^(\s*)([-*])(?= )/gm, (_m, s, c) => s + (c === '-' ? '*' : '-'));

/** Original blocks outside `touched` that are missing from `out` (byte for byte, D-67 marker swap allowed). */
async function lostBlocks(orig: string, out: string, touched: Set<number>): Promise<string[]> {
  const before = await blocksRaw(orig);
  const after = await blocksRaw(out);
  const pool = [...after];
  const lost: string[] = [];
  before.forEach((raw, i) => {
    if (touched.has(i)) return;
    let j = pool.indexOf(raw);
    if (j < 0) j = pool.indexOf(swapMarkers(raw));
    if (j < 0) lost.push(`#${i} ${JSON.stringify(raw.slice(0, 60))}`);
    else pool.splice(j, 1);
  });
  return lost;
}

async function checkOnce(path: string, text: string, ed: TeggEditor, touched: Set<number>, what: string): Promise<string[]> {
  const out = await ed.save();
  if (out === null) return [];
  const problems: string[] = [];
  const lost = await lostBlocks(text, out, touched);
  if (lost.length) problems.push(`${path} ${what}: untouched blocks changed: ${lost.join(', ')}`);
  const back = await open(out);
  const a = shape(ed), b = shape(back);
  if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`${path} ${what}: reads back differently`);
  back.destroy();
  return problems;
}

test('fr_fmt_07_ac10_every_block_every_operation', async () => {
  const m = await editorModule();
  assert.ok(m.OPERATIONS.length >= 11, `OPERATIONS covers type, insert, delete, split, join, turn into list/heading/quote, move up/down, delete block; got ${m.OPERATIONS.join(', ')}`);
  const problems: string[] = [];
  let applied = 0;
  for (const [path, text] of corpus()) {
    const probe = await open(text);
    const n = probe.view.state.doc.childCount;
    const ro = new Set(probe.readonlyBlocks());
    probe.destroy();
    for (let k = 0; k < n; k++) {
      if (ro.has(k)) continue;
      for (const op of m.OPERATIONS) {
        const ed = await open(text);
        if (!m.applyOperation(ed, op, k)) { ed.destroy(); continue; }
        applied++;
        problems.push(...(await checkOnce(path, text, ed, new Set([k - 1, k, k + 1]), `${op}@${k}`)));
        ed.destroy();
      }
    }
  }
  assert.ok(applied > 500, `operations applied: ${applied}`);
  assert.deepEqual(problems.slice(0, 20), [], `${problems.length} problems`);
});

const RUNS = Number(process.env.EDITOR_PROPERTY_RUNS ?? 100);
const SEEDS = [20261013, Number(process.env.QA_SEED ?? 0) || 7];

test('fr_fmt_07_ac11_property_random_command_sequences', async () => {
  const m = await editorModule();
  const files = corpus();
  const extra = ['bold', 'italic', 'link', 'tag', 'pasteBlock', 'undo', 'redo'];
  const ops = [...m.OPERATIONS, ...extra];
  for (const seed of SEEDS) {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: files.length - 1 }),
        fc.array(fc.tuple(fc.integer({ min: 0, max: ops.length - 1 }), fc.nat(50)), { minLength: 1, maxLength: 20 }),
        async (fi, cmds) => {
          const [, text] = files[fi];
          const ed = await open(text);
          let applied = 0;
          for (const [oi, b] of cmds) {
            const n = ed.view.state.doc.childCount;
            if (n === 0) break;
            const k = b % n;
            const op = ops[oi];
            if (ed.readonlyBlocks().includes(k)) continue;
            if (op === 'undo') ed.commands.undo();
            else if (op === 'redo') ed.commands.redo();
            else if (op === 'bold' || op === 'italic') {
              const t = ed.view.state.doc.child(k).textContent as string;
              if (t.length > 1) { try { selectText(ed, k, t.slice(0, 2)); ed.commands.toggleMark(op); } catch { /* not a text block */ } }
            } else if (op === 'link') { caret(ed, k); ed.commands.insertLink({ path: 'Pages/Cíl.md', title: 'Cíl', fromPath: 'Pages/X.md', stemUnique: true }); }
            else if (op === 'tag') { caret(ed, k); ed.commands.insertTag('projekt'); }
            else if (op === 'pasteBlock') { caret(ed, k); const blocks = await blocksRaw(text); ed.commands.pasteText(blocks[b % Math.max(blocks.length, 1)] ?? 'Ž'); }
            else m.applyOperation(ed, op, k);
            applied++;
            // Indices shift after structural edits, so the property is: (a) the save reads back to the same editor
            // content, and (b) at most three original blocks (the edited one and its neighbours) are lost per command.
            const out = await ed.save();
            if (out === null) continue;
            const lost = await lostBlocks(text, out, new Set());
            const back = await open(out);
            const same = JSON.stringify(shape(ed)) === JSON.stringify(shape(back));
            back.destroy();
            if (!same || lost.length > 3 * applied) { ed.destroy(); return false; }
          }
          ed.destroy();
          return true;
        },
      ),
      { seed, numRuns: RUNS, endOnFailure: true },
    );
  }
});

test('fr_fmt_02_ac5_first_edit_adds_id_type_modified_only', async () => {
  const m = await editorModule();
  const ids = ['01JB0Z0000000000000000Z901', '01JB0Z0000000000000000Z902'];
  let i = 0;
  const bez = editorNote('Bez hlavičky');
  const ed = m.createEditor({ text: bez, now: () => NOW, newId: () => ids[i++] });
  caret(ed, 0);
  type(ed, ' Doplněno.');
  const out = await ed.save();
  assert.equal(out, `---\nid: ${ids[0]}\ntype: page\nmodified: ${NOW}\n---\n${bez.replace(/\n$/, '')} Doplněno.\n`, 'Bez hlavičky');
  ed.markSaved(out!);
  type(ed, ' Ještě.');
  const out2 = await ed.save();
  assert.match(out2 ?? '', new RegExp(`^---\\nid: ${ids[0]}\\n`), 'the id stays the same in later saves');

  const cizi = editorNote('Cizí hlavička');
  const ed2 = m.createEditor({ text: cizi, now: () => NOW, newId: () => ids[1] });
  caret(ed2, 0);
  type(ed2, ' Doplněno.');
  const out3 = await ed2.save();
  const fmEnd = cizi.indexOf('\n---\n', 4);
  const want = `${cizi.slice(0, fmEnd)}\nid: ${ids[1]}\ntype: page\nmodified: ${NOW}${cizi.slice(fmEnd).replace(/\n$/, '')} Doplněno.\n`;
  assert.equal(out3, want, 'Cizí hlavička: id, type, modified appended after the existing keys');
});
