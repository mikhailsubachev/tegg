// MS3 slice 3A, L1: NFR-OTH-02 AC-2 (shown texts are catalog keys), AC-4 (plural forms), AC-5 (collation).
// Written from docs/acceptance/app-shell.md and docs/contracts/ms3-shell.md §3.1, §3.6 only (D-61).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
async function catalog() {
  const cat = await load('../ui/src/i18n/catalog.ts');
  assert.ok(cat, 'ui/src/i18n/catalog.ts is missing');
  return cat;
}

afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const ERROR_KINDS = ['Conflict', 'Gone', 'NotFound', 'NameTaken', 'Io', 'NoVault', 'NotEmpty', 'Placeholder', 'InvalidFrontmatter'];
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

test('nfr_oth_02_ac2_shown_texts_are_catalog_keys', async () => {
  const cat = await catalog();
  const reg = await load('../ui/src/shell/registry.ts');
  assert.ok(reg, 'ui/src/shell/registry.ts is missing');
  const en = cat.en as Record<string, unknown>;
  const keys = Object.keys(en);
  assert.ok(keys.length > 0, 'the en catalog is empty');
  for (const r of [...(reg.ROUTES as any[]), ...(reg.PANEL_TABS as any[])]) {
    assert.ok(r.name in en, `${r.id}: name is not a catalog key`);
    if ('purpose' in r) assert.ok(r.purpose in en, `${r.id}: purpose is not a catalog key`);
  }
  for (const c of reg.DISABLED_CONTROLS as any[]) assert.ok(c.label in en, `disabled control ${c.label} is not a catalog key`);
  cat.setCatalog(cat.en, 'en');
  const coming = keys.filter((k) => typeof en[k] === 'string' && /^Coming in \{\w+\}$/.test(en[k] as string));
  assert.ok(coming.length > 0, 'no catalog message "Coming in {…}" (D-116, AP-74)');
  for (const kind of ERROR_KINDS) {
    // The Import window's own error texts (`import.error.*`, R155) sit beside the general ones; they are not counted here.
    const hit = keys.filter((k) => !k.startsWith('import.error.') && /error/i.test(k) && squash(k).endsWith(squash(kind)));
    assert.equal(hit.length, 1, `exactly one catalog message for core error kind ${kind} (found: ${hit.join(', ') || 'none'})`);
  }
});

test('nfr_oth_02_ac4_plural_forms_follow_locale_rules', async () => {
  const cat = await catalog();
  // The mechanism, with a synthetic message: Intl.PluralRules('cs') gives one / few / other for 1 / 3 / 5.
  cat.setCatalog({ 'test.files': { one: 'jeden soubor ({count})', few: '{count} soubory', other: '{count} souborů' } }, 'cs');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('test.files', { count: n })), ['jeden soubor (1)', '3 soubory', '5 souborů']);
  // The placeholder warning (FR-VLT-03 AC-4): a plural message in en; a Czech test catalog with the same key.
  const en = cat.en as Record<string, any>;
  const warn = Object.keys(en).filter((k) => /placeholder/i.test(k) && typeof en[k] === 'object' && /file/.test(String(en[k].other)));
  assert.equal(warn.length, 1, `one plural placeholder-warning message in en (found: ${warn.join(', ') || 'none'})`);
  cat.setCatalog(cat.en, 'en');
  assert.match(cat.t(warn[0], { count: 1 }), /^1 file\b/);
  assert.match(cat.t(warn[0], { count: 3 }), /^3 files\b/);
  cat.setCatalog({ [warn[0]]: { one: 'ONE {count}', few: 'FEW {count}', other: 'OTHER {count}' } }, 'cs');
  assert.deepEqual([1, 3, 5].map((n) => cat.t(warn[0], { count: n })), ['ONE 1', 'FEW 3', 'OTHER 5']);
});

test('nfr_oth_02_ac5_name_sort_uses_region_collation', async () => {
  const col = await load('../ui/src/i18n/collate.ts');
  assert.ok(col, 'ui/src/i18n/collate.ts is missing');
  const plurals = ['Schůzky', 'Čajovny', 'Cesty'];
  col.setCollationLocale('cs');
  assert.deepEqual([...plurals].sort(col.collator().compare), ['Cesty', 'Čajovny', 'Schůzky'], 'cs');
  col.setCollationLocale('en');
  assert.deepEqual([...plurals].sort(col.collator().compare), ['Čajovny', 'Cesty', 'Schůzky'], 'en');
  // NFD input sorts like NFC (FR-FMT-12).
  col.setCollationLocale('cs');
  assert.deepEqual(['Schůzky', 'Čajovny'.normalize('NFD'), 'Cesty'].sort(col.collator().compare).map((s) => s.normalize('NFC')), ['Cesty', 'Čajovny', 'Schůzky']);
});
