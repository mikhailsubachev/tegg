// Slice Q, L1 / L3: docs/acceptance/queries.md FR-FMT-06 AC-4. Every query file of the fixture and of
// tests/fixtures/queries-files/expected/ parses with the `yaml` package (YAML 1.2) to the keys Tegg shows, `micromark`
// (CommonMark) reads each fixture note's fence as one code block with info `query`, and the real `@tegg/doc`
// `queryFences` (docs/contracts/v1-queries.md §3.1, the L3 twin of `tegg_format::query_fences`) gives
// tests/fixtures/queries-files/expected.json's `fences`. The fake core's twin is checked against the same corpus by
// app/test/fake_queries.contract.test.ts (D-512). Written from the ACs, the contract and the fixtures only (D-61).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { queryFencesOf } from '../ui/test/fake-queries';
import { QFX, REPO, expectedFile, queriesVault } from './queries-data';

type Mod = Record<string, any>;
const EXPECTED = join(QFX, 'expected.json');
function expectedJson(): any {
  assert.ok(existsSync(EXPECTED), 'tests/fixtures/queries-files/expected.json exists (L3, contract §6.2)');
  return JSON.parse(readFileSync(EXPECTED, 'utf8'));
}
const files = queriesVault();

// ------------------------------------------------------------------------------------------------ FR-FMT-06 AC-4

test('fr_fmt_06_ac4_fence_is_yaml_and_code', async () => {
  // Every query file of the fixture and of expected/ parses with the yaml package (YAML 1.2), except Nečitelný.
  const yml = [
    ...Object.keys(files).filter((p) => p.endsWith('.yml') && p.includes('.tegg/queries/') && !p.endsWith('Nečitelný.yml')).map((p) => [p, files[p]] as const),
    ...readdirSync(join(QFX, 'expected')).map((n) => [`expected/${n}`, expectedFile(n)] as const),
  ];
  for (const [p, t] of yml) {
    const y = parseYaml(t) as Record<string, unknown>;
    assert.ok(y && typeof y === 'object' && typeof y.title === 'string', `${p}: YAML 1.2 with a title`);
  }
  // Every fence body of the fixture notes parses as YAML except the broken inline one.
  const notes = Object.keys(files).filter((p) => p.endsWith('.md'));
  let fences = 0;
  const req = createRequire(resolve(REPO, 'packages/doc/package.json'));
  const mm = await import(pathToFileURL(req.resolve('micromark')).href);
  const doc = await import('@tegg/doc');
  for (const p of notes) {
    const fs = await queryFencesOf(files[p]);
    for (const f of fs) {
      fences++;
      if (f.body.startsWith('title: [rozbitý')) continue;
      assert.doesNotThrow(() => parseYaml(f.body), `${p}: the fence body is YAML`);
    }
    const body = files[p].slice(doc.parse(files[p]).bodyStart);
    const html: string = mm.micromark(body);
    assert.equal((html.match(/<code class="language-query">/g) ?? []).length, fs.length, `${p}: micromark reads each fence as one code block with info \`query\``);
  }
  assert.equal(fences, 15, 'the fixture holds 15 query fences (Porada 7: 2, Porada 14: 1, Lisabon: 1, Den: 1, Přehled: 9, Šablona: 1)');
  // The product's @tegg/doc `queryFences` (§3.1) gives expected.json's fences.
  const ex = expectedJson();
  const qf = (doc as Mod).queryFences;
  assert.equal(typeof qf, 'function', '@tegg/doc exports queryFences (contract §3.1)');
  for (const [path, want] of Object.entries(ex.fences as Record<string, any[]>)) {
    const got = (qf(files[path]) as any[]).map((f) => ({ range: f.range, saved: f.saved, nested: f.nested }));
    assert.deepEqual(got, want.map((w) => ({ range: w.range, saved: w.saved, nested: w.nested })), `${path}: @tegg/doc queryFences`);
  }
});
