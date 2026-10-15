// @vitest-environment jsdom
// MS4 slice 4A, L1: creating a note from a broken link, `types/create.ts` `createObjectForLink` (docs/contracts/
// ms4-links.md §5.3; D-286, D-287, D-245). FR-LNK-04 AC-6 (the created note's title comes from the plan, NFC; one
// `link_create`, never `note_create`), AC-7 (names and link text: the plan's rewrite goes through the editor's
// `replaceLink`; without an editor a rewrite plan is never sent). The plan rules themselves are checked at the core
// (crates/tegg-core/tests/ac_backlinks.rs) and in L5. IPC is mocked with `@tauri-apps/api/mocks` (`mockIPC`).
// Written from docs/acceptance/backlinks.md and the contract only (D-61). The module loads inside each test (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { parse } from '@tegg/doc';
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
const fm = (text: string) => parse(text).frontmatter?.data ?? {};

test('fr_lnk_04_ac6_create_for_link_sends_one_link_create_with_the_plan_title', async () => {
  const m = await need(CREATE, 'createObjectForLink');
  const p = plan('Neexistuje');
  const calls = fakeCore(() => ({ path: 'Quick Notes/Neexistuje.md', rewrite: null }));
  const path = await m.createObjectForLink(ROZBITE, 'Neexistuje#Kapitola', p, {});
  assert.equal(path, 'Quick Notes/Neexistuje.md');
  const lc = calls.filter((c) => c.cmd === 'link_create');
  assert.equal(lc.length, 1, 'one link_create');
  assert.equal(calls.filter((c) => c.cmd === 'note_create' || c.cmd === 'note_write').length, 0, 'no other write');
  assert.equal(lc[0].args.from, ROZBITE);
  assert.equal(lc[0].args.target, 'Neexistuje#Kapitola');
  assert.deepEqual(lc[0].args.expect, p, 'the plan the offer showed');
  const data = fm(String(lc[0].args.text));
  assert.equal(data.title, 'Neexistuje', 'title from the plan, no heading');
  assert.equal(data.type, 'quick-note', 'type from the plan');
  assert.ok(!String(lc[0].args.text).includes('Kapitola'), 'no heading is created');
});

test('fr_lnk_04_ac6_an_nfd_target_gives_an_nfc_title', async () => {
  const m = await need(CREATE, 'createObjectForLink');
  const calls = fakeCore(() => ({ path: 'Quick Notes/Nová věc.md', rewrite: null }));
  await m.createObjectForLink(ROZBITE, 'Nová věc'.normalize('NFD'), plan('Nová věc'), {});
  const text = String(calls.find((c) => c.cmd === 'link_create')?.args.text ?? '');
  assert.equal(fm(text).title, 'Nová věc');
  assert.equal(text, text.normalize('NFC'), 'the new note is NFC');
});

test('fr_lnk_04_ac7_the_rewrite_goes_through_the_editor', async () => {
  const m = await need(CREATE, 'createObjectForLink');
  const p = plan('Q3: plán?', 'Q3 plán|Q3: plán?', 'Quick Notes/Q3 plán.md');
  const calls = fakeCore(() => ({ path: 'Quick Notes/Q3 plán.md', rewrite: 'Q3 plán|Q3: plán?' }));
  const replaced: [number, string][] = [];
  const editor = { commands: { replaceLink: (pos: number, linkText: string) => { replaced.push([pos, linkText]); return true; } } };
  const path = await m.createObjectForLink(ROZBITE, 'Q3: plán?', p, { editor, chipPos: 42 });
  assert.equal(path, 'Quick Notes/Q3 plán.md');
  const text = String(calls.find((c) => c.cmd === 'link_create')?.args.text ?? '');
  assert.equal(fm(text).title, 'Q3: plán?', 'the full title');
  assert.match(text, /^title: "Q3: plán\?"$/m, 'quoted title');
  assert.deepEqual(replaced, [[42, 'Q3 plán|Q3: plán?']], 'replaceLink(chipPos, rewrite): one editor change');
});

test('fr_lnk_04_ac7_without_an_editor_a_rewrite_plan_is_never_sent', async () => {
  const m = await need(CREATE, 'createObjectForLink');
  const calls = fakeCore(() => ({ path: 'Quick Notes/Q3 plán.md', rewrite: 'Q3 plán|Q3: plán?' }));
  let threw = false;
  try {
    await m.createObjectForLink(ROZBITE, 'Q3: plán?', plan('Q3: plán?', 'Q3 plán|Q3: plán?', 'Quick Notes/Q3 plán.md'), {});
  } catch {
    threw = true;
  }
  assert.equal(calls.filter((c) => c.cmd === 'link_create').length, 0, 'no link_create from a read-only view (D-287)');
  assert.ok(threw, 'the call is refused');
});
