// D-1833 (tools/qa/CONTRACT.md §3.6): under a gate a failed WebKit test is retried once. This reporter writes the
// tests that failed and then passed on the retry to `$VERIFY_RESULTS/app-webkit.flaky.json`, where the gate reads
// them, prints them and counts them in the flaky list. Outside a gate (no VERIFY_RESULTS) it writes nothing.
import fs from 'node:fs';
import path from 'node:path';
import type { Reporter, TestCase } from '@playwright/test/reporter';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

export default class FlakyReporter implements Reporter {
  private readonly tests = new Set<TestCase>();

  onTestEnd(test: TestCase): void {
    this.tests.add(test);
  }

  onEnd(): void {
    const dir = process.env.VERIFY_RESULTS;
    // The quarantined run (VERIFY_FLAKY, nightly) holds known flaky tests; it doesn't count them again.
    if (!dir || process.env.VERIFY_FLAKY) return;
    const flaky = [...this.tests]
      .filter((t) => t.outcome() === 'flaky')
      // titlePath: root, project, file, then the describe blocks and the test's own title.
      .map((t) => ({ file: path.relative(REPO_ROOT, t.location.file).split(path.sep).join('/'), test: t.titlePath().slice(3).join(' › ') }))
      .sort((a, b) => (a.file + a.test < b.file + b.test ? -1 : 1));
    fs.mkdirSync(dir, { recursive: true });
    // The nightly dev-server run (D-1882) reports under its own name, next to the bundle run's file.
    const name = process.env.VERIFY_WEBKIT_DEV ? 'app-webkit-dev.flaky.json' : 'app-webkit.flaky.json';
    fs.writeFileSync(path.join(dir, name), JSON.stringify(flaky, null, 2) + '\n');
  }

  printsToStdio(): boolean {
    return false;
  }
}
