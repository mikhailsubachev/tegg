// Search page redesign real-app test (L6, Appium mac2 on the built test app, D-382, TS-I7): docs/acceptance/
// search-navigation.md § "Search page redesign" FR-SRC-02 AC-17 ("L6 once for the relaunch"): the query and the Type
// filter belong to the `search` history entry and aren't stored anywhere else, so after a relaunch `search` opens
// empty with `Type: all`, and neither the vault nor `ui-state.json` changes (D-1217). TEGG_TEST=1 with TEGG_NOW, a
// temporary Application Support and a temporary copy of the synthetic `search/` + `search-page/` fixture (D-62,
// D-1222). Keys go only to Tegg (D-799). Written from the AC and docs/contracts/v1-search.md only (D-61).
// v0.109 (D-1343): FR-NAV-01 AC-22 ("L6 once for the created file"): the count line's `Create “cteni”` creates
// `Quick Notes/cteni.md` (the default type) as the one change in the vault, and opens it.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { FX, appiumDown, changedPaths, end, firstShown, need, nfc, read, ready, session, shown, sleep, support, testEnv, tmp, tree, typeAscii, waitFile, waitMark, type Driver } from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

function pageVault(base: string): string {
  const v = join(base, 'Hledání');
  cpSync(join(FX, 'search'), v, { recursive: true });
  cpSync(join(FX, 'search-page'), v, { recursive: true });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  return v;
}
const uiState = (sup: string) => (existsSync(join(sup, 'ui-state.json')) ? readFileSync(join(sup, 'ui-state.json'), 'utf8') : '');
async function fieldValue(d: Driver): Promise<string> {
  const f = await firstShown(d, 'Search query');
  return f ? nfc(String((await f.getAttribute('value').catch(() => '')) ?? '')) : '<no field>';
}

test('fr_src_02_ac17_search_opens_empty_with_type_all_after_a_relaunch', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('search-page-ac17');
  const vault = pageVault(base);
  const sup = support(base);
  const log = join(base, 'perf.jsonl');
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    d = await session(testEnv(sup, log, { TEGG_VAULT: vault, TEGG_ROUTE: 'search' }));
    assert.ok(await waitMark(log, 'route-ready:search'), 'search shown');
    const ui0 = uiState(sup);
    await (await need(d, 'Search query', 5000)).click();
    typeAscii('noci');
    await (await need(d, 'Type: all', 5000)).click();
    await (await need(d, 'Quick Note 2', 3000)).click();
    assert.ok(await shown(d, 'Type: Quick Note', 3000), 'the Type filter reads Type: Quick Note');
    assert.equal(await fieldValue(d), 'noci', 'the query is typed');
    await sleep(500);
    assert.equal(uiState(sup), ui0, 'changing the text and the filter stores nothing in ui-state.json');
    await end(d);
    d = undefined;
    const log2 = join(base, 'perf2.jsonl');
    d = await session(testEnv(sup, log2, { TEGG_VAULT: vault, TEGG_ROUTE: 'search' }));
    assert.ok(await waitMark(log2, 'route-ready:search'), 'search shown after the relaunch');
    assert.ok(await shown(d, 'Type: all', 5000), 'after a relaunch search opens with Type: all');
    assert.equal(await shown(d, 'Type: Quick Note', 500), false, 'the Type filter isn\'t remembered');
    assert.equal(await fieldValue(d), '', 'the query isn\'t remembered');
    assert.ok(await shown(d, 'Search all your objects', 3000), 'the empty state of FR-SRC-03 AC-14');
    assert.doesNotMatch(uiState(sup), /noci|quick-note|Quick Note/, 'nothing of the search state in ui-state.json');
  } finally {
    await end(d);
  }
  assert.deepEqual(tree(vault), before, 'the vault is unchanged: bytes, mtime and inode of every file');
  rmSync(base, { recursive: true, force: true });
});

test('fr_nav_01_ac22_create_button_creates_the_file_once', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('search-no-goto-ac22');
  const vault = pageVault(base);
  const sup = support(base);
  const log = join(base, 'perf.jsonl');
  const before = tree(vault);
  const NEW = 'Quick Notes/cteni.md';
  let d: Driver | undefined;
  try {
    d = await session(testEnv(sup, log, { TEGG_VAULT: vault, TEGG_ROUTE: 'search' }));
    assert.ok(await waitMark(log, 'route-ready:search'), 'search shown');
    await (await need(d, 'Search query', 5000)).click();
    typeAscii('cteni');
    await (await need(d, 'Create “cteni”', 5000)).click();
    assert.ok(await waitMark(log, `route-ready:note/${NEW}`), 'the new object opens (note/Quick Notes/cteni.md)');
    const text = await waitFile(join(vault, NEW), (t) => t !== null, 5000);
    assert.ok(text?.includes('\ntitle: cteni\n') && text.includes('\ntype: quick-note\n'), `Quick Notes/cteni.md with title: cteni, type: quick-note: ${text}`);
    await sleep(1000);
  } finally {
    await end(d);
  }
  assert.deepEqual(changedPaths(before, tree(vault)), [NEW], 'the one change in the vault is the created file (D-232: one write)');
  assert.equal(read(vault, NEW)?.includes('title: cteni'), true, 'the file stays');
  rmSync(base, { recursive: true, force: true });
});
