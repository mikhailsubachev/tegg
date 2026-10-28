// Slice 4E-1, L1: the catalog strings of the 4E-1 dialog, folder field, status texts, backup labels, the interrupted
// banner and the R100 commands (docs/acceptance/type-moves.md R99 sections A and B, R100; NFR-OTH-02 AC-10 "every R99
// text is a catalog key with plural forms where it has a count"). Interface docs/contracts/ms4-jobs.md §14.8 (keys
// `job.typeMove.done`, `job.folderMove.running`, `job.folderMove.done`, `job.folderMove.tidy`, `job.folderMove.skipped`,
// `job.interrupted.typeMove`; `job.undo.*` commands). Where the contract names no key, the text is found by its shape:
// a catalog message whose English text, with every `{placeholder}` written as `{}`, equals R99's text with every
// `<placeholder>` written the same way (for plural messages each form; for `{ text, … }` messages the text with each
// counted part's `other` form). Written from the ACs and the contract only (D-61). Modules load inside the tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { catalog, load } from './read-helpers';

afterEach(async () => {
  const cat = await catalog().catch(() => null);
  cat?.setCatalog(cat.en, 'en');
});

type Msg = string | Record<string, unknown>;
const hole = (s: string) => s.replace(/\{[^}]+\}/g, '{}');
/** Every English form of a message, placeholders as `{}`; `plural` when the message has count forms. */
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
/** Catalog keys whose English text has `shape` (R99 `<x>` → `{}`), exactly or (`part`) as a part of it. */
function keysFor(en: Record<string, Msg>, shape: string, part = false): { key: string; plural: boolean }[] {
  const want = shape.replace(/<[^>]+>/g, '{}');
  return Object.entries(en).flatMap(([key, m]) => {
    const f = forms(m);
    return f.texts.some((t) => (part ? t.includes(want) : t === want)) ? [{ key, plural: f.plural }] : [];
  });
}
const vars = (n: number, extra: Record<string, string | number> = {}) => ({ count: n, n, ...extra });

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-10

test('nfr_oth_02_ac10_change_type_dialog_texts_are_catalog_keys', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, Msg>;
  const missing: string[] = [];
  for (const s of [
    'Change type?',
    'Property mapping <Old> → <New>',
    '<Name> maps to',
    'Properties mapped to Content are written at the top of the note as Property: value, one line each.',
    'Content',
  ]) if (keysFor(en, s).length === 0) missing.push(s);
  assert.deepEqual(missing, [], 'R99 A: every text of the Change type dialog is a catalog message');
});

test('nfr_oth_02_ac10_status_texts_with_counts_have_plural_forms', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, Msg>;
  for (const k of ['job.typeMove.done', 'job.folderMove.running', 'job.folderMove.done', 'job.folderMove.tidy', 'job.folderMove.skipped', 'job.interrupted.typeMove']) {
    assert.ok(k in en, `catalog key ${k} (ms4-jobs §14.8)`);
  }
  assert.equal(hole(forms(en['job.typeMove.done']).texts[0]), 'Now a {}', 'job.typeMove.done: `Now a <Type>`');
  assert.equal(cat.t('job.typeMove.done', { type: 'Kniha' }), 'Now a Kniha', 'R99 A, FR-STO-04 AC-4');
  const shapes: [string, boolean][] = [
    ['Moving <plural> · <done> of <n>', false],
    ['Moved <n> <plural>', false],
    ['updated links in <m> notes', true],
    ['Moved <n> <plural> and <k> <plural₂> to their folders', false],
    ['<k> not moved (changed meanwhile, tried again later)', false],
    ['Changing the type of "<title>" was interrupted: <done> of <total> links updated', false],
  ];
  const bad: string[] = [];
  for (const [s, counted] of shapes) {
    const hits = keysFor(en, s, true);
    if (hits.length === 0) bad.push(`${s}: no catalog message`);
    else if (counted && !hits.some((h) => h.plural)) bad.push(`${s}: no plural forms (D-133)`);
  }
  assert.deepEqual(bad, [], 'R99 B2 status texts are catalog messages; counted words have plural forms');
  const one = keysFor(en, 'updated links in <m> note', true);
  assert.ok(one.length > 0, '`1 note` is the singular form (`updated links in 1 note`)');
});

test('nfr_oth_02_ac10_folder_field_and_backup_labels', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, Msg>;
  const bad: string[] = [];
  for (const [s, counted] of [
    ['Saving moves <n> <plural> from <old>/ here (backup first; undo in the status strip).', false],
    ['Change type of <n> objects to <Name>', true],
    ['Move <plural> to <folder>', false],
    ['Tidy folders', false],
  ] as [string, boolean][]) {
    const hits = keysFor(en, s);
    if (hits.length === 0) bad.push(`${s}: no catalog message`);
    else if (counted && !hits.some((h) => h.plural)) bad.push(`${s}: no plural forms`);
  }
  assert.deepEqual(bad, [], 'R99 B1 help text and the Settings › Backups labels of 4E-1 (tags.md R85)');
  assert.ok(keysFor(en, 'Change type of <n> object to <Name>').length > 0, '`1 object` singular label');
});

test('fr_ux_03_ac18_undo_commands_are_registered_with_catalog_titles', async () => {
  const cat = await catalog();
  const cmd = await load('../ui/src/shell/commands.ts');
  assert.ok(cmd, 'commands module loads');
  const ctx = { vault: { name: 'Přesuny', path: '/tmp/Přesuny', placeholders: 0 }, types: [], counts: {}, route: { id: 'note/<path>', path: 'Knihy/Plán.md' } };
  const list = cmd!.commands(ctx) as { id: string; title: string; vars?: Record<string, unknown>; section?: string }[];
  const titles = list.map((c) => (c.title in (cat.en as object) ? cat.t(c.title, (c.vars ?? {}) as any) : c.title));
  for (const t of ['Undo type change', 'Undo move']) {
    const i = titles.indexOf(t);
    assert.ok(i >= 0, `${t} is a palette command (R100): ${titles.filter((x) => x.startsWith('Undo')).join(', ')}`);
    assert.ok(list[i].id.startsWith('job.undo'), `${t}: a job.undo.* command (ms4-jobs §14.8): ${list[i].id}`);
    assert.ok(list[i].title in (cat.en as object), `${t}: title is a catalog key`);
  }
});
