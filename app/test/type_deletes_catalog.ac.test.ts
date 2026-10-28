// Slice 4E-2, L1: the catalog strings of the 4E-2 dialogs, statuses, the deleted-type route, the widen-only menu's
// footer, the key description, the backup labels and the R100 commands (docs/acceptance/type-moves.md R99 sections C,
// D, E, F, R100; NFR-OTH-02 AC-10 "every R99 text is a catalog key with plural forms where it has a count"; FR-UX-03
// AC-18 "R100's commands run from the palette"). Interface docs/contracts/ms4-jobs.md §14.9.1 (labels
// `backups.label.valueRemove`, `backups.label.typeDelete`), §14.9.4 (commands `job.undo.valueRemove`,
// `job.undo.typeDelete`), §14.9.8 (keys `job.valueRemove.running` / `done`, `job.typeDelete.running` / `done` /
// `keptType`). Where the contract names no key, the text is found by its shape as in type_moves_catalog.ac.test.ts: a
// catalog message whose English text, with every `{placeholder}` as `{}`, equals R99's text with every `<placeholder>`
// as `{}` (plural messages: each form; `{ text, … }` messages: the text with each counted part's `other` form).
// Written from the ACs and the contract only (D-61). Modules load inside the tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { catalog, load } from './read-helpers';

afterEach(async () => {
  const cat = await catalog().catch(() => null);
  cat?.setCatalog(cat.en, 'en');
});

type Msg = string | Record<string, unknown>;
const hole = (s: string) => s.replace(/\{[^}]+\}/g, '{}');
function forms(m: Msg): { texts: string[]; plural: boolean } {
  if (typeof m === 'string') return { texts: [hole(m)], plural: false };
  if (typeof (m as any).text === 'string') {
    let t = (m as any).text as string;
    let plural = false;
    for (const [k, v] of Object.entries(m)) {
      if (k === 'text' || typeof v !== 'object' || v === null) continue;
      plural = true;
      t = t.replace(`{${k}}`, String((v as any).other ?? ''));
    }
    return { texts: [hole(t)], plural };
  }
  return { texts: Object.values(m).filter((v): v is string => typeof v === 'string').map(hole), plural: 'other' in m && Object.keys(m).length > 1 };
}
function keysFor(en: Record<string, Msg>, shape: string, part = false): { key: string; plural: boolean }[] {
  const want = shape.replace(/<[^>]+>/g, '{}');
  return Object.entries(en).flatMap(([key, m]) => {
    const f = forms(m);
    return f.texts.some((t) => (part ? t.includes(want) : t === want)) ? [{ key, plural: f.plural }] : [];
  });
}
function check(en: Record<string, Msg>, shapes: [string, boolean][], part = false): string[] {
  const bad: string[] = [];
  for (const [s, counted] of shapes) {
    const hits = keysFor(en, s, part);
    if (hits.length === 0) bad.push(`${s}: no catalog message`);
    else if (counted && !hits.some((h) => h.plural)) bad.push(`${s}: no plural forms (D-133)`);
  }
  return bad;
}

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-10

test('nfr_oth_02_ac10_delete_property_texts_are_catalog_keys_with_plurals', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, Msg>;
  const bad = check(en, [
    ['Delete property "<Name>"?', false],
    ['A backup of the vault is made first (Settings › Backups). Undo restores the values and the property.', false],
    ['No <singular> has a value. Only the type definition changes.', false],
    ['Delete property', false],
  ]);
  bad.push(...check(en, [
    ['Removes the <key> line from <n> <plural>', false],
    ['have no value and are not touched', true],
    ['Delete from <n> notes', true],
  ], true));
  assert.deepEqual(bad, [], 'R99 D: every text of the Delete property dialog is a catalog message; counted words have plural forms');
  assert.ok(keysFor(en, '<m> has no value and is not touched', true).length > 0, 'the singular `1 has no value and is not touched` (FR-TYP-04 AC-6)');
  assert.ok(keysFor(en, 'Delete from <n> note', true).length > 0, 'the singular `Delete from 1 note`');
});

