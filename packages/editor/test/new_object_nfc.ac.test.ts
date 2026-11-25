// New objects from `/` and `+`, FR-FMT-12 AC-18 (L1): titles and links in NFC (docs/acceptance/new-object-menu.md;
// contract docs/contracts/new-object-menu.md §3: `linkText(c)` is NFC, `insertObjectLink(from, to, c)` replaces the
// trigger and query with the link as one transaction). The L1 parts: N7's title typed in NFD gives an NFC link; the
// same title in NFC afterwards links `Pages/Čtení knih (2).md` (the path the core returned; the free stem itself is
// L4); ` +pa` typed in the NFD host after `Úkol v NFD` inserts an NFC link and keeps the NFD bytes of `Úkol v NFD`.
// The file name and `title:` bytes come from the one creation path (`note_create`, L4/L5). Its own named test by
// D-2668 (6). Fixture: tests/fixtures/vaults/tasks (read only). Written from the AC and the contract only (D-61).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextSelection } from '@tiptap/pm/state';
import { editorModule, NOW, newId, REPO, type, type LinkChoice, type TeggEditor } from './helpers';

const NFD_HOST = 'Pages/NFD host.md';
type Ed = TeggEditor & { commands: TeggEditor['commands'] & { insertObjectLink?: (from: number, to: number, c: LinkChoice) => boolean } };
const fx = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults/tasks', rel), 'utf8');
const touched = (text: string) => text.replace(/^modified: .*$/m, `modified: ${NOW}`);
const choice = (path: string, title: string, fromPath = NFD_HOST): LinkChoice => ({ path, title, fromPath, stemResolves: true });
const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex');

async function open(text: string): Promise<Ed> {
  const m = await editorModule();
  return (m.createEditor as any)({ text, now: () => NOW, newId }) as Ed;
}
/** The document position right after `needle` exactly as given (no normalization). */
function afterExact(ed: Ed, needle: string): number {
  let pos = -1;
  ed.view.state.doc.descendants((n: any, p: number) => {
    if (pos >= 0) return false;
    if (n.isText) {
      const i = (n.text as string).indexOf(needle);
      if (i >= 0) pos = p + i + needle.length;
    }
    return true;
  });
  return pos;
}

test('fr_fmt_12_ac18_nfd_titles_give_nfc_links_and_the_nfd_host_keeps_its_bytes', async () => {
  const { linkText } = await editorModule();
  const titleNfc = 'Čtení knih';
  const titleNfd = titleNfc.normalize('NFD');
  assert.notEqual(titleNfd, titleNfc, 'the NFD title differs in bytes from the NFC one');

  // N7: the title typed in NFD; whatever form the path comes in, the link is NFC bytes.
  for (const path of ['Pages/Čtení knih.md', 'Pages/Čtení knih.md'.normalize('NFD')]) {
    const got = linkText(choice(path, titleNfd, 'Pages/Bloky.md'));
    assert.equal(hex(got), hex('Čtení knih'), `N7: an NFD title gives the NFC link text (path in ${path === path.normalize('NFC') ? 'NFC' : 'NFD'})`);
  }
  // The same title typed in NFC afterwards: the core returned `Pages/Čtení knih (2).md` (stems compare equal).
  const second = linkText(choice('Pages/Čtení knih (2).md', titleNfc, 'Pages/Bloky.md'));
  assert.equal(hex(second), hex('Čtení knih (2)|Čtení knih'), 'the second Čtení knih links its ` (2)` file, NFC');
  const secondFromNfd = linkText(choice('Pages/Čtení knih (2).md'.normalize('NFD'), titleNfd, 'Pages/Bloky.md'));
  assert.equal(hex(secondFromNfd), hex('Čtení knih (2)|Čtení knih'), 'an NFD path and title for the ` (2)` file still give NFC');

  // ` +pa` typed in the NFD host after `Úkol v NFD`: an NFC link, the NFD bytes kept.
  const orig = fx(NFD_HOST);
  const paraNfd = 'Úkol v NFD'.normalize('NFD');
  assert.ok(orig.includes(paraNfd) && !orig.includes('Úkol v NFD'.normalize('NFC')), 'the fixture holds `Úkol v NFD` in NFD bytes');
  const cases: [LinkChoice, string][] = [
    [choice('Pages/Nový plán.md', 'Nový plán'), 'Nový plán'],
    [choice('Pages/Čtení knih.md'.normalize('NFD'), titleNfd), 'Čtení knih'],
  ];
  const bad: string[] = [];
  for (const [c, link] of cases) {
    const ed = await open(orig);
    const at = afterExact(ed, paraNfd);
    if (at < 0) { bad.push(`${link}: the editor text doesn't hold \`Úkol v NFD\` in NFD`); continue; }
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, at)));
    type(ed, ' +pa');
    const to = ed.view.state.selection.from;
    const cmd = ed.commands.insertObjectLink;
    if (typeof cmd !== 'function') { bad.push('commands.insertObjectLink is missing (new-object-menu contract §3)'); break; }
    if (cmd(to - ' +pa'.length, to, c) !== true) { bad.push(`${link}: insertObjectLink returned false`); continue; }
    const out = await ed.save();
    // `link` is an NFC literal, so equal bytes mean an NFC link next to the kept NFD paragraph.
    const expected = touched(orig.replace(paraNfd, `${paraNfd} [[${link}]]`));
    if (out === null || hex(out) !== hex(expected)) bad.push(`${link}: saved ${JSON.stringify(out)}`);
  }
  assert.deepEqual(bad, [], 'the NFD host gains an NFC link; the NFD bytes of `Úkol v NFD` and every other byte are kept');
});
