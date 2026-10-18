// PR #47 QA review (minors): the task write path (ui/src/tasks/write.ts, ms5-tasks §5).
// 1. Two actions queued on one task: the second is based on the first's own write, not reported as an outside change.
// 2. Try again (base 'current') takes the status it changes from out of the file as it is now, so Done → Done keeps
//    `completed` (D-472) even when the row was read before an outside edit made the task Done.
import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';

const files = new Map<string, { text: string; version: { mtimeNs: string; size: number; hash: string } }>();
let n = 0;
const ver = () => ({ mtimeNs: String(++n), size: 0, hash: `v${n}` });
vi.mock('../../ui/src/ipc/client', () => ({
  ipc: {
    noteRead: async (path: string) => { const f = files.get(path); if (!f) throw { kind: 'NotFound' }; return { path, text: f.text, version: f.version, utf8: true }; },
    noteWrite: async (path: string, text: string, base: unknown) => {
      const f = files.get(path)!;
      if (JSON.stringify(base) !== JSON.stringify(f.version)) throw { kind: 'Conflict' };
      f.text = text; f.version = ver();
      return { outcome: 'written', version: f.version };
    },
  },
}));

const P = 'Tasks/Úkol.md';
const TEXT = '---\nid: 01JB5A0000000000000000Q001\ntype: task\ntitle: Úkol\nstatus: To do\npriority: Low\nmodified: 2026-10-01T09:00:00+02:00\n---\n';
const DEFS = {
  statuses: [
    { label: 'To do', color: null, state: 'open', stateRaw: 'open' }, { label: 'Done', color: null, state: 'done', stateRaw: 'done' },
    { label: 'Delegováno', color: null, state: 'done', stateRaw: 'done' },
  ],
  priorities: [{ label: 'High', color: null, state: null }, { label: 'Low', color: null, state: null }],
  unknownStates: [],
} as any;
beforeEach(() => { files.clear(); n = 0; });
const row = (version: unknown, status = 'To do', state = 'open') => ({ path: P, title: 'Úkol', status, state, statusKnown: true, version, readOnly: false } as any);

test('bug_47_fr_tsk_02_a_second_queued_action_is_based_on_the_first_write', async () => {
  const { writeTask } = await import('../../ui/src/tasks/write');
  files.set(P, { text: TEXT, version: ver() });
  const r = row(files.get(P)!.version);
  const a = writeTask(r, DEFS, { kind: 'complete', done: true });
  const b = writeTask(r, DEFS, { kind: 'change', change: { kind: 'priority', to: 'High' } });
  assert.equal((await a).outcome, 'written');
  assert.equal((await b).outcome, 'written', 'not reported as changed outside Tegg');
  assert.ok(files.get(P)!.text.includes('status: Done') && files.get(P)!.text.includes('priority: High'), 'both changes are in the file');
});

test('bug_47_fr_tsk_02_try_again_reads_the_current_status', async () => {
  const { writeTask } = await import('../../ui/src/tasks/write');
  files.set(P, { text: TEXT.replace('status: To do', 'status: Done').replace('modified: 2026-10-01T09:00:00+02:00\n', 'modified: 2026-10-01T09:00:00+02:00\ncompleted: 2026-10-02T08:00:00+02:00\n'), version: ver() });
  const stale = row({ mtimeNs: '0', size: 0, hash: 'old' });
  const r = await writeTask(stale, DEFS, { kind: 'change', change: { kind: 'status', to: 'Delegováno', toState: 'done', fromState: 'open', firstOpen: 'To do', now: '' } }, 'current');
  assert.equal(r.outcome, 'written');
  assert.ok(files.get(P)!.text.includes('completed: 2026-10-02T08:00:00+02:00\n'), 'Done → Done keeps completed (D-472)');
});

test('bug_47_fr_tsk_02_three_queued_actions_are_all_based_on_this_windows_writes', async () => {
  const { writeTask } = await import('../../ui/src/tasks/write');
  files.set(P, { text: TEXT, version: ver() });
  const r = row(files.get(P)!.version);
  const a = writeTask(r, DEFS, { kind: 'complete', done: true });
  const b = writeTask(r, DEFS, { kind: 'change', change: { kind: 'priority', to: 'High' } });
  const c = writeTask(r, DEFS, { kind: 'change', change: { kind: 'due', to: '2026-10-20' } });
  assert.deepEqual([(await a).outcome, (await b).outcome, (await c).outcome], ['written', 'written', 'written'], 'none is reported as changed outside Tegg');
  assert.ok(files.get(P)!.text.includes('due: 2026-10-20'), 'the third change is in the file');
});

test('bug_47_fr_tsk_02_an_outside_change_between_queued_actions_is_still_a_conflict', async () => {
  const { writeTask } = await import('../../ui/src/tasks/write');
  files.set(P, { text: TEXT, version: ver() });
  const r = row(files.get(P)!.version);
  assert.equal((await writeTask(r, DEFS, { kind: 'complete', done: true })).outcome, 'written');
  const f = files.get(P)!;
  f.text = f.text.replace('priority: Low', 'priority: High'); f.version = ver(); // another program
  assert.equal((await writeTask(r, DEFS, { kind: 'change', change: { kind: 'due', to: '2026-10-20' } })).outcome, 'conflict', 'never accepted as ours (NFR-REL-02)');
});
