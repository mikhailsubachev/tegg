// New objects from `/` and `+`, L1: the menu model and the strings (docs/acceptance/new-object-menu.md R234, R235, R238;
// contract docs/contracts/new-object-menu.md §1, §2, §4). FR-EDT-03 AC-6 (the rows of R234 in order, 23 with the
// fixture's types), AC-7 (the New rows from the vault's creatable types, D-122 order by region, never Daily Note, Tag,
// Image, PDF or an unparsable type), AC-8 (filtering and the `+` ranking, D-2627), AC-9 (the `+` trigger rule, D-2625),
// NFR-OTH-02 AC-28 (R238's catalog keys, `slash.task` gone, the pseudo-locale). Modules load dynamically (TS-I1):
// `app/ui/src/edit/slashMenu.ts` doesn't exist yet. Written from the ACs and the contract only (D-61).
import { beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
type Type = { key: string; name: string; plural: string; folder: string; icon: string; color: string; system: boolean; invalid: boolean };
const T = (key: string, name: string, plural: string, icon: string, system = true, invalid = false): Type => ({ key, name, plural, folder: plural, icon, color: 'gray', system, invalid });
/** The tasks fixture's types (new-empty/.tegg plus projekt.yml). */
const FIXTURE: Type[] = [
  T('page', 'Page', 'Pages', 'file-text'), T('task', 'Task', 'Tasks', 'check-square'), T('quick-note', 'Quick Note', 'Quick Notes', 'zap'),
  T('daily-note', 'Daily Note', 'Daily', 'calendar'), T('tag', 'Tag', 'Tags', 'hash'), T('image', 'Image', 'Images', 'image'), T('pdf', 'PDF', 'PDFs', 'file'),
  T('projekt', 'Projekt', 'Projekty', 'folder', false),
];
/** Plus the runtime types of AC-7: Cvičení, Čaj and the unparsable rozbity.yml. */
const RUNTIME: Type[] = [...FIXTURE, T('cviceni', 'Cvičení', 'Cvičení', 'file-text', false), T('caj', 'Čaj', 'Čaje', 'file-text', false), T('rozbity', 'rozbity', 'rozbity', 'file-text', false, true)];

async function mods() {
  const menu = await load('../ui/src/edit/slashMenu.ts');
  const col = await load('../ui/src/i18n/collate.ts');
  const cat = await load('../ui/src/i18n/catalog.ts');
  assert.ok(menu && typeof menu.menuRows === 'function' && typeof menu.creatableTypes === 'function' && typeof menu.plusOpens === 'function',
    'app/ui/src/edit/slashMenu.ts exports creatableTypes, menuRows and plusOpens (new-object-menu contract §2)');
  return { menu: menu!, col: col!, cat: cat! };
}
beforeEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
  (await load('../ui/src/i18n/collate.ts'))?.setCollationLocale?.('cs');
});
type Row = { id: string; group: string; label: string; disabled: boolean; type?: string; icon?: string };
const labels = (rows: Row[]) => rows.map((r) => r.label);

const R234 = [
  'Text', 'Heading 1', 'Heading 2', 'Heading 3', 'Bulleted list', 'Numbered list', 'Checklist', 'Mindmap', 'Quote', 'Callout', 'Code block', 'Divider', 'Table',
  'Turn into object…', 'Embed object', 'Image', 'PDF', 'Query', 'Block embed', 'New Page', 'New Task', 'New Quick Note', 'New Projekt',
];

test('fr_edt_03_ac6_the_menu_model_lists_r234_in_order', async () => {
  const { menu } = await mods();
  const rows = menu.menuRows({ types: FIXTURE, query: '', trigger: '/' }) as Row[];
  assert.deepEqual(labels(rows), R234, 'the 23 options of R234 in order');
  assert.deepEqual([...new Set(rows.map((r) => r.group))], ['blocks', 'objects', 'media', 'advanced', 'newObject'], 'groups Blocks, Objects, Media, Advanced, New object');
  assert.equal(rows.filter((r) => r.label === 'Task').length, 0, 'no `Task` row (D-2611)');
  assert.deepEqual(rows.filter((r) => r.disabled).map((r) => r.label), ['Block embed'], 'only Block embed is disabled');
  const news = rows.filter((r) => r.group === 'newObject');
  assert.deepEqual(news.map((r) => [r.type, r.icon]), [['page', 'file-text'], ['task', 'check-square'], ['quick-note', 'zap'], ['projekt', 'folder']], 'each New row: its type key and the type file\'s icon');
});

