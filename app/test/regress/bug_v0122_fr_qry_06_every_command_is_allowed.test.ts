// Bug v0.122 (FR-QRY-06, FR-TYP-04; NFR-SEC-03, D-552): in the real app `New query` said "The query couldn't be saved."
// The app defines a command manifest (build.rs), and with one Tauri refuses every app command that has no
// `allow-<command>` permission in a capability ("not allowed by ACL"). The slice Q commands, and the 4E type-move,
// tidy and delete-job commands before them, were registered in `generate_handler!` but never added to the manifest or
// the main window's capability. WebKit tests run on the fake core and can't see this, so this L0 check does.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TAURI = resolve(import.meta.dirname, '..', '..', 'src-tauri');
const read = (rel: string) => readFileSync(resolve(TAURI, rel), 'utf8');

function registered(): string[] {
  const m = /generate_handler!\[([\s\S]*?)\]/.exec(read('src/lib.rs'));
  assert.ok(m, 'lib.rs registers its commands with generate_handler!');
  return m[1].replace(/\/\/.*$/gm, '').split(',').map((s) => s.trim().split('::').pop()!.trim()).filter(Boolean);
}

function manifest(): Set<string> {
  const m = /const COMMANDS: &\[&str\] = &\[([\s\S]*?)\];/.exec(read('build.rs'));
  assert.ok(m, 'build.rs has the COMMANDS manifest');
  return new Set([...m[1].matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]));
}

const allowed = (file: string) => new Set<string>(JSON.parse(read(`capabilities/${file}`)).permissions.filter((p: unknown) => typeof p === 'string'));
const perm = (c: string) => `allow-${c.replace(/_/g, '-')}`;

test('bug_v0122_fr_qry_06_every_registered_command_is_in_the_manifest_and_a_capability', () => {
  const cmds = registered();
  const man = manifest();
  const main = allowed('default.json');
  const capture = allowed('capture.json');
  assert.deepEqual(cmds.filter((c) => !man.has(c)), [], 'every registered command is in build.rs COMMANDS');
  assert.deepEqual(cmds.filter((c) => !main.has(perm(c)) && !capture.has(perm(c))), [], 'every registered command is allowed in the main or the capture capability');
  for (const c of ['queries_list', 'query_get', 'query_run', 'query_apply', 'query_revert', 'query_create', 'query_duplicate', 'query_rename', 'query_trash', 'query_restore', 'query_usages']) {
    assert.ok(main.has(perm(c)), `the main window may call ${c} (FR-QRY-06)`);
  }
});
