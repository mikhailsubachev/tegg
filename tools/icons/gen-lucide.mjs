#!/usr/bin/env node
// Lucide icon data for Tegg (docs/contracts/v1-cards.md §5; FR-TYP-01 AC-20; D-2067, D-2075, D-2105, D-2112).
//
// Run by hand at dev time (Node >= 22, no dependencies):
//
//   node tools/icons/gen-lucide.mjs                     downloads the pinned lucide-static tarball, checks its integrity
//                                                       and writes packages/schema/data/lucide-0.460.0.json and
//                                                       app/src-tauri/Credits.rtf
//   node tools/icons/gen-lucide.mjs --tarball <file>    the same from a local copy of that tarball (integrity checked)
//   node tools/icons/gen-lucide.mjs --check             offline: checks the committed outputs against this script's pins
//                                                       (run by `./verify commit` when the outputs or the script change)
//
// lucide-static is never a dependency of any package (FR-TYP-01 AC-20 (a)); the app never fetches anything (NFR-SEC-01):
// only this script touches the network, and only without `--check` / `--tarball`.

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

export const VERSION = '0.460.0';
export const PACKAGE = `lucide-static@${VERSION}`;
export const TARBALL = 'https://registry.npmjs.org/lucide-static/-/lucide-static-0.460.0.tgz';
export const INTEGRITY = 'sha512-X6pIdg7jVxv7YQ/uR241hwhNiztcAfmj181TbcX7HCxxk/3mGaRtAc6b2ftUvQBufbJE6ehgyzO2uVsa604tWg==';
export const COUNT = 1539;
/** The SVG tags an icon node may hold (v1-cards §2.4). */
export const TAGS = ['path', 'circle', 'rect', 'polyline', 'line', 'polygon', 'ellipse'];
/** types.md R14's 24 old names (D-2067): each must resolve, by name or by an alias. */
export const OLD_NAMES = ['file-text', 'check-square', 'zap', 'calendar', 'hash', 'image', 'file', 'book', 'book-open', 'lightbulb', 'users', 'user', 'folder', 'map', 'star', 'flag',
  'bookmark', 'briefcase', 'coffee', 'globe', 'graduation-cap', 'pen-line', 'utensils', 'plane'];

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = join(REPO, `packages/schema/data/lucide-${VERSION}.json`);
const ALIASES = join(REPO, 'packages/schema/data/icon-aliases.json');
const CREDITS = join(REPO, 'app/src-tauri/Credits.rtf');
const D3_LICENSE = join(REPO, 'app/node_modules/d3-force/LICENSE');

function fail(msg) {
  console.error(`gen-lucide: ${msg}`);
  process.exit(1);
}

/** The npm `integrity` string (sha512, base64) of some bytes. */
function integrityOf(bytes) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

