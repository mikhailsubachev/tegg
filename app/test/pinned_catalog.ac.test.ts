// Slice PIN, L1: docs/acceptance/pinned.md NFR-OTH-02 AC-16 (R137 and D-1392's `typeEntry.menu`): the catalog has exactly the
// slice's keys with their English texts, plurals by `Intl.PluralRules` (D-133), the Czech test catalog for 1, 3 and 5, and
// the commands' titles are these keys. Interface docs/contracts/v1-pinned.md §3.3, §3.4. Written from the ACs and the
// contract only (D-61). Modules load inside the tests (TS-I1).
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

/** R137 (+ D-1392), with the variables each text is checked with. */
const R137: [string, Record<string, string | number>, string][] = [
  ['pinned.section', {}, 'Pinned'], ['pinned.countA11y', { count: 1 }, '1 pinned item'], ['pinned.countA11y', { count: 5 }, '5 pinned items'],
  ['pinned.empty', { path: '⋯ › Pin to sidebar' }, 'Drag things here, or use ⋯ › Pin to sidebar.'], ['pinned.emptyPath', {}, '⋯ › Pin to sidebar'],
  ['pinned.grip', {}, 'Drag to reorder'], ['pinned.unpinNamed', { label: 'Rozpočet 2027' }, 'Unpin Rozpočet 2027'], ['pinned.unpin', {}, 'Unpin'],
  ['pinned.menu', {}, 'Pinned item'], ['pinned.open', {}, 'Open'], ['pinned.moveUp', {}, 'Move up'], ['pinned.moveDown', {}, 'Move down'],
  ['pinned.kind.tag', {}, 'Tag'], ['pinned.kind.type', {}, 'Type page'], ['pinned.state.pending', {}, 'Loading'], ['pinned.state.trashed', {}, 'In the trash'],
  ['pinned.state.missing', {}, 'Not found'], ['pinned.state.empty', {}, 'No objects'],
  ['pinned.missingAlert', { label: 'Výjezd Lisabon 2026' }, '“Výjezd Lisabon 2026” can\'t be found. It was deleted, or moved outside Tegg.'],
  ['pinned.moved', { position: 3, total: 5 }, 'Moved to position 3 of 5'], ['pinned.pinnedAnnounce', { label: 'Čajovna' }, 'Pinned Čajovna'],
  ['pinned.unpinnedAnnounce', { label: 'Čajovna' }, 'Unpinned Čajovna'], ['pinned.badge', {}, 'Pin'], ['pinned.notSaved', {}, 'Available once the object is saved.'],
  ['pinned.unreadable', {}, 'The pins file can\'t be read.'], ['pinned.unreadableLine', { line: 5 }, 'The pins file can\'t be read (line 5).'],
  ['pinned.fixFile', {}, 'Fix .tegg/pinned.yml to change pins.'], ['pinned.newer', {}, 'Made by a newer version of Tegg. Read-only.'],
  ['pinned.changedOutside', {}, 'Pins changed outside Tegg. Your change wasn\'t saved.'], ['pinned.saveFailed', {}, 'Couldn\'t save the pins. Try again.'],
  ['cmd.pin', {}, 'Pin to sidebar'], ['cmd.unpin', {}, 'Unpin from sidebar'], ['searchResult.menu', {}, 'Search result'], ['tagsAll.rowMenu', {}, 'Tag'],
  ['typeEntry.menu', { name: 'Schůzka' }, 'Schůzka actions'],
];

test('nfr_oth_02_ac16_pins_strings', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, unknown>;
  const bad: string[] = [];
  for (const [key, vars, want] of R137) {
    const got = key in en ? cat.t(key, vars) : 'missing';
    if (got !== want) bad.push(`${key} ${JSON.stringify(vars)}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, [], 'R137\'s keys with their English texts');
  const keys = new Set(R137.map(([k]) => k));
  const extra = Object.keys(en).filter((k) => k.startsWith('pinned.') && !keys.has(k));
  assert.deepEqual(extra, [], 'no other `pinned.*` key');
  for (const k of ['route.pinned', 'purpose.pinned', 'cmd.goto.pinned']) assert.ok(!(k in en), `${k} removed with the route`);
  const cmd = await load('../ui/src/shell/commands.ts');
  const l = (cmd?.commands({ vault: { name: 'P', path: '/tmp/P', placeholders: 0 }, types: [], counts: {}, route: { id: 'type/<type>', param: 'schůzka' }, actions: { pinStatus: () => ({ pinned: false, disabled: null }) } }) ?? []) as any[];
  assert.equal(l.find((c) => c.id === 'sidebar.pin')?.title, 'cmd.pin', 'sidebar.pin\'s title is the key cmd.pin');
});

test('nfr_oth_02_ac16_pins_strings_czech_plurals', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, unknown>;
  assert.ok('pinned.countA11y' in en, 'pinned.countA11y in the catalog');
  cat.setCatalog({ ...en, 'pinned.countA11y': { one: '{count} připnutá položka', few: '{count} připnuté položky', other: '{count} připnutých položek' } }, 'cs');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('pinned.countA11y', { count: n })), ['1 připnutá položka', '3 připnuté položky', '5 připnutých položek'], 'one, few, other');
});
