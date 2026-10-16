// @vitest-environment jsdom
// MS4 slice 4A, L1: FR-LNK-04 AC-13 (D-364), a refused rewrite after the note is created fails with `RewriteFailed`
// (docs/contracts/ms4-links.md §4, §5.3). Written from docs/acceptance/backlinks.md and the contract only (D-61).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { need } from './read-helpers';
import { typeDto } from './types-helpers';

const CREATE = '../ui/src/types/create.ts';
const ROZBITE = 'Pages/Rozbité odkazy.md';
afterEach(() => clearMocks());

type Call = { cmd: string; args: any };
function fakeCore(result: (args: any) => unknown): Call[] {
  const calls: Call[] = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === 'type_get') return typeDto(String((args as any)?.key ?? 'quick-note'));
    if (cmd === 'type_template') return null;
    if (cmd === 'link_create') return result(args);
    if (cmd === 'vault_types') return [typeDto('page'), typeDto('quick-note')];
    return null;
  });
  return calls;
}
const plan = (title: string, rewrite: string | null = null, path = `Quick Notes/${title}.md`) => ({ state: 'create' as const, path, title, type: 'quick-note', rewrite });
test('fr_lnk_04_ac13_a_refused_rewrite_fails_with_rewrite_failed', async () => {
  const m = await need(CREATE, 'createObjectForLink');
  const p = plan('Q3: plán?', 'Q3 plán|Q3: plán?', 'Quick Notes/Q3 plán.md');
  const calls = fakeCore(() => ({ path: 'Quick Notes/Q3 plán.md', rewrite: 'Q3 plán|Q3: plán?' }));
  const editor = { commands: { replaceLink: () => false } };
  let err: any = null;
  try {
    await m.createObjectForLink(ROZBITE, 'Q3: plán?', p, { editor, chipPos: 42 });
  } catch (e) {
    err = e;
  }
  assert.notEqual(err, null, 'createObjectForLink rejects (D-364)');
  assert.equal(err.kind, 'RewriteFailed');
  assert.equal(err.path, 'Quick Notes/Q3 plán.md', 'the created path');
  assert.equal(calls.filter((c) => c.cmd === 'link_create').length, 1, 'exactly one link_create');
});
