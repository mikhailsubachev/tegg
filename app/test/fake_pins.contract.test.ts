// Keeps the fake core's pins twin (app/ui/test/fake-pins.ts, docs/contracts/v1-pinned.md §5) honest against the shared
// corpus tests/fixtures/pinned-files/ (D-512): every expected/ file is the twin's output for its README operation, the
// sample files list the README's rows, and every output parses with the `yaml` package to the pins the twin lists. Not
// an AC test: the AC tests (app/test/pinned.ac.test.ts, crates/tegg-core/tests/ac_pinned.rs) check the product.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { HEADER, pinsJobPatch, pinsPatch, pinsRead, pinsResolve, type PinEditDto, type PinStoredDto } from '../ui/test/fake-pins';
import { loadFixtureVault } from '../ui/test/fake-core';

const FX = resolve(import.meta.dirname, '../../tests/fixtures/pinned-files');
const fx = (name: string) => readFileSync(join(FX, name), 'utf8');
const ID = (nn: string) => `01JB5P000000000000000000${nn}`;
const O = (nn: string | null, path: string | null): PinStoredDto => ({ kind: 'object', id: nn === null ? null : ID(nn), path });
const VALID: PinStoredDto[] = [
  O('01', 'Projekty/Rozpočet 2027.md'), O('02', 'Projekty/Výjezd Lisabon 2026.md'), O('03', 'Schůzky/2026-10-07 Týdenní porada.md'),
  { kind: 'tag', key: 'offsite' }, { kind: 'type', key: 'projekt' },
];
const CAJ = O('04', 'Pages/Čajovna.md');
/** Slice Q (v1-queries §1.9, D-1501): the samples' `query:` item is listed now, last. */
const QPIN: PinStoredDto = { kind: 'query', name: 'Otevřené úkoly tento týden' };
function step(text: string | null, edit: PinEditDto): string {
  const r = pinsPatch(text, edit);
  assert.ok(!('error' in r), `${JSON.stringify(edit)}: ${JSON.stringify(r)}`);
  assert.ok('text' in r && r.text !== null, `${JSON.stringify(edit)} writes`);
  return (r as { text: string }).text;
}
const vault = () => {
  const v = loadFixtureVault('tests/fixtures/vaults/pinned', 'tests/fixtures/vaults/new-empty/.tegg');
  delete v.files['README.md'];
  delete v.files['_attachments/graf.png'];
  return v.files;
};

test('the sample files list the README rows', () => {
  assert.deepEqual(pinsRead(fx('valid.yml')).items.map((i) => i.target), [...VALID, QPIN]);
  assert.deepEqual(pinsRead(fx('valid.yml')).items.map((i) => i.lines), [[3, 5], [5, 7], [7, 9], [9, 10], [10, 11], [11, 12]]);
  assert.deepEqual(pinsRead(fx('nfd.yml')).items.map((i) => i.target), [...VALID, QPIN]);
  assert.deepEqual(pinsRead(fx('entries.yml')).items.map((i) => i.target), [VALID[0], { kind: 'tag', key: 'offsite' }, { kind: 'type', key: 'schůzka' }, QPIN]);
  assert.equal(pinsRead(fx('newer-version.yml')).state, 'newer');
  assert.deepEqual(pinsRead(fx('invalid-yaml.yml')).error?.line, 5);
  for (const f of ['unknown-keys.yml', 'unknown-keys-crlf.yml', 'unknown-keys-no-newline.yml']) {
    const r = pinsRead(fx(f));
    assert.deepEqual([r.state, r.patchable, r.items.map((i) => i.target)], ['ok', true, [VALID[0], { kind: 'tag', key: 'účty' }, VALID[2], VALID[4]]], f);
  }
  const rows = pinsResolve(pinsRead(fx('stale.yml')), vault(), true).map((r) => r.state);
  assert.deepEqual(rows, ['ok', 'ok', 'trashed', 'missing', 'missing', 'noObjects', 'missing']);
  // The pinned fixture has no saved query of that name: `missing`, never `pending` (D-1498).
  assert.deepEqual(pinsResolve(pinsRead(fx('valid.yml')), vault(), true).map((r) => r.state), ['ok', 'ok', 'ok', 'ok', 'ok', 'missing']);
  assert.deepEqual(pinsResolve(pinsRead(fx('valid.yml')), vault(), false).map((r) => r.state), ['pending', 'pending', 'pending', 'pending', 'ok', 'missing']);
});

