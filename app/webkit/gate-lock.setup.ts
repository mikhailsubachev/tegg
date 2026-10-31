// D-1330 (tools/qa/CONTRACT.md §3.5): a WebKit run started outside ./verify (a targeted `npx playwright test`) loads
// the machine like a gate, so it waits for the same machine-wide lock. Inside a gate the lock is already held and this
// returns at once. Playwright handles its own signals and stops its workers first, so the lock is released on exit.
import { acquireGateLock } from '../../tools/qa/src/gate-lock.ts';

export default async function globalSetup(): Promise<void> {
  await acquireGateLock('app webkit', process.cwd(), { signals: false });
}
