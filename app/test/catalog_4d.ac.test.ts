// MS4 slice 4D-lite, L1: the strings of tags, backups and merge (docs/acceptance/tags.md R88; docs/contracts/
// ms4-tags.md §7). FR-TAG-06 AC-10 (every text is an R88 key with its English text, plural forms), FR-TAG-04 AC-8 and
// FR-TAG-08 AC-5 (the job strings, one not-updated list for every kind, D-672, D-677), FR-HIS-04 AC-7 (the backup
// labels per kind, AP-600), FR-TAG-05 AC-4 (`Unknown colour "magenta"`, D-669). The pairs are read from the approved
// criteria. Written from the ACs and the contract only (D-61). Modules load inside the tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
async function catalog(): Promise<Mod> {
  const cat = await load('../ui/src/i18n/catalog.ts');
  assert.ok(cat, 'ui/src/i18n/catalog.ts');
  return cat!;
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const REPO = resolve(import.meta.dirname, '../..');
function pairs(file: string, first: string): [string, string][] {
  const md = readFileSync(resolve(REPO, file), 'utf8');
  const line = md.split('\n').find((l) => l.startsWith(first));
  assert.ok(line, `${first} line in ${file}`);
  return [...line!.matchAll(/`([a-z][A-Za-z.]*)` `([^`]+)`/g)].map((m) => [m[1], m[2]]);
}
function check(cat: Mod, list: [string, string][]): string[] {
  const bad: string[] = [];
  for (const [key, text] of list) {
    if (!(key in cat.en)) { bad.push(`${key}: missing`); continue; }
    const vars: Record<string, string | number> = {};
    for (const m of text.matchAll(/\{(\w+)\}/g)) vars[m[1]] = m[1] === 'count' ? 5 : `«${m[1]}»`;
    const want = text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k]));
    const got = cat.t(key, vars);
    if (got !== want) bad.push(`${key}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  return bad;
}
/** Keys whose text has two plural numbers; checked with numbers below. */
const TWO_NUMBERS = ['tags.summary', 'tag.summary'];
const R88 = () => pairs('docs/acceptance/tags.md', '`tags.title`');

test('fr_tag_06_ac10_r88_strings_are_catalog_keys_with_the_exact_english', async () => {
  const cat = await catalog();
  const list = R88();
  assert.equal(list.length, 79, `R88 has ${list.length} keys with text`);
  assert.deepEqual(check(cat, list.filter(([k]) => !TWO_NUMBERS.includes(k))), [], 'every R88 key with its English text');
  assert.equal(cat.t('tags.summary', { tags: 10, objects: 11 }), '10 tags · 11 tagged objects', 'tags.summary');
  assert.equal(cat.t('tags.summary', { tags: 1, objects: 1 }), '1 tag · 1 tagged object', 'tags.summary, plural forms each');
  assert.equal(cat.t('tag.summary', { objects: 6, types: 4 }), '6 objects of 4 types', 'tag.summary');
  assert.equal(cat.t('tag.summary', { objects: 1, types: 1 }), '1 object of 1 type', 'tag.summary, plural forms each');
  assert.equal(cat.t('tag.summary', { objects: 0, types: 0 }), '0 objects of 0 types', 'tag.summary for a new tag (FR-TAG-03 AC-1)');
});

test('fr_tag_06_ac10_plural_forms_of_the_counts', async () => {
  const cat = await catalog();
  const one: [string, Record<string, string | number>, string][] = [
    ['tag.renameUpdates', { count: 1 }, 'updates 1 note'],
    ['job.tag.notUpdated', { count: 1 }, '1 note not updated'],
    ['job.tag.running', { tag: 'Účty', count: 1 }, 'Updating #Účty in 1 note'],
    ['tag.renameLine', { count: 1 }, 'Updates 1 note. A backup is made first.'],
    ['tag.removeFrom', { count: 1 }, 'Remove from 1 object'],
    ['tag.deleteUsed', { tag: 'Účty', count: 1 }, '#Účty is used by 1 object.'],
    ['backups.restored', { count: 1 }, 'Restored 1 note from the backup'],
  ];
  const bad = one.filter(([k, v, want]) => !(k in cat.en) || cat.t(k, v) !== want).map(([k, v, want]) => `${k}: want ${want}, got ${k in cat.en ? cat.t(k, v) : 'missing'}`);
  assert.deepEqual(bad, [], 'count 1 reads singular (D-133)');
});

test('fr_tag_04_ac8_one_not_updated_list_for_every_job_kind', async () => {
  const cat = await catalog();
  assert.equal(cat.t('job.notUpdated.count', { count: 2 }), '2 notes not updated', 'job.notUpdated.count is `{count} notes not updated` (D-677)');
  assert.equal(cat.t('job.notUpdated.count', { count: 1 }), '1 note not updated', 'plural forms');
  assert.equal(cat.t('job.tag.renamed', { from: 'Účty', to: 'Výdaje', count: 6 }), 'Renamed #Účty to #Výdaje in 6 notes', 'job.tag.renamed');
  assert.equal(cat.t('job.tag.running', { tag: 'Účty', count: 6 }), 'Updating #Účty in 6 notes', 'job.tag.running');
});

test('fr_tag_08_ac5_removal_status_text', async () => {
  const cat = await catalog();
  assert.equal(cat.t('job.tag.removed', { tag: 'Účty', count: 6 }), 'Removed #Účty from 6 notes', 'job.tag.removed');
});

test('fr_his_04_ac7_backup_labels_per_kind', async () => {
  const cat = await catalog();
  const want: [string, Record<string, string | number>, string][] = [
    ['backups.label.tagRename', { from: 'Účty', to: 'Výdaje' }, 'Rename #Účty to #Výdaje'],
    ['backups.label.tagDelete', { tag: 'finance', count: 2 }, 'Remove #finance from 2 objects'],
    ['backups.label.merge', { count: 2, title: 'Schůzka' }, 'Merge 2 objects into "Schůzka"'],
    ['backups.label.restore', { time: '22. 10. 2026 10:00' }, 'Before restoring 22. 10. 2026 10:00'],
    ['backups.label.unknown', { kind: 'test-backup' }, 'Backup (test-backup)'],
  ];
  const bad = want.filter(([k, v, w]) => !(k in cat.en) || cat.t(k, v) !== w).map(([k, v, w]) => `${k}: want ${w}, got ${k in cat.en ? cat.t(k, v) : 'missing'}`);
  assert.deepEqual(bad, [], 'labels (AP-600, ms4-tags §7)');
});

test('fr_tag_05_ac4_contract_strings_of_colour_and_duplicates', async () => {
  const cat = await catalog();
  assert.deepEqual(check(cat, [
    ['tag.unknownColour', 'Unknown colour "{value}"'],
    ['tag.duplicateWarning', 'Another Tag file for #{tag} exists: {path}. Merge them on Duplicate titles first.'],
    ['tag.renameTemplates', 'Updates {count} notes and {templates} templates. A backup is made first.'],
  ]), [], 'ms4-tags §7 keys');
  assert.equal(cat.t('tag.unknownColour', { value: 'magenta' }), 'Unknown colour "magenta"', 'D-669');
});
