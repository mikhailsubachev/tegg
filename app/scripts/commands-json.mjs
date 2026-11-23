// Slice AND-1 (CP-3 → D-2038): writes src-tauri/target/commands.json from src-tauri/src/commands.rs, so the UI's
// refusal-list test (app/test/android_platform.ac.test.ts) has the shell's lists even when the Rust test that also
// writes the file (ar_03_ac9_command_sets_per_platform) hasn't run yet in this gate. The lists are read from the source,
// so both writers give the same file.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const shell = resolve(import.meta.dirname, '../src-tauri');
const src = readFileSync(join(shell, 'src/commands.rs'), 'utf8').replace(/\/\/[^\n]*/g, '');
const list = (name) => {
  const m = new RegExp(`pub const ${name}: &\\[&str\\] = &\\[([^\\]]*)\\]`).exec(src);
  if (!m) throw new Error(`commands.rs has no ${name}`);
  return [...m[1].matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]);
};
mkdirSync(join(shell, 'target'), { recursive: true });
writeFileSync(join(shell, 'target/commands.json'), JSON.stringify({ DESKTOP: list('DESKTOP'), ANDROID: list('ANDROID'), ANDROID_ONLY: list('ANDROID_ONLY') }, null, 2));
