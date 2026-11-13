// Slice I2, L1: docs/acceptance/import-capacities.md NFR-OTH-02 AC-18, the catalog part: exactly R155's keys with their
// English texts, plus the 43 keys of D-1572 and D-1583 (docs/contracts/v1-import-window.md §5.2), without
// `import.types.tags`; the report's words `import.report.*` equal `REPORT_ENGLISH` of crates/tegg-import/src/lib.rs
// (§5.1); plurals use `Intl.PluralRules` and the Czech test catalog shows `import.preview.go`, `import.where.repeat`
// and `import.space.counts` at 1, 3 and 5; the app menu's `cmd.import` row of app/src-tauri/src/strings.rs equals the
// catalog (§4.1); the removed route keys are gone (§4.4). Written from the ACs and the contract only (D-61). The catalog
// loads inside the tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
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
const NO_UNDO = 'This import can’t be undone. A backup from before it is in Settings › Backups. Restoring it brings back your earlier files and leaves the imported ones in place.';
/** R155 (with the QA follow-up rows), each with the variables its text is checked with. Plural keys are checked at 5. */
const R155: Row[] = [
  ['import.title', {}, 'Import'], ['import.titleCapacities', {}, 'Import from Capacities'], ['import.titleDone', {}, 'Import finished'],
  ['import.step', { n: 3, total: 6 }, 'Step 3 of 6'], ['import.steps.source', {}, 'Source'], ['import.steps.space', {}, 'Space'], ['import.steps.where', {}, 'Where'],
  ['import.steps.mapping', {}, 'Mapping'], ['import.steps.preview', {}, 'Preview'], ['import.steps.import', {}, 'Import'], ['import.back', {}, 'Back'],
  ['import.cancel', {}, 'Cancel'], ['import.continue', {}, 'Continue'], ['import.hide', {}, 'Hide'], ['import.close', {}, 'Close'],
  ['import.source.group', {}, 'Source'], ['import.source.capacities', {}, 'Capacities export'], ['import.source.capacitiesHelp', {}, 'A .zip or folder exported from Capacities.'],
  ['import.source.obsidian', {}, 'Obsidian vault or Markdown folder'], ['import.source.obsidianHelp', {}, 'Open it in place, or copy it into a new vault.'],
  ['import.source.notionAnytype', {}, 'Notion · Anytype'], ['import.source.later', {}, 'Later'],
  ['import.drop', {}, 'Drop a Capacities export here'], ['import.dropHelp', {}, 'A .zip file or an already extracted folder'], ['import.chooseZip', {}, 'Choose zip…'],
  ['import.chooseFolder', {}, 'Choose folder…'], ['import.reading', { done: '1 240', total: '3 180' }, 'Reading 1 240 of 3 180 files…'], ['import.readingName', {}, 'Reading the export'],
  ['import.stop', {}, 'Stop'], ['import.readSafe', {}, 'Reading the export changes nothing in your vault.'],
  ['import.unreadableCount', { count: 5 }, '5 files couldn’t be read. They will be listed in the report.'],
  ['import.spaces', { count: 3 }, 'This export has 3 spaces. One space is imported at a time.'], ['import.space.group', {}, 'Space'],
  ['import.space.counts', { objects: 5, types: 5 }, '5 objects · 5 types'],
  ['import.space.hint', {}, 'Run the import again for the other spaces. Their types are matched to the types you already have.'],
  ['import.where.group', {}, 'Destination'], ['import.where.new', {}, 'A new vault'], ['import.where.recommended', {}, 'Recommended'],
  ['import.where.newHelp', {}, 'Keeps the import apart from your current notes.'], ['import.where.newName', { space: 'PKM' }, 'Capacities · PKM'], ['import.where.change', {}, 'Change…'],
  ['import.where.current', { vault: 'Osobní' }, 'This vault · Osobní'],
  ['import.where.currentHelp', { count: 5 }, 'Adds the objects next to your 5 notes. A backup zip of the vault is made first.'],
  ['import.where.repeat', { count: 5 }, '5 objects were already imported into this vault. Importing again creates duplicates, so a new vault is recommended.'],
  ['import.types.colSource', {}, 'In Capacities'], ['import.types.colTarget', {}, 'Becomes in Tegg'], ['import.types.colAttributes', {}, 'Attributes'],
  ['import.types.new', {}, 'New'], ['import.types.stub', {}, 'stub'], ['import.types.status', { mapped: 3, total: 5 }, '3 of 5 mapped'],
  ['import.types.statusA11y', { mapped: 3, total: 5 }, 'Map attributes, 3 of 5 mapped'], ['import.types.none', {}, 'None'],
  ['import.types.hint', { count: 5, example: '3 of 5 mapped ›' }, '5 types still have attributes to map. Click a status, e.g. 3 of 5 mapped ›, to map that type’s attributes and values.'],
  ['import.types.menu', { source: 'People' }, 'People becomes'], ['import.types.noMatch', { source: 'People' }, 'No “People” type in this vault'],
  ['import.types.newType', { name: 'Person' }, 'New type “Person”'], ['import.types.rename', {}, 'rename…'], ['import.types.useExisting', {}, 'Use a type you have'],
  ['import.types.skip', {}, 'Don’t import'], ['import.types.skipped', { count: 31 }, '31 skipped'],
  ['import.attrs.title', { source: 'Tasks', target: 'Task' }, 'Tasks → Task'],
  ['import.attrs.summary', { mapped: 3, total: 5, keys: 'status and priority' }, '3 of 5 mapped · status and priority still need a look'],
  ['import.attrs.menu', { key: 'dueDate' }, 'dueDate becomes'], ['import.attrs.skip', {}, 'Don’t import'], ['import.attrs.values', { count: 5 }, '5 values'],
  ['import.attrs.merge', {}, 'Merge'], ['import.attrs.split', {}, 'Split'], ['import.attrs.valuesOf', { key: 'status' }, 'Values of status'], ['import.attrs.empty', {}, 'empty'],
  ['import.attrs.mergeNote', { a: 'HIgh', b: 'High', kept: 'High' }, 'HIgh and High look like the same value and will be merged into High.'],
  ['import.attrs.back', {}, 'Back to types'], ['import.attrs.done', {}, 'Done'],
  ['import.decide.case', { count: 5 }, '5 links differ only in case'], ['import.decide.caseExample', { link: '[[eva]]', title: 'Eva' }, '[[eva]] may mean Eva.'],
  ['import.decide.review', {}, 'Review…'], ['import.decide.ambiguous', { count: 5 }, '5 links match several objects'],
  ['import.decide.ambiguousHelp', {}, 'They will point at the first match and be marked as ambiguous in the report.'], ['import.decide.info', {}, 'Info'],
  ['import.decide.tagLike', { count: 5 }, '5 attribute links to tag-like objects'],
  ['import.decide.tagLikeExample', { key: 'status', link: '[[in progress]]' }, 'status: [[in progress]] can become a select value, not a link.'], ['import.decide.select', {}, 'Select'],
  ['import.preview.will', {}, 'Will be imported'], ['import.preview.objects', {}, 'Objects'], ['import.preview.objectsHelp', { types: 6, new: 1 }, '6 types · 1 new'],
  ['import.preview.attachments', {}, 'Attachments'], ['import.preview.attachmentsHelp', {}, 'into _attachments/'], ['import.preview.links', {}, 'Links'],
  ['import.preview.linksHelp', {}, 'rewritten by source ID'], ['import.preview.attention', {}, 'Needs attention after'], ['import.preview.unresolved', {}, 'Unresolved links'],
  ['import.preview.unresolvedHelp', {}, 'kept and marked'], ['import.preview.stubs', {}, 'Query stubs'], ['import.preview.stubsHelp', {}, 'needs rebuilding'],
  ['import.preview.notExported', {}, 'Not in the export, can’t be imported'], ['import.preview.notExportedList', {}, 'Query definitions · tag colours · comments'],
  ['import.preview.leftOut', {}, 'Left out'], ['import.preview.technical', {}, 'Technical attributes'], ['import.preview.kinds', { count: 5 }, '5 kinds'],
  ['import.preview.missing', {}, 'Missing files'],
  ['import.preview.nothingNew', { name: 'Capacities · PKM' }, 'Nothing has been written yet. A new vault Capacities · PKM will be created.'],
  ['import.preview.nothingCurrent', { count: 5, vault: 'Osobní' }, 'Nothing has been written yet. 5 objects will be added to Osobní after a backup.'],
  ['import.preview.go', { count: 5 }, 'Import 5 objects'],
  ['import.run.read', {}, 'Reading the export'], ['import.run.files', { count: 5 }, '5 files'], ['import.run.create', {}, 'Creating the vault'],
  ['import.run.backup', {}, 'Backing up the vault'], ['import.run.objects', {}, 'Writing objects'], ['import.run.attachments', {}, 'Copying attachments'],
  ['import.run.report', {}, 'Writing the report'], ['import.run.of', { done: 2, total: 3 }, '2 of 3'],
  ['import.run.note', {}, 'Writing can’t be stopped half-way. You can keep working in Tegg; this window can be closed and the progress stays in the status bar.'],
  ['import.run.waiting', {}, 'Waiting for another operation to finish'], ['import.status.running', { done: 2, total: 3 }, 'Importing 2 of 3'], ['import.status.done', {}, 'Import finished'],
  ['import.done.objects', { count: 5 }, '5 objects imported'], ['import.done.summary', { attachments: 4, links: 7, vault: 'Capacities · PKM' }, '4 attachments · 7 links · into Capacities · PKM'],
  ['import.done.report', { date: '2026-11-12' }, 'Import report · 2026-11-12'], ['import.done.unresolved', {}, 'Unresolved links'], ['import.done.unresolvedHelp', {}, 'with their location'],
  ['import.done.stubs', {}, 'Query stubs to rebuild'], ['import.done.ambiguous', {}, 'Ambiguous links'], ['import.done.merged', {}, 'Merged values'],
  ['import.done.dropped', {}, 'Dropped files'], ['import.done.openReport', {}, 'Open report'], ['import.done.openVault', {}, 'Open vault'], ['import.done.noUndo', {}, NO_UNDO],
  ['import.error.notCapacities', {}, 'This doesn’t look like a Capacities export. Choose the .zip file or the folder that Capacities exported.'],
  ['import.error.unreadableArchive', {}, 'This zip file can’t be read. Export it again from Capacities, or extract it and choose the folder.'],
  ['import.error.encrypted', {}, 'This zip file is password-protected. Extract it first, then choose the folder.'], ['import.error.empty', {}, 'This export has no objects.'],
  ['import.error.sourceChanged', {}, 'The export changed since it was read. Nothing was written.'], ['import.error.sourceGone', {}, 'The export can’t be read any more.'],
  ['import.error.targetExists', { name: 'Capacities · PKM' }, 'A folder named “Capacities · PKM” already exists there.'], ['import.error.targetNotWritable', {}, 'Tegg can’t write to that folder.'],
  ['import.error.targetInside', {}, 'Choose a folder outside your vaults and outside the export.'],
  ['import.error.noSpace', { needed: '230 MB', free: '100 MB' }, 'Not enough disk space: the import needs about 230 MB, 100 MB is free.'],
  ['import.error.backupFailed', {}, 'The backup couldn’t be made, so nothing was imported.'], ['import.error.stopped', { reason: 'the export changed' }, 'The import stopped: the export changed. Nothing was added.'],
  ['import.error.targetChanged', {}, 'Your vault’s types changed since the preview. Nothing was written.'],
  ['import.error.reason.fileAppeared', { path: 'Pages/Plán.md' }, 'a file appeared at Pages/Plán.md'], ['import.error.reason.sourceChanged', {}, 'the export changed'],
  ['import.readAgain', {}, 'Read again'], ['import.planAgain', {}, 'Plan again'], ['cmd.import', {}, 'Import…'],
];
/** §5.2: the 39 keys of D-1572 and the four of D-1583. */
const ADDED: Row[] = [
  ['import.source.laterHelp', {}, 'Coming later'], ['import.types.needsLook', {}, 'needs a look'], ['import.types.tagCollections', {}, 'Tag collections'],
  ['import.types.notExported', {}, 'Not in the export'], ['import.types.renameLabel', {}, 'Name of the new type'], ['import.attrs.newAttr', { name: 'status' }, 'New attribute “status”'],
  ['import.attrs.renameLabel', {}, 'Name of the new attribute'], ['import.attrs.kindGroup', {}, 'Kind'],
  ['import.attrs.kind.text', {}, 'text'], ['import.attrs.kind.number', {}, 'number'], ['import.attrs.kind.checkbox', {}, 'checkbox'], ['import.attrs.kind.date', {}, 'date'],
  ['import.attrs.kind.date-time', {}, 'date and time'], ['import.attrs.kind.date-range', {}, 'date range'], ['import.attrs.kind.select', {}, 'select'], ['import.attrs.kind.relation', {}, 'links'],
  ['import.attrs.useExisting', { type: 'Task' }, 'Use an attribute of Task'], ['import.attrs.valueMenu', { value: 'Not Started' }, 'Not Started becomes'],
  ['import.attrs.keepMenu', {}, 'Keep which spelling?'], ['import.attrs.linksTo', { type: 'Person' }, 'Links to Person'],
  ['import.attrs.refused', { key: 'priority' }, 'priority can’t be mapped that way. The earlier choice is back.'], ['import.decide.use', {}, 'Use this object'],
  ['import.decide.ambiguousRow', { link: '[[Plán]]', title: 'Plán' }, '[[Plán]] points to Plán'], ['import.decide.done', {}, 'Done'], ['import.planning', {}, 'Preparing the mapping…'],
  ['import.run.list', {}, 'Import steps'], ['import.run.statePending', {}, 'pending'], ['import.run.stateRunning', {}, 'running'], ['import.run.stateDone', {}, 'done'],
  ['import.run.cantStop', {}, 'Writing can’t be stopped half-way.'], ['import.quit.title', {}, 'An import is running. Quit anyway?'],
  ['import.quit.body', {}, 'Tegg will offer to undo the unfinished import the next time you open the vault.'], ['import.quit.keep', {}, 'Keep importing'],
  ['import.status.failed', {}, 'Import stopped'], ['import.error.reason.write', { path: 'Pages/Plán.md' }, 'Pages/Plán.md couldn’t be written'],
  ['import.error.reason.engine', {}, 'a note couldn’t be converted'],
  ['import.error.leftover', { name: 'Capacities · PKM' }, 'An unfinished import in “Capacities · PKM.tegg-importing” couldn’t be moved to the Trash. Move it yourself, then try again.'],
  ['import.error.generic', {}, 'Something went wrong. Nothing was written.'],
  ['job.interrupted.import', { space: 'PKM', done: 120, total: 310 }, 'Importing “PKM” was interrupted: 120 of 310 files written'],
  ['import.state.open', {}, 'open'], ['import.state.inProgress', {}, 'in progress'], ['import.state.done', {}, 'done'], ['import.state.cancelled', {}, 'cancelled'],
];
/** R155's keys marked "(plural)" (D-133). */
const PLURAL = ['import.unreadableCount', 'import.spaces', 'import.where.currentHelp', 'import.where.repeat', 'import.types.hint', 'import.types.skipped', 'import.attrs.values',
  'import.decide.case', 'import.decide.ambiguous', 'import.decide.tagLike', 'import.preview.kinds', 'import.preview.nothingCurrent', 'import.preview.go', 'import.run.files', 'import.done.objects'];
