// Keeps the fake core's slice OC behaviour (app/ui/test/fake-cards.ts, fake-schema.ts, fake-links.ts;
// docs/contracts/v1-cards.md §13) honest against the shared corpus tests/fixtures/vaults/cards/expected-card-data.json,
// which crates/tegg-core/tests/ac_cards.rs checks the real core against, and against the type-file bytes the Rust tests
// expect (crates/tegg-schema/tests/ac_card_type_file.rs). The WebKit tests (L5) run against this twin, so it must agree
// with the core. Not an AC test: the AC tests (app/test/cards_*.ac.test.ts, the Rust ac_card*.rs) check the product.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { cardExample, cardsFor, detailValues } from '../ui/test/fake-cards';
import { objects } from '../ui/test/fake-links';
import { handle as handleSchema, listTypes } from '../ui/test/fake-schema';

const REPO = resolve(import.meta.dirname, '../..');
const nfc = (s: string) => s.normalize('NFC');
/** The two attachments of the overlay README, copied in by the tests (`_attachments/vyhlidka.png`, `pravidla-tabora.pdf`). */
const BIN = ['_attachments/vyhlidka.png', '_attachments/pravidla-tabora.pdf'];

function load(...dirs: string[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const dir of dirs) {
    const abs = resolve(REPO, dir);
    const prefix = dir.endsWith('/.tegg') ? '.tegg/' : '';
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        const rel = nfc(prefix + relative(abs, p));
        if (rel === 'README.md' || rel === 'expected-card-data.json') continue;
        files[rel] = readFileSync(p, 'utf8');
      }
    };
    walk(abs);
  }
  return files;
}
const vault = () => load('tests/fixtures/vaults/views', 'tests/fixtures/vaults/new-empty/.tegg', 'tests/fixtures/vaults/cards');
const expected: Record<string, any> = JSON.parse(readFileSync(resolve(REPO, 'tests/fixtures/vaults/cards/expected-card-data.json'), 'utf8')).cards;
/** As the Rust test compares: links in full, `file` by target, kind and path. */
const shape = (c: any) => ({
  type: c.type, title: c.title, keys: c.keys, values: c.values, excerpt: c.excerpt,
  links: c.links.map((l: any) => ({ target: l.target, kind: l.kind, path: l.path, title: l.title, type: l.type })), unreviewed: c.unreviewed,
  file: c.file ? { target: c.file.target, kind: c.file.kind, path: c.file.path } : null,
});
const V = { mtimeNs: '1', size: 1, hash: 'h' };
const versOf = (files: Record<string, string>) => Object.fromEntries(Object.keys(files).filter((p) => p.startsWith('.tegg/types/')).map((p) => [p, V]));

test('the twin gives every object the card data of expected-card-data.json', () => {
  const files = vault();
  // `.trash/` objects are never indexed (no card surface draws them); the corpus lists one for completeness.
  const paths = Object.keys(expected).filter((p) => !p.startsWith('.trash/'));
  const got = cardsFor(files, paths, { bin: BIN });
  const bad: string[] = [];
  for (const p of paths) {
    const g = got[nfc(p)];
    const want = JSON.stringify(expected[p]);
    const have = g ? JSON.stringify(shape(g)) : 'none';
    if (have !== JSON.stringify(JSON.parse(want))) bad.push(`${p}\n  want ${want}\n  got  ${have}`);
  }
  assert.deepEqual(bad, []);
});

test('the twin reads card lists and icons as the core (R209, R210, §5.4)', () => {
  const types = listTypes(vault(), {});
  const t = (k: string) => types.find((x) => x.key === k)!;
  assert.deepEqual([t('výlet').cardList.length, t('výlet').cardDefault, t('výlet').cardKeys.length, t('výlet').cardIgnored], [12, false, 11, ['neznámý-klíč']]);
  assert.deepEqual([t('book').cardList, t('book').cardDefault], [['tags', 'body', 'author', 'status', 'modified'], true]);
  assert.equal(t('kontrola').resolvedIcon?.name, 'square-check-big', 'check-square draws square-check-big');
  const attr = (k: string) => t('výlet').attributes.find((a: any) => a.key === k);
  assert.deepEqual([attr('kraj').icon, attr('kraj').resolvedIcon?.name, attr('délka').icon, attr('délka').resolvedIcon, attr('náročnost').icon], ['map-pin', 'map-pin', 'ikona-ktera-neexistuje', null, null]);
});

test('the twin writes the card and icon lines as tegg-schema', async () => {
  const files = vault();
  const patch = async (key: string, ops: unknown[]) => {
    const r = await handleSchema('type_patch', { key, base: V, ops }, files, versOf(files));
    assert.equal(r.error, undefined, JSON.stringify(r.error));
    return r.writes?.[`.tegg/types/${key}.yml`] ?? null;
  };
  const book = files['.tegg/types/book.yml'];
  assert.equal(await patch('book', [{ op: 'card', keys: ['body', 'author', 'status', 'modified'] }]), book.replace('preview: [author, status]\n', 'preview: [author, status]\ncard: [body, author, status, modified]\n'), 'inserted after preview');
  const vylet = files['.tegg/types/výlet.yml'];
  const line = 'card: [tags, description, stav, náročnost, kraj, vybavení, délka, termín, odkaz, průvodce, neznámý-klíč, modified]\n';
  assert.equal(await patch('výlet', [{ op: 'card', keys: null }]), vylet.replace(line, ''), 'Reset removes the line');
  assert.equal(await patch('výlet', [{ op: 'card', keys: ['tags', 'description', 'stav', 'náročnost', 'kraj', 'vybavení', 'délka', 'termín', 'odkaz', 'průvodce', 'neznámý-klíč', 'modified'] }]), null, 'an equal list writes nothing');
  const naro = '    name: Náročnost\n    type: select\n';
  assert.equal(await patch('výlet', [{ op: 'attributeIcon', key: 'náročnost', icon: 'mountain' }]), vylet.replace(naro, `${naro}    icon: mountain\n`), 'an icon line after type');
  assert.equal(await patch('výlet', [{ op: 'attributeIcon', key: 'kraj', icon: null }]), vylet.replace('    type: text\n    icon: map-pin\n', '    type: text\n'), 'None removes it');
  assert.equal(await patch('kontrola', [{ op: 'set', field: 'icon', value: 'square-check-big' }]), null, 'the canonical name of the current icon writes nothing (D-2103)');
  const removed = await patch('výlet', [{ op: 'removeAttribute', key: 'kraj' }]);
  assert.ok(removed?.includes('card: [tags, description, stav, náročnost, vybavení, délka, termín, odkaz, průvodce, neznámý-klíč, modified]\n'), 'a deleted property leaves card: (D-2077)');
});

test('the twin gives the example card and duplicate details as the core', async () => {
  const files = vault();
  assert.equal(cardExample(files, 'výlet', { bin: BIN })?.path, 'Výlety/Sněžka z Pece.md', 'the most recently modified Výlet');
  assert.equal(cardExample(files, 'článek', { bin: BIN })?.path, 'Články/Bez zdroje.md');
  const types = listTypes(files, {});
  const sn = (await objects(files)).find((o) => o.path === 'Výlety/Sněžka z Pece.md')!;
  assert.deepEqual(detailValues(sn, types), [['stav', 'Hotový'], ['náročnost', 'Střední']], 'the first two set pill values (§3.5)');
});
