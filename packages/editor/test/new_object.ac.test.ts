// New objects from `/` and `+`, L1 and L2: the @tegg/editor side (docs/acceptance/new-object-menu.md R237; contract
// docs/contracts/new-object-menu.md §3). FR-EDT-03 AC-14 (L1: the D-184 link text of N1…N8; titles with `|`, `[[`, `]]`
// get no alias, D-2514), FR-EDT-03 AC-15 (L1: `insertObjectLink` is one transaction; ⌘Z leaves the text as before the
// trigger, ⇧⌘Z puts the same link back), FR-FMT-12 AC-18 (L1: NFC titles and links; NFD host bytes kept), FR-FMT-07
// AC-39 (L1: N1, N9, the NFD host; L2: a link at a random allowed caret position of a random host paragraph changes
// only the bytes between the trigger's start and the caret; fixed seed plus one per run). Fixture:
// tests/fixtures/vaults/tasks (read only). Written from the ACs and the contract only (D-61); the stub has no
// `insertObjectLink`, so every test fails on an assertion (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextSelection } from '@tiptap/pm/state';
import { editorModule, NOW, newId, REPO, type, type LinkChoice, type TeggEditor } from './helpers';

const fx = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults/tasks', rel), 'utf8');
const touched = (text: string) => text.replace(/^modified: .*$/m, `modified: ${NOW}`);
type Ed = TeggEditor & { historyDepth(): number; commands: TeggEditor['commands'] & { insertObjectLink?: (from: number, to: number, c: LinkChoice) => boolean } };

async function open(text: string): Promise<Ed> {
  const m = await editorModule();
  return (m.createEditor as any)({ text, now: () => NOW, newId }) as Ed;
}
/** The document position right after the first occurrence of `needle`, in NFC or NFD as the text holds it. */
function after(ed: Ed, needle: string): number {
  let pos = -1;
  ed.view.state.doc.descendants((n: any, p: number) => {
    if (pos >= 0) return false;
    if (n.isText) {
      for (const form of [needle.normalize('NFC'), needle.normalize('NFD')]) {
        const i = (n.text as string).indexOf(form);
        if (i >= 0) { pos = p + i + form.length; break; }
      }
    }
    return true;
  });
  assert.ok(pos >= 0, `the editor text holds ${JSON.stringify(needle)}`);
  return pos;
}
function caretAt(ed: Ed, pos: number) {
  ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, pos)));
}
/** Types `trigger` at `pos` and replaces it with the link (the dialog's Create, R236). */
function createLink(ed: Ed, pos: number, trigger: string, c: LinkChoice): boolean {
  caretAt(ed, pos);
  type(ed, trigger);
  const from = ed.view.state.selection.from - trigger.length;
  const cmd = ed.commands.insertObjectLink;
  assert.ok(typeof cmd === 'function', 'commands.insertObjectLink exists (new-object-menu contract §3)');
  return cmd!(from, ed.view.state.selection.from, c);
}
const BLOKY = 'Pages/Bloky.md';
const choice = (path: string, title: string, fromPath = BLOKY): LinkChoice => ({ path, title, fromPath, stemResolves: true });

// ------------------------------------------------------------------------------------------------ FR-EDT-03 AC-14 (L1), FR-FMT-12 AC-18 (L1)

