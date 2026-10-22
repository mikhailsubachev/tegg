// Unit tests for the Rust AC runner (CONTRACT §5.2): which cargo failures count as red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairBlocks, parseArgs, parseCargoTest, planBatches, splitLibtestOutput, toJunit } from '../src/cargo-junit.ts';
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

test('a panic on an .expect( line of the test file is a setup failure, not red (QA review)', () => {
  const out = `
running 2 tests
test fr_x_ac1_expect_setup ... FAILED
test fr_x_ac2_assert ... FAILED

failures:

---- fr_x_ac1_expect_setup stdout ----

thread 'fr_x_ac1_expect_setup' (1) panicked at crates/tegg-vault/tests/ac_x.rs:3:40:
read: NotImplemented

---- fr_x_ac2_assert stdout ----

thread 'fr_x_ac2_assert' (2) panicked at crates/tegg-vault/tests/ac_x.rs:5:5:
expected bytes A

failures:
    fr_x_ac1_expect_setup
    fr_x_ac2_assert
`;
  const source = ['fn a() {', '    // setup', '    let b = vault.read("x").expect("read");', '    let c = 1;', '    assert!(false, "expected bytes A");'].join('\n');
  const by = Object.fromEntries(parseCargoTest(out, 'crates/tegg-vault/tests/ac_x.rs', source).map((c) => [c.name, c.assertion]));
  assert.deepEqual(by, { fr_x_ac1_expect_setup: false, fr_x_ac2_assert: true });
});

// ---------------------------------------------------------------------------
// TS-I AC-4: batched runs per package (D-525, CONTRACT §5.2)
// ---------------------------------------------------------------------------

const BATCH_STDERR = `   Compiling tegg-p v0.1.0 (/t/crates/p)
    Finished \`test\` profile [unoptimized + debuginfo] target(s) in 1.23s
     Running tests/ac_a.rs (/t/deps/ac_a-1a2b3c)
     Running tests/ac_b.rs (/t/deps/ac_b-4d5e6f)
     Running tests/ac_c.rs (/t/deps/ac_c-7a8b9c)
error: test failed, to rerun pass \`--test ac_c\`
`;

const BLOCK_A = `
running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
`;

const BLOCK_B = `
running 1 test
test x_ac1_y ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
`;

const PANIC_C = `thread 'fr_c_ac1_assert' (77) panicked at crates/p/tests/ac_c.rs:9:5:
assertion \`left == right\` failed
  left: "Příliš"
 right: "Příliš žluťoučký kůň"`;

const BLOCK_C = `
running 2 tests
test fr_c_ac1_assert ... FAILED
test fr_c_ac2_passes ... ok

failures:

---- fr_c_ac1_assert stdout ----

${PANIC_C}
note: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace


failures:
    fr_c_ac1_assert

test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
`;

const BATCH_STDOUT = `${BLOCK_A}\n${BLOCK_B}\n${BLOCK_C}`;

test('ts_i_ac4_split_libtest_output_pairs_running_lines_with_blocks', () => {
  const split = splitLibtestOutput(BATCH_STDOUT, BATCH_STDERR);
  assert.deepEqual(split.stems, ['ac_a', 'ac_b', 'ac_c'], 'one stem per `Running tests/<stem>.rs` line, in order');
  assert.equal(split.blocks.length, 3, 'one block per `running <n> tests` header');
  assert.match(split.blocks[0]!, /running 0 tests/);
  assert.match(split.blocks[0]!, /test result: ok\. 0 passed/);
  assert.ok(split.blocks[1]!.includes('x_ac1_y'), 'block 2 holds the single test of ac_b');
  assert.ok(!split.blocks[1]!.includes('fr_c_ac1_assert'), 'block 2 holds nothing of ac_c');
  assert.ok(split.blocks[2]!.includes(PANIC_C), 'block 3 holds the panic text of ac_c');
  assert.match(split.blocks[2]!, /test result: FAILED\. 1 passed; 1 failed/);
  assert.ok(!split.blocks[2]!.includes('x_ac1_y'), 'block 3 holds nothing of ac_b');
});

