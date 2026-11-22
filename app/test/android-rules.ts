// Slice AND-1, L0 rule helpers (docs/acceptance/android-shell.md AR-03 AC-7): where a desktop-only symbol may appear in
// the shell's Rust sources. Test infrastructure only (no AC outcome is asserted here); the rule's own test and the run
// over `app/src-tauri/src/**` are in android_static.ac.test.ts.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

/** AR-03 AC-7's symbols (plus `TrayIconBuilder`, the rule's sample). */
export const DESKTOP_ONLY = [
  'tauri::tray', 'tauri::menu', 'TrayIconBuilder', 'set_menu', 'on_menu_event', 'TitleBarStyle', 'title_bar_style', 'hidden_title', 'EffectsBuilder',
  '.center(', '.unminimize(', '.always_on_top(',
  'tauri_plugin_dialog', 'pick_folder', 'UnixListener', 'single_instance',
  'install_hotkey_handler', 'register_hotkey', 'watch_mouse_buttons', 'launched_at_login', 'RunEvent::Reopen', '/usr/bin/open', 'objc2',
];

/** An attribute that compiles its item only on the desktop / on macOS. */
const GATE = /^#\[cfg\(\s*(desktop|target_os\s*=\s*"macos"|all\(\s*(desktop|target_os\s*=\s*"macos")\b)/;

type Masked = { code: string; shape: string };

/** `code`: comments blanked. `shape`: comments, string and char literal contents blanked (braces and `;` in them don't
 *  count). Offsets are kept. */
export function mask(src: string): Masked {
  const code = src.split('');
  const shape = src.split('');
  const blank = (arr: string[], from: number, to: number) => { for (let k = from; k < to; k++) if (arr[k] !== '\n') arr[k] = ' '; };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      const e = src.indexOf('\n', i);
      const end = e < 0 ? src.length : e;
      blank(code, i, end); blank(shape, i, end); i = end; continue;
    }
    if (c === '/' && n === '*') {
      let depth = 1; let j = i + 2;
      while (j < src.length && depth > 0) {
        if (src[j] === '/' && src[j + 1] === '*') { depth++; j += 2; } else if (src[j] === '*' && src[j + 1] === '/') { depth--; j += 2; } else j++;
      }
      blank(code, i, j); blank(shape, i, j); i = j; continue;
    }
    const raw = /^r(#*)"/.exec(src.slice(i, i + 10));
    if (raw && !/[A-Za-z0-9_]/.test(src[i - 1] ?? '')) {
      const close = `"${raw[1]}`;
      const e = src.indexOf(close, i + raw[0].length);
      const end = e < 0 ? src.length : e + close.length;
      blank(shape, i + raw[0].length, end - close.length); i = end; continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      blank(shape, i + 1, j); i = j + 1; continue;
    }
    if (c === "'") {
      const m = /^'(\\(x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|.)|[^\\'])'/u.exec(src.slice(i, i + 12));
      if (m) { blank(shape, i + 1, i + m[0].length - 1); i += m[0].length; continue; }
    }
    i++;
  }
  return { code: code.join(''), shape: shape.join('') };
}

/** Leading attributes of `text` (whitespace between them allowed). */
function leadingAttrs(text: string): string[] {
  const out: string[] = [];
  let s = text.trimStart();
  while (s.startsWith('#[') || s.startsWith('#![')) {
    let depth = 0; let j = s.indexOf('[');
    for (; j < s.length; j++) { if (s[j] === '[') depth++; else if (s[j] === ']') { depth--; if (depth === 0) break; } }
    out.push(s.slice(0, j + 1).replace(/^#!/, '#'));
    s = s.slice(j + 1).trimStart();
  }
  return out;
}

const gated = (text: string) => leadingAttrs(text).some((a) => GATE.test(a.replace(/\s+/g, ' ')));

/** Start of the item or statement that contains offset `at`: after the previous `;`, `{` or `}` outside parentheses
 *  (a closure body inside a call's arguments doesn't end the statement). Returns the offset after the boundary. */
function segmentStart(shape: string, at: number): number {
  let paren = 0;
  for (let k = at - 1; k >= 0; k--) {
    const ch = shape[k];
    if (ch === ')' || ch === ']') paren++;
    else if (ch === '(' || ch === '[') { if (paren > 0) paren--; }
    else if (paren > 0) continue;
    else if (ch === '}' || ch === '{' || ch === ';') return k + 1;
  }
  return 0;
}

/** True when offset `at` lies in an item, block or statement whose leading attributes gate it to the desktop/macOS. */
export function isGatedAt(m: Masked, at: number): boolean {
  let pos = at;
  for (;;) {
    const start = segmentStart(m.shape, pos);
    if (gated(m.code.slice(start, pos))) return true;
    if (start === 0) return false;
    // Step out to the enclosing `{` (skipping sibling blocks): the item or block it opens is checked next.
    let depth = 0;
    let k = start - 1;
    for (; k >= 0; k--) {
      const ch = m.shape[k];
      if (ch === '}') depth++;
      else if (ch === '{') { if (depth === 0) break; depth--; }
    }
    if (k < 0) return false;
    pos = k;
  }
}

/** Unguarded uses of `symbols` in one file's text: `line: symbol` (1-based lines). `fileGated`: the whole file is gated
 *  (its `mod` declaration or an inner `#![cfg(…)]`). */
export function unguarded(src: string, symbols = DESKTOP_ONLY, fileGated = false): string[] {
  if (fileGated || gated(src.replace(/^\s*(\/\/[^\n]*\n\s*)*/, ''))) return [];
  const m = mask(src);
  const out: string[] = [];
  for (const sym of symbols) {
    let from = 0;
    for (;;) {
      const i = m.code.indexOf(sym, from);
      if (i < 0) break;
      from = i + sym.length;
      const word = /^[A-Za-z_]/.test(sym) && /[A-Za-z0-9_]/.test(m.code[i - 1] ?? '');
      if (word) continue;
      if (!isGatedAt(m, i)) out.push(`${src.slice(0, i).split('\n').length}: ${sym}`);
    }
  }
  return out;
}

/** `.rs` files under `dir`. */
export function rustFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...rustFiles(p));
    else if (name.endsWith('.rs')) out.push(p);
  }
  return out.sort();
}

/** Whether `file` (under `src`) is compiled only on the desktop through its `mod` declaration (or an ancestor's). */
export function moduleGated(src: string, file: string): boolean {
  const rel = relative(src, file);
  if (rel === 'lib.rs' || rel === 'main.rs') return false;
  const name = basename(file) === 'mod.rs' ? basename(dirname(file)) : basename(file, '.rs');
  const parentDir = basename(file) === 'mod.rs' ? dirname(dirname(file)) : dirname(file);
  const parents = parentDir === src ? [join(src, 'lib.rs'), join(src, 'main.rs')] : [join(parentDir, 'mod.rs'), `${parentDir}.rs`];
  for (const parent of parents) {
    if (!existsSync(parent)) continue;
    const text = readFileSync(parent, 'utf8');
    const m = mask(text);
    const re = new RegExp(`\\bmod\\s+${name}\\s*;`, 'g');
    let hit: RegExpExecArray | null;
    while ((hit = re.exec(m.code))) {
      if (isGatedAt(m, hit.index)) return true;
      if (parent !== join(src, 'lib.rs') && parent !== join(src, 'main.rs') && moduleGated(src, parent)) return true;
    }
  }
  return false;
}
