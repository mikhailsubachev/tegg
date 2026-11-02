// MS5 slice 5B, L0: static rules for the capture window (docs/acceptance/capture.md NFR-SEC-03 AC-1, AC-4 "L0 for the
// bundle"; docs/contracts/ms5-capture.md §2.1, §2.3, §4). The capture capability grants exactly the capture commands
// and no plugin permission; the main capability doesn't list the capture windows; the app declares its command
// manifest (so every command needs an `allow-` permission); the capture page's module graph (from
// `ui/src/capture/main.tsx`) reaches neither `ipc/client.ts` nor `@tegg/editor`, and none of its sources calls the
// clipboard API, `postMessage`, `window.open` or `fetch`. Written from the ACs and the contract only (D-61). Every
// missing file is an assertion failure (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const APP = resolve(import.meta.dirname, '..');
const read = (rel: string) => (existsSync(resolve(APP, rel)) ? readFileSync(resolve(APP, rel), 'utf8') : null);
function json(rel: string): any {
  const t = read(rel);
  assert.ok(t !== null, `${rel} exists`);
  try {
    return JSON.parse(t!);
  } catch {
    assert.fail(`${rel} is valid JSON`);
  }
}
/** `allow-capture_context` and `allow-capture-context` are the same app-command permission. */
const norm = (p: string) => p.replace(/_/g, '-');

const CAPTURE_COMMANDS = ['capture_context', 'capture_create', 'capture_ready', 'capture_hide', 'capture_resize', 'capture_open_main', 'capture_draft_get', 'capture_draft_set', 'capture_saved_show', 'capture_saved_hover', 'capture_suggest', 'capture_media_add']; // v0.52: capture_suggest (D-603, amends D-553); 6A: capture_media_add (D-624); v0.113: capture_saved_hover (D-1358)
const CORE = ['core:event:allow-listen', 'core:event:allow-unlisten', 'core:window:allow-start-dragging'];

test('nfr_sec_03_ac1_the_capture_capability_grants_exactly_the_capture_commands', () => {
  const cap = json('src-tauri/capabilities/capture.json');
  assert.deepEqual([...(cap.windows ?? [])].sort(), ['capture', 'capture-saved'], 'windows: capture and capture-saved');
  const perms = (cap.permissions ?? []).map((p: unknown) => (typeof p === 'string' ? p : (p as { identifier?: string })?.identifier ?? JSON.stringify(p)));
  assert.deepEqual(perms.map(norm).sort(), [...CORE, ...CAPTURE_COMMANDS.map((c) => `allow-${c}`)].map(norm).sort(), 'exactly the capture commands plus listen, unlisten and window dragging');
  for (const p of perms) {
    assert.ok(!/^(fs|shell|dialog|clipboard-manager|opener|http|global-shortcut|single-instance|process|os|notification)[:]/.test(p), `no plugin permission: ${p}`);
    assert.ok(!/^core:default$|^core:(webview|app|path|resources|menu|tray|image):/.test(p), `no other core permission: ${p}`);
  }
});

test('nfr_sec_03_ac1_the_main_capability_does_not_list_the_capture_windows', () => {
  const main = json('src-tauri/capabilities/default.json');
  assert.deepEqual(main.windows, ['main'], 'default.json: windows ["main"] only');
  const perms: string[] = (main.permissions ?? []).map((p: unknown) => (typeof p === 'string' ? p : (p as { identifier?: string })?.identifier ?? '')).map(norm);
  for (const c of ['capture_ready', 'capture_hide', 'capture_resize', 'capture_saved_show']) assert.ok(!perms.includes(norm(`allow-${c}`)), `the main window isn't allowed ${c}`);
  for (const c of ['note_read', 'note_write', 'inbox_list', 'vault_settings']) assert.ok(perms.includes(norm(`allow-${c}`)), `the main window is allowed ${c} (explicit app-command permission, §2.1)`);
  const build = read('src-tauri/build.rs') ?? '';
  assert.match(build, /app_manifest\s*\(\s*(tauri_build::)?AppManifest::new\(\)\s*\.commands\(/, 'build.rs declares the app command manifest (§2.1)');
  for (const c of [...CAPTURE_COMMANDS, 'note_read', 'note_write', 'index_switcher', 'search', 'inbox_list'].filter((c) => c !== 'search')) {
    assert.ok(build.includes(`"${c}"`), `build.rs lists ${c}`);
  }
});

// ------------------------------------------------------------------------------------------------ the capture page

const SRC = resolve(APP, 'ui/src');
const ENTRY = resolve(SRC, 'capture/main.tsx');
/** Local module files reachable from `entry` through static and dynamic imports; bare specifiers listed apart. */
function graph(entry: string): { files: string[]; bare: string[] } {
  const files = new Set<string>();
  const bare = new Set<string>();
  const todo = [entry];
  const resolveLocal = (from: string, spec: string): string | null => {
    const base = resolve(dirname(from), spec);
    for (const c of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')]) if (existsSync(c) && !c.endsWith('/')) {
      try { readFileSync(c); return c; } catch { /* a directory */ }
    }
    return null;
  };
  while (todo.length) {
    const f = todo.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec.startsWith('.') || spec.startsWith('/')) {
        if (/\.(css|svg|png)(\?.*)?$/.test(spec)) continue;
        const r = resolveLocal(f, spec);
        if (r) todo.push(r);
      } else bare.add(spec);
    }
  }
  return { files: [...files].map((f) => relative(SRC, f)).sort(), bare: [...bare].sort() };
}