const FILES = ['crates/p/tests/ac_a.rs', 'crates/p/tests/ac_b.rs', 'crates/p/tests/ac_c.rs'];
const SOURCES = new Map<string, string>([
  ['crates/p/tests/ac_a.rs', '// no tests yet\n'],
  ['crates/p/tests/ac_b.rs', '#[test]\nfn x_ac1_y() {\n    assert!(true);\n}\n'],
  ['crates/p/tests/ac_c.rs', '#[test]\nfn fr_c_ac1_assert() {\n    assert_eq!("Příliš", "Příliš žluťoučký kůň");\n}\n\n#[test]\nfn fr_c_ac2_passes() {}\n'],
]);

test('ts_i_ac4_pair_blocks_maps_each_file_to_its_block', () => {
  const split = splitLibtestOutput(BATCH_STDOUT, BATCH_STDERR);
  const paired = pairBlocks(split, FILES, SOURCES);
  assert.ok(paired, 'matching counts and declared names pair successfully');
  assert.deepEqual([...paired.keys()], FILES);
  assert.match(paired.get('crates/p/tests/ac_a.rs')!, /running 0 tests/);
  assert.ok(paired.get('crates/p/tests/ac_b.rs')!.includes('test x_ac1_y ... ok'));
  assert.ok(paired.get('crates/p/tests/ac_c.rs')!.includes(PANIC_C));
});

test('ts_i_ac4_pair_blocks_returns_undefined_on_count_mismatch', () => {
  const split = splitLibtestOutput(BATCH_STDOUT, BATCH_STDERR);
  const twoStems = { stems: split.stems.slice(0, 2), blocks: split.blocks };
  assert.equal(pairBlocks(twoStems, FILES.slice(0, 2), SOURCES), undefined, 'two stems, three blocks: cannot attribute');
  assert.equal(pairBlocks(split, FILES.slice(0, 2), SOURCES), undefined, 'three stems and blocks, two files: cannot attribute');
});

test('ts_i_ac4_pair_blocks_returns_undefined_when_test_names_are_not_declared_in_the_file', () => {
  const split = splitLibtestOutput(BATCH_STDOUT, BATCH_STDERR);
  const swapped = new Map<string, string>([
    ['crates/p/tests/ac_a.rs', SOURCES.get('crates/p/tests/ac_a.rs')!],
    ['crates/p/tests/ac_b.rs', SOURCES.get('crates/p/tests/ac_c.rs')!],
    ['crates/p/tests/ac_c.rs', SOURCES.get('crates/p/tests/ac_b.rs')!],
  ]);
  assert.equal(pairBlocks(split, FILES, swapped), undefined, 'a block whose test names are not declared in the paired file is rejected');
});

test('ts_i_ac4_parse_cargo_test_on_a_paired_block_still_detects_the_assertion', () => {
  const split = splitLibtestOutput(`${BLOCK_A}\n${OUT}`, '     Running tests/ac_a.rs (/t/deps/ac_a-1)\n     Running tests/ac_dates.rs (/t/deps/ac_dates-2)\n');
  const paired = pairBlocks(
    split,
    ['crates/tegg-format/tests/ac_a.rs', 'crates/tegg-format/tests/ac_dates.rs'],
    new Map([
      ['crates/tegg-format/tests/ac_a.rs', ''],
      ['crates/tegg-format/tests/ac_dates.rs', ['fn fr_fmt_11_ac1_date_written() {', 'fn fr_fmt_11_ac3_setup_unwrap() {', 'fn fr_fmt_11_ac4_todo_in_stub() {', 'fn fr_fmt_11_ac2_passes() {'].join('\n')],
    ]),
  );
  assert.ok(paired, 'pairs');
  const cases = parseCargoTest(paired.get('crates/tegg-format/tests/ac_dates.rs')!, 'crates/tegg-format/tests/ac_dates.rs');
  const by = Object.fromEntries(cases.map((c) => [c.name, c]));
  assert.equal(cases.length, 4);
  assert.equal(by.fr_fmt_11_ac1_date_written.assertion, true);
  assert.equal(by.fr_fmt_11_ac3_setup_unwrap.assertion, false);
  assert.equal(by.fr_fmt_11_ac4_todo_in_stub.assertion, false);
  assert.equal(by.fr_fmt_11_ac2_passes.status, 'ok');
  assert.deepEqual(parseCargoTest(paired.get('crates/tegg-format/tests/ac_a.rs')!, 'crates/tegg-format/tests/ac_a.rs'), []);
});

