// D-124: `verify milestone --milestone MSn` tells its steps which milestone is gated (VERIFY_MILESTONE, CONTRACT §2.1),
// so registry tests can fail on placeholders due at or before it. Other gates don't set it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { makeRepo, readText, sq, tmpDir, verify } from './helpers.ts';

const BRD = '# BRD\n\n### 11.2 Milestones\n\n| Milestone | Name | Requirements |\n| --- | --- | --- |\n| MS1 | Core | FR-ABC-01 |\n';
const ACS = '# ACs\n\n### FR-ABC-01 Something\n\n- **AC-1** [manual] Works.\n';

test('milestone_gate_passes_verify_milestone_to_steps', (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const envFile = path.join(out, 'env');
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'env', level: 'push', run: `printf '%s\\n' "\${VERIFY_MILESTONE-unset}" >> ${sq(envFile)}` }] },
    files: { 'docs/Business Requirements.md': BRD, 'docs/acceptance/core.md': ACS },
  });
  verify(repo, ['milestone', '--milestone', 'MS1']);
  verify(repo, ['push']);
  assert.deepEqual(readText(envFile, 'step environment dump').trim().split('\n'), ['MS1', 'unset']);
});
