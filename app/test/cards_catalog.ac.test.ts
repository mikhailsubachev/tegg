// Slice OC, L1: the registry and catalog parts of docs/acceptance/cards.md (FR-UX-03 AC-54: R217's commands with their
// titles, no shortcut, `needsVault: true`, listed exactly where R217 says; NFR-OTH-02 AC-24: R217's keys with their
// English texts, the removed keys gone, plural forms through `Intl.PluralRules` with a Czech test catalog), types.md
// FR-TYP-01 AC-28 (the new labels of type settings come from the catalog) and app-shell.md FR-UX-02 AC-26 (R1's design
// entries after OC). Interface docs/contracts/v1-cards.md §9, §11 (D-2106, D-2107). Written from the ACs and the contract
// only (D-61). Modules load inside the tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { fixtureType } from './cards-data';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try { return (await import(/* @vite-ignore */ path)) as Mod; } catch { return null; }
}
async function mods() {
  const reg = await load('../ui/src/shell/registry.ts');
  const cat = await load('../ui/src/i18n/catalog.ts');
  const cmd = await load('../ui/src/shell/commands.ts');
  assert.ok(reg && cat && cmd, 'registry, catalog and commands modules load');
  return { reg: reg!, cat: cat!, cmd: cmd! };
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const VAULT = { name: 'Výlety a knihy', path: '/tmp/Výlety a knihy', placeholders: 0 };
const TYPES = ['výlet', 'book', 'tag', 'page', 'kontrola'].map(fixtureType);
function ctxOf(route: Record<string, unknown> | null, calls: unknown[] = []) {
  return {
    vault: VAULT, types: TYPES, counts: { výlet: 4, book: 17 }, route,
    actions: {
      go: (r: any) => calls.push(r),
      views: { status: () => null, run: (id: string) => calls.push(id) },
      queryStatus: () => null, pinStatus: () => null,
      cards: { add: () => calls.push('card.add'), reset: () => calls.push('card.reset'), changeIcon: () => calls.push('type.changeIcon') },
    },
  };
}
const R = {
  typeVylet: { id: 'type/<type>', param: 'výlet' }, typeTag: { id: 'type/<type>', param: 'tag' }, settingsVylet: { id: 'type-settings/<type>', param: 'výlet' },
  settingsBook: { id: 'type-settings/<type>', param: 'book' }, settingsTag: { id: 'type-settings/<type>', param: 'tag' },
  noteSnezka: { id: 'note/<path>', param: 'Výlety/Sněžka z Pece.md', path: 'Výlety/Sněžka z Pece.md', type: 'výlet' }, inbox: { id: 'inbox' },
};
/** R217: [id, title key, English title]. */
const R217: [string, string, string][] = [
  ['card.edit', 'cmd.card.edit', 'Edit card…'], ['card.add', 'cmd.card.add', 'Add property to card…'], ['card.reset', 'cmd.card.reset', 'Reset card to default'],
  ['type.changeIcon', 'cmd.type.changeIcon', 'Change type icon…'],
];

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-54

test('fr_ux_03_ac54_card_and_icon_commands', async () => {
  const { reg, cat, cmd } = await mods();
  const list = (route: Record<string, unknown> | null) => cmd.commands(ctxOf(route)) as any[];
  const ids = (route: Record<string, unknown> | null) => list(route).map((c) => c.id as string);
  const onSettings = list(R.settingsVylet);
  for (const [id, key, title] of R217) {
    const c = onSettings.find((x) => x.id === id);
    assert.ok(c, `${id} is listed on type-settings/výlet`);
    assert.deepEqual([c.title, key in cat.en ? cat.t(c.title, c.vars ?? {}) : 'missing', c.needsVault, c.shortcut ?? null], [key, title, true, null], `${id}: ${title}, needsVault, no shortcut`);
  }
  const where = (id: string) => Object.entries(R).filter(([, r]) => ids(r).includes(id)).map(([k]) => k).sort();
  assert.deepEqual(where('card.edit'), ['noteSnezka', 'settingsBook', 'settingsVylet', 'typeVylet'], 'Edit card… on type/, note/ (its type) and type-settings/, never Tag');
  assert.deepEqual(where('card.add'), ['settingsBook', 'settingsVylet'], 'Add property to card… on type-settings/ (not Tag)');
  assert.deepEqual(where('card.reset'), ['settingsVylet'], 'Reset card to default only where the type has a card: key');
  assert.deepEqual(where('type.changeIcon'), ['settingsBook', 'settingsTag', 'settingsVylet', 'typeTag', 'typeVylet'], 'Change type icon… on type/ and type-settings/ of defined types');
  const calls: any[] = [];
  const ctx = ctxOf(R.typeVylet, calls);
  await (cmd.commands(ctx) as any[]).find((c) => c.id === 'card.edit')?.run(ctx);
  assert.ok(calls.length === 1 && calls[0].section === 'card' && calls[0].focus === 'card.add' && JSON.stringify(calls[0]).includes('výlet'), `Edit card… goes to type-settings/výlet, section card, focus Add property: ${JSON.stringify(calls)}`);
  const sc = (reg.SHORTCUTS as { command: string }[]).filter((s) => /^(card\.|type\.changeIcon)/.test(s.command));
  assert.deepEqual(sc, [], 'no shortcut (D-2107)');
  for (const k of ['card.move', 'property.icon', 'card.add', 'card.reset']) assert.ok(k in cmd.CONTROL_COMMANDS, `FR-UX-03 AC-8's control map has ${k}`);
});

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-24

type Row = [string, Record<string, string | number>, string];
const KEYS: Row[] = [
  ['card.pill', { name: 'Stav', value: 'Hotový' }, 'Stav: Hotový'], ['card.more', { count: 4 }, '+4 more'], ['card.moreHint', { items: 'Vybavení: Svačina' }, 'Not shown: Vybavení: Svačina'],
  ['card.editedToday', {}, 'Edited today'], ['card.editedYesterday', {}, 'Edited yesterday'], ['card.editedOn', { date: 'Mon' }, 'Edited Mon'],
  ['card.createdToday', {}, 'Created today'], ['card.createdYesterday', {}, 'Created yesterday'], ['card.createdOn', { date: 'Fri' }, 'Created Fri'],
  ['card.addedToday', {}, 'Added today'], ['card.addedYesterday', {}, 'Added yesterday'], ['card.addedOn', { date: 'Mon' }, 'Added Mon'],
  ['card.localLink', { name: 'Podklady k výletům' }, '↗ Podklady k výletům'], ['card.source', {}, 'Source'],
  ['typeSettings.card', {}, 'Card'], ['typeSettings.cardHint', {}, 'Title plus the properties you pick.'], ['typeSettings.cardList', {}, 'Card properties'],
  ['typeSettings.cardTitle', {}, 'Title'], ['typeSettings.cardAlways', {}, 'Always shown'], ['typeSettings.cardKind.tags', {}, '#chips'],
  ['typeSettings.cardKind.text', {}, 'text · 2 lines'], ['typeSettings.cardKind.pill', {}, 'pill'], ['typeSettings.cardKind.link', {}, 'link chip'],
  ['typeSettings.cardKind.date', {}, 'date, bottom right'], ['typeSettings.cardAdd', {}, 'Add property'], ['typeSettings.cardFind', {}, 'Find a property…'],
  ['typeSettings.cardGroupType', { name: 'Výlet' }, 'Výlet properties'], ['typeSettings.cardGroupBuiltIn', {}, 'Built in'],
  ['typeSettings.cardNoMatch', { query: 'xyz' }, 'No properties match “xyz”.'], ['typeSettings.cardAllAdded', {}, 'Every property is on the card'],
  ['typeSettings.cardRemove', { name: 'Kraj' }, 'Remove Kraj from the card'], ['typeSettings.cardDrag', { name: 'Kraj' }, 'Drag to reorder Kraj'],
  ['typeSettings.cardReset', {}, 'Reset to default'], ['typeSettings.cardIsDefault', {}, 'Already the default'], ['typeSettings.cardExample', {}, 'Example card'],
  ['typeSettings.cardExampleEmpty', { plural: 'Prázdné' }, 'No Prázdné yet'], ['typeSettings.cardUnknown', { type: 'Výlet', keys: 'neznámý-klíč' }, 'Not a property of Výlet, kept in the file: neznámý-klíč'],
  ['typeSettings.cardUnreadable', { file: '.tegg/types/výlet.yml' }, 'The card setting in .tegg/types/výlet.yml can\'t be read. Fix it in the file to change the card.'],
  ['typeSettings.cardFixed', {}, 'Fixed by Tegg: the type icon (Task: its checkbox), the file preview of Images and PDFs, and Unreviewed while the review workflow is on.'],
  ['typeSettings.embedCardNote', {}, 'Card uses the Card section above.'], ['typeSettings.propertyIcon', { name: 'Kraj' }, 'Icon for Kraj'], ['attr.body', {}, 'Body'],
  ['iconPicker.title', { name: 'Náročnost' }, 'Icon for Náročnost'], ['iconPicker.search', {}, 'Search icons…'], ['iconPicker.suggested', { name: 'Map' }, 'Suggested for “Map”'],
  ['iconPicker.recent', {}, 'Recent'], ['iconPicker.all', {}, 'All icons'], ['iconPicker.none', {}, 'None (show the name)'],
  ['iconPicker.noMatch', { query: 'kanbanx' }, 'No icons for “kanbanx”. Try another word.'], ['iconPicker.current', {}, 'Current'],
  ['cmd.card.edit', {}, 'Edit card…'], ['cmd.card.add', {}, 'Add property to card…'], ['cmd.card.reset', {}, 'Reset card to default'], ['cmd.type.changeIcon', {}, 'Change type icon…'],
  // Contract §9 additions.
  ['typeSettings.viewsList', { plural: 'Books' }, 'Views of Books'], ['typeSettings.viewDefault', {}, 'Default · always first'], ['typeSettings.viewKindBy', { display: 'Wall', attribute: 'Status' }, 'Wall · by Status'] /* slice Q3 (AC-Test-Change, D-2196; R227) */,
  ['typeSettings.viewEdit', {}, 'Edit'], ['typeSettings.viewDrag', { name: 'Rozečtené' }, 'Drag to reorder Rozečtené'], ['typeSettings.noIcon', {}, 'No icon'],
  ['typeSettings.cardMoved', { name: 'Kraj', position: 3 }, 'Moved Kraj to position 3'], ['iconPicker.resultsGroup', {}, 'Results'], ['iconPicker.results', { count: 1 }, '1 icon'],
  ['iconPicker.results', { count: 7 }, '7 icons'], ['iconPicker.loadFailed', {}, 'Icons couldn\'t be loaded. Try again.'], ['ts.section.card', {}, 'Card'], ['ts.section.views', {}, 'Views'],
];
const REMOVED = ['ts.addPreview', 'ts.addPreviewMenu', 'ts.previewFull', 'ts.previewIgnored', 'ts.removePreview', 'typeRule.previewFull'];
const R14 = ['file-text', 'check-square', 'zap', 'calendar', 'hash', 'image', 'file', 'book', 'book-open', 'lightbulb', 'users', 'user', 'folder', 'map', 'star', 'flag', 'bookmark',
  'briefcase', 'coffee', 'globe', 'graduation-cap', 'pen-line', 'utensils', 'plane'];
const KEPT = ['preview.properties', 'board.card', 'board.none', 'task.more', 'task.complete', 'panel.checked', 'link.unreviewed', 'ts.conflict', 'ts.newer', 'ts.icon', 'ts.changeIcon'];

test('nfr_oth_02_ac24_card_and_picker_strings', async () => {
  const { cat } = await mods();
  const en = cat.en as Record<string, unknown>;
  const bad: string[] = [];
  for (const [key, vars, want] of KEYS) {
    const got = key in en ? cat.t(key, vars) : 'missing';
    if (got !== want) bad.push(`${key} ${JSON.stringify(vars)}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, [], 'R217\'s keys and the contract\'s §9 keys with their English texts');
  assert.deepEqual(REMOVED.filter((k) => k in en), [], 'the Preview properties section\'s own keys are gone');
  assert.deepEqual(R14.map((n) => `icon.${n}`).filter((k) => k in en), [], 'R14\'s icon.<name> labels are gone (icons are named by their Lucide name)');
  assert.deepEqual(KEPT.filter((k) => !(k in en)), [], 'the reused keys stay (preview.properties too, D-2111)');
  cat.setCatalog({ ...en, 'card.more': { one: '+{count} další', few: '+{count} další', other: '+{count} dalších' } }, 'cs');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('card.more', { count: n })), ['+1 další', '+3 další', '+5 dalších'], 'card.more through Intl.PluralRules: one, few, other');
});

// ------------------------------------------------------------------------------------------------ types.md FR-TYP-01 AC-28

test('fr_typ_01_ac28_type_settings_strings_themes_keyboard', async () => {
  const { cat } = await mods();
  const want: Row[] = [
    ['typeSettings.viewsList', { plural: 'Books' }, 'Views of Books'], ['typeSettings.viewDefault', {}, 'Default · always first'], ['typeSettings.viewKindBy', { display: 'Wall', attribute: 'Status' }, 'Wall · by Status'] /* slice Q3 (AC-Test-Change, D-2196; R227) */,
    ['views.remove', { plural: 'Books' }, 'Remove from Books page'], ['typeSettings.propertyIcon', { name: 'Kraj' }, 'Icon for Kraj'], ['typeSettings.noIcon', {}, 'No icon'],
  ];
  const en = cat.en as Record<string, unknown>;
  assert.deepEqual(want.filter(([k, v, t]) => !(k in en) || cat.t(k, v) !== t).map(([k]) => k), [], 'the new labels of type settings come from the catalog');
});

// ------------------------------------------------------------------------------------------------ app-shell FR-UX-02 AC-26

const SETTINGS = ['settings/appearance', 'settings/date-time', 'settings/vault', 'settings/shortcuts', 'settings/menu-bar', 'settings/backups', 'settings/trash-history', 'settings/previews'];

test('fr_ux_02_ac26_settings_design_entries', async () => {
  const { reg } = await mods();
  const routes = reg.ROUTES as { id: string; design: string | null; status?: { built?: boolean } }[];
  assert.deepEqual(SETTINGS.map((id) => [id, routes.find((r) => r.id === id)?.design ?? null]), SETTINGS.map((id) => [id, 'Settings']), 'the eight settings routes: design Settings');
  assert.equal(routes.find((r) => r.id === 'type-settings/<type>')?.design, 'CardSettings', 'type-settings/<type>: design CardSettings (D-2106)');
  const th = routes.find((r) => r.id === 'settings/trash-history');
  // D-2147: the registry's own shape, `status.built === false` (registry.ts `tbd`).
  assert.ok(th && th.status?.built === false, 'settings/trash-history stays TBD');
});
