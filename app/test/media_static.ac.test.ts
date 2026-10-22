// MS6 slice 6A, L0: static rules for loading vault media (docs/acceptance/trash-media.md FR-ATT-01 AC-12 "no other
// scheme, no network, no file outside the vault", AC-11 "the capture window gets only `capture_media_add`";
// docs/contracts/ms6-trash-media.md §3.6, §5, §9.3; D-626, D-624, NFR-SEC-01, NFR-SEC-03). No Tauri `asset:` protocol
// and no `assetProtocol` scope in the config; the shell registers the `tegg-media` scheme; the capture capability gains
// exactly `allow-capture-media-add`; every media URL of the UI comes from `ipc/media.ts` `mediaUrl`, which builds
// `tegg-media://localhost/<percent-encoded vault path>` or uses `window.__TEGG_MEDIA_BASE__` in tests. Written from the
// ACs and the contract only (D-61). Every missing file or module is an assertion failure (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const APP = resolve(import.meta.dirname, '..');
const read = (rel: string) => (existsSync(resolve(APP, rel)) ? readFileSync(resolve(APP, rel), 'utf8') : null);
function json(rel: string): any {
  const t = read(rel);
  assert.ok(t !== null, `${rel} exists`);
  return JSON.parse(t!);
}
const norm = (p: string) => p.replace(/_/g, '-');
function sources(dir: string, ext: RegExp): [string, string][] {
  const out: [string, string][] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (ext.test(n)) out.push([p.slice(APP.length + 1), readFileSync(p, 'utf8')]);
    }
  };
  walk(resolve(APP, dir));
  return out;
}
afterEach(() => { delete (globalThis as any).window; });

test('fr_att_01_ac12_no_asset_protocol_and_the_tegg_media_scheme', () => {
  for (const rel of ['src-tauri/tauri.conf.json', 'src-tauri/tauri.preview.conf.json']) {
    const t = read(rel);
    if (t === null) continue;
    assert.ok(!/assetProtocol/.test(t), `${rel}: no assetProtocol (D-626)`);
    assert.ok(!/\basset:/.test(t) && !/asset\.localhost/.test(t), `${rel}: no asset: scheme`);
  }
  const csp = String(json('src-tauri/tauri.conf.json')?.app?.security?.csp ?? '');
  assert.ok(!/https?:\/\/(?!ipc\.localhost|tegg-media\.localhost)/.test(csp), `the CSP allows no network origin: ${csp}`);
  const rust = sources('src-tauri/src', /\.rs$/).map(([, t]) => t).join('\n');
  assert.ok(/register_asynchronous_uri_scheme_protocol\(\s*"tegg-media"/.test(rust), 'the shell registers the read-only `tegg-media` scheme (§3.6)');
  assert.ok(/img-src[^;]*tegg-media/.test(csp), `the CSP lets images load from tegg-media: ${csp}`);
});

test('fr_att_01_ac11_the_capture_capability_gains_exactly_capture_media_add', () => {
  const cap = json('src-tauri/capabilities/capture.json');
  const perms: string[] = (cap.permissions ?? []).map((p: unknown) => norm(typeof p === 'string' ? p : String((p as any)?.identifier ?? '')));
  const media = perms.filter((p) => /media|trash/.test(p));
  assert.deepEqual(media, ['allow-capture-media-add'], 'only capture_media_add (D-624, NFR-SEC-03)');
  for (const p of ['allow-media-add', 'allow-media-add-paths', 'allow-media-pick', 'allow-trash-list', 'allow-note-read']) assert.ok(!perms.includes(p), `not ${p}`);
  const main = json('src-tauri/capabilities/default.json');
  const mainPerms: string[] = (main.permissions ?? []).map((p: unknown) => norm(typeof p === 'string' ? p : String((p as any)?.identifier ?? '')));
  assert.ok(!mainPerms.includes('allow-capture-media-add'), 'the main window has no capture_media_add');
});

test('fr_att_01_ac12_every_media_url_comes_from_media_url', async () => {
  let m: any = null;
  try { m = await import('../ui/src/ipc/media.ts'); } catch { m = null; }
  assert.ok(m && typeof m.mediaUrl === 'function', 'ui/src/ipc/media.ts exports mediaUrl (§3.6)');
  (globalThis as any).window = {};
  const url = String(m.mediaUrl('_attachments/záhon 2.png'));
  const prefix = 'tegg-media://localhost/';
  assert.ok(url.startsWith(prefix), `tegg-media://localhost/…: ${url}`);
  assert.ok(/^[\x21-\x7e]+$/.test(url), `percent-encoded (ASCII, no spaces): ${url}`);
  assert.equal(decodeURIComponent(url.slice(prefix.length)).normalize('NFC'), '_attachments/záhon 2.png', 'the vault path, NFC');
  assert.equal(decodeURIComponent(String(m.mediaUrl('_attachments/záhon 2.png')).slice(prefix.length)), '_attachments/záhon 2.png', 'NFC-normalized');
  (globalThis as any).window = { __TEGG_MEDIA_BASE__: 'http://localhost:5177/__media/' };
  const t = String(m.mediaUrl('PDFs/Rozpočet.pdf'));
  assert.ok(t.startsWith('http://localhost:5177/__media/'), `the test base replaces the scheme: ${t}`);
  assert.equal(decodeURIComponent(t.slice('http://localhost:5177/__media/'.length)), 'PDFs/Rozpočet.pdf');
  // No other module builds media URLs from vault paths (no asset:, no convertFileSrc, no file:).
  for (const [rel, text] of sources('ui/src', /\.(ts|tsx)$/)) {
    assert.ok(!/convertFileSrc|asset:\/\/|asset\.localhost|['"`]file:\/\//.test(text), `${rel}: no other way to load files`);
    if (rel !== 'ui/src/ipc/media.ts') assert.ok(!/tegg-media:\/\//.test(text), `${rel}: builds tegg-media URLs only through mediaUrl`);
  }
});