test('nfr_sec_03_ac4_the_capture_page_imports_no_main_window_client_or_editor', () => {
  assert.ok(existsSync(resolve(APP, 'ui/capture.html')), 'app/ui/capture.html (a second Vite input beside ui/index.html, §4)');
  assert.match(read('vite.config.ts') ?? '', /capture\s*:\s*[^,}]*capture\.html/, 'vite.config.ts: rollupOptions.input has capture: capture.html');
  assert.ok(existsSync(ENTRY), 'ui/src/capture/main.tsx');
  const g = graph(ENTRY);
  assert.ok(!g.files.includes('ipc/client.ts'), `the capture graph doesn't reach ipc/client.ts: ${g.files.join(', ')}`);
  assert.ok(g.files.includes('ipc/capture.ts'), 'the capture page talks through ipc/capture.ts');
  assert.ok(!g.bare.some((b) => b.startsWith('@tegg/editor') || b.startsWith('@tiptap') || b.startsWith('prosemirror')), `no editor package: ${g.bare.join(', ')}`);
  assert.ok(!g.bare.some((b) => /^@tauri-apps\/plugin-/.test(b)), `no Tauri plugin: ${g.bare.join(', ')}`);
  // 6A (D-624, D-632): also ipc/media.ts (the tegg-media URL builder of the thumbnails, no IPC; ms6-trash-media §3.6, §5);
  // @tegg/doc (pastedImageName) is a package import, which this list of app files doesn't restrict.
  // D-763: the capture's due calendar is the app's one date picker, dates/* (pure UI, no IPC, no editor).
  const allowed = /^(capture\/|i18n\/|theme\/|dates\/|tasks\/quickAdd\.ts$|ipc\/capture\.ts$|ipc\/media\.ts$|ipc\/types\.ts$|shell\/Icon\.tsx$|icons\.ts$|zone\.ts$)/;
  assert.deepEqual(g.files.filter((f) => !allowed.test(f)), [], 'only capture/*, i18n/*, theme/*, dates/*, tasks/quickAdd.ts, ipc/capture.ts, ipc/media.ts and shell/Icon (§4)');
});

test('nfr_sec_03_ac4_the_capture_sources_call_no_clipboard_postmessage_or_network', () => {
  assert.ok(existsSync(ENTRY), 'ui/src/capture/main.tsx');
  const g = graph(ENTRY);
  const bad: string[] = [];
  for (const f of g.files) {
    const t = readFileSync(resolve(SRC, f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [re, what] of [[/navigator\s*\.\s*clipboard/, 'navigator.clipboard'], [/\.postMessage\s*\(/, 'postMessage'], [/window\s*\.\s*open\s*\(/, 'window.open'], [/\bfetch\s*\(/, 'fetch'], [/XMLHttpRequest|WebSocket|EventSource/, 'network'], [/clipboard-manager/, 'clipboard plugin']] as const) {
      if (re.test(t)) bad.push(`${f}: ${what}`);
    }
  }
  assert.deepEqual(bad, [], 'NFR-SEC-03 AC-4, contract §2.3');
});
