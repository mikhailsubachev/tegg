// Search page redesign, L1: the catalog strings and plural forms (docs/acceptance/search-navigation.md § "Search page
// redesign" FR-SRC-03 AC-18, D-133) and the highlight and text tokens (FR-SRC-03 AC-19, D-129). Interface
// docs/contracts/v1-search.md §3 (keys, `--sel-hl` light #FFE7A3 / dark #5A4718). Written from the ACs and the
// contract only (D-61). Modules load inside the tests (TS-I1).
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
async function catalog(): Promise<Mod> {
  const cat = await load('../ui/src/i18n/catalog.ts');
  assert.ok(cat && typeof cat.t === 'function' && typeof cat.setCatalog === 'function', 'ui/src/i18n/catalog.ts');
  return cat!;
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

/** v1-search §3 and the AC texts: key → [variables, English text]. */
const STRINGS: [string, Record<string, string | number>, string][] = [
  ['search.placeholder', {}, 'Search for a phrase'],
  ['search.clear', {}, 'Clear search'],
  ['search.filters', {}, 'Filters'],
  ['search.typeAll', {}, 'Type: all'],
  ['search.typeOne', { type: 'Task' }, 'Type: Task'],
  ['search.allTypes', {}, 'All types'],
  ['search.clearFilters', {}, 'Clear filters'],
  ['search.alias', { alias: 'Reading list' }, 'Alias: Reading list'],
  ['search.attribute', { label: 'místo', value: 'Špindlerův Mlýn' }, 'místo: Špindlerův Mlýn'],
  ['search.filterTag', { tag: 'zima' }, 'Filter by #zima'],
  ['search.filterType', { type: 'Task' }, 'Type Task'],
  ['search.emptyTitle', {}, 'Search all your objects'],
  ['search.emptyBody', {}, 'Type a phrase to search titles, text, file names and attribute values, or pick a type or tag. A filter alone is a search too.'],
  ['search.noResultsTitle', { q: 'rozpočet' }, 'No results for “rozpočet”'],
  ['search.noResultsBody', { q: 'rozpočet', filters: 'Type Task and #hory' }, 'Nothing matches “rozpočet” with Type Task and #hory. Clear the filters to search everything.'],
  ['search.noObjectsTitle', { filters: 'Type Task and #hory' }, 'No objects with Type Task and #hory'],
  ['search.noObjectsBody', {}, 'Clear the filters to search everything.'],
  // Unchanged (AC-18): the field's name, the list's name, the file-name line and the typo mark.
  ['search.label', {}, 'Search query'],
  ['search.results', {}, 'Search results'],
  ['search.fileName', { stem: 'Lipno víkend' }, 'File name: Lipno víkend'],
  ['search.typo', {}, 'similar spelling'],
];

/** The count messages and `Show next` (D-1204, D-1212): key → variables without `count` → [count, English]. */
const PLURALS: [string, Record<string, string>, [number, string][]][] = [
  ['search.count', {}, [[1, '1 result'], [5, '5 results']]],
  ['search.countTags', { tags: '#hory #zima' }, [[1, '1 object with #hory #zima'], [3, '3 objects with #hory #zima']]],
  ['search.countType', { type: 'Page' }, [[1, '1 object of type Page'], [6, '6 objects of type Page']]],
  ['search.countTypeTags', { type: 'Quick Note', tags: '#hory' }, [[1, '1 object of type Quick Note with #hory'], [2, '2 objects of type Quick Note with #hory']]],
  ['search.showNext', {}, [[10, 'Show next 10'], [50, 'Show next 50'], [1, 'Show next 1']]],
];

test('fr_src_03_ac18_every_string_is_a_catalog_key_with_its_english_text', async () => {
  const cat = await catalog();
  const bad: string[] = [];
  for (const [key, vars, want] of STRINGS) {
    if (!(key in cat.en)) { bad.push(`${key}: missing`); continue; }
    const got = cat.t(key, vars);
    if (got !== want) bad.push(`${key}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  for (const [key, vars, cases] of PLURALS) {
    if (!(key in cat.en)) { bad.push(`${key}: missing`); continue; }
    for (const [n, want] of cases) {
      const got = cat.t(key, { ...vars, count: n });
      if (got !== want) bad.push(`${key} (${n}): want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    }
  }
  assert.deepEqual(bad, [], 'v1-search §3 keys with the AC texts');
});

test('fr_src_03_ac18_count_messages_use_plural_forms_never_number_plus_word', async () => {
  const cat = await catalog();
  const notPlural = PLURALS.map(([k]) => k).filter((k) => !(k in cat.en) || typeof cat.en[k] === 'string');
  assert.deepEqual(notPlural, [], 'the count messages and Show next are plural messages (Intl.PluralRules), not one string with a number');
  // The Czech test catalog: 1, 3 and 6 pick three different forms (one, few, other).
  const cs: Record<string, unknown> = {
    'search.count': { one: '{count} výsledek', few: '{count} výsledky', other: '{count} výsledků' },
    'search.countTags': { one: '{count} objekt s {tags}', few: '{count} objekty s {tags}', other: '{count} objektů s {tags}' },
    'search.countType': { one: '{count} objekt typu {type}', few: '{count} objekty typu {type}', other: '{count} objektů typu {type}' },
    'search.countTypeTags': { one: '{count} objekt typu {type} s {tags}', few: '{count} objekty typu {type} s {tags}', other: '{count} objektů typu {type} s {tags}' },
    'search.showNext': { one: 'Zobrazit další {count}', few: 'Zobrazit další {count} (few)', other: 'Zobrazit dalších {count}' },
  };
  cat.setCatalog({ ...(cat.en as object), ...cs }, 'cs');
  const bad: string[] = [];
  for (const [key, vars] of PLURALS) {
    const forms = [1, 3, 6].map((n) => cat.t(key, { ...vars, type: 'Stránka', tags: '#hory', count: n }) as string);
    if (new Set(forms).size !== 3) bad.push(`${key}: ${forms.join(' | ')}`);
  }
  assert.deepEqual(bad, [], 'three different Czech forms for 1, 3 and 6');
  // In English the same keys still give the AC's texts after switching back.
  cat.setCatalog(cat.en, 'en');
  assert.equal(cat.t('search.countTags', { tags: '#hory', count: 3 }), '3 objects with #hory', 'search.countTags in English');
});

// ------------------------------------------------------------------------------------------------ AC-19 tokens

test('fr_src_03_ac19_highlight_token_and_text_contrast_in_both_themes', async () => {
  const tok = await load('../ui/src/theme/tokens.ts');
  const con = await load('../ui/src/theme/contrast.ts');
  assert.ok(tok && tok.themes && con && typeof con.ratio === 'function', 'theme tokens and contrast');
  const light = tok!.themes.light as Record<string, string>;
  const dark = tok!.themes.dark as Record<string, string>;
  assert.deepEqual([String(light['sel-hl']).toUpperCase(), String(dark['sel-hl']).toUpperCase()], ['#FFE7A3', '#5A4718'], 'the sel-hl token (D-129)');
  const bad: string[] = [];
  for (const [name, t] of [['light', light], ['dark', dark]] as const) {
    for (const [fg, bg] of [['text', 'sel-hl'], ['text', 'bg'], ['muted', 'bg']]) {
      if (!t[fg] || !t[bg]) { bad.push(`${name}: ${fg} or ${bg} missing`); continue; }
      const r = con!.ratio(t[fg], t[bg]);
      if (r < 4.5) bad.push(`${name}: ${fg} on ${bg} = ${r.toFixed(2)}`);
    }
  }
  assert.deepEqual(bad, [], '≥ 4.5:1 for the highlight and the page text tokens');
});
