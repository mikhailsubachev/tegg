// MS4 slice 4A, L1: the UI ordering helper `links/order.ts` (docs/contracts/ms4-links.md §5.1; D-122, D-276, D-284,
// D-290). FR-LNK-01 AC-3 (group and entry order with cs and en), FR-LNK-04 AC-10 (Broken links: count, then label),
// FR-LNK-14 AC-8 (Duplicate titles: size, then label; objects by created, missing last). The core's order (system
// types, instants) is kept; only name-ordered parts use the region collator. Written from docs/acceptance/backlinks.md
// and the contract only (D-61). The module is loaded inside each test (`need`), so a missing module fails an
// assertion (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { need } from './read-helpers';

const ORDER = '../ui/src/links/order.ts';
const col = (locale: string) => new Intl.Collator(locale);

const T = (key: string, name: string, plural: string, system: boolean) => ({ key, name, plural, folder: plural, icon: 'file-text', color: 'gray', system, invalid: false });
const TYPES = [
  T('page', 'Page', 'Pages', true), T('task', 'Task', 'Tasks', true), T('quick-note', 'Quick Note', 'Quick Notes', true),
  T('daily-note', 'Daily Note', 'Daily Notes', true), T('tag', 'Tag', 'Tags', true), T('image', 'Image', 'Images', true), T('pdf', 'PDF', 'PDFs', true),
  T('schůzka', 'Schůzka', 'Schůzky', false), T('čajovna', 'Čajovna', 'Čajovny', false), T('cesta', 'Cesta', 'Cesty', false),
];
const tgt = { target: 'Cíl', kind: 'note', path: 'Pages/Cíl.md', title: 'Cíl', type: 'page' };
const occ = { kind: 'body', attribute: null, attributeName: null, at: { line: 8, byte: 4 }, excerpt: { segments: [{ kind: 'link', text: 'Cíl', target: tgt, here: true, marks: [] }], cutStart: false, cutEnd: false } };
const E = (source: string, title: string, type: string, modified: string | null) => ({ source, title, type, modified, readOnly: false, occurrences: [occ] });
const G = (type: string, entries: any[], defined = true) => ({ type, defined, raw: type, entries });

/** Cíl's panel as the core returns it (§3: system types in D-121 order and instants are ordered; name-ordered parts aren't). */
function corePanel() {
  return {
    objects: 12,
    groups: [
      G('page', [
        E('Pages/Odkazy v textu.md', 'Odkazy v textu', 'page', '2026-10-10T09:00:00+02:00'),
        E('Pages/Rozbité odkazy.md', 'Rozbité odkazy', 'page', '2026-10-05T09:00:00+02:00'),
        E('Pages/Zápis.md', 'Zápis', 'page', null),
        E('Pages/Šablony.md', 'Šablony', 'page', null),
        E('Pages/Sešit.md', 'Sešit', 'page', null),
      ]),
      G('quick-note', [E('Quick Notes/Rychlá poznámka.md', 'Rychlá poznámka', 'quick-note', '2026-10-03T09:00:00+02:00')]),
      G('daily-note', [E('Daily/2026-10-07.md', '2026-10-07', 'daily-note', null)]),
      G('schůzka', [E('Schůzky/2026-10-08 Porada.md', '2026-10-08 Porada', 'schůzka', '2026-10-12T09:00:00+02:00')]),
      G('čajovna', [E('Čajovny/U Dvou.md', 'U Dvou', 'čajovna', null)]),
      G('cesta', [E('Cesty/Brno.md', 'Brno', 'cesta', null)]),
      G('neznámý', [E('Pages/Bez typu s vlastností.md', 'Bez typu s vlastností', 'neznámý', '2026-10-02T09:00:00+02:00')], false),
    ],
  };
}
const groupTypes = (p: any) => (p.groups as any[]).map((g) => g.type);
const titles = (p: any, type: string) => ((p.groups as any[]).find((g) => g.type === type)?.entries ?? []).map((e: any) => e.title);

test('fr_lnk_01_ac3_groups_keep_system_order_and_sort_user_types_by_region', async () => {
  const m = await need(ORDER, 'orderBacklinks');
  const cs = m.orderBacklinks(corePanel(), TYPES, col('cs'));
  assert.deepEqual(groupTypes(cs), ['page', 'quick-note', 'daily-note', 'cesta', 'čajovna', 'schůzka', 'neznámý'], 'cs: system types, user types by plural (Cesty < Čajovny < Schůzky), undefined last');
  const en = m.orderBacklinks(corePanel(), TYPES, col('en'));
  assert.deepEqual(groupTypes(en), ['page', 'quick-note', 'daily-note', 'čajovna', 'cesta', 'schůzka', 'neznámý'], 'en: Čajovny < Cesty');
});

