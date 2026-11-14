// Slice REL, L1: docs/acceptance/related.md NFR-OTH-02 AC-20 (the catalog has exactly R183's keys with the English texts;
// no string has a count, so no plural forms). Interface docs/contracts/v1-related.md §3.2 (`app/ui/src/i18n/catalog.ts`).
// The pseudo-locale half is in app/webkit/related_a11y.ac.test.ts. Written from the ACs and the contract only (D-61).
// Modules load inside the test (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try { return (await import(/* @vite-ignore */ path)) as Mod; } catch { return null; }
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const R183: [string, string][] = [
  ['related.tab', 'Related'], ['related.list', 'Related notes'], ['related.showLinked', 'Show linked notes'], ['related.linked', 'Linked'],
  ['related.linkedDescription', 'Linked with this note'], ['related.empty', 'No related notes'], ['related.loading', 'Loading…'],
  ['cmd.related.show', 'Show related'], ['cmd.related.showLinked', 'Related: Show linked notes'], ['cmd.related.hideLinked', 'Related: Hide linked notes'],
];

test('nfr_oth_02_ac20_related_strings_in_the_catalog', async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  assert.ok(cat, 'ui/src/i18n/catalog.ts loads');
  const en = cat!.en as Record<string, unknown>;
  const bad: string[] = [];
  for (const [key, want] of R183) {
    const got = key in en ? cat!.t(key, {}) : 'missing';
    if (got !== want) bad.push(`${key}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    if (typeof en[key] !== 'string') bad.push(`${key}: a plain string, no plural forms`);
  }
  assert.deepEqual(bad, [], "R183's keys with their English texts");
  const extra = Object.keys(en).filter((k) => (k.startsWith('related.') || k.startsWith('cmd.related.')) && !R183.some(([x]) => x === k));
  assert.deepEqual(extra, [], 'exactly R183\'s keys (no other related.* or cmd.related.* key)');
  for (const [key] of R183) assert.ok(!/\{\s*count/.test(String(en[key])), `${key} has no count`);
});
