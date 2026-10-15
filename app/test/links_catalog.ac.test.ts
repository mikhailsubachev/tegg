// MS4 slice 4A, L1: catalog strings of the Backlinks panel, Broken links, Duplicate titles and the Create offer.
// FR-LNK-01 AC-15 (every label, heading, hint, marker and count from the catalog, with plural categories; the Czech
// test catalog shows one / few / other for 1, 3, 5), with the exact English texts of R15, R16 and FR-LNK-01 AC-1,
// AC-5, AC-13; FR-LNK-02 AC-5; FR-LNK-04 AC-4, AC-7, AC-8, AC-10, AC-11; FR-LNK-14 AC-8. Keys from
// docs/contracts/ms4-links.md §5.4 (plural forms per D-133). Written from docs/acceptance/backlinks.md and the
// contract only (D-61). A new file, so the existing catalog test is unchanged (TS-I3). Modules load inside the tests.
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { catalog } from './read-helpers';

afterEach(async () => {
  const cat = await catalog().catch(() => null);
  cat?.setCatalog(cat.en, 'en');
});

/** Variables under every name the message might use (the contract shows `{n}`, plural messages take `count`). */
const v = (n: number, m = 0, extra: Record<string, string> = {}) => ({ count: n, n, m, objects: m, ...extra });

test('fr_lnk_01_ac15_backlinks_panel_strings_and_plurals', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, unknown>;
  for (const k of ['backlinks.count', 'backlinks.empty', 'backlinks.emptyHint', 'backlinks.more', 'backlinks.embed', 'backlinks.unlinked', 'commands.showBacklinks']) {
    assert.ok(k in en, `catalog key ${k}`);
  }
  assert.equal(typeof en['backlinks.count'], 'object', 'backlinks.count is a plural message (D-133)');
  assert.equal(cat.t('backlinks.count', v(9)), '9 objects link here', 'AC-1');
  assert.equal(cat.t('backlinks.count', v(1)), '1 object links here', 'singular');
  assert.equal(cat.t('backlinks.empty'), 'No backlinks yet', 'AC-13');
  assert.equal(cat.t('backlinks.emptyHint'), 'Link to this note with [[ or @ from another note.', 'R15 hint');
  assert.equal(cat.t('backlinks.more', v(2)), 'Show 2 more', 'AC-5');
  assert.equal(cat.t('backlinks.embed'), 'Embed', 'FR-LNK-02 AC-5');
  assert.equal(cat.t('backlinks.unlinked'), 'Unlinked mentions', 'R15 (AP-211)');
  assert.equal(cat.t('commands.showBacklinks'), 'Show backlinks', 'R16');
});

test('fr_lnk_01_ac15_czech_test_catalog_picks_one_few_other', async () => {
  const cat = await catalog();
  assert.ok('backlinks.count' in (cat.en as Record<string, unknown>), 'catalog key backlinks.count');
  cat.setCatalog({ ...(cat.en as object), 'backlinks.count': { one: '{count} objekt sem odkazuje', few: '{count} objekty sem odkazují', other: '{count} objektů sem odkazuje' } }, 'cs');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('backlinks.count', v(n))), ['1 objekt sem odkazuje', '3 objekty sem odkazují', '5 objektů sem odkazuje']);
});

test('fr_lnk_04_ac10_broken_links_and_create_offer_strings', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, unknown>;
  for (const k of ['brokenLinks.title', 'brokenLinks.summary', 'brokenLinks.create', 'createLink.title', 'createLink.noNote', 'createLink.type', 'createLink.create',
    'createLink.rewrite', 'createLink.needsEdit', 'createLink.folder', 'createLink.exists', 'createLink.planChanged', 'commands.gotoBrokenLinks']) {
    assert.ok(k in en, `catalog key ${k}`);
  }
  const names = { label: 'Neexistuje', target: 'Neexistuje', title: 'Neexistuje', type: 'Quick Note', stem: 'Q3 plán', name: 'Q3 plán', file: 'Q3 plán' };
  assert.equal(cat.t('brokenLinks.title'), 'Broken links');
  assert.equal(cat.t('brokenLinks.summary', v(12, 3)), '12 broken links in 3 objects', 'AC-10 summary');
  assert.equal(cat.t('brokenLinks.create', names), 'Create "Neexistuje"');
  assert.equal(cat.t('createLink.title'), 'Create note', 'AC-4 dialog name');
  assert.equal(cat.t('createLink.noNote', names), 'No note named "Neexistuje"');
  assert.equal(cat.t('createLink.type', names), 'Type: Quick Note');
  assert.equal(cat.t('createLink.create', names), 'Create "Neexistuje"');
  assert.equal(cat.t('createLink.rewrite', names), 'The file will be named "Q3 plán" and this link changed to point to it.', 'AC-7');
  assert.equal(cat.t('createLink.needsEdit'), "This link can't point to a file name. Edit the link first.", 'AC-7 read view');
  assert.equal(cat.t('createLink.folder'), "Notes can't be created in this folder.", 'AC-8');
  assert.equal(cat.t('createLink.exists', names), '"Neexistuje" exists now.', 'AC-11');
  assert.equal(cat.t('commands.gotoBrokenLinks'), 'Go to Broken links');
});

test('fr_lnk_14_ac8_duplicate_titles_strings', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, unknown>;
  for (const k of ['duplicates.title', 'duplicates.summary', 'duplicates.backlinks', 'duplicates.merge', 'commands.gotoDuplicateTitles']) assert.ok(k in en, `catalog key ${k}`);
  assert.equal(cat.t('duplicates.title'), 'Duplicate titles');
  assert.equal(cat.t('duplicates.summary', v(2, 6)), '2 titles shared by 6 objects');
  assert.equal(typeof en['duplicates.backlinks'], 'object', 'duplicates.backlinks is a plural message');
  assert.equal(cat.t('duplicates.backlinks', v(1)), '1 backlink');
  assert.equal(cat.t('duplicates.backlinks', v(0)), '0 backlinks');
  assert.equal(cat.t('duplicates.merge'), 'Merge…');
  assert.equal(cat.t('commands.gotoDuplicateTitles'), 'Go to Duplicate titles');
});