test('fr_lnk_01_ac3_entries_by_instant_then_without_modified_by_title', async () => {
  const m = await need(ORDER, 'orderBacklinks');
  assert.deepEqual(titles(m.orderBacklinks(corePanel(), TYPES, col('cs')), 'page'), ['Odkazy v textu', 'Rozbité odkazy', 'Sešit', 'Šablony', 'Zápis'], 'cs: S < Š');
  assert.deepEqual(titles(m.orderBacklinks(corePanel(), TYPES, col('en')), 'page'), ['Odkazy v textu', 'Rozbité odkazy', 'Šablony', 'Sešit', 'Zápis'], 'en: Ša < Se');
  // The instants' order from the core is kept whatever the offsets say as text (zones don't change it).
  const p = corePanel();
  p.groups[0].entries[0].modified = '2026-10-10T08:30:00+00:00';
  p.groups[0].entries[1].modified = '2026-10-10T09:00:00+02:00';
  assert.deepEqual(titles(m.orderBacklinks(p, TYPES, col('en')), 'page').slice(0, 2), ['Odkazy v textu', 'Rozbité odkazy'], 'core instant order kept');
  assert.equal(m.orderBacklinks(corePanel(), TYPES, col('cs')).objects, 12, 'the count is unchanged');
});

const BG = (label: string, count: number) => ({ key: label.normalize('NFC').toLowerCase(), label, count, create: { state: 'create', path: `Quick Notes/${label}.md`, title: label, type: 'quick-note', rewrite: null }, sources: [] });
const BROKEN = ['Šablona', 'Q3: plán?', 'Smazaná', 'Chybí', 'Projekty/Alfa', 'Osoby/Eva Malá', 'Chybějící osoba'].map((l) => BG(l, 1));

test('fr_lnk_04_ac10_broken_groups_by_count_then_label', async () => {
  const m = await need(ORDER, 'orderBroken');
  const cs = (m.orderBroken([...BROKEN, BG('Neexistuje', 5)], col('cs')) as any[]).map((g) => g.label);
  assert.deepEqual(cs, ['Neexistuje', 'Chybějící osoba', 'Chybí', 'Osoby/Eva Malá', 'Projekty/Alfa', 'Q3: plán?', 'Smazaná', 'Šablona'], 'cs');
  const en = (m.orderBroken([BG('Neexistuje', 5), ...[...BROKEN].reverse()], col('en')) as any[]).map((g) => g.label);
  assert.deepEqual(en, ['Neexistuje', 'Chybějící osoba', 'Chybí', 'Osoby/Eva Malá', 'Projekty/Alfa', 'Q3: plán?', 'Šablona', 'Smazaná'], 'en: Šablona before Smazaná');
});

const DO = (path: string, title: string, created: string | null) => ({ path, title, type: 'page', folder: path.split('/')[0], details: { created, preview: [], stem: null }, backlinks: 0 });
const DG = (label: string, objects: any[]) => ({ key: label.normalize('NFC').toLowerCase(), label, objects });

test('fr_lnk_14_ac8_duplicates_by_size_then_label_objects_by_created', async () => {
  const m = await need(ORDER, 'orderDuplicates');
  const groups = [
    DG('Čtení', [DO('Pages/Čtení podruhé.md', 'Čtení', null), DO('Pages/Čtení.md', 'Čtení', '2026-08-01T08:00:00+02:00')]),
    DG('Senior Product Manager', [
      DO('Quick Notes/SPM velkými.md', 'SENIOR PRODUCT MANAGER', null),
      DO('Osoby/SPM Alfa.md', 'Senior Product Manager', '2026-10-03T09:00:00+02:00'),
      DO('Pages/Senior Product Manager (2).md', 'Senior Product Manager', '2026-10-02T00:30:00+02:00'),
      DO('Pages/Senior Product Manager.md', 'Senior Product Manager', '2026-09-01T10:00:00+02:00'),
    ]),
  ];
  const out = m.orderDuplicates(groups, col('cs')) as any[];
  assert.deepEqual(out.map((g) => [g.label, g.objects.length]), [['Senior Product Manager', 4], ['Čtení', 2]], 'size descending');
  assert.deepEqual(out[0].objects.map((o: any) => o.path), ['Pages/Senior Product Manager.md', 'Pages/Senior Product Manager (2).md', 'Osoby/SPM Alfa.md', 'Quick Notes/SPM velkými.md'], 'created ascending, missing last');
  assert.deepEqual(out[1].objects.map((o: any) => o.path), ['Pages/Čtení.md', 'Pages/Čtení podruhé.md']);
  // Equal sizes: by label with the region collator (D-122).
  const tie = [DG('Šablona', [DO('Pages/a.md', 'Šablona', null), DO('Pages/b.md', 'Šablona', null)]), DG('Sešit', [DO('Pages/c.md', 'Sešit', null), DO('Pages/d.md', 'Sešit', null)])];
  assert.deepEqual((m.orderDuplicates(tie, col('cs')) as any[]).map((g) => g.label), ['Sešit', 'Šablona'], 'cs');
  assert.deepEqual((m.orderDuplicates([...tie].reverse(), col('en')) as any[]).map((g) => g.label), ['Šablona', 'Sešit'], 'en');
  // Created compares instants: 2026-10-02T00:30+02:00 (22:30Z on 1 Oct) is before 2026-10-01T23:00:00-05:00 (04:00Z on 2 Oct).
  const zones = [DG('X', [DO('Pages/x2.md', 'X', '2026-10-01T23:00:00-05:00'), DO('Pages/x1.md', 'X', '2026-10-02T00:30:00+02:00')])];
  assert.deepEqual((m.orderDuplicates(zones, col('en')) as any[])[0].objects.map((o: any) => o.path), ['Pages/x1.md', 'Pages/x2.md'], 'by instant');
});
