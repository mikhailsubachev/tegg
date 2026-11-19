// Slice Q2, L1: docs/acceptance/views.md NFR-OTH-02 AC-21 (R192 as fixed by D-1812, contract §4.6): the catalog has
// R192's keys with their English texts, the removed keys are gone (AP-1517's labels, `typePage.allView` renamed to
// `views.all`, no `views.notReady`), the reused keys stay, plurals use `Intl.PluralRules` (D-133) and the Czech test
// catalog shows 1, 3 and 5. Interface docs/contracts/v1-views.md §4.6. Written from the ACs and the contract only (D-61).
// The catalog loads inside the tests (TS-I1).
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
const R192: Row[] = [
  ['views.all', { plural: 'Books' }, 'All Books'], ['views.add', {}, 'Add view'], ['views.addMenu', {}, 'Add view'], ['views.newGroup', {}, 'New view'],
  ['views.kind.table', {}, 'Table'], ['views.kind.list', {}, 'List'], ['views.kind.board', {}, 'Board'], ['views.kind.boardBy', { attribute: 'Status' }, 'by Status'],
  ['views.savedGroup', {}, 'Show a saved query'], ['views.reason.needsNote', {}, 'Needs the note it is used on'],
  ['views.reason.otherType', { type: 'Autor', thisType: 'Book' }, 'Shows Autor, not Book'],
  ['views.reason.severalTypes', { thisType: 'Book' }, 'Shows several types, not only Book'], ['views.reason.allTypes', { thisType: 'Book' }, 'Shows all types, not only Book'],
  ['views.reason.unreadable', {}, 'Can\'t be read'], ['views.newName', {}, 'New view'], ['views.menu', {}, 'View actions'], ['views.edit', {}, 'Edit view'],
  ['views.rename', {}, 'Rename…'], ['views.duplicate', {}, 'Duplicate'], ['views.openAsQuery', {}, 'Open as query'], ['views.openAsQueryHint', {}, 'Queries ›'],
  ['views.remove', { plural: 'Books' }, 'Remove from Books page'], ['views.removeHint', {}, 'Keeps the query in Queries'], ['views.trash', {}, 'Move to trash'],
  ['views.brokenTypes', { types: 'Book and Autor', thisType: 'Book' }, 'This view shows Book and Autor, not only Book. Edit view to fix it.'],
  ['views.unreadableSetting', { file: '.tegg/types/book.yml' }, 'The views setting in .tegg/types/book.yml can\'t be read. Fix it in the file to change views.'],
  ['views.pageMark', { plural: 'Books' }, 'Books page'],
  ['views.addFailed', { plural: 'Books' }, 'The view was saved as a query but couldn\'t be added to the Books page.'],
  ['views.changedOutside', { plural: 'Books' }, '"Books" changed outside Tegg. The views weren\'t changed.'],
  ['views.moved', { name: 'Rozečtené' }, 'Moved view Rozečtené'],
  ['views.brokenAllTypes', { thisType: 'Book' }, 'This view shows all types, not only Book. Edit view to fix it.'],
  ['query.editor.usedOnPage', { plural: 'Books', count: 1 }, 'Used on the Books page and 1 note. Changes apply everywhere.'],
  ['query.editor.usedOnPage', { plural: 'Books', count: 3 }, 'Used on the Books page and 3 notes. Changes apply everywhere.'],
  ['query.editor.showFixed', { plural: 'Books' }, 'fixed: a view of the Books page'], ['query.editor.board', {}, 'Board'], ['query.editor.groupBy', {}, 'Group by'],
  ['query.editor.groupByHint', {}, 'one lane per option'], ['query.editor.lanes', {}, 'Lanes'], ['query.editor.onCards', {}, 'On cards'], ['query.editor.onCardsChange', {}, 'Change…'],
  ['board.lanes', {}, 'Lanes'], ['board.vertical', {}, 'Vertical'], ['board.horizontal', {}, 'Horizontal'], ['board.verticalTitle', {}, 'Vertical lanes'],
  ['board.horizontalTitle', {}, 'Horizontal lanes'], ['board.none', { attribute: 'Status' }, 'No Status'], ['board.excluded', {}, 'Not in this view'],
  ['board.excludedLong', { values: 'Reading and To read' }, 'Not in this view: its filter shows only Reading and To read.'],
  ['board.dragColumn', {}, 'Drag to move the column'], ['board.dragRow', {}, 'Drag to move the row'], ['board.collapse', { lane: 'Román' }, 'Collapse Román'],
  ['board.expand', { lane: 'Román' }, 'Expand Román'], ['board.newIn', { type: 'Book', lane: 'Reading' }, 'New Book in Reading'], ['board.newTile', { type: 'Book' }, 'New Book'],
  ['board.dropSet', { attribute: 'Status', lane: 'Reading' }, 'Drop to set Status: Reading'], ['board.dropAdd', { lane: 'Poezie' }, 'Drop to add Poezie'],
  ['board.moved', { title: 'Kniha o horách', lane: 'Reading' }, 'Moved "Kniha o horách" to Reading'], ['board.added', { title: 'Mapa bez severu', lane: 'Poezie' }, 'Added "Mapa bez severu" to Poezie'],
  ['board.leftView', { title: 'Noční vlak', lane: 'Read' }, 'Moved "Noční vlak" to Read. It no longer shows in this view.'],
  ['board.inlineKept', { tag: 'večerní', title: 'Světla přístavu' }, '#večerní is in the text of "Světla přístavu" and stays.'],
  ['board.card', { type: 'Book', title: 'Účetní ze Žižkova' }, 'Book: Účetní ze Žižkova'],
  ['board.changedOutside', { title: 'Kniha o horách' }, '"Kniha o horách" changed outside Tegg. Your change wasn\'t saved.'],
  ['board.laneMoved', { lane: 'To read' }, 'Moved lane To read'], ['board.laneCount', { count: 3 }, '3 cards'], ['board.laneCount', { count: 1 }, '1 card'],
  ['board.cardMenu.moveTo', {}, 'Move to'], ['board.cardMenu.alsoAdd', {}, 'Also add to'], ['board.resetOrder', {}, 'Reset lane order'],
  ['sort.button', {}, 'Sort'], ['sort.dialog', {}, 'Sort'], ['sort.by', {}, 'Sort by'], ['sort.then', {}, 'then by'], ['sort.add', {}, '+ Add sort'], ['sort.clear', {}, 'Clear'],
  ['sort.remove', {}, 'Remove'], ['sort.drag', {}, 'Drag to change the order'], ['sort.orderLabel', {}, 'Order'], ['sort.more', { count: 2 }, '+2'],
  ['sort.level', { n: 2, order: 'ascending' }, 'Sort level 2, ascending'], ['sort.ascending', {}, 'ascending'], ['sort.descending', {}, 'descending'],
  ['sort.order.textAsc', {}, 'A → Z'], ['sort.order.textDesc', {}, 'Z → A'], ['sort.order.dateAsc', {}, 'Oldest first'], ['sort.order.dateDesc', {}, 'Newest first'],
  ['sort.order.numberAsc', {}, 'Smallest first'], ['sort.order.numberDesc', {}, 'Largest first'], ['sort.order.optionFirst', { option: 'Excellent' }, 'Excellent first'],
  ['sort.order.checkAsc', {}, 'Unchecked first'], ['sort.order.checkDesc', {}, 'Checked first'],
  ['cmd.newView', {}, 'New view…'], ['cmd.editView', {}, 'Edit view'], ['cmd.nextView', {}, 'Next view'], ['cmd.previousView', {}, 'Previous view'],
  ['cmd.moveViewLeft', {}, 'Move view left'], ['cmd.moveViewRight', {}, 'Move view right'], ['cmd.switchLanes', {}, 'Switch lanes'], ['cmd.addSortLevel', {}, 'Add sort level'],
  ['cmd.resetLaneOrder', {}, 'Reset lane order'], ['cmd.cardNext', {}, 'Move card to next lane'], ['cmd.cardPrevious', {}, 'Move card to previous lane'],
  ['cmd.laneLeft', {}, 'Move lane left'], ['cmd.laneRight', {}, 'Move lane right'], ['cmd.laneUp', {}, 'Move lane up'], ['cmd.laneDown', {}, 'Move lane down'],
];
/** Reused keys (D-1812): not part of R192, they stay. */
const REUSED: Row[] = [
  ['typePage.views', {}, 'Views'], ['tasks.tagFilter', {}, 'Filter by tag'], ['task.more', { title: 'Dům u řeky' }, 'More actions for "Dům u řeky"'], ['pinned.open', {}, 'Open'],
];
const REMOVED = ['typePage.allView', 'views.notReady', 'ctl.filter', 'ctl.group', 'ctl.addView', 'ctl.addViewSettings', 'ctl.editView'];
const PREFIXES = ['views.', 'board.', 'sort.'];

