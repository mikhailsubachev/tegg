// MS5 slice 5B, L1: the strings of capture, settings and the Inbox (docs/acceptance/capture.md R58, R59;
// docs/acceptance/inbox.md R63; docs/contracts/ms5-capture.md §9). FR-CAP-01 AC-14 (every R59 key with its English
// text; the status item's menu strings in Rust equal the catalog), FR-SET-01 AC-10 (the Settings: Vault strings and
// commands), FR-SET-03 AC-5 (the Date & time page's labels), FR-INB-01 AC-11 (every R63 key, plural forms).
// The pairs are read from the approved criteria. Written from the ACs and the contract only (D-61). Modules load
// inside the tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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
const R59 = () => pairs('docs/acceptance/capture.md', '`capture.window`');
const R63 = () => pairs('docs/acceptance/inbox.md', '`inbox.title`');

// ------------------------------------------------------------------------------------------------ FR-CAP-01 AC-14

test('fr_cap_01_ac14_r59_strings_are_catalog_keys_with_the_exact_english', async () => {
  const cat = await catalog();
  const list = R59();
  // 6A (D-620, D-628): `capture.mediaLater` is retired (catalog_6a.ac.test.ts requires it to be absent).
  assert.ok(!list.some(([k]) => k === 'capture.mediaLater'), 'R59 no longer lists capture.mediaLater');
  assert.equal(list.length, 63, `R59 has ${list.length} keys`);
  assert.deepEqual(check(cat, list), [], 'every R59 key with its English text');
});

test('fr_cap_01_ac14_the_status_menu_strings_in_rust_equal_the_catalog', async () => {
  const cat = await catalog();
  const file = resolve(REPO, 'app/src-tauri/src/strings.rs');
  assert.ok(existsSync(file), 'app/src-tauri/src/strings.rs (the menu bar strings, §9)');
  const rust = new Map([...readFileSync(file, 'utf8').matchAll(/"(menubar\.[A-Za-z]+)"\s*(?:,|=>|:)\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const menubar = R59().filter(([k]) => k.startsWith('menubar.'));
  assert.equal(menubar.length, 7, 'R59 menubar.* keys');
  for (const [key, text] of menubar) {
    assert.equal(rust.get(key), text, `${key} in strings.rs`);
    assert.equal(cat.t(key), text, `${key} in the catalog`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-SET-01 AC-10

test('fr_set_01_ac10_settings_strings_and_commands', async () => {
  const cat = await catalog();
  const list = R59().filter(([k]) => k.startsWith('settings.') || k === 'hotkeys.notice');
  assert.ok(list.length >= 20, `settings strings: ${list.length}`);
  assert.deepEqual(check(cat, list), [], 'Settings: Vault, Menu bar and startup, Shortcuts strings');
  const cmd = await load('../ui/src/shell/commands.ts');
  assert.ok(cmd, 'shell/commands.ts');
  const ctx = { vault: { name: 'Doručené', path: '/tmp/Doručené', placeholders: 0 }, types: [], counts: {} };
  const titles = (cmd!.commands(ctx) as any[]).map((c) => cat.t(c.title, c.vars ?? {}));
  for (const t of ['Go to Settings: Vault', 'Go to Settings: Menu bar and startup', 'Go to Settings: Shortcuts', 'Go to Settings: Date & time']) assert.ok(titles.includes(t), `palette command ${t}`);
  const due = (cmd!.commands(ctx) as any[]).filter((c) => /^Go to Settings: (Vault|Menu bar and startup|Shortcuts|Date & time)$/.test(cat.t(c.title, c.vars ?? {}))).filter((c) => c.due);
  assert.deepEqual(due.map((c) => cat.t(c.title)), [], 'the four Settings pages are built (no "Coming in")');
});

// ------------------------------------------------------------------------------------------------ FR-SET-03 AC-5

test('fr_set_03_ac5_date_and_time_labels_are_catalog_texts', async () => {
  const cat = await catalog();
  const values = new Set(Object.values(cat.en as Record<string, unknown>).filter((v): v is string => typeof v === 'string'));
  for (const label of ['Date format', 'Time format', 'First day of week', 'Region', 'ISO (2026-10-14)', 'Long (14 October 2026)', '24-hour', '12-hour', 'Monday', 'Sunday']) {
    assert.ok(values.has(label), `R58 label "${label}" is a catalog text`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-11

test('fr_inb_01_ac11_r63_strings_are_catalog_keys_with_the_exact_english', async () => {
  const cat = await catalog();
  const list = R63();
  assert.equal(list.length, 54, `R63 has ${list.length} keys`);
  assert.deepEqual(check(cat, list), [], 'every R63 key with its English text');
  const plural = ['inbox.summary', 'inbox.markAllConfirm', 'inbox.selected', 'inbox.done.many', 'inbox.skipped', 'sidebar.inboxCount', 'backup.convert'];
  for (const k of plural) assert.equal(typeof cat.en[k], 'object', `${k} has plural forms`);
  assert.equal(cat.t('inbox.skipped', { count: 1 }), "1 item changed outside Tegg and wasn't changed.", 'the singular of inbox.skipped (FR-INB-02 AC-12)');
  assert.equal(cat.t('sidebar.inboxCount', { count: 13 }), '13 items to review', 'sidebar description on the fixture');
  assert.equal(cat.t('inbox.summary', { count: 13 }), '13 to review', 'summary on the fixture');
  assert.equal(cat.t('backup.convert', { count: 2, type: 'Nápad' }), 'Convert 2 items to Nápad', 'backup label (FR-INB-02 AC-14)');
});