test('every expected file is the twin\'s output', () => {
  assert.equal(step(null, { edit: 'insert', target: VALID[0], at: null }), fx('expected/created.yml'));
  assert.ok(fx('expected/created.yml').startsWith(`${HEADER}\n`));
  assert.equal(step(fx('expected/created.yml'), { edit: 'insert', target: O(null, 'Pages/Bez hlavičky.md'), at: null }), fx('expected/created-idless.yml'));
  assert.equal(step(fx('valid.yml'), { edit: 'remove', index: 2 }), fx('expected/valid-after-unpin-porada.yml'));
  assert.equal(step(fx('valid.yml'), { edit: 'move', from: 1, to: 3 }), fx('expected/valid-after-move.yml'));
  assert.equal(step(step(fx('valid.yml'), { edit: 'move', from: 1, to: 2 }), { edit: 'move', from: 2, to: 3 }), fx('expected/valid-after-move.yml'));
  assert.equal(step(fx('valid.yml'), { edit: 'insert', target: CAJ, at: 1 }), fx('expected/valid-after-pin-at-2.yml'));
  let t = fx('valid.yml');
  for (let i = 0; i < 5; i++) t = step(t, { edit: 'remove', index: 0 });
  assert.equal(t, fx('expected/valid-after-unpin-all.yml'));
  let c = fx('expected/created.yml');
  c = step(c, { edit: 'remove', index: 0 });
  assert.match(c, /^pins: \[\]$/m, 'the last item leaves `pins: []`');
  for (const v of ['', '-crlf', '-no-newline']) {
    const src = fx(`unknown-keys${v}.yml`);
    assert.equal(step(src, { edit: 'insert', target: CAJ, at: 1 }), fx(`expected/unknown-keys${v}-after-pin.yml`), `pin${v}`);
    assert.equal(step(src, { edit: 'remove', index: 1 }), fx(`expected/unknown-keys${v}-after-unpin.yml`), `unpin${v}`);
    assert.equal(step(src, { edit: 'move', from: 2, to: 0 }), fx(`expected/unknown-keys${v}-after-move.yml`), `move${v}`);
  }
  assert.equal(step(fx('entries.yml'), { edit: 'insert', target: CAJ, at: 1 }), fx('expected/entries-after-pin.yml'));
  assert.equal(step(fx('entries.yml'), { edit: 'remove', index: 1 }), fx('expected/entries-after-unpin.yml'));
  assert.equal(step(fx('entries.yml'), { edit: 'move', from: 2, to: 0 }), fx('expected/entries-after-move.yml'));
  assert.equal(pinsJobPatch(fx('valid.yml'), [{ kind: 'moved', from: 'Projekty/Rozpočet 2027.md', to: 'Projekty/Rozpočet 2028.md', id: ID('01') }]), fx('expected/valid-after-rename.yml'));
  const tagged = `${fx('valid.yml')}  - tag: účty\n`;
  assert.equal(pinsJobPatch(tagged, [{ kind: 'tagRenamed', from: 'účty', to: 'finance' }]), fx('expected/valid-after-tag-rename.yml'));
  const newId = '01JB5PNEWID0000000000000AA';
  assert.equal(pinsJobPatch(fx('stale.yml'), [{ kind: 'moved', from: 'Pages/Bez hlavičky.md', to: 'Pages/Bez hlavičky 2.md', id: newId }]),
    fx('expected/stale-after-rename-bez-hlavicky.yml').replace('<ID>', newId));
  const noVersion = fx('valid.yml').replace('version: 1\n', '');
  const pinned = step(noVersion, { edit: 'insert', target: CAJ, at: null });
  assert.equal(pinned.split('\n')[1], 'version: 1');
  assert.equal(pinned, `${fx('valid.yml')}  - id: ${ID('04')}\n    path: Pages/Čajovna.md\n`);
});

test('the expected files parse with the yaml package to the listed pins', () => {
  const asYaml = (t: PinStoredDto) => (t.kind === 'object' ? { ...(t.id ? { id: t.id } : {}), ...(t.path ? { path: t.path } : {}) } : t.kind === 'tag' ? { tag: t.key } : t.kind === 'query' ? { query: t.name } : { type: t.key });
  for (const f of ['valid.yml', 'expected/created.yml', 'expected/valid-after-move.yml', 'expected/valid-after-pin-at-2.yml', 'expected/unknown-keys-after-pin.yml', 'expected/unknown-keys-crlf-after-move.yml']) {
    const doc = parse(fx(f)) as { pins: unknown[] };
    const listed = pinsRead(fx(f)).items.map((i) => asYaml(i.target));
    assert.deepEqual(doc.pins.filter((p) => listed.some((l) => JSON.stringify(l) === JSON.stringify(Object.fromEntries(Object.entries(p as object).filter(([k]) => ['id', 'path', 'tag', 'type', 'query'].includes(k)))))).length, listed.length, f);
  }
});
