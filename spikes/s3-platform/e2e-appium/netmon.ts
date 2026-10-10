// S3-QA AC-4 / NFR-SEC-01: watches the app's processes for internet sockets.
// WebKit's XPC helpers are children of launchd, not the app, so ownership can't be read from
// the process tree without root. We snapshot helper PIDs before launch; helpers that appear
// afterwards belong to the app under test (run the suite with no other new WebKit clients).
import { execFileSync } from 'node:child_process';

const sh = (cmd: string, args: string[]) => {
  try { return execFileSync(cmd, args, { encoding: 'utf8' }); } catch { return ''; }
};
const pids = (pattern: string) => sh('pgrep', ['-f', pattern]).split('\n').filter(Boolean);
const WEBKIT = 'com\\.apple\\.WebKit\\.(Networking|WebContent|GPU)';
export const APP_PATTERN = 'Tegg S3\\.app/Contents/MacOS/tegg-s3';

export class NetMonitor {
  private before = new Set(pids(WEBKIT));
  private timer?: NodeJS.Timeout;
  readonly sockets = new Set<string>();
  readonly watched = new Set<string>();

  start(intervalMs = 200) {
    this.timer = setInterval(() => this.poll(), intervalMs);
    return this;
  }
  poll() {
    const ours = [...pids(APP_PATTERN), ...pids(WEBKIT).filter((p) => !this.before.has(p))];
    ours.forEach((p) => this.watched.add(p));
    if (!ours.length) return;
    // -a: AND the filters; -i: internet sockets only (IPC over Unix sockets/Mach ports is fine).
    const out = sh('lsof', ['-nP', '-a', '-i', '-p', ours.join(',')]);
    out.split('\n').slice(1).filter(Boolean).forEach((l) => this.sockets.add(l.replace(/\s+/g, ' ')));
  }
  stop() {
    clearInterval(this.timer);
    this.poll();
    return { watched: [...this.watched], sockets: [...this.sockets] };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // CLI: start this before launching the app, Ctrl-C to stop and print the report.
  const m = new NetMonitor().start();
  console.error('watching; launch the app now, Ctrl-C to stop');
  process.on('SIGINT', () => { console.log(JSON.stringify(m.stop(), null, 2)); process.exit(0); });
}
