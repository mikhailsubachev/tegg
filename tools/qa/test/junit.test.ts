// Unit tests for the JUnit reader (CONTRACT §5.2 step 4 relies on the failure text being read in full).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJunit } from '../src/junit.ts';

test('a failure whose message quotes XML with "/>" is read to its end', () => {
  // node:test's junit reporter escapes `<` and `"` in attributes but leaves `>` as is, so a step command
  // quoted in an assertion message can contain `/>` inside the message attribute.
  const xml = `<testsuites>
<testsuite name="s" tests="1">
<testcase name="ts_x_AC1_y" classname="s" time="1">
<failure type="testCodeFailure" message="second push skips the step&#10;exit status: 0&#10;echo '&lt;testsuites>&lt;testcase name=&quot;ts_x_AC1_report&quot;/>&lt;/testsuites>' > out.xml">
AssertionError [ERR_ASSERTION]: second push skips the step
'pass' !== 'skipped'
</failure>
</testcase>
</testsuite>
</testsuites>`;
  const cases = parseJunit(xml);
  assert.equal(cases.length, 1, 'the XML quoted inside the message is not a testcase');
  assert.equal(cases[0].name, 'ts_x_AC1_y');
  assert.match(cases[0].failure ?? '', /AssertionError \[ERR_ASSERTION\]/, 'the failure text reaches past the quoted "/>"');
});

test('self-closing failure and error elements with attributes containing ">" are read', () => {
  const xml = `<testsuite><testcase name="a" classname="c"><failure type="AssertionError" message="x > y"/></testcase>
<testcase name="b" classname="c"><error type="Error" message="boom"/></testcase><testcase name="d" classname="c"/></testsuite>`;
  const cases = parseJunit(xml);
  assert.deepEqual(cases.map((c) => [c.name, c.failure !== undefined]), [['a', true], ['b', true], ['d', false]]);
  assert.match(cases[0].failure ?? '', /x > y/);
});