/** A minimal ustar reader: path → bytes of every regular file (pax `path` headers honoured). */
function untar(buf) {
  const out = new Map();
  let off = 0;
  let paxPath = null;
  const str = (a, b) => buf.subarray(off + a, off + b).toString('utf8').replace(/\0.*$/s, '');
  while (off + 512 <= buf.length) {
    if (buf.subarray(off, off + 512).every((b) => b === 0)) break;
    const name = str(0, 100);
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(buf[off + 156] || 48);
    const prefix = buf.subarray(off + 257, off + 263).toString('latin1').startsWith('ustar') ? str(345, 500) : '';
    const body = buf.subarray(off + 512, off + 512 + size);
    if (type === 'x') {
      const m = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
      paxPath = m ? m[1] : null;
    } else if (type === '0' || type === '\0' || type === '7') {
      out.set(paxPath ?? (prefix ? `${prefix}/${name}` : name), Buffer.from(body));
      paxPath = null;
    } else {
      paxPath = null;
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

/** Plain RTF text: `\`, `{`, `}` escaped, non-ASCII as `\uN?`, each line a paragraph. */
function rtfText(s) {
  const esc = [...s.replace(/\r\n/g, '\n')]
    .map((c) => {
      if (c === '\\' || c === '{' || c === '}') return `\\${c}`;
      if (c === '\n') return '\\par\n';
      const cp = c.codePointAt(0);
      if (cp < 0x80) return c;
      if (cp > 0xffff) {
        const hi = Math.floor((cp - 0x10000) / 0x400) + 0xd800;
        const lo = ((cp - 0x10000) % 0x400) + 0xdc00;
        return `\\u${hi - 0x10000}?\\u${lo - 0x10000}?`;
      }
      return `\\u${cp > 0x7fff ? cp - 0x10000 : cp}?`;
    })
    .join('');
  return esc;
}

export function credits(lucideLicense, d3License) {
  const head = (t) => `{\\b ${rtfText(t)}}\\par\n\\par\n`;
  return [
    '{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fswiss Helvetica;}}\\f0\\fs20\n',
    head(`Lucide ${VERSION}`),
    rtfText(lucideLicense.trim()),
    '\\par\n\\par\n',
    head('d3-force'),
    rtfText(d3License.trim()),
    '\\par\n}\n',
  ].join('');
}

function resolveName(names, aliases, n) {
  if (names.has(n)) return n;
  const t = aliases[n];
  return t && names.has(t) ? t : null;
}

/** The checks shared by a generation and `--check` (v1-cards §5.2). Returns the problems found. */
export function problems(data, aliases) {
  const bad = [];
  if (data.lucide !== VERSION) bad.push(`lucide is ${data.lucide}, want ${VERSION}`);
  if (data.package !== PACKAGE) bad.push(`package is ${data.package}, want ${PACKAGE}`);
  if (data.integrity !== INTEGRITY) bad.push('integrity differs from the pinned one');
  const names = Object.keys(data.icons ?? {});
  if (data.count !== COUNT || names.length !== COUNT) bad.push(`count ${data.count}, ${names.length} names; want ${COUNT}`);
  if (new Set(names).size !== names.length) bad.push('names repeat');
  const sorted = [...names].sort();
  if (sorted.some((n, i) => n !== names[i])) bad.push('names are not in code-point order');
  for (const n of names) {
    const e = data.icons[n];
    if (!/^[a-z0-9-]+$/.test(n)) bad.push(`${n}: not a lower-case ASCII name`);
    if (!Array.isArray(e?.n) || e.n.length === 0) bad.push(`${n}: empty node`);
    else if (e.n.some((x) => !Array.isArray(x) || !TAGS.includes(x[0]) || typeof x[1] !== 'object')) bad.push(`${n}: unknown element`);
    if (!Array.isArray(e?.k) || e.k.some((k) => typeof k !== 'string')) bad.push(`${n}: keywords aren't a list of strings`);
  }
  const set = new Set(names);
  for (const [a, t] of Object.entries(aliases)) {
    if (!set.has(t)) bad.push(`alias ${a} → ${t}: no such icon`);
    if (set.has(a)) bad.push(`alias ${a} is itself an icon name`);
  }
  for (const n of OLD_NAMES) if (!resolveName(set, aliases, n)) bad.push(`old name ${n} doesn't resolve`);
  return bad;
}

async function tarballBytes(local) {
  if (local) return readFileSync(local);
  const res = await fetch(TARBALL);
  if (!res.ok) fail(`download failed: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

async function generate(local) {
  const tmp = mkdtempSync(join(tmpdir(), 'tegg-lucide-'));
  try {
    const tgz = await tarballBytes(local);
    writeFileSync(join(tmp, 'lucide-static.tgz'), tgz);
    const got = integrityOf(tgz);
    if (got !== INTEGRITY) fail(`integrity mismatch: ${got}`);
    const files = untar(gunzipSync(tgz));
    const file = (p) => files.get(p) ?? fail(`the tarball has no ${p}`);
    const nodes = JSON.parse(file('package/icon-nodes.json').toString('utf8'));
    const tags = JSON.parse(file('package/tags.json').toString('utf8'));
    const license = file('package/LICENSE').toString('utf8');
    const version = JSON.parse(file('package/package.json').toString('utf8')).version;
    if (version !== VERSION) fail(`the tarball is version ${version}`);
    const names = Object.keys(nodes).sort();
    const icons = {};
    for (const n of names) icons[n] = { n: nodes[n], k: Array.isArray(tags[n]) ? tags[n] : [] };
    const data = { lucide: VERSION, package: PACKAGE, integrity: INTEGRITY, count: names.length, icons };
    const aliases = JSON.parse(readFileSync(ALIASES, 'utf8'));
    const bad = problems(data, aliases);
    if (bad.length) fail(`refused:\n  ${bad.join('\n  ')}`);
    if (!existsSync(D3_LICENSE)) fail(`${D3_LICENSE} is missing (npm install in app/)`);
    writeFileSync(DATA, JSON.stringify(data));
    writeFileSync(CREDITS, credits(license, readFileSync(D3_LICENSE, 'utf8')));
    console.log(`${DATA}: ${statSync(DATA).size} bytes`);
    console.log(`${CREDITS}: ${statSync(CREDITS).size} bytes`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function check() {
  const bad = [];
  if (!existsSync(DATA)) fail(`${DATA} is missing`);
  const data = JSON.parse(readFileSync(DATA, 'utf8'));
  const aliases = JSON.parse(readFileSync(ALIASES, 'utf8'));
  bad.push(...problems(data, aliases));
  if (statSync(DATA).size >= 2 * 1024 * 1024) bad.push('the data file is 2 MiB or more (D-2075)');
  if (!existsSync(CREDITS)) bad.push(`${CREDITS} is missing`);
  else {
    const rtf = readFileSync(CREDITS, 'utf8');
    if (!rtf.startsWith('{\\rtf1')) bad.push('Credits.rtf is not RTF');
    for (const t of [`Lucide ${VERSION}`, 'ISC License', 'Copyright (c) for portions of Lucide are held by Cole Bemis', 'Lucide Contributors', 'd3-force']) {
      if (!rtf.includes(t)) bad.push(`Credits.rtf lacks ${JSON.stringify(t)}`);
    }
    if (existsSync(D3_LICENSE)) {
      const first = readFileSync(D3_LICENSE, 'utf8').trim().split('\n')[0];
      if (!rtf.includes(rtfText(first))) bad.push("Credits.rtf lacks d3-force's licence text");
    }
  }
  if (bad.length) fail(`check failed:\n  ${bad.join('\n  ')}`);
  console.log(`gen-lucide --check: ok (${data.count} icons, ${PACKAGE})`);
}

const args = process.argv.slice(2);
if (args.includes('--check')) check();
else {
  const i = args.indexOf('--tarball');
  await generate(i >= 0 ? args[i + 1] : null);
}
