// AppleScript for the real-app tests, with one guard (D-758, D-799): keys sent through System Events go to the frontmost app,
// so when Tegg isn't frontmost (it crashed, quit early, or another window took the focus) they reach whatever is: during
// the MS4 gate a ⌘Q quit the Claude app, and during an MM run an Esc reached the Claude app and stopped it. So a script
// that sends keys runs only while the test build (`app.tegg.desktop`) is frontmost, waited for up to 2 s; otherwise it
// is not run and the test fails. Finder may be frontmost too (the capture tests send keys to Tegg's capture window over
// Finder), except for ⌘Q and ⌘W, which need Tegg itself; the global hotkeys (⌃⌥…) go anywhere. The check and the keys
// run in one AppleScript, so no other app can come to the front between them. Tegg is never activated here:
// activating by bundle id could launch another copy of the app.
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

/** A script that sends keys (`keystroke` / `key code`). */
export function sendsKeys(script: string): boolean {
  return /\b(keystroke|key code)\b/i.test(script);
}

/** A global hotkey (⌃⌥ + a key, FR-CAP-03/05): Tegg receives it whichever app is frontmost. */
export function globalHotkey(script: string): boolean {
  return /using \{(?=[^}]*control down)(?=[^}]*option down)[^}]*\}/i.test(script);
}

/** Runs AppleScript lines; keys only while Tegg (or, except ⌘Q/⌘W, Finder) is frontmost. */
export function osa(...lines: string[]): string {
  const script = lines.join('\n');
  if (!sendsKeys(script) || globalHotkey(script)) return execFileSync('osascript', lines.flatMap((l) => ['-e', l]), { encoding: 'utf8' });
  const allowed = quitsOrCloses(script) ? [TEGG_BUNDLE_ID] : [TEGG_BUNDLE_ID, 'com.apple.finder'];
  const guarded = [
    'tell application "System Events" to set f to bundle identifier of first application process whose frontmost is true',
    `if f is not in {${allowed.map((b) => JSON.stringify(b)).join(', ')}} then return "refused:" & f`,
    ...lines,
    'return "sent"',
  ];
  const end = Date.now() + 2000;
  let out = '';
  for (;;) {
    out = execFileSync('osascript', guarded.flatMap((l) => ['-e', l]), { encoding: 'utf8' }).trim();
    if (!out.startsWith('refused:') || Date.now() >= end) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  if (out.startsWith('refused:')) throw new Error(`refusing to send keys: the frontmost app is "${out.slice(8) || 'unknown'}", not Tegg (D-758)`);
  return '';
}
