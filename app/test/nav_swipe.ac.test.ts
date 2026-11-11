// v0.123 feedback (D-1511): docs/acceptance/app-shell.md FR-NAV-03 AC-14, "The command is in the command manifest and
// the main window's capability (bug v0.122)". With a command manifest Tauri refuses every app command without an
// `allow-<command>` permission in a capability, and the WebKit tests (fake core) can't see that; this static check
// does, as `test/regress/bug_v0122_fr_qry_06_every_command_is_allowed.test.ts` does for every registered command (that
// test stays green while `nav_swipe_scroll` isn't registered at all, so this one names it). The files are read as the
// shell's public configuration: `build.rs` `COMMANDS`, `capabilities/default.json` (main), `capabilities/capture.json`,
// and the `generate_handler!` list. The ACL itself is probed at L4 in `src-tauri/tests/ac_nav_swipe.rs`.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TAURI = resolve(import.meta.dirname, '..', 'src-tauri');
const read = (rel: string) => readFileSync(resolve(TAURI, rel), 'utf8');
const CMD = 'nav_swipe_scroll';
const PERM = 'allow-nav-swipe-scroll';

function registered(): string[] {
  const m = /generate_handler!\[([\s\S]*?)\]/.exec(read('src/lib.rs'));
  assert.ok(m, 'lib.rs registers its commands with generate_handler!');
  return m[1].replace(/\/\/.*$/gm, '').split(',').map((s) => s.trim().split('::').pop()!.trim()).filter(Boolean);
}
function manifest(): string[] {
  const m = /const COMMANDS: &\[&str\] = &\[([\s\S]*?)\];/.exec(read('build.rs'));
  assert.ok(m, 'build.rs has the COMMANDS manifest');
  return [...m[1].matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]);
}
const allowed = (file: string): string[] => JSON.parse(read(`capabilities/${file}`)).permissions.filter((p: unknown) => typeof p === 'string');

test('fr_nav_03_ac14_nav_swipe_scroll_is_a_registered_command', () => {
  assert.deepEqual(registered().filter((c) => c === CMD), [CMD], `${CMD} is registered once in generate_handler!`);
});

test('fr_nav_03_ac14_nav_swipe_scroll_is_in_the_command_manifest', () => {
  assert.deepEqual(manifest().filter((c) => c === CMD), [CMD], `${CMD} is once in build.rs COMMANDS`);
});

test('fr_nav_03_ac14_nav_swipe_scroll_is_in_the_main_windows_capability_only', () => {
  assert.deepEqual(allowed('default.json').filter((p) => p === PERM), [PERM], `the main window's capability allows ${CMD}`);
  assert.deepEqual(allowed('capture.json').filter((p) => p === PERM), [], `the capture windows don't get ${CMD} (NFR-SEC-03)`);
});
