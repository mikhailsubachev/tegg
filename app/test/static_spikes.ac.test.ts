// MS3 slice 3C static rule (L0, D-83, architecture §11): spike code is ported, never imported. No file under
// packages/, app/ or crates/ imports from spikes/ or uses the S2 `@core` alias; `@tegg/editor` (packages/editor) exists
// with its own qa.config.json test step and imports nothing from `@tauri-apps/*` or `app/` (AR-03 AC-2).
// docs/acceptance/editor.md FR-EDT-01 AC-1; docs/contracts/ms3-shell.md §13.3, §13.8. One test for the whole AC so the
// red run fails on its first missing part (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const SKIP = new Set(['node_modules', 'target', 'dist', 'test-results', '.appium', 'gen', 'icons']);

function files(dir: string, re: RegExp): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, re));
    else if (re.test(name)) out.push(p);
  }
  return out.sort();
}

const TS = /\.(tsx?|jsx?|mjs|cjs|mts|json)$/;
const RS = /\.rs$|^Cargo\.toml$/;
/** Import specifiers / paths that reach spike code. */
const SPIKE_TS = [
  /(from|import)\s*\(?\s*['"][^'"]*\bspikes\//,
  /require\(\s*['"][^'"]*\bspikes\//,
  /(from|import)\s*\(?\s*['"]@core(\/|['"])/,
  /['"]@core\/?\*?['"]\s*:/, // tsconfig paths / vite alias key
];
const SPIKE_RS = [/path\s*=\s*"[^"]*\bspikes\//, /include(_str|_bytes)?!\(\s*"[^"]*\bspikes\//, /#\[path\s*=\s*"[^"]*\bspikes\//];

function offenders(list: string[], rules: RegExp[]): string[] {
  const out: string[] = [];
  for (const f of list) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (rules.some((r) => r.test(line))) out.push(`${relative(REPO, f)}:${i + 1}`);
    });
  }
  return out;
}

test('fr_edt_01_ac1_editor_package_is_ported_not_imported', () => {
  const pkg = resolve(REPO, 'packages/editor');
  assert.ok(existsSync(join(pkg, 'package.json')), 'packages/editor/package.json is missing (@tegg/editor, D-83)');
  const name = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).name;
  assert.equal(name, '@tegg/editor', 'package name');
  assert.ok(existsSync(join(pkg, 'src/index.ts')), 'packages/editor/src/index.ts is missing');

  const qa = JSON.parse(readFileSync(resolve(REPO, 'qa.config.json'), 'utf8')) as { steps: { dir: string; run: string; level: string }[] };
  assert.ok(
    qa.steps.some((s) => s.dir === 'packages/editor' && /vitest/.test(s.run)),
    'qa.config.json has a test step for packages/editor',
  );

  const ts = [...files(resolve(REPO, 'packages'), TS), ...files(resolve(REPO, 'app'), TS)];
  assert.deepEqual(offenders(ts, SPIKE_TS), [], 'imports from spikes/ or the @core alias under packages/ or app/');
  const rs = files(resolve(REPO, 'crates'), RS).concat(files(resolve(REPO, 'app/src-tauri'), RS));
  assert.deepEqual(offenders(rs, SPIKE_RS), [], 'Rust code under crates/ or app/src-tauri reaching into spikes/');

  const editorSrc = files(join(pkg, 'src'), /\.(tsx?|jsx?|mjs)$/);
  assert.ok(editorSrc.length > 0, 'packages/editor/src has source files');
  const platform = offenders(editorSrc, [/(from|import)\s*\(?\s*['"]@tauri-apps\//, /(from|import)\s*\(?\s*['"][^'"]*\bapp\//, /(from|import)\s*\(?\s*['"](\.\.\/)+app\//]);
  assert.deepEqual(platform, [], '@tegg/editor imports @tauri-apps/* or app/ (AR-03 AC-2)');
});
