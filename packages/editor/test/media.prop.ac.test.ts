// MS6 slice 6A, L2 property (AR-06, T1): FR-FMT-07 AC-22's editor half. Random notes made of round-trip-corpus
// blocks; media paragraphs (`![[<file>]]`) are inserted with `insertEmbeds` (paste, drop and the picker insert through
// it) at random blocks and removed again by selecting the media block and deleting it (⌫ on a selected block, D-428):
// the saved text changes only those paragraphs (every other block byte-identical, the frontmatter untouched), and
// removing every inserted paragraph gives the original body back. The other half (trash and restore return a file
// byte-identical with its mtime) is crates/tegg-core/tests/ac_trash_prop.rs. docs/acceptance/trash-media.md FR-FMT-07
// AC-22; docs/contracts/ms6-trash-media.md §6.1 (`insertEmbeds(view, embeds, pos?)`: one paragraph per item at `pos`,
// one transaction; the media block is an embed block). Written from the ACs and the contract only (D-61). Seeds: a
// fixed seed plus QA_SEED (TS-L2); more runs with EDITOR_PROPERTY_RUNS.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { blocksRaw, corpus, editorModule, NOW, newId } from './helpers';

const FRONT = '---\nid: 01JB6A0000000000000000P001\ntype: page\ntitle: Hostitel\nmodified: 2026-10-01T09:00:00+02:00\n---\n';
const FILES = ['záhon.png', 'Pasted image 20261022100000.png', 'Rozpočet 2026.pdf', 'IMG_1234.HEIC', '_attachments/osiřelý.jpg', 'Záhon 2.PNG'];
const isMedia = (raw: string) => /^!\[\[[^\]\n]+\.(png|PNG|pdf|HEIC|jpg)\]\]$/.test(raw);
const OWN = ['Odstavec s háčky a čárkami: příliš žluťoučký kůň.', '## Nadpis sekce', '> Citace s ![[záhon.png]] uvnitř.', '- položka jedna\n- položka dvě'];

async function pool(): Promise<string[]> {
  const { parse } = await import('@tegg/doc');
  const out = new Set<string>(OWN);
  for (const [, text] of corpus()) {
    for (const b of parse(text).blocks) {
      if (!['paragraph', 'heading', 'quote', 'code', 'table', 'list'].includes(b.kind)) continue;
      if (b.raw.length > 400 || isMedia(b.raw) || /^\s|\r|\t/.test(b.raw)) continue;
      out.add(b.raw);
      if (out.size > 60) break;
    }
  }
  return [...out];
}
function ui() {
  return {
    resolve: (t: string) => (/\.(png|pdf|heic|jpg)$/i.test(t) ? { kind: 'media' as const, path: `_attachments/${t}`, type: 'image', title: t } : undefined),
    unresolved: (t: string) => `No note named ${t}`,
    sourceBlock: 'Source block',
    hint: 'Type / for commands',
    placeholder: (kind: string, value: string) => ({ name: `${kind} ${value}`, text: value }),
    onLink: () => {},
    onTag: () => {},
    onExternal: () => {},
    media: () => {},
    embed: () => ({ update: () => {}, selected: () => {}, destroy: () => {} }),
  };
}
/** The text with its `modified:` line removed: every edit updates `modified` (D-174), D-632. */
const noMod = (t: string) => t.replace(/^modified: .*\n/m, '');
const esc = (v: unknown) => JSON.stringify(v).replace(/[̀-ͯ]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const RUNS = Number(process.env.EDITOR_PROPERTY_RUNS ?? 100);
const SEEDS = [20261022, Number(process.env.QA_SEED ?? 0) || 13];

test('fr_fmt_07_ac22_property_media_paragraphs_change_only_themselves', async () => {
  const m = (await editorModule()) as any;
  assert.equal(typeof m.insertEmbeds, 'function', '@tegg/editor exports insertEmbeds (ms6-trash-media §6.1)');
  const blocks = await pool();
  assert.ok(blocks.length >= 10, `setup: block pool from the corpus (${blocks.length})`);
  // Red guard: inserting one embed after block 0 gives exactly one new paragraph there.
  {
    const ed = m.createEditor({ text: `${FRONT}Před.\n\nPo.\n`, now: () => NOW, newId, ui: ui() });
    const pos = ed.view.state.doc.child(0).nodeSize;
    assert.equal(m.insertEmbeds(ed.view, ['záhon.png'], pos), true, 'insertEmbeds inserts');
    assert.equal(noMod((await ed.save()) ?? ''), noMod(`${FRONT}Před.\n\n![[záhon.png]]\n\nPo.\n`), 'one paragraph at pos');
    ed.destroy();
  }
  const failures: string[] = [];
  for (const seed of SEEDS) {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.nat(blocks.length - 1), { minLength: 1, maxLength: 6 }),
        fc.array(fc.record({ at: fc.nat(100), files: fc.array(fc.nat(FILES.length - 1), { minLength: 1, maxLength: 3 }) }), { minLength: 1, maxLength: 3 }),
        async (bi, inserts) => {
          const seq = bi.map((i) => blocks[i]);
          const text = `${FRONT}${seq.join('\n\n')}\n`;
          const parsed = await blocksRaw(text);
          fc.pre(parsed.length === seq.length && parsed.every((r, i) => r === seq[i]));
          const mark = failures.length;
          const ed = m.createEditor({ text, now: () => NOW, newId, ui: ui() });
          const model = [...seq];
          for (const ins of inserts) {
            const n = ed.view.state.doc.childCount;
            const k = ins.at % (n + 1);
            let pos = 0;
            for (let j = 0; j < k; j++) pos += ed.view.state.doc.child(j).nodeSize;
            const embeds = ins.files.map((f) => FILES[f]);
            if (!m.insertEmbeds(ed.view, embeds, pos)) { failures.push(`insertEmbeds at ${k} refused`); ed.destroy(); return false; }
            model.splice(k, 0, ...embeds.map((e) => `![[${e.normalize('NFC')}]]`));
          }
          const saved = (await ed.save()) ?? text;
          const got = await blocksRaw(saved);
          if (!noMod(saved).startsWith(noMod(FRONT))) failures.push('frontmatter changed beyond modified');
          if (JSON.stringify(got) !== JSON.stringify(model)) failures.push(`after insert: ${esc(got)}, want ${esc(model)}`);
          // Remove every inserted media paragraph again (select the block, delete).
          for (let k = ed.view.state.doc.childCount - 1; k >= 0; k--) {
            const raw = (await blocksRaw(ed.text?.() ?? saved))[k];
            if (raw === undefined || !isMedia(raw) || seq.includes(raw)) continue;
            if (!ed.commands.selectBlockAt(k) || !ed.commands.deleteBlocks()) { failures.push(`delete media block ${k} refused`); break; }
          }
          // Back at the loaded text, `save()` has nothing to write (null): read the editor's text then (D-632).
          const back = (await ed.save()) ?? ed.text();
          ed.destroy();
          if (JSON.stringify(await blocksRaw(back)) !== JSON.stringify(seq)) failures.push(`after removal: ${esc(await blocksRaw(back))}, want ${esc(seq)}`);
          if (failures.length > mark) failures.push(`case: ${esc(seq)} inserts ${JSON.stringify(inserts)}`);
          return failures.length === mark;
        },
      ),
      { seed, numRuns: RUNS, endOnFailure: true },
    ).catch((e) => failures.push(String(e).split('\n').slice(0, 6).join('\n')));
  }
  assert.deepEqual(failures.slice(0, 5), [], `${failures.length} failures`);
});
