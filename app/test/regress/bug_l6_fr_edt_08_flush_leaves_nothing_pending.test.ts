// bug_l6_fr_edt_08: the L6 run of FR-DLY-02 AC-4 (⌘Q right after the first keystroke on today's virtual Daily Note)
// showed `Quit without saving?` over a saved note in about half the runs. The first write's `transform` (the Daily
// Note title and stamp fix, D-334) puts the frontmatter into the editor, which reports a change: `changed()` arms the
// debounce timer while the flush is writing. The flush's second write found nothing new to save but left that timer,
// so `pending` stayed true and the quit handler asked instead of quitting (FR-EDT-08 AC-7, D-196).
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('../../ui/src/ipc/client', () => ({ ipc: {} }));
vi.mock('@tegg/editor', () => ({ VerifyError: class VerifyError extends Error {} }));

test('bug_l6_fr_edt_08_flush_after_a_transformed_first_write_leaves_nothing_pending', async () => {
  const { Saver } = await import('../../ui/src/edit/autosave');
  let text = 'draft\n';
  let saved: string | null = null;
  let saver: InstanceType<typeof Saver> | null = null;
  const opened = { eq: (o: unknown) => o === opened };
  const changed = { eq: (o: unknown) => o === changed };
  const ed = {
    view: { composing: false },
    editor: { state: { doc: changed } },
    save: async () => (text === saved ? null : text),
    text: () => text,
    markSaved: (t: string) => { saved = t; },
    // The editor reports the frontmatter it was given as a change (an undoable step), like a keystroke.
    applyFrontmatter: (next: string) => { text = next; saver!.changed(); },
  };
  saver = new Saver('Daily/2026-10-18.md', ed as never, null, { state: () => {}, conflict: () => {}, gone: () => {}, written: () => {} });
  (saver as unknown as { openedDoc: unknown }).openedDoc = opened;
  saver.transform = (t) => (t.startsWith('fixed ') ? t : `fixed ${t}`);
  saver.create = async () => ({ path: 'Daily/2026-10-18.md', version: { mtimeNs: '1', size: 1, hash: '00' } as never });

  text = 'draft a\n';
  saver.changed();
  await saver.flush();
  assert.equal(saved, 'fixed draft a\n', 'the first write holds the transformed text');
  assert.equal(saver.state, 'saved', 'the note is saved');
  assert.equal(saver.pending, false, 'nothing is left pending after the flush, so ⌘Q quits');
  saver.dispose();
});
