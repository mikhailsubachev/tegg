// QA review of slice G3 (graph presets in `.tegg/graph.yml`, R118 write rules, contract v1-graph §16.1, §16.6, §16.10):
// the fake core's TypeScript twin (ui/test/fake-presets.ts) gives the same bytes or the same refusal as the Rust module
// on the regression cases of crates/tegg-core/tests/bug_qag3_graph_yml.rs (FR-GRP-02, FR-FMT-07; D-1122, D-1124):
// comment lines inside an item or a block value behave like blank lines, `version: 1` goes after a BOM, directives and
// `---`, a file with several documents or a flow item is never patched, `presets: ~` is refused, a key the scanner
// can't find is refused rather than written twice, and every write is parsed back first (aliases).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { presetsPatch, presetsRead } from '../../ui/test/fake-presets';
import type { PresetOpDto } from '../../ui/src/graph/types';

const ORDER = ['page', 'task', 'quick-note', 'daily-note', 'cesta', 'osoba', 'projekt', 'schůzka', 'image', 'pdf', 'tag', 'recept'];
const save = (name: string, hiddenTypes: string[] = [], hiddenKinds: string[] = []): PresetOpDto => ({ op: 'save', name, hiddenTypes, hiddenKinds });
const update = (name: string, hiddenTypes: string[] = [], hiddenKinds: string[] = []): PresetOpDto => ({ op: 'update', name, hiddenTypes, hiddenKinds });
const rename = (from: string, to: string): PresetOpDto => ({ op: 'rename', from, to });
const del = (name: string): PresetOpDto => ({ op: 'delete', name });

function written(start: string, op: PresetOpDto, want: string, what: string) {
  const r = presetsPatch(start, op, ORDER);
  assert.ok(!('error' in r), `${what}: answered ${JSON.stringify(r)}`);
  assert.equal((r as { text: string }).text, want, `${what}: the file afterwards`);
  assert.equal(presetsRead(want).state, 'ok', `${what}: the written file reads as ok`);
}
function refused(start: string, op: PresetOpDto, what: string) {
  const r = presetsPatch(start, op, ORDER);
  assert.ok('error' in r && r.error.kind === 'Unreadable', `${what}: refused with Unreadable, got ${JSON.stringify(r)}`);
}

const REPRO_1 = 'version: 1\npresets:\n  - name: A\n#    hidden-types: [tag]\n    hidden-kinds: []\n  - name: B\n    hidden-types: []\n    hidden-kinds: []\n';
const REPRO_2 = 'version: 1\npresets:\n  - name: A\n    hidden-types:\n      - tag\n    #  - page\n      - kniha\n    hidden-kinds: []\n  - name: B\n    hidden-types: []\n    hidden-kinds: []\n';
const ITEM_A = 'presets:\n  - name: A\n    hidden-types: []\n    hidden-kinds: []\n';

test('bug_qag3_fr_grp_02_twin_delete_keeps_an_item_whole_across_a_shallow_comment', () => {
  written(REPRO_1, del('A'), 'version: 1\npresets:\n  - name: B\n    hidden-types: []\n    hidden-kinds: []\n', 'delete A');
  written(REPRO_1, update('A', ['tag']), 'version: 1\npresets:\n  - name: A\n#    hidden-types: [tag]\n    hidden-kinds: []\n    hidden-types: [tag]\n  - name: B\n    hidden-types: []\n    hidden-kinds: []\n', 'update A');
});

test('bug_qag3_fr_grp_02_twin_update_replaces_a_block_list_across_a_comment_at_the_key_column', () => {
  assert.deepEqual(presetsRead(REPRO_2).presets[0], { name: 'A', hiddenTypes: ['tag', 'kniha'], hiddenKinds: [] });
  written(REPRO_2, update('A', ['page']), 'version: 1\npresets:\n  - name: A\n    hidden-types: [page]\n    hidden-kinds: []\n  - name: B\n    hidden-types: []\n    hidden-kinds: []\n', 'update A');
});

test('bug_qag3_fr_grp_02_twin_comments_after_the_last_content_line_stay', () => {
  const start = 'version: 1\npresets:\n  - name: A\n    hidden-types: []\n    hidden-kinds: []\n    # about the next one\n  - name: B\n    hidden-types:\n      - tag\n      # end of the list\n    hidden-kinds: []\n';
  written(start, del('A'), 'version: 1\npresets:\n    # about the next one\n  - name: B\n    hidden-types:\n      - tag\n      # end of the list\n    hidden-kinds: []\n', 'delete A');
  written(start, update('B', ['page']), 'version: 1\npresets:\n  - name: A\n    hidden-types: []\n    hidden-kinds: []\n    # about the next one\n  - name: B\n    hidden-types: [page]\n      # end of the list\n    hidden-kinds: []\n', 'update B');
});

