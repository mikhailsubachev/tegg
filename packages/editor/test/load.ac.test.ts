// FR-EDT-01 AC-2 (L1): loading a note into @tegg/editor and unloading it never changes it (ADR 0002 §3); the
// normalization guard turns exactly the ragged table of `obsidian/04 Tables.md` into a read-only source block.
// docs/acceptance/editor.md; docs/contracts/ms3-shell.md §13.3 (`save()` returns null when nothing changed,
// `readonlyBlocks()`).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { corpus, editorFixture, open } from './helpers';

test('fr_edt_01_ac2_loading_never_changes_a_note', async () => {
  const files = [...corpus(), ...editorFixture()];
  assert.ok(files.length > 40, 'corpus and editor fixture found');
  const changed: string[] = [];
  for (const [path, text] of files) {
    const ed = await open(text);
    const out = await ed.save();
    if (out !== null) changed.push(path);
    ed.destroy();
  }
  assert.deepEqual(changed, [], 'save() after load must return null (no write) for every file');
});

test('fr_edt_01_ac2_normalization_guard_is_exactly_the_ragged_table', async () => {
  const { parse } = await import('@tegg/doc');
  const guarded: string[] = [];
  for (const [path, text] of corpus()) {
    const ed = await open(text);
    const blocks = parse(text).blocks;
    for (const i of ed.readonlyBlocks()) {
      const b = blocks[i];
      assert.ok(b, `${path}: readonlyBlocks() index ${i} is not a block of @tegg/doc parse`);
      // Raw blocks, embeds, queries and mindmaps are source blocks/placeholders by kind (FR-EDT-01 AC-8); the
      // normalization guard is about blocks of an editable kind the editor would rewrite on load.
      if (['raw', 'embed', 'query', 'mindmap'].includes(b.kind)) continue;
      guarded.push(`${path}#${i}:${b.kind}`);
    }
    ed.destroy();
  }
  assert.equal(guarded.length, 1, `exactly one guarded block in the corpus, got ${JSON.stringify(guarded)}`);
  assert.match(guarded[0], /obsidian\/04 Tables\.md#\d+:table$/, 'the ragged table of obsidian/04 Tables.md');
});
