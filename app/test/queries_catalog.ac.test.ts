// Slice Q, L1: docs/acceptance/queries.md NFR-OTH-02 AC-17 (R145 with contract §4.5's keys and the `query.` prefix,
// D-1481, D-1493): the catalog has exactly the slice's keys with their English texts, the removed keys are gone, plurals
// use `Intl.PluralRules` (D-133) and the Czech test catalog shows 1, 3 and 5. Interface docs/contracts/v1-queries.md §4.5.
// Written from the ACs and the contract only (D-61). The catalog loads inside the tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try { return (await import(/* @vite-ignore */ path)) as Mod; } catch { return null; }
}
async function catalog(): Promise<Mod> {
  const cat = await load('../ui/src/i18n/catalog.ts');
  assert.ok(cat, 'ui/src/i18n/catalog.ts loads');
  return cat!;
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

type Row = [string, Record<string, string | number>, string];
/** R145 (with §4.5's additions), each with the variables its text is checked with. */
const R145: Row[] = [
  ['queries.title', {}, 'Queries'], ['queries.count', { count: 11 }, '11 queries'], ['queries.count', { count: 1 }, '1 query'],
  ['queries.find', {}, 'Find a query…'], ['queries.new', {}, 'New query'], ['queries.empty', {}, 'No queries yet. Use New query, or type /query in a note.'],
  ['queries.col.query', {}, 'Query'], ['queries.col.created', {}, 'Created'], ['queries.col.updated', {}, 'Updated'], ['queries.rowMenu', {}, 'Query actions'],
  ['queries.rename', {}, 'Rename…'], ['queries.duplicate', {}, 'Duplicate'], ['queries.trash', {}, 'Move to trash'], ['queries.unreadable', {}, 'Can\'t be read'],
  ['query.back', {}, 'All queries'], ['query.created', { date: '30 Sep 2026' }, 'Created 30 Sep 2026'], ['query.edit', {}, 'Edit query'],
  ['query.needsPage', {}, 'Results show only on the page that uses this query'],
  ['query.needsPageBody', { example: 'Links to · This note' }, 'Its filters depend on that page (for example Links to · This note), so there is nothing to list here.'],
  ['query.usedOn', {}, 'Used on'], ['query.notUsed', {}, 'Not used in any note yet.'], ['query.template', {}, 'Template'],
  ['query.block.label', { title: 'Projekty v běhu' }, 'Query: Projekty v běhu'], ['query.block.noResults', {}, 'No objects match.'],
  ['query.block.draft', {}, 'Choose types and filters to start. Until then the block shows nothing.'],
  ['query.block.brokenAttr', { attribute: 'hodnocení', type: 'Kniha' }, 'The filter hodnocení uses an attribute the Kniha type doesn\'t have, so it is ignored.'],
  ['query.block.brokenKey', { key: 'view' }, 'The setting view can\'t be read, so its default is used.'],
  ['query.block.noType', { key: 'neexistuje' }, 'The type neexistuje doesn\'t exist.'], ['query.block.fixFilter', {}, 'Fix filter'],
  ['query.block.needsContext', {}, 'This filter needs the note it is used on.'],
  ['query.block.notFound', { name: 'Neexistující dotaz' }, 'The query “Neexistující dotaz” doesn\'t exist.'], ['query.block.chooseQuery', {}, 'Choose a query…'],
  ['query.block.createIt', {}, 'Create it'], ['query.block.trashed', { name: 'Starý dotaz' }, 'The query “Starý dotaz” is in the trash.'],
  ['query.block.restore', {}, 'Restore'], ['query.block.unreadable', { line: 5 }, 'This query can\'t be read (line 5).'], ['query.block.openQuery', {}, 'Open query'],
  ['query.block.saveAs', {}, 'Save as query…'], ['query.block.showMore', { count: 5, total: 20 }, 'Show 5 more (out of 20)'], ['query.block.columns', {}, 'Columns'],
  ['query.editor.dialog', {}, 'Edit query'], ['query.editor.titleField', {}, 'Query title'],
  ['query.editor.usedOn', { count: 3 }, 'Used on 3 notes. Changes apply everywhere.'],
  ['query.editor.show', {}, 'Show'], ['query.editor.type', {}, 'Type'], ['query.editor.allTypes', {}, 'none = all types'], ['query.editor.where', {}, 'Where'],
  ['query.editor.and', {}, 'and'], ['query.editor.or', {}, 'or'], ['query.editor.combine', { connector: 'and' }, 'Combine filters with and'],
  ['query.editor.groupAny', {}, 'Filter group: any of'], ['query.editor.groupAll', {}, 'Filter group: all of'], ['query.editor.addFilter', {}, 'Add filter'],
  ['query.editor.addGroup', {}, 'Add group'], ['query.editor.addToGroup', {}, 'Add filter to group'], ['query.editor.removeFilter', {}, 'Remove filter'],
  ['query.editor.removeGroup', {}, 'Remove group'], ['query.editor.findAttr', {}, 'Find attribute…'], ['query.editor.links', {}, 'Links'],
  ['query.editor.every', {}, 'Every object'], ['query.editor.thisNote', {}, 'This note'], ['query.editor.sort', {}, 'Sort'], ['query.editor.asc', {}, 'Ascending'],
  ['query.editor.desc', {}, 'Descending'], ['query.editor.limit', {}, 'Limit'], ['query.editor.view', {}, 'View'], ['query.editor.list', {}, 'List'],
  ['query.editor.table', {}, 'Table'], ['query.editor.tableHint', {}, 'With Table, a Columns button appears next to Edit in the block'],
  ['query.editor.results', { count: 3 }, '3 results'], ['query.editor.results', { count: 1 }, '1 result'], ['query.editor.source', {}, 'View source'],
  ['query.editor.done', {}, 'Done'], ['query.editor.changedOutside', {}, 'This query changed outside Tegg. Your change wasn\'t saved.'],
  ['query.picker.title', {}, 'Choose a query'], ['query.picker.new', {}, 'New query'], ['query.newQuery.dialog', {}, 'New query'],
  ['query.newQuery.field', {}, 'Query name'], ['query.newQuery.taken', {}, 'A query with this name already exists.'],
  // §4.5's additions (D-1493).
  ['route.queries', {}, 'Queries'], ['route.query', {}, 'Query'], ['purpose.queries', {}, 'Saved queries you can use as blocks in any note.'],
  ['purpose.query', {}, 'A saved query, its results and where it is used.'], ['slash.query.description', {}, 'A live list of objects'],
  ['queries.sortLabel', {}, 'Sort queries'], ['queries.sort.createdDesc', {}, 'Created ↓'], ['queries.sort.createdAsc', {}, 'Created ↑'],
  ['queries.sort.updatedDesc', {}, 'Updated ↓'], ['queries.sort.updatedAsc', {}, 'Updated ↑'], ['queries.sort.title', {}, 'Title A–Z'],
  ['queries.renameDialog', {}, 'Rename query'], ['queries.trashed', { name: 'Projekty v běhu' }, 'Moved “Projekty v běhu” to the trash'],
  ['query.rename.notReady', {}, 'Queries can be renamed once the vault has finished loading.'], // D-1510, FR-QRY-06 AC-22
  ['query.saveFailed', {}, 'The query couldn\'t be saved.'], ['query.block.readOnly', {}, 'Made by a newer version of Tegg. Read-only.'],
  ['query.block.brokenFilter', { attribute: 'stav' }, 'The filter stav can\'t be used as written, so it is ignored.'],
  ['query.block.taskReadOnly', {}, 'Edit the task to change it.'], ['query.block.newObject', { type: 'Task' }, 'New Task'],
  ['query.block.linksHere', {}, '· links to this note'], ['query.columns.mixed', {}, 'Mixed types: only columns every object has.'],
  ['query.editor.untitled', {}, 'Untitled query'], ['query.editor.removeType', { type: 'Task' }, 'Remove Task'], ['query.editor.attribute', {}, 'Attribute'],
  ['query.editor.operator', {}, 'Condition'], ['query.editor.value', {}, 'Value'], ['query.editor.limitError', {}, 'Enter a number from 1 to 1000.'],
  ['query.editor.linksTo', {}, 'Links to'], ['query.editor.linkedFrom', {}, 'Linked from'],
  ['query.editor.ignored.notAttribute', { type: 'Kniha' }, 'Ignored: not an attribute of Kniha'],
  ['query.editor.ignored.operator', { attribute: 'stav' }, 'Ignored: this condition doesn\'t fit stav'],
  ['query.editor.ignored.value', {}, 'Ignored: the value can\'t be read'], ['query.editor.ignored.nestedGroup', {}, 'Ignored: groups cannot hold groups'],
  ['query.newQuery.create', {}, 'Create'], ['query.newQuery.cancel', {}, 'Cancel'],
  ['query.op.is', {}, 'is'], ['query.op.is_not', {}, 'is not'], ['query.op.contains', {}, 'contains'], ['query.op.is_empty', {}, 'is empty'],
  ['query.op.is_not_empty', {}, 'is not empty'], ['query.op.is_any_of', {}, 'is any of'], ['query.op.has_any_of', {}, 'has any of'],
  ['query.op.has_all_of', {}, 'has all of'], ['query.op.has_none_of', {}, 'has none of'], ['query.op.before', {}, 'before'], ['query.op.after', {}, 'after'],
  ['query.op.between', {}, 'between'], ['query.op.today', {}, 'today'], ['query.op.this_week', {}, 'this week'],
  ['query.op.within_next_days', {}, 'within next N days'], ['query.op.overdue', {}, 'overdue'], ['query.op.eq', {}, '='], ['query.op.ne', {}, '≠'],
  ['query.op.lt', {}, '<'], ['query.op.gt', {}, '>'], ['query.op.links_to', {}, 'links to'], ['query.op.checked', {}, 'is checked'],
  ['query.op.notChecked', {}, 'is not checked'],
  ['cmd.goQueries', {}, 'Go to Queries'], ['cmd.newQuery', {}, 'New query…'], ['cmd.insertQuery', {}, 'Insert query'], ['cmd.renameQuery', {}, 'Rename query…'],
  ['cmd.trashQuery', {}, 'Move query to trash'], ['pinned.kind.query', {}, 'Query'],
];
const REMOVED = ['route.savedQueries', 'purpose.savedQueries', 'cmd.goto.savedQueries'];

test('nfr_oth_02_ac17_query_strings', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, unknown>;
  const bad: string[] = [];
  for (const [key, vars, want] of R145) {
    const got = key in en ? cat.t(key, vars) : 'missing';
    if (got !== want) bad.push(`${key} ${JSON.stringify(vars)}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, [], 'R145\'s keys with their English texts');
  const keys = new Set(R145.map(([k]) => k));
  const extra = Object.keys(en).filter((k) => (k.startsWith('queries.') || k.startsWith('query.')) && !keys.has(k));
  assert.deepEqual(extra, [], 'no other `queries.*` / `query.*` key (exactly R145\'s)');
  for (const k of REMOVED) assert.ok(!(k in en), `${k} removed`);
  for (const k of ['picker.title']) assert.ok(k in en, `${k} (\`Choose {name}\`) stays: R145's picker title is \`query.picker.title\` (D-1481)`);
});

test('nfr_oth_02_ac17_query_strings_czech_plurals', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, unknown>;
  for (const k of ['queries.count', 'query.editor.usedOn', 'query.editor.results']) assert.ok(k in en, `${k} in the catalog`);
  cat.setCatalog({
    ...en,
    'queries.count': { one: '{count} dotaz', few: '{count} dotazy', other: '{count} dotazů' },
    'query.editor.usedOn': { one: 'Použito v {count} poznámce.', few: 'Použito ve {count} poznámkách.', other: 'Použito v {count} poznámkách.' },
    'query.editor.results': { one: '{count} výsledek', few: '{count} výsledky', other: '{count} výsledků' },
  }, 'cs');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('queries.count', { count: n })), ['1 dotaz', '3 dotazy', '5 dotazů'], 'queries.count: one, few, other');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('query.editor.results', { count: n })), ['1 výsledek', '3 výsledky', '5 výsledků'], 'query.editor.results: one, few, other');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('query.editor.usedOn', { count: n })), ['Použito v 1 poznámce.', 'Použito ve 3 poznámkách.', 'Použito v 5 poznámkách.'], 'query.editor.usedOn: one, few, other');
});
