// MS5 slice 5B, L1: the capture window's tag field and the default-type matching (docs/acceptance/capture.md R55 Tags,
// FR-CAP-01 AC-6 "L1 for the list", FR-VLT-05 AC-1 "L1 for the matching twin"; docs/contracts/ms5-capture.md §4, §5.1,
// §11.2). `app/ui/src/capture/tags.ts` (`tagSuggestions`, `addChip`: the pure part of TagField.tsx) and the fake core's
// settings twin (app/ui/test/fake-settings.ts) with the Settings warning text (R59). Written from the ACs and the
// contract only (D-61). Modules load inside the tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
async function tags(): Promise<Mod> {
  const m = await load('../ui/src/capture/tags.ts');
  assert.ok(m && typeof m.tagSuggestions === 'function' && typeof m.addChip === 'function', 'ui/src/capture/tags.ts exports tagSuggestions and addChip');
  return m!;
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const REPO = resolve(import.meta.dirname, '../..');
function inboxFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [dir, prefix] of [['tests/fixtures/vaults/inbox', ''], ['tests/fixtures/vaults/new-empty/.tegg', '.tegg/']] as const) {
    const abs = resolve(REPO, dir);
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else files[(prefix + relative(abs, p)).normalize('NFC')] = readFileSync(p, 'utf8'); } };
    walk(abs);
  }
  delete files['README.md'];
  return files;
}
const nfd = (s: string) => s.normalize('NFD');

// ------------------------------------------------------------------------------------------------ FR-CAP-01 AC-6

test('fr_cap_01_ac6_suggestions_start_with_then_contain_folded_at_most_8', async () => {
  const m = await tags();
  // The fixture's index tags (nákup, doma, práce) plus runtime tags for the ordering and the limit.
  const index = ['nákup', 'doma', 'práce', 'Nákupy', 'Nakladatel', 'vánoční nákup', 'zánik', 'Čajovna'];
  assert.deepEqual(m.tagSuggestions('nák', index, 'cs'), ['Nakladatel', 'nákup', 'Nákupy', 'vánoční nákup'], 'starting with nák (folded), then containing it, each in D-122 order');
  assert.equal(m.tagSuggestions('nák', index, 'cs')[0], 'Nakladatel', 'the first starting-with tag');
  assert.deepEqual(m.tagSuggestions('#nák', ['nákup', 'doma'], 'cs'), ['nákup'], 'a typed # is ignored');
  assert.deepEqual(m.tagSuggestions(nfd('nák'), ['nákup'], 'cs'), ['nákup'], 'NFD typed text matches');
  assert.deepEqual(m.tagSuggestions('cajov', index, 'cs'), ['Čajovna'], 'diacritics folded');
  const many = Array.from({ length: 12 }, (_, i) => `nákup${String(i + 1).padStart(2, '0')}`);
  assert.equal(m.tagSuggestions('nák', many, 'cs').length, 8, 'at most 8');
  assert.deepEqual(m.tagSuggestions('nák', ['nákup'], 'cs'), ['nákup'], 'the fixture case: nák lists #nákup first');
});

test('fr_cap_01_ac6_chips_are_not_doubled_and_are_nfc', async () => {
  const m = await tags();
  assert.deepEqual(m.addChip([], 'nákup'), ['nákup'], 'a chip');
  assert.deepEqual(m.addChip(['nákup'], 'výlet'), ['nákup', 'výlet'], 'a second chip');
  assert.deepEqual(m.addChip([], '#výlet'), ['výlet'], 'a typed # is not doubled');
  assert.deepEqual(m.addChip(['nákup'], 'Nákup'), ['nákup'], 'case-insensitive duplicate not added');
  assert.deepEqual(m.addChip(['nákup'], nfd('nákup')), ['nákup'], 'NFD duplicate not added');
  assert.deepEqual(m.addChip([], nfd('výlet')), ['výlet'.normalize('NFC')], 'an NFD tag is NFC');
  assert.deepEqual(m.addChip(['nákup'], '   '), ['nákup'], 'nothing for an empty token');
});

// ------------------------------------------------------------------------------------------------ FR-VLT-05 AC-1

test('fr_vlt_05_ac1_the_default_type_twin_and_the_settings_warning', async () => {
  const twin = await load('../ui/test/fake-settings.ts');
  const cat = await load('../ui/src/i18n/catalog.ts');
  assert.ok(twin && typeof twin.vaultSettings === 'function' && typeof twin.captureDefault === 'function', 'app/ui/test/fake-settings.ts (§11.2)');
  assert.ok(cat, 'catalog');
  const base = inboxFiles();
  const yml = base['.tegg/vault.yml'];
  const variant = (line: string | null): Record<string, string> => ({ ...base, '.tegg/vault.yml': line === null ? yml.replace(/^default-type:.*\n/m, '') : yml.replace(/^default-type:.*$/m, line) });
  const cases: [string | null, string, boolean, string][] = [
    ['default-type: Quick Note', 'quick-note', true, 'quick-note'],
    ['default-type: quick-note', 'quick-note', true, 'quick-note'],
    ['default-type: nápad', 'nápad', true, 'nápad'],
    ['default-type: Nápad', 'nápad', true, 'nápad'],
    [`default-type: ${nfd('nápad')}`, 'nápad', true, 'nápad'],
    ['default-type: Daily Note', 'daily-note', true, 'quick-note'],
    [null, 'quick-note', false, 'quick-note'],
    ['default-type: ""', 'quick-note', false, 'quick-note'],
    ['default-type: [a, b]', 'quick-note', false, 'quick-note'],
    ['default-type: Neexistuje', 'quick-note', false, 'quick-note'],
  ];
  for (const [line, key, valid, capture] of cases) {
    const f = variant(line);
    const s: any = twin!.vaultSettings(f);
    assert.deepEqual([s.defaultType.key, s.defaultType.valid], [key, valid], `${line ?? '(missing)'}: key and validity (D-239, D-541)`);
    assert.equal(twin!.captureDefault(f), capture, `${line ?? '(missing)'}: the capture window's default`);
  }
  // The warning settings/vault shows for an unusable value (R59).
  assert.equal(cat!.t('settings.vault.badDefault', { value: 'Neexistuje' }), 'The default type "Neexistuje" doesn\'t exist. Using Quick Note.', 'settings.vault.badDefault');
  // A deleted type file (outside Tegg) makes its value unusable (FR-VLT-05 AC-7).
  const gone = variant('default-type: nápad');
  delete gone['.tegg/types/nápad.yml'];
  assert.deepEqual([twin!.vaultSettings(gone).defaultType.key, twin!.vaultSettings(gone).defaultType.valid], ['quick-note', false], 'nápad.yml deleted → Quick Note');
});