test('bug_qag3_fr_grp_02_twin_version_goes_after_a_document_start_directives_and_a_bom', () => {
  written(`---\n${ITEM_A}`, rename('A', 'B'), '---\nversion: 1\npresets:\n  - name: B\n    hidden-types: []\n    hidden-kinds: []\n', 'after ---');
  written(`%YAML 1.2\n---\n# h\n${ITEM_A}`, rename('A', 'B'), '%YAML 1.2\n---\n# h\nversion: 1\npresets:\n  - name: B\n    hidden-types: []\n    hidden-kinds: []\n', 'after %YAML, ---, comment');
  written(`﻿# h\n${ITEM_A}`, rename('A', 'B'), '﻿# h\nversion: 1\npresets:\n  - name: B\n    hidden-types: []\n    hidden-kinds: []\n', 'BOM, comment');
  written(`﻿${ITEM_A}`, del('A'), '﻿version: 1\npresets: []\n', 'BOM, then presets');
});

test('bug_qag3_fr_grp_02_twin_a_file_with_several_documents_is_never_patched', () => {
  for (const start of [`version: 1\n${ITEM_A}---\nother: 1\n`, `version: 1\n${ITEM_A}...\n`, `---\nversion: 1\n${ITEM_A}---\n`]) {
    const read = presetsRead(start);
    assert.equal(read.state, 'ok', `${JSON.stringify(start)}: listed as the core lists it (D-1122)`);
    assert.deepEqual(read.presets.map((p) => p.name), ['A'], `${JSON.stringify(start)}: lists A`);
    for (const op of [save('C'), update('A', ['tag']), rename('A', 'B'), del('A')]) refused(start, op, `${JSON.stringify(start)} ${op.op}`);
  }
});

test('bug_qag3_fr_grp_02_twin_a_write_that_breaks_an_alias_is_refused', () => {
  const start = 'version: 1\npresets:\n  - name: A\n    hidden-types: &t [tag]\n    hidden-kinds: []\n  - name: B\n    hidden-types: *t\n    hidden-kinds: []\n';
  refused(start, del('A'), 'delete A');
  refused(start, update('A', ['page']), 'update A');
  written(start, update('B', ['page']), 'version: 1\npresets:\n  - name: A\n    hidden-types: &t [tag]\n    hidden-kinds: []\n  - name: B\n    hidden-types: [page]\n    hidden-kinds: []\n', 'update B');
});

test('bug_qag3_fr_grp_02_twin_presets_null_is_refused', () => {
  refused('version: 1\npresets: ~\n', save('A'), 'presets: ~');
  refused('version: 1\npresets: null\n', save('A'), 'presets: null');
});

test('bug_qag3_fr_grp_02_twin_a_flow_item_makes_every_write_refused', () => {
  const start = 'version: 1\npresets:\n  - {name: A, hidden-types: [], hidden-kinds: []}\n  - name: B\n    hidden-types: []\n    hidden-kinds: []\n';
  for (const op of [save('C'), update('B', ['tag']), rename('B', 'D'), del('B'), del('A')]) refused(start, op, op.op);
});

test('bug_qag3_fr_grp_02_twin_a_quoted_key_is_patched', () => {
  const start = 'version: 1\npresets:\n  - "name": A\n    \'hidden-types\': [tag]\n    hidden-kinds: []\n';
  written(start, rename('A', 'B'), 'version: 1\npresets:\n  - "name": B\n    \'hidden-types\': [tag]\n    hidden-kinds: []\n', 'rename');
  written(start, update('A', ['page']), 'version: 1\npresets:\n  - "name": A\n    \'hidden-types\': [page]\n    hidden-kinds: []\n', 'update');
});

test('bug_qag3_fr_grp_02_twin_a_key_the_scanner_misses_is_refused_not_written_twice', () => {
  // YAML reads `hidden-types` (a tagged key) but the scanner can't find it: refused, as the core's `old_has` check.
  const start = 'version: 1\npresets:\n  - name: A\n    !!str hidden-types: [tag]\n    hidden-kinds: []\n';
  assert.deepEqual(presetsRead(start).presets[0], { name: 'A', hiddenTypes: ['tag'], hiddenKinds: [] });
  refused(start, update('A', ['page']), 'update A');
});