test('nfr_oth_02_ac10_status_texts_of_the_4e2_jobs', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, Msg>;
  const keys = ['job.valueRemove.running', 'job.valueRemove.done', 'job.typeDelete.running', 'job.typeDelete.done', 'job.typeDelete.keptType'];
  assert.deepEqual(keys.filter((k) => !(k in en)), [], 'the status keys of ms4-jobs §14.9.8');
  const bad = check(en, [
    ['Deleting <Name> · <done> of <n>', false],
    ['Deleted <Name> · removed values from <n> notes', true],
    ['Deleted <Name> · <n> <plural> in the trash', false],
    ['object was not changed, so the type was kept.', true],
  ], true);
  assert.deepEqual(bad, [], 'R99 D3, F2 status texts are catalog messages; counted words have plural forms');
  assert.ok(keysFor(en, 'removed values from <n> note', true).length > 0, 'the singular `removed values from 1 note` (FR-TYP-04 AC-7)');
});

test('nfr_oth_02_ac10_delete_type_texts_and_the_deleted_type_route', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, Msg>;
  const bad = check(en, [
    ['Delete type "<Name>"?', false],
    ['A backup of the vault is made first (Settings › Backups). Undo brings the <plural> and the type back.', false],
    ['This type no longer exists.', false],
    ['Open Trash', false],
  ]);
  bad.push(...check(en, [
    ['go to the trash with the type', false],
    ['Notes that link to them show moved to trash.', false],
    ['Delete type and trash <n> <plural>', false],
    ['Deleting <Name> moves its <n> <plural> to the trash. To keep them, change their type first. A backup is made first.', false],
    ['Delete <Name> type…', false],
    ['<Name> was deleted. Its <n> objects are in the trash.', true],
  ], true));
  assert.deepEqual(bad, [], 'R99 F1, F2, F3: every text is a catalog message; `<n> objects` has plural forms');
});

test('nfr_oth_02_ac10_menu_footer_key_description_and_backup_labels', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, Msg>;
  const bad = check(en, [
    ['Only a more general type; values stay as written.', false],
    ["The key can't be changed after creation.", false],
    ['Delete property <Name>', false],
    ['Delete type <Name>', false],
  ]);
  assert.deepEqual(bad, [], 'R99 C, E and the Settings › Backups labels of 4E-2 (tags.md R85)');
  for (const [k, want] of [['backups.label.valueRemove', 'Delete property Poznámka'], ['backups.label.typeDelete', 'Delete type Schůzka']] as const) {
    assert.ok(k in en, `catalog key ${k} (ms4-jobs §14.9.1)`);
    assert.equal(cat.t(k, { name: k.endsWith('valueRemove') ? 'Poznámka' : 'Schůzka' }), want, `${k} with { name }`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-18

test('fr_ux_03_ac18_undo_delete_commands_are_registered_with_catalog_titles', async () => {
  const cat = await catalog();
  const cmd = await load('../ui/src/shell/commands.ts');
  assert.ok(cmd, 'commands module loads');
  const ctx = { vault: { name: 'Přesuny', path: '/tmp/Přesuny', placeholders: 0 }, types: [], counts: {}, route: { id: 'type-settings/<type>', path: null } };
  const list = cmd!.commands(ctx) as { id: string; title: string; vars?: Record<string, unknown>; section?: string }[];
  const titles = list.map((c) => (c.title in (cat.en as object) ? cat.t(c.title, (c.vars ?? {}) as any) : c.title));
  for (const [t, id] of [['Undo delete property', 'job.undo.valueRemove'], ['Undo delete type', 'job.undo.typeDelete']] as const) {
    const i = titles.indexOf(t);
    assert.ok(i >= 0, `${t} is a palette command (R100): ${titles.filter((x) => x.startsWith('Undo')).join(', ')}`);
    assert.equal(list[i].id, id, `${t}: command ${id} (ms4-jobs §14.9.4)`);
    assert.ok(list[i].title in (cat.en as object), `${t}: title is a catalog key`);
    assert.equal(list[i].section, 'edit', `${t}: section edit (R100)`);
  }
});
