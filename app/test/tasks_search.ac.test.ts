// Preview v0.94 feedback, L1: the title search on the Schedule and the Kanban (docs/acceptance/tasks.md FR-TSK-04
// AC-19, AC-20, AC-21, FR-TSK-05 AC-16; AP-1180…AP-1184 → D-1280…D-1284). Interface docs/contracts/ms5-tasks.md §13:
// catalog `cmd.tasks.search` `Filter tasks`. Written from the ACs and the contract only (D-61). Modules load inside the
// tests (TS-I1).
//
// Slice Q2-T (AC-Test-Change, D-1912; docs/acceptance/views.md part three, row FR-TSK-04 AC-19…AC-21, FR-TSK-05 AC-16):
// the field is the type page's `Filter Tasks…` of each view tab (R186, part one §4.4); `views.ts` loses `schedule`,
// `kanban`, `counts` and `ViewInput.search` (v1-views §28.2), so the L1 tests of the search inside those functions are
// removed; matching, the lanes kept while searching and the no-match status are tested at L5 (webkit/tasks_search,
// webkit/views_tasks_schedule FR-TSK-04 AC-28). The catalog test stands (`cmd.tasks.search` kept, D-1922).
import { test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-21 (strings, §13)

test('fr_tsk_04_ac21_catalog_has_the_filter_tasks_command', async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  assert.ok(cat && cat.en, 'ui/src/i18n/catalog.ts exports en');
  assert.ok('cmd.tasks.search' in cat!.en, 'catalog key cmd.tasks.search (§13)');
  assert.equal(cat!.t('cmd.tasks.search'), 'Filter tasks', 'cmd.tasks.search `Filter tasks` (D-1284)');
});
