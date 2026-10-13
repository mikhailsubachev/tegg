// L6 helper (docs/contracts/ms3-shell.md §13.6): "another program" that changes and reads vault files from a separate
// process, for FR-SYN-02 AC-6 and FR-SYN-03 AC-12…AC-20 (docs/acceptance/editor.md). Test code; no assertions here.
//
//   node external.ts write  <file> <content-file>      write bytes in place (like a sync client or editor)
//   node external.ts rename <from> <to>                rename / move
//   node external.ts delete <file>                     delete
//   node external.ts poll   <file> <everyMs> <forMs> <out.jsonl>
//        read the file every <everyMs> ms for <forMs> ms; one JSON line per distinct read: {"t":ms,"sha":…,"text":…}
//   node external.ts many   <dir> <count> <token>     append a line with <token> to <count> notes under <dir> at once
import { appendFileSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const [cmd, ...a] = process.argv.slice(2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (cmd === 'write') writeFileSync(a[0], readFileSync(a[1]));
  else if (cmd === 'rename') renameSync(a[0], a[1]);
  else if (cmd === 'delete') rmSync(a[0]);
  else if (cmd === 'poll') {
    const every = Number(a[1]), until = Date.now() + Number(a[2]);
    let last = '';
    const t0 = Date.now();
    while (Date.now() < until) {
      try {
        const b = readFileSync(a[0]);
        const sha = createHash('sha256').update(b).digest('hex');
        if (sha !== last) { appendFileSync(a[3], JSON.stringify({ t: Date.now() - t0, sha, text: b.toString('utf8') }) + '\n'); last = sha; }
      } catch (e) {
        appendFileSync(a[3], JSON.stringify({ t: Date.now() - t0, error: String((e as Error).message) }) + '\n');
      }
      await sleep(every);
    }
  } else if (cmd === 'many') {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        if (n.startsWith('.') || n === '_templates' || n === '_attachments') continue;
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (n.endsWith('.md')) files.push(p);
      }
    };
    walk(a[0]);
    const pick = files.sort().slice(0, Number(a[1]));
    for (const f of pick) appendFileSync(f, `\n${a[2]} ${pick.indexOf(f)}\n`);
    process.stdout.write(JSON.stringify(pick) + '\n');
  } else {
    process.stderr.write(`unknown command ${cmd}\n`);
    process.exit(2);
  }
}
void main();
