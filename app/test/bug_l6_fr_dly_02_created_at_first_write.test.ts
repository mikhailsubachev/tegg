// bug_l6_fr_dly_02: the L6 run of FR-DLY-02 AC-2 (D-382) found `created`/`modified` of a new Daily Note stamped when
// the virtual note opened, not at the first write (ms4-daily §3: the UI replaces `{{now}}` at the write). restampDraft
// moves the open-time stamp to the write time and leaves everything else alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const draft = (s: string) => `---\nid: 01J\ntype: daily-note\ntitle: "2026-10-14"\ndate: 2026-10-14\ncreated: ${s}\nmodified: ${s}\n---\n\n## Poznámky\nText created: ${s}\n`;

test('bug_l6_fr_dly_02_first_write_restamps_created_and_modified', async () => {
  const mod = await import('../ui/src/daily/stamp.ts').catch(() => null);
  assert.ok(mod && typeof mod.restampDraft === 'function', 'ui/src/daily/stamp.ts exports restampDraft');
  const open = '2026-10-14T08:00:00+02:00';
  const write = '2026-10-14T08:05:31+02:00';
  const out = mod!.restampDraft(draft(open), open, write);
  assert.equal(out, draft(write).replace(`Text created: ${write}`, `Text created: ${open}`), 'only the frontmatter stamps change');
  assert.equal(mod!.restampDraft(draft(open), '2026-01-01T00:00:00+01:00', write), draft(open), 'a user-edited stamp is kept');
});
