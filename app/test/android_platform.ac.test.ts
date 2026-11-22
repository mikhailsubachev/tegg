// Slice AND-1, L1 (Vitest, Node): docs/acceptance/android-shell.md AR-03 AC-11, the L1 part "the client's refusal list,
// which equals RA2" (AP-2026 → D-2026), through docs/contracts/android-shell.md §9.1:
// - `app/ui/src/ipc/android.ts` exports `ANDROID_EXCLUDED` (RA2's groups P1…P5, J, V, O);
// - CP-3 → D-2038: it equals `DESKTOP − (ANDROID − ANDROID_ONLY)` of the shell, read from
//   `app/src-tauri/target/commands.json`, which the Rust AR-03 AC-9 test writes (the `app-shell-test` step runs Rust
//   before the UI tests); the test fails when the file is missing;
// - `app/ui/src/platform.ts` exports `platform()`: `window.__TEGG_PLATFORM__`, default `macos`.
// The page behaviour (no invoke, the `Unsupported` alert) is the L5 test app/webkit/android_shell.ac.test.ts.
// Written from the ACs and the contract only (D-61). Modules load inside the test (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try { return (await import(/* @vite-ignore */ path)) as Mod; } catch { return null; }
}

/** RA2's groups, as the ACs list them. */
const RA2: Record<string, string[]> = {
  P1: ['capture_context', 'capture_create', 'capture_ready', 'capture_hide', 'capture_resize', 'capture_open_main', 'capture_draft_get', 'capture_draft_set', 'capture_saved_show', 'capture_saved_hover', 'capture_suggest', 'capture_open', 'capture_media_add'],
  P2: ['hotkeys', 'hotkeys_retry', 'shell_settings', 'shell_settings_set'],
  P3: ['import_pick_source', 'import_scan', 'import_cancel', 'import_where', 'import_check_target', 'import_plan', 'import_start', 'import_status', 'import_discard', 'import_transform_result'],
  P4: ['vault_pick_dir', 'media_pick'],
  P5: ['vault_reveal', 'media_reveal', 'backup_reveal', 'media_open', 'open_external', 'app_about', 'app_quit'],
  J: ['note_rename', 'tag_rename', 'tag_delete', 'merge_start', 'type_move_plan', 'type_move', 'folder_move_preview', 'tidy_now', 'value_remove_start', 'type_delete_start', 'inbox_bulk', 'starter_add', 'backup_restore', 'job_undo', 'job_redo', 'type_create', 'type_patch', 'type_delete'],
  V: ['query_apply', 'query_revert', 'query_create', 'query_duplicate', 'query_rename', 'query_trash', 'query_restore', 'task_views_restore'],
  O: ['graph_neighbourhood', 'graph_presets_get', 'graph_presets_apply', 'index_related', 'trash_restore', 'trash_delete', 'trash_empty'],
};
// Slice AND-2 (docs/contracts/android-phone.md §2.1, D-2074, D-2086): RA2's Android-only commands gain android_open_url
// and android_window (AC-Test-Change, approved by the owner with the contract); neither is refused on Android.
const ONLY = ['vault_start', 'vault_find', 'storage_access', 'storage_access_settings', 'android_open_url', 'android_window'];
const COMMANDS_JSON = resolve(import.meta.dirname, '../src-tauri/target/commands.json');
const sorted = (xs: Iterable<string>) => [...xs].sort();

test('ar_03_ac11_ui_skips_missing_commands_on_android_refusal_list', async () => {
  const m = await load('../ui/src/ipc/android.ts');
  assert.ok(m, 'ui/src/ipc/android.ts loads (contract §9.1)');
  const list = m!.ANDROID_EXCLUDED as unknown;
  assert.ok(Array.isArray(list), 'ANDROID_EXCLUDED is an array of command names');
  const excluded = list as string[];
  assert.equal(new Set(excluded).size, excluded.length, 'ANDROID_EXCLUDED has no duplicates');
  assert.deepEqual(sorted(excluded), sorted(Object.values(RA2).flat()), 'ANDROID_EXCLUDED equals RA2\'s groups P1…P5, J, V, O');
  for (const keep of ['vault_current', 'vault_open', 'vault_create', 'vault_recent', 'note_read', 'note_write', 'jobs_ready', 'nav_swipe_scroll', ...ONLY]) {
    assert.ok(!excluded.includes(keep), `${keep} is not refused on Android`);
  }

  assert.ok(existsSync(COMMANDS_JSON), `${COMMANDS_JSON} exists (written by the Rust test ar_03_ac9_command_sets_per_platform, CP-3)`);
  const lists = JSON.parse(readFileSync(COMMANDS_JSON, 'utf8')) as { DESKTOP?: string[]; ANDROID?: string[]; ANDROID_ONLY?: string[] };
  const desktop = lists.DESKTOP ?? [];
  const android = new Set(lists.ANDROID ?? []);
  const only = new Set(lists.ANDROID_ONLY ?? []);
  assert.ok(desktop.length > 0, 'commands.json lists the desktop commands');
  const shellExcluded = desktop.filter((c) => !android.has(c) || only.has(c));
  assert.deepEqual(sorted(excluded), sorted(shellExcluded), 'ANDROID_EXCLUDED equals the shell\'s DESKTOP − ANDROID (one list, two places)');

  const p = await load('../ui/src/platform.ts');
  assert.ok(p && typeof p.platform === 'function', 'ui/src/platform.ts exports platform()');
  const g = globalThis as any;
  const had = 'window' in g;
  const before = g.window;
  try {
    g.window = {};
    assert.equal(p!.platform(), 'macos', 'no __TEGG_PLATFORM__: macos (the desktop default)');
    g.window = { __TEGG_PLATFORM__: 'android' };
    assert.equal(p!.platform(), 'android', '__TEGG_PLATFORM__ = android');
    g.window = { __TEGG_PLATFORM__: 'macos' };
    assert.equal(p!.platform(), 'macos', '__TEGG_PLATFORM__ = macos');
  } finally {
    if (had) g.window = before; else delete g.window;
  }
});