test('fr_edt_03_ac7_creatable_types_in_region_order', async () => {
  const { menu, col } = await mods();
  const names = (ts: Type[]) => (menu.creatableTypes(ts) as Type[]).map((t) => t.name);
  col.setCollationLocale('cs');
  assert.deepEqual(names(RUNTIME), ['Page', 'Task', 'Quick Note', 'Cvičení', 'Čaj', 'Projekt'], 'region cs: Page, Task, Quick Note, then the user types (D-122)');
  assert.deepEqual(labels((menu.menuRows({ types: RUNTIME, query: '', trigger: '/' }) as Row[]).filter((r) => r.group === 'newObject')), ['New Page', 'New Task', 'New Quick Note', 'New Cvičení', 'New Čaj', 'New Projekt'], 'the New rows (cs)');
  col.setCollationLocale('en-US');
  assert.deepEqual(names(RUNTIME), ['Page', 'Task', 'Quick Note', 'Čaj', 'Cvičení', 'Projekt'], 'region en-US');
  assert.ok(!names(RUNTIME).some((n) => ['Daily Note', 'Tag', 'Image', 'PDF', 'rozbity'].includes(n)), 'never Daily Note, Tag, Image, PDF or an unparsable type');
  const renamed = RUNTIME.map((t) => (t.key === 'projekt' ? { ...t, name: 'Záměr' } : t)).filter((t) => t.key !== 'caj');
  col.setCollationLocale('cs');
  assert.deepEqual(names(renamed), ['Page', 'Task', 'Quick Note', 'Cvičení', 'Záměr'], 'a renamed type shows its new name; a deleted one is gone');
});

test('fr_edt_03_ac8_filtering_and_the_plus_ranking', async () => {
  const { menu } = await mods();
  const q = (query: string, trigger: '/' | '+', types = FIXTURE) => labels(menu.menuRows({ types, query, trigger }) as Row[]);
  assert.deepEqual(q('task', '/'), ['New Task'], '/task lists exactly New Task');
  assert.deepEqual(q('TASK', '/'), ['New Task'], '/TASK');
  assert.deepEqual(q('task', '+'), ['New Task'], '+task');
  assert.deepEqual(q('new', '/'), ['New Page', 'New Task', 'New Quick Note', 'New Projekt'], '/new in that order');
  assert.deepEqual(q('pro', '+'), ['New Projekt'], '+pro lists exactly New Projekt');
  assert.equal(q('quick', '/')[0], 'New Quick Note', '/quick: New Quick Note first');
  assert.equal(q('caj', '+', RUNTIME)[0], 'New Čaj', '+caj: New Čaj first (folded diacritics)');
  assert.equal(q('čaj', '+', RUNTIME)[0], 'New Čaj', '+čaj');
  assert.equal(q('čaj'.normalize('NFD'), '+', RUNTIME)[0], 'New Čaj', '+čaj typed in NFD');
  assert.equal(q('tab', '/')[0], 'Table', '/tab: Table first');
  assert.equal(q('hea2', '/')[0], 'Heading 2', '/hea2: Heading 2 first');
  const plusTa = q('ta', '+');
  assert.equal(plusTa[0], 'New Task', '+ta: New Task first (D-2627)');
  assert.ok(plusTa.indexOf('Table') > 0, `+ta: Table below it (${plusTa.join(', ')})`);
  assert.equal(q('ta', '/')[0], 'Table', '/ta: Table first');
  assert.deepEqual(q('xyz', '/'), [], '/xyz: nothing');
  assert.deepEqual(q('xyz', '+'), [], '+xyz: nothing');
});

test('fr_edt_03_ac9_the_plus_trigger_rule', async () => {
  const { menu } = await mods();
  const cases: [string, boolean][] = [
    ['', true], ['Úvodní odstavec. ', true], ['Úvodní\t', true], ['řádek\n', true],
    ['Úvodní odstavec.', false], ['a', false], ['C', false], ['C+', false], ['1', false], ['(', false], ['.', false], [',', false], ['Úvodní odstavec. a', false],
  ];
  const got = cases.map(([before]) => [before, menu.plusOpens(before)]);
  assert.deepEqual(got, cases, 'R235: `+` opens at a block start or after whitespace; never inside a word or after punctuation (D-2625)');
});

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-28 (L1)

const R238: [string, string, Record<string, string>][] = [
  ['slash.group.newObject', 'New object', {}],
  ['slash.newObject', 'New Projekt', { type: 'Projekt' }],
  ['newObject.dialog', 'New Projekt', { type: 'Projekt' }],
  ['newObject.title', 'Title', {}],
  ['newObject.hint', 'Creates Projekty/Spuštění webu.md and links it here.', { path: 'Projekty/Spuštění webu.md' }],
  ['newObject.create', 'Create', {}],
  ['newObject.cancel', 'Cancel', {}],
  ['newObject.needTitle', 'Add a title', {}],
  ['newObject.failed', 'Couldn’t create "Nový plán". Nothing was changed.', { title: 'Nový plán' }],
  ['slash.label', 'Insert block', {}],
  ['slash.empty', 'No matching blocks', {}],
];

test('nfr_oth_02_ac28_r238_texts_are_catalog_keys_and_slash_task_is_gone', async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  assert.ok(cat, 'catalog loads');
  const en = cat!.en as Record<string, unknown>;
  assert.deepEqual(R238.filter(([k]) => !(k in en)).map(([k]) => k), [], 'every R238 key is in the catalog');
  assert.deepEqual(R238.map(([k, , v]) => cat!.t(k, v)), R238.map(([, text]) => text), 'their English texts');
  assert.equal('slash.task' in en, false, '`slash.task` is gone (D-2611)');
  cat!.setCatalog(cat!.pseudo(cat!.en), 'en');
  const bare = R238.map(([k, , v]) => cat!.t(k, v) as string).filter((s) => !/^⟦.*⟧$/s.test(s));
  assert.deepEqual(bare, [], 'the pseudo-locale wraps each, user content (type names, titles, paths) inside the frame');
});
