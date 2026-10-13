// MS3 slice 3B, L1: the attribute strip's rows (FR-TYP-08 AC-1…AC-4, display only; D-147). Written from
// docs/acceptance/read-view.md and docs/contracts/ms3-shell.md §11.3 (`read/properties.ts`) only (D-61). Rendering,
// date formatting in the page and chip activation are checked at L5 (app/webkit/read_view.ac.test.ts).
import { beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { parse } from '@tegg/doc';
import { F, catalog, fixture, need } from './read-helpers';

const PROPS = '../ui/src/read/properties.ts';
beforeEach(async () => { await catalog().catch(() => {}); });

async function rows(rel: string) {
  const m = await need(PROPS, 'attributeRows');
  return m.attributeRows(parse(fixture(rel))) as { subtitle: string | null; rows: { key: string; label: string; value: any }[] };
}

test('fr_typ_08_ac1_strip_order_subtitle_and_hidden_keys', async () => {
  const r = await rows(F.vlastnosti);
  assert.equal(r.subtitle, 'Poznámka se všemi druhy vlastností.', 'description is the subtitle');
  assert.deepEqual(r.rows.map((x) => x.key), [
    'tags', 'aliases', 'stav', 'počet', 'hotovo', 'termín', 'schůzka-v', 'lidé', 'cesta', 'meta', 'custom-key',
    'source', 'review', 'created', 'modified',
  ], 'tags, aliases, other attributes in file order, then source, review, created, modified; id, type, title, description, icon, cover, import-id and empty values hidden');
});

test('fr_typ_08_ac2_labels', async () => {
  const r = await rows(F.vlastnosti);
  assert.deepEqual(r.rows.map((x) => x.label), [
    'Tags', 'Aliases', 'stav', 'počet', 'hotovo', 'termín', 'schůzka-v', 'lidé', 'cesta', 'meta', 'custom-key',
    'Source', 'Review', 'Created', 'Modified',
  ], 'catalog labels for reserved keys, other keys as written (NFC), the date range pair as one row');
  for (const l of r.rows.map((x) => x.label)) assert.equal(l, l.normalize('NFC'));
});

test('fr_typ_08_ac3_values_by_format', async () => {
  const r = await rows(F.vlastnosti);
  const v = Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
  assert.deepEqual(v.tags, { kind: 'tags', tags: ['projekt', 'Čeština'] });
  assert.deepEqual(v.aliases, { kind: 'list', items: ['Atributy', 'Properties test'] });
  assert.deepEqual(v['stav'], { kind: 'text', text: 'Rozpracováno' });
  assert.deepEqual(v['počet'], { kind: 'number', text: '3' }, 'numbers as written');
  assert.deepEqual(v['hotovo'], { kind: 'checkbox', checked: true });
  assert.deepEqual(v['termín'], { kind: 'date', date: '2026-10-20' }, 'date kept as YYYY-MM-DD (FR-FMT-11)');
  assert.deepEqual(v['schůzka-v'], { kind: 'datetime', datetime: '2026-10-07T14:30:00+02:00' });
  assert.deepEqual(v['lidé'], { kind: 'links', targets: ['Cíl', 'Dvojník'] }, 'relations as link targets');
  assert.deepEqual(v['cesta'], { kind: 'range', start: '2026-07-01', end: '2026-07-14' });
  assert.equal(v['meta']?.kind, 'yaml', 'nested map as YAML source');
  assert.match(String(v['meta']?.source), /a: 1[\s\S]*b: dvě/);
  assert.deepEqual(v['custom-key'], { kind: 'text', text: 'hodnota' });
  assert.deepEqual(v.source, { kind: 'links', targets: ['Cíl'] }, 'source as a link chip');
  assert.deepEqual(v.review, { kind: 'review', value: 'unreviewed' });
  assert.deepEqual(v.created, { kind: 'datetime', datetime: '2026-10-01T09:00:00+02:00' });
  assert.deepEqual(v.modified, { kind: 'datetime', datetime: '2026-10-02T10:00:00+02:00' });
  const cat = await catalog();
  const labels = Object.values(cat.en as Record<string, unknown>);
  assert.ok(labels.includes('Unreviewed'), 'the catalog has the label "Unreviewed" for review: unreviewed');
});

test('fr_typ_08_ac4_system_only_and_untyped', async () => {
  const sys = await rows(F.jenSys);
  assert.deepEqual(sys.rows.map((x) => [x.key, x.label]), [['created', 'Created'], ['modified', 'Modified']], 'only Created and Modified');
  assert.equal(sys.subtitle, null);
  const bez = await rows(F.bez);
  assert.deepEqual(bez, { subtitle: null, rows: [] }, 'no frontmatter: no rows, no subtitle');
});
