// MS5 slice 5A-1 (D-512): the fake core's type-file ops (ui/test/fake-schema.ts) give the bytes of the shared corpus
// tests/fixtures/types/ops-5a.json, the corpus crates/tegg-schema/tests/ac_task_options.rs reads, so the L5 tests of
// FR-TSK-02 and FR-TSK-03 run against the same rules as the core (ms5-tasks §2.2, §7).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { handle } from '../ui/test/fake-schema';

const REPO = resolve(import.meta.dirname, '../..');
const corpus = JSON.parse(readFileSync(resolve(REPO, 'tests/fixtures/types/ops-5a.json'), 'utf8'));
const base: string = readFileSync(resolve(REPO, corpus.base), 'utf8');
const P = '.tegg/types/task.yml';
const V = { mtimeNs: '1', size: base.length, hash: 'corpus' };

/** Files for the `used` counts of a case: one task per use of a label. */
function vault(used: [string, number][] | undefined): Record<string, string> {
  const files: Record<string, string> = { [P]: base };
  let n = 0;
  for (const [label, count] of used ?? []) {
    const key = ['High', 'Medium', 'Low', 'None'].includes(label) ? 'priority' : 'status';
    for (let i = 0; i < count; i++) files[`Tasks/U${n++}.md`] = `---\ntype: task\ntitle: U${n}\n${key}: ${label}\n---\n`;
  }
  return files;
}

async function run(ac: string) {
  const bad: string[] = [];
  for (const c of corpus.cases.filter((x: any) => x.ac === ac)) {
    const r = await handle('type_patch', { key: 'task', base: V, ops: c.ops }, vault(c.used), { [P]: V } as any);
    if (c.error) {
      if (!r.error || (r.error as any).reason !== c.error) bad.push(`${c.name}: want ${c.error}, got ${JSON.stringify(r.error ?? r.writes)}`);
    } else if (c.unchanged) {
      if (r.writes) bad.push(`${c.name}: want no write`);
    } else {
      let want = base;
      for (const [from, to] of c.replace) want = want.replace(from, to);
      const got = (r.writes as Record<string, string> | undefined)?.[P];
      if (got !== want) bad.push(`${c.name}:\n--- want\n${want}--- got\n${got ?? JSON.stringify(r.error)}`);
    }
  }
  assert.deepEqual(bad, [], `${ac}: the fake schema differs from the corpus`);
}

for (const ac of ['FR-TSK-02/AC-2', 'FR-TSK-02/AC-3', 'FR-TSK-02/AC-4', 'FR-TSK-02/AC-5', 'FR-TSK-02/AC-6', 'FR-TSK-02/AC-7', 'FR-TSK-03/AC-2']) {
  test(`${ac.toLowerCase().replace(/[/-]/g, '_')}_fake_schema_follows_the_ops_5a_corpus`, () => run(ac));
}
