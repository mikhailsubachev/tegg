// Unit tests for the Rust AC runner (CONTRACT §5.2): which cargo failures count as red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCargoTest, toJunit } from '../src/cargo-junit.ts';
import { parseJunit } from '../src/junit.ts';

const OUT = `
running 4 tests
test fr_fmt_11_ac1_date_written ... FAILED
test fr_fmt_11_ac3_setup_unwrap ... FAILED
test fr_fmt_11_ac4_todo_in_stub ... FAILED
test fr_fmt_11_ac2_passes ... ok

failures:

---- fr_fmt_11_ac1_date_written stdout ----

thread 'fr_fmt_11_ac1_date_written' (1234) panicked at crates/tegg-format/tests/ac_dates.rs:12:5:
assertion \`left == right\` failed
  left: ""
 right: "2026-10-09"

---- fr_fmt_11_ac3_setup_unwrap stdout ----

thread 'fr_fmt_11_ac3_setup_unwrap' (1235) panicked at crates/tegg-format/tests/ac_dates.rs:20:30:
called \`Result::unwrap()\` on an \`Err\` value: NotImplemented

---- fr_fmt_11_ac4_todo_in_stub stdout ----

thread 'fr_fmt_11_ac4_todo_in_stub' (1236) panicked at crates/tegg-format/src/lib.rs:7:5:
not yet implemented
note: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace


failures:
    fr_fmt_11_ac1_date_written
    fr_fmt_11_ac3_setup_unwrap
    fr_fmt_11_ac4_todo_in_stub

test result: FAILED. 1 passed; 3 failed; 0 ignored
`;

test('an assert in the AC test file is red; unwrap, a panic in src and a pass are not', () => {
  const cases = parseCargoTest(OUT, 'crates/tegg-format/tests/ac_dates.rs');
  const by = Object.fromEntries(cases.map((c) => [c.name, c]));
  assert.equal(cases.length, 4);
  assert.equal(by.fr_fmt_11_ac1_date_written.assertion, true);
  assert.equal(by.fr_fmt_11_ac3_setup_unwrap.assertion, false);
  assert.equal(by.fr_fmt_11_ac4_todo_in_stub.assertion, false);
  assert.equal(by.fr_fmt_11_ac2_passes.status, 'ok');
});

test('JUnit output marks only assertion failures with AssertionError', () => {
  const xml = toJunit('tegg-format::ac_dates', parseCargoTest(OUT, 'tests/ac_dates.rs'));
  const tcs = parseJunit(xml);
  assert.equal(tcs.length, 4);
  assert.match(tcs.find((t) => t.name === 'fr_fmt_11_ac1_date_written')!.failure!, /AssertionError/);
  assert.doesNotMatch(tcs.find((t) => t.name === 'fr_fmt_11_ac4_todo_in_stub')!.failure!, /AssertionError/);
  assert.equal(tcs.find((t) => t.name === 'fr_fmt_11_ac2_passes')!.failure, undefined);
});

test('a compile error gives no testcases', () => {
  assert.deepEqual(parseCargoTest('error[E0425]: cannot find function `x`\nerror: could not compile', 'tests/ac_x.rs'), []);
});
