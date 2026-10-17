// Regression (TS-I AC-2, D-343): check-red ran AC runners with VERIFY_GATE set but no VERIFY_PORT_BASE, so the app's
// Playwright config refused to load and every new WebKit AC file was reported as "no testcases".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NODE_AC_RUNNER, assertExit, commitAll, makeRepo, verify, writeFiles } from './helpers.ts';

const PORT_GUARDED_RED_TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
if (process.env.VERIFY_GATE && !Number.isInteger(Number(process.env.VERIFY_PORT_BASE))) throw new Error('VERIFY_PORT_BASE is not a port');
test('red', () => { assert.equal(1, 2); });
`;

test('bug_checkred_port_ts_i_ac2_check_red_gives_runners_a_port', (t) => {
  const repo = makeRepo(t, { config: { steps: [], acRunners: [NODE_AC_RUNNER] }, files: { 'src/.keep': '' } });
  writeFiles(repo, { 't/port.ac.test.ts': PORT_GUARDED_RED_TEST });
  const c = commitAll(repo, 'test: red AC test that needs a port');
  const r = verify(repo, ['check-red', c]);
  assertExit(r, 0, 'check-red for a red AC test whose runner needs VERIFY_PORT_BASE');
  assert.ok(!/no testcases/.test(r.stdout + r.stderr));
});