test('ts_i_ac4_plan_batches_groups_by_package_and_isolates_serial_files', () => {
  const files = [
    'crates/p/tests/ac_one.rs',
    'crates/q/tests/ac_two.rs',
    'crates/p/tests/ac_tz.rs',
    'crates/p/tests/ac_three.rs',
    'crates/q/tests/ac_four.rs',
  ];
  const pkgOf = (file: string) => file.split('/')[1]!;
  const batches = planBatches(files, new Set(['crates/p/tests/ac_tz.rs']), 4, pkgOf);
  assert.deepEqual(batches, [
    { pkg: 'p', files: ['crates/p/tests/ac_one.rs'], threads: 4 },
    { pkg: 'q', files: ['crates/q/tests/ac_two.rs', 'crates/q/tests/ac_four.rs'], threads: 4 },
    { pkg: 'p', files: ['crates/p/tests/ac_tz.rs'], threads: 1 },
    { pkg: 'p', files: ['crates/p/tests/ac_three.rs'], threads: 4 },
  ]);
});

test('ts_i_ac4_plan_batches_without_serial_files_gives_one_batch_per_package', () => {
  const files = ['crates/p/tests/ac_one.rs', 'crates/q/tests/ac_two.rs', 'crates/p/tests/ac_three.rs'];
  const batches = planBatches(files, new Set(), 1, (f: string) => f.split('/')[1]!);
  assert.deepEqual(batches, [
    { pkg: 'p', files: ['crates/p/tests/ac_one.rs', 'crates/p/tests/ac_three.rs'], threads: 1 },
    { pkg: 'q', files: ['crates/q/tests/ac_two.rs'], threads: 1 },
  ]);
});

test('ts_i_ac4_parse_args_defaults_threads_to_1_and_separates_libtest_args', () => {
  const plain = parseArgs(['--junit', '/out/r.xml', 'crates/p/tests/ac_a.rs']);
  assert.equal(plain.junit, '/out/r.xml');
  assert.equal(plain.threads, 1, 'default --threads is 1');
  assert.deepEqual([...plain.serial], []);
  assert.deepEqual(plain.files, ['crates/p/tests/ac_a.rs']);
  assert.deepEqual(plain.libtest, []);

  const full = parseArgs([
    '--junit', '/out/r.xml', '--threads', '4',
    '--serial', 'crates/p/tests/ac_tz.rs', '--serial', 'crates/q/tests/ac_env.rs',
    'crates/p/tests/ac_a.rs', 'crates/p/tests/ac_tz.rs', 'crates/q/tests/ac_env.rs',
    '--', '--skip', 'nfr_perf_', '--nocapture',
  ]);
  assert.equal(full.junit, '/out/r.xml');
  assert.equal(full.threads, 4);
  assert.deepEqual([...full.serial].sort(), ['crates/p/tests/ac_tz.rs', 'crates/q/tests/ac_env.rs']);
  assert.deepEqual(full.files, ['crates/p/tests/ac_a.rs', 'crates/p/tests/ac_tz.rs', 'crates/q/tests/ac_env.rs']);
  assert.deepEqual(full.libtest, ['--skip', 'nfr_perf_', '--nocapture']);
});
