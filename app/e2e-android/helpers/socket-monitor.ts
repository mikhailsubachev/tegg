// Slice AND-1, NFR-SEC-01 AC-3's monitor (docs/acceptance/android-shell.md; docs/contracts/android-shell.md §12): during
// the whole `app-android-e2e` run it samples `/proc/net/tcp`, `tcp6`, `udp` and `udp6` on the emulator every 2 s and
// appends one JSON line per sample to a log: `{ "at": <ms>, "uids": [..], "sockets": ["<table>: <line>", …] }`, the
// lines whose uid column belongs to Tegg's apps (`dumpsys package <id>` userId). The step starts it before the tests
// (`node app/e2e-android/helpers/socket-monitor.ts <log>`), exports the log's path as `TEGG_LA_SOCKET_LOG` and stops
// it after them; `nfr_sec_01_ac3_no_sockets_on_android` reads it. Test infrastructure only.
import { appendFileSync } from 'node:fs';
import { adb, RELEASE_ID, socketsOf, TEST_ID } from './device.ts';

function uids(): number[] {
  const out: number[] = [];
  for (const id of [TEST_ID, RELEASE_ID]) {
    const r = adb(['shell', `dumpsys package ${id}`]);
    const m = /userId=(\d+)/.exec(r.stdout);
    if (m) out.push(Number(m[1]));
  }
  return out;
}

/** Samples every `everyMs` into `log` until the returned function is called. */
export function startMonitor(log: string, everyMs = 2000): () => void {
  const tick = () => {
    const ids = uids();
    const sockets = ids.flatMap((u) => socketsOf(u));
    appendFileSync(log, `${JSON.stringify({ at: Date.now(), uids: ids, sockets })}\n`);
  };
  tick();
  const t = setInterval(tick, everyMs);
  return () => clearInterval(t);
}

if (import.meta.main) {
  const log = process.argv[2];
  if (!log) {
    console.error('usage: node app/e2e-android/helpers/socket-monitor.ts <log.jsonl>');
    process.exit(2);
  }
  const stop = startMonitor(log);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { stop(); process.exit(0); });
}
