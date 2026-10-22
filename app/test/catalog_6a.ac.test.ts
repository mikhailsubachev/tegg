// MS6 slice 6A, L1: the strings of the trash and media (docs/acceptance/trash-media.md R78; docs/contracts/
// ms6-trash-media.md §8). FR-HIS-01 AC-9 (every R78 key with its English text, plural forms; the extra §8 keys; the
// retired keys; `route.home`, `purpose.home`, `cmd.goto.home` stay for v1.0). The pairs are read from the approved
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
/** `key` `English text` pairs of the strings table whose line starts with `first`. */
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
const R78 = () => pairs('docs/acceptance/trash-media.md', '`trash.title`');

test('fr_his_01_ac9_r78_strings_are_catalog_keys_with_the_exact_english', async () => {
  const cat = await catalog();
  const list = R78();
  assert.equal(list.length, 33, `R78 has ${list.length} keys with text`);
  assert.deepEqual(check(cat, list), [], 'every R78 key with its English text');
});

test('fr_his_01_ac9_contract_strings_and_plural_forms', async () => {
  const cat = await catalog();
  assert.deepEqual(check(cat, [
    ['trash.nothing', 'Nothing to delete yet.'],
    ['trash.conflict', '"{title}" changed outside Tegg. It wasn\'t moved to the trash.'],
    ['trash.removeFailed', "{count} items couldn't be removed."],
    ['media.dropHint', 'Drop to add'],
  ]), [], 'ms6-trash-media §8 keys');
  assert.equal(cat.t('media.tooLarge', { name: 'velký.png' }), cat.t('media.refused', { name: 'velký.png' }), 'media.tooLarge = media.refused (D-621)');
  const one: [string, string][] = [['trash.summary', '1 item'], ['trash.folder', '1 object'], ['media.pages', '1 page'], ['trash.removeFailed', "1 item couldn't be removed."], ['trash.movedMany', 'Moved 1 item to the trash']];
  for (const [k, want] of one) assert.equal(cat.t(k, { count: 1 }), want, `${k}: plural forms (count 1)`);
  for (const k of ['route.home', 'purpose.home', 'cmd.goto.home']) assert.ok(k in cat.en, `${k} stays for v1.0`);
  for (const k of ['capture.mediaLater', 'ph.embedImage']) assert.ok(!(k in cat.en), `${k} is retired`);
});
