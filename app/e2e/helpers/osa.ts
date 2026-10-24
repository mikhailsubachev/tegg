// AppleScript for the real-app tests, with one guard (D-758): ⌘Q and ⌘W go through System Events to the frontmost
// app, so when Tegg isn't frontmost (it crashed, quit early, or another window took the focus) they quit or close
// whatever is: during the MS4 gate a ⌘Q quit the Claude app. Before a ⌘Q or ⌘W the frontmost process must be the
// test build (`app.tegg.desktop`), waited for up to 2 s; otherwise the script is not run and the test fails. Tegg is
// never activated here: activating by bundle id could launch another copy of the app.
import { execFileSync } from 'node:child_process';

export const TEGG_BUNDLE_ID = 'app.tegg.desktop';

/** A script that quits or closes the frontmost app: ⌘Q (key code 12, keystroke "q") or ⌘W (13, "w"). */
export function quitsOrCloses(script: string): boolean {
  return /key code (12|13) using \{[^}]*command down/i.test(script) || /keystroke "[qw]" using \{[^}]*command down/i.test(script);
}

export function frontmostBundle(): string {
  try {
    return execFileSync('osascript', ['-e', 'tell application "System Events" to get bundle identifier of first application process whose frontmost is true'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/** Runs AppleScript lines; a ⌘Q or ⌘W only while Tegg is frontmost. */
export function osa(...lines: string[]): string {
  if (lines.some(quitsOrCloses)) {
    const end = Date.now() + 2000;
    let front = frontmostBundle();
    while (front !== TEGG_BUNDLE_ID && Date.now() < end) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      front = frontmostBundle();
    }
    if (front !== TEGG_BUNDLE_ID) throw new Error(`refusing ⌘Q/⌘W: the frontmost app is "${front || 'unknown'}", not Tegg (D-758)`);
  }
  return execFileSync('osascript', lines.flatMap((l) => ['-e', l]), { encoding: 'utf8' });
}
