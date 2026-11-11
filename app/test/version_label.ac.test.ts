// L1: the version label (FR-UX-01 AC-5, D-597, D-1512; AC-test change D-1513).
// Written from docs/acceptance/app-shell.md (FR-UX-01 AC-5) and docs/contracts/ms3-shell.md §1 "Release build", §12.3
// only (D-61): `versionLabel(version: string | undefined): string` in `app/ui/src/version.ts` returns `v<version>` when
// `version` is `MAJOR.MINOR.PATCH` (each part `0` or a number without a leading zero), else `dev`. The module loads
// inside each test through `need`, so a missing module or export fails an assertion (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { need } from './read-helpers';

const VERSION = '../ui/src/version.ts';
async function versionLabel(version: string | undefined): Promise<unknown> {
  const m = await need(VERSION, 'versionLabel');
  assert.equal(typeof m.versionLabel, 'function', 'versionLabel is a function');
  try {
    return m.versionLabel(version);
  } catch (e) {
    assert.fail(`versionLabel(${JSON.stringify(version)}) returns a label instead of throwing: ${String(e)}`);
  }
}

test('fr_ux_01_ac5_version_label_is_the_release_version', async () => {
  assert.equal(await versionLabel('0.1.0'), 'v0.1.0');
  assert.equal(await versionLabel('0.2.13'), 'v0.2.13');
  assert.equal(await versionLabel('1.0.0'), 'v1.0.0');
});

test('fr_ux_01_ac5_version_label_is_dev_without_a_release_version', async () => {
  assert.equal(await versionLabel(undefined), 'dev', 'no version');
  assert.equal(await versionLabel(''), 'dev', 'an empty version');
});

test('fr_ux_01_ac5_version_label_is_dev_for_a_version_that_is_not_major_minor_patch', async () => {
  for (const v of ['0.1', 'v0.1.0', '0.1.0-beta', '01.2.3']) {
    assert.equal(await versionLabel(v), 'dev', `${JSON.stringify(v)} is not MAJOR.MINOR.PATCH of plain numbers`);
  }
});

test('fr_ux_01_ac5_version_label_matches_the_shown_pattern', async () => {
  for (const v of [undefined, '', '0.1.0', '0.2.13', '1.0.0', '0.1', 'v0.1.0', '0.1.0-beta', '01.2.3']) {
    const label = await versionLabel(v);
    assert.equal(typeof label, 'string', `${JSON.stringify(v)} gives a string`);
    assert.match(label as string, /^(v\d+\.\d+\.\d+|dev)$/, `${JSON.stringify(v)} → ${String(label)}`);
  }
});