test('fr_edt_03_ac14_link_text_of_n1_to_n8_and_titles_that_cant_be_an_alias', async () => {
  const { linkText } = await editorModule();
  const cases: [LinkChoice, string, string][] = [
    [choice('Pages/Nový plán.md', 'Nový plán'), 'Nový plán', 'N1'],
    [choice('Pages/Koupit lepidlo (2).md', 'Koupit lepidlo'), 'Koupit lepidlo (2)|Koupit lepidlo', 'N3'],
    [choice('Pages/Q4 plán rozpočet.md', 'Q4: plán/rozpočet'), 'Q4 plán rozpočet|Q4: plán/rozpočet', 'N4'],
    [choice('Pages/C poznámky.md', 'C# poznámky'), 'C poznámky|C# poznámky', 'N5'],
    [choice('Pages/Dvojník (2).md', 'Dvojník'), 'Dvojník (2)|Dvojník', 'N6'],
    [choice('Pages/Čtení knih.md'.normalize('NFD'), 'Čtení knih'.normalize('NFD')), 'Čtení knih', 'N7: an NFD title gives an NFC link'],
    [choice('Projekty/Spuštění webu.md', 'Spuštění webu'), 'Spuštění webu', 'N8'],
    [choice('Pages/A B.md', 'A | B'), 'A B', 'AP-2132: a `|` in the title, no alias'],
    [choice('Pages/pole x.md', 'pole [[x]]'), 'pole x', 'AP-2132: `[[` and `]]` in the title, no alias'],
    [choice('Pages/konec.md', 'konec ]]'), 'konec', 'AP-2132: `]]` alone'],
  ];
  const got = cases.map(([c]) => linkText(c));
  assert.deepEqual(got, cases.map(([, want]) => want), 'D-184 link texts (D-2514)');
  assert.ok(got.every((s) => s === s.normalize('NFC')), 'every link text is NFC (FR-FMT-12 AC-18)');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-03 AC-15 (L1)

test('fr_edt_03_ac15_insert_object_link_is_one_undo_step_without_the_trigger', async () => {
  const orig = fx(BLOKY);
  const ed = await open(orig);
  assert.equal(createLink(ed, after(ed, 'Úvodní odstavec.'), ' +pa', choice('Pages/Nový plán.md', 'Nový plán')), true, 'insertObjectLink runs');
  const n1 = touched(orig.replace('Úvodní odstavec.\n', 'Úvodní odstavec. [[Nový plán]]\n'));
  const out = await ed.save();
  assert.equal(out, n1, 'N1: line 1 reads `Úvodní odstavec. [[Nový plán]]`');
  ed.markSaved(out!);
  const before = ed.view.state.doc.resolve(ed.view.state.selection.from).nodeBefore;
  assert.ok(before && before.type.name !== 'text', `the caret is right after the link chip (${before?.type.name})`);
  ed.commands.undo();
  const undone = await ed.save();
  assert.equal(undone, touched(orig.replace('Úvodní odstavec.\n', 'Úvodní odstavec. \n')), '⌘Z removes the link in one step and leaves `Úvodní odstavec. ` (no `+pa`, D-2512)');
  ed.markSaved(undone!);
  ed.commands.redo();
  assert.equal(await ed.save(), n1, '⇧⌘Z puts the same link back');
  const ed2 = await open(orig);
  createLink(ed2, after(ed2, 'Úvodní odstavec.'), ' +pa', choice('Pages/Nový plán.md', 'Nový plán'));
  type(ed2, 'X');
  assert.equal(await ed2.save(), touched(orig.replace('Úvodní odstavec.\n', 'Úvodní odstavec. [[Nový plán]]X\n')), 'the next typed X lands after the link');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-39 (L1), FR-FMT-12 AC-18 (L1)

test('fr_fmt_07_ac39_the_host_gains_only_the_link_in_lf_crlf_and_nfd_hosts', async () => {
  const bad: string[] = [];
  const cases: [string, string, string][] = [['N1', BLOKY, 'Úvodní odstavec.'], ['N9', 'Pages/CRLF host.md', 'Úkol s CRLF'], ['NFD host', 'Pages/NFD host.md', 'Úkol v NFD']];
  for (const [what, path, para] of cases) {
    const orig = fx(path);
    const raw = orig.includes(para) ? para : para.normalize('NFD'); // the NFD host holds the paragraph in NFD bytes
    const ed = await open(orig);
    try {
      createLink(ed, after(ed, para), ' +pa', choice('Pages/Nový plán.md', 'Nový plán', path));
    } catch (e) { bad.push(`${what}: ${(e as Error).message}`); continue; }
    const out = await ed.save();
    const expected = touched(orig.replace(raw, `${raw} [[Nový plán]]`));
    if (out !== expected) bad.push(`${what}: ${JSON.stringify(out)}`);
  }
  assert.deepEqual(bad, [], 'every other byte, the line endings and the final-newline state unchanged; the NFD bytes of `Úkol v NFD` kept and the link in NFC');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-39 (L2)

const RUNS = Number(process.env.EDITOR_PROPERTY_RUNS ?? 60);
const RANDOM = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31;
const SEEDS = [20261126, RANDOM];
console.log(`new object link property: seed = ${SEEDS[0]}, seed = ${SEEDS[1]}`);
const WORDS = ['Kořen', 'Žluťoučký', 'kůň', 'úpěl', 'Příprava', 'Řeka', 'Čtení', 'ďábel', 'Šňůra', 'plán'];
const tokenArb = fc.oneof(
  fc.constantFrom(...WORDS).map((w) => ({ kind: 'word', w })),
  fc.constantFrom(...WORDS).map((w) => ({ kind: 'strong', w })),
  fc.constantFrom('Lisabon', 'Zasedačka', 'Cíl').map((w) => ({ kind: 'link', w })),
  fc.constantFrom('práce', 'doma', 'čtení').map((w) => ({ kind: 'tag', w })),
);
const hostArb = fc.record({
  tokens: fc.array(tokenArb, { minLength: 0, maxLength: 8 }),
  at: fc.nat(8), crlf: fc.boolean(), finalNewline: fc.boolean(), nfd: fc.boolean(), before: fc.boolean(), afterPara: fc.boolean(),
});

test('fr_fmt_07_ac39_property_a_link_changes_only_the_bytes_of_the_trigger', { timeout: 600_000 }, async () => {
  const failures: string[] = [];
  for (const seed of SEEDS) {
    await fc.assert(
      fc.asyncProperty(hostArb, async (h) => {
        const mark = failures.length;
        const k = h.tokens.length === 0 ? 0 : h.at % (h.tokens.length + 1);
        const toks = h.tokens.map((t) => {
          const w = h.nfd ? t.w.normalize('NFD') : t.w;
          return t.kind === 'word' ? w : t.kind === 'strong' ? `**${w}**` : t.kind === 'link' ? `[[${t.w}]]` : `#${w}`;
        });
        toks.splice(k, 0, 'Kotva'); // the caret goes before this word: a block start or after a space (R235)
        const para = toks.join(' ');
        let text = '---\nid: 01JB5A0000000000000000P039\ntype: page\ntitle: Hostitel\nmodified: 2026-10-01T09:00:00+02:00\n---\n' + (h.before ? 'Před.\n\n' : '') + para + (h.afterPara ? '\n\nPo.' : '');
        if (h.finalNewline) text += '\n';
        if (h.crlf) text = text.replace(/\n/g, '\r\n');
        const ed = await open(text);
        if (typeof ed.commands.insertObjectLink !== 'function') { failures.push('commands.insertObjectLink is missing (new-object-menu contract §3)'); ed.destroy(); return false; }
        const pos = after(ed, 'Kotva') - 'Kotva'.length;
        createLink(ed, pos, '+pa', choice('Pages/Nový plán.md', 'Nový plán', 'Pages/Hostitel.md'));
        const out = await ed.save();
        ed.destroy();
        const want = touched(text.replace('Kotva', '[[Nový plán]]Kotva'));
        if (out !== want) failures.push(`case ${JSON.stringify(text)}: saved ${JSON.stringify(out)}`);
        return failures.length === mark;
      }),
      { seed, numRuns: RUNS, endOnFailure: true },
    ).catch((e) => failures.push(String(e).split('\n').slice(0, 6).join('\n')));
  }
  assert.deepEqual(failures.slice(0, 6), [], `${failures.length} failures`);
});
