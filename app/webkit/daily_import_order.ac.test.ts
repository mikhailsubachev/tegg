// Slice I1, L5 (WebKit + fake core): FR-DLY-01 AC-12 (D-1546, amends D-319): among several Daily Notes of one date,
// a note without `import-id` comes before every note with one. docs/acceptance/daily-notes.md; the rule's fake-core
// twin is `@tegg/doc` `dailyOrder` (docs/contracts/v1-import.md §12.3). The third note for 12 Oct is written at test
// time into the fixture vault's copy (contract §16.2: no committed file). Written from the AC and the contract only
// (D-61). A new file, so the existing `daily.ac.test.ts` stays unmodified (TS-I3).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { D, dailyVault, duplicateNotice, editorBody, flat, gotoDaily, must, seen, startDaily, writeCalls } from './daily-helpers';

const D12C = 'Daily/2026-10-12 (3).md';
const IMPORT_LINE = 'import-id: "capacities:PKM/DailyNotes/2026-10-12.md"\n';
const imported = (line: string) =>
  `---\nid: 01JB4B0000000000000000D015\ntype: daily-note\ntitle: "2026-10-12"\ndate: 2026-10-12\nreview: unreviewed\n${line}created: 2026-11-12T10:00:00+01:00\nmodified: 2026-11-12T10:00:00+01:00\n---\nImportovaný zápis.\n`;

test('fr_dly_01_ac12_an_imported_note_never_takes_the_day', async ({ page }) => {
  const core = await startDaily(page, { vault: dailyVault((files) => { files[D12C] = imported(IMPORT_LINE); }) });
  const before = await core.files();
  await gotoDaily(page, '2026-10-12');
  // (3) has the newest `created`, and an import-id: the day still opens (2).
  assert.ok(await seen(editorBody(page).getByText('Novější zápis z druhého zařízení.'), 2000), 'daily/2026-10-12 opens Daily/2026-10-12 (2).md, not the imported note');
  const notice = await must(duplicateNotice(page), 'region "Other notes for this date"');
  assert.ok(flat(await notice.innerText()).startsWith('2 other notes have this date:'), `notice text: ${flat(await notice.innerText())}`);
  const names = (await notice.getByRole('link').allInnerTexts()).map(flat).filter((t) => t.startsWith('Daily/'));
  assert.deepEqual(names, [D.d12, D12C], 'the notice lists Daily/2026-10-12.md, then Daily/2026-10-12 (3).md');
  assert.deepEqual(await writeCalls(core), [], 'opening and reading write nothing');
  assert.deepEqual(await core.files(), before, 'no file changed');

  // The line removed from (3) externally: (3) is now the newest note without one and opens within 2 s.
  await core.setFile(D12C, imported(''));
  assert.ok(await seen(editorBody(page).getByText('Importovaný zápis.'), 2000), 'without the import-id line (3) opens within 2 s');
  // The line put back: (2) opens again.
  await core.setFile(D12C, imported(IMPORT_LINE));
  assert.ok(await seen(editorBody(page).getByText('Novější zápis z druhého zařízení.'), 2000), 'with the line back, (2) opens again');
});