test('nfr_oth_02_ac21_view_strings', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, unknown>;
  const bad: string[] = [];
  for (const [key, vars, want] of [...R192, ...REUSED]) {
    const got = key in en ? cat.t(key, vars) : 'missing';
    if (got !== want) bad.push(`${key} ${JSON.stringify(vars)}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, [], 'R192\'s keys (D-1812) with their English texts, and the reused keys');
  const keys = new Set(R192.map(([k]) => k));
  const extra = Object.keys(en).filter((k) => PREFIXES.some((p) => k.startsWith(p)) && !keys.has(k));
  assert.deepEqual(extra, [], 'no other `views.*`, `board.*`, `sort.*` key (exactly R192\'s)');
  for (const k of REMOVED) assert.ok(!(k in en), `${k} removed`);
  for (const k of ['query.editor.sort', 'query.editor.asc', 'query.editor.desc']) assert.ok(k in en, `${k} stays (slice Q's list, §4.6)`);
});

test('nfr_oth_02_ac21_view_strings_czech_plurals', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, unknown>;
  for (const k of ['board.laneCount', 'query.editor.usedOnPage']) assert.ok(k in en, `${k} in the catalog`);
  cat.setCatalog({
    ...en,
    'board.laneCount': { one: '{count} karta', few: '{count} karty', other: '{count} karet' },
    'query.editor.usedOnPage': { one: 'Na stránce {plural} a v {count} poznámce.', few: 'Na stránce {plural} a ve {count} poznámkách.', other: 'Na stránce {plural} a v {count} poznámkách.' },
  }, 'cs');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('board.laneCount', { count: n })), ['1 karta', '3 karty', '5 karet'], 'board.laneCount: one, few, other');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('query.editor.usedOnPage', { plural: 'Knihy', count: n })),
    ['Na stránce Knihy a v 1 poznámce.', 'Na stránce Knihy a ve 3 poznámkách.', 'Na stránce Knihy a v 5 poznámkách.'], 'query.editor.usedOnPage: one, few, other');
});