const REMOVED = ['route.import', 'purpose.import', 'cmd.goto.import', 'import.types.tags'];

test('nfr_oth_02_ac18_import_strings', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, unknown>;
  assert.equal(ADDED.length, 43, 'setup: §5.2 has 43 keys');
  const bad: string[] = [];
  for (const [key, vars, want] of [...R155, ...ADDED]) {
    const got = key in en ? cat.t(key, vars) : 'missing';
    if (got !== want) bad.push(`${key} ${JSON.stringify(vars)}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, [], 'R155\'s keys and §5.2\'s with their English texts');
  // Exactly these `import.*` keys (the report's words aside); the removed ones are gone.
  const keys = new Set([...R155, ...ADDED].map(([k]) => k));
  const extra = Object.keys(en).filter((k) => k.startsWith('import.') && !k.startsWith('import.report.') && !keys.has(k));
  assert.deepEqual(extra, [], 'no other `import.*` key (R155 plus §5.2, D-1572, D-1583)');
  for (const k of REMOVED) assert.ok(!(k in en), `${k} is not in the catalog`);
  for (const k of ['banner.dismiss', 'quit.anyway', 'backups.label.import']) assert.ok(k in en, `${k} is reused (§5.1, §5.2)`);
  // Plurals: count messages are plural forms, not plain strings (D-133); `import.space.counts` has two (one per count).
  for (const k of PLURAL) assert.notEqual(typeof en[k], 'string', `${k} has plural forms`);
  const two = en['import.space.counts'] as Record<string, unknown> | string;
  assert.ok(typeof two === 'object' && 'text' in two && 'objects' in two && 'types' in two, '`import.space.counts` takes a plural form for {objects} and one for {types}');
});

test('nfr_oth_02_ac18_import_strings: the Czech test catalog at 1, 3 and 5', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, unknown>;
  for (const k of ['import.preview.go', 'import.where.repeat', 'import.space.counts']) assert.ok(k in en, `${k} in the catalog`);
  cat.setCatalog({
    ...en,
    'import.preview.go': { one: 'Importovat {count} objekt', few: 'Importovat {count} objekty', other: 'Importovat {count} objektů' },
    'import.where.repeat': { one: '{count} objekt už byl importován.', few: '{count} objekty už byly importovány.', other: '{count} objektů už bylo importováno.' },
    'import.space.counts': {
      text: '{objects} · {types}',
      objects: { one: '{n} objekt', few: '{n} objekty', other: '{n} objektů' }, types: { one: '{n} typ', few: '{n} typy', other: '{n} typů' },
    },
  }, 'cs');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('import.preview.go', { count: n })), ['Importovat 1 objekt', 'Importovat 3 objekty', 'Importovat 5 objektů'], 'import.preview.go: one, few, other');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('import.where.repeat', { count: n })), ['1 objekt už byl importován.', '3 objekty už byly importovány.', '5 objektů už bylo importováno.'], 'import.where.repeat: one, few, other');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('import.space.counts', { objects: n, types: n })), ['1 objekt · 1 typ', '3 objekty · 3 typy', '5 objektů · 5 typů'], 'import.space.counts: one, few, other for both counts');
});

test('nfr_oth_02_ac18_import_strings: the report\'s words are REPORT_ENGLISH', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, unknown>;
  const file = resolve(REPO, 'crates/tegg-import/src/lib.rs');
  assert.ok(existsSync(file), 'crates/tegg-import/src/lib.rs');
  const src = readFileSync(file, 'utf8');
  const start = src.indexOf('const REPORT_ENGLISH');
  assert.ok(start >= 0, 'REPORT_ENGLISH is in lib.rs');
  const body = src.slice(start, src.indexOf('];', start));
  const rust = new Map([...body.matchAll(/\(\s*"([^"]+)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/g)].map((m) => [`import.report.${m[1]}`, m[2].replace(/\\(.)/g, '$1')]));
  assert.ok(rust.size >= 60, `REPORT_ENGLISH has the report's words (${rust.size})`);
  const missing = [...rust].filter(([k, v]) => en[k] !== v).map(([k, v]) => `${k}: want ${JSON.stringify(v)}, got ${JSON.stringify(en[k])}`);
  assert.deepEqual(missing, [], 'every REPORT_ENGLISH entry is in the catalog with the same text');
  const extra = Object.keys(en).filter((k) => k.startsWith('import.report.') && !rust.has(k));
  assert.deepEqual(extra, [], 'no other `import.report.*` key');
  assert.equal(en['import.report.stub.note'], 'This query was imported from Capacities. Its definition wasn’t exported, so it needs rebuilding.', 'import.report.stub.note (D-1580)');
  assert.equal(en['import.report.noUndo'], NO_UNDO, 'import.report.noUndo is R155\'s sentence');
});

test('nfr_oth_02_ac18_import_strings: the app menu\'s `cmd.import` in strings.rs equals the catalog', async () => {
  const cat = await catalog();
  const file = resolve(REPO, 'app/src-tauri/src/strings.rs');
  assert.ok(existsSync(file), 'app/src-tauri/src/strings.rs');
  const m = /"cmd\.import"\s*,\s*"([^"]*)"/.exec(readFileSync(file, 'utf8'));
  assert.ok(m, 'strings.rs has the row ("cmd.import", "…") (§4.1)');
  assert.equal(m![1], cat.t('cmd.import'), 'strings.rs `cmd.import` equals the catalog');
  assert.equal(m![1], 'Import…', '`Import…`');
});
