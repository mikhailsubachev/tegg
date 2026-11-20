// D-1880 (tools/qa/CONTRACT.md §3.2.1): the server the WebKit tests load the UI from. The WebKit suite only proves
// it by passing; these tests pin the properties the contract relies on (QA review of the built-bundle change).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const APP = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(APP, '..');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, 'localhost', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

type Server = { child: ChildProcess; port: number; exit: Promise<number | null>; stderr: () => string };

function start(port: number): Server {
  const child = spawn(process.execPath, ['webkit/serve-built.ts', String(port)], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<number | null>((r) => child.on('close', (code) => r(code)));
  return { child, port, exit, stderr: () => err };
}

async function up(s: Server): Promise<void> {
  for (let i = 0; i < 600; i++) {
    try {
      if ((await fetch(`http://localhost:${s.port}/`)).ok) return;
    } catch {
      // not listening yet: the build is running
    }
    if (s.child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`the server on port ${s.port} did not come up\n${s.stderr()}`);
}

test('bug_d1880_the_test_bundle_serves_the_pages_and_the_app_modules_at_their_source_paths', async (t) => {
  const s = start(await freePort());
  t.after(() => s.child.kill());
  await up(s);
  const get = (p: string) => fetch(`http://localhost:${s.port}${p}`);

  const index = await (await get('/')).text();
  assert.match(index, /<script type="module"[^>]* src="\/src\/main\.tsx"/, 'index.html loads the page entry at its source path');
  assert.match(await (await get('/capture.html')).text(), /src="\/src\/capture\/main\.tsx"/, 'capture.html loads its entry at its source path');

  // Each module keeps the exports the tests read in the page, and is served as JavaScript whatever its extension.
  const wanted: Record<string, string[]> = {
    '/src/main.tsx': [],
    '/src/capture/main.tsx': [],
    '/src/theme/tokens.ts': ['light', 'dark'],
    '/src/theme/contrast.ts': ['ratio'],
    '/src/i18n/catalog.ts': ['setCatalog', 'pseudo', 'en'],
    '/src/i18n/collate.ts': ['setCollationLocale', 'collator'],
    '/src/shell/registry.ts': ['SHORTCUTS', 'IN_NOTE_PLACEHOLDERS'],
    '/src/shell/vaultColor.ts': ['vaultColor'],
    '/src/mindmap/layout.ts': ['layoutMindmap'],
    [`/@fs${REPO.split(path.sep).join('/')}/packages/doc/src/index.ts`]: ['mindmapTree'],
  };
  for (const [url, names] of Object.entries(wanted)) {
    const res = await get(encodeURI(url));
    assert.equal(res.status, 200, `${url} is served`);
    assert.match(res.headers.get('content-type') ?? '', /^text\/javascript/, `${url} is served as JavaScript`);
    assert.equal(res.headers.get('cache-control'), 'no-store', `${url} is never cached`);
    const code = await res.text();
    const exported = [...code.matchAll(/export\s*\{([^}]*)\}/g)].flatMap((m) => m[1].split(',').map((e) => e.trim().split(/\s+as\s+/).pop()!));
    for (const n of names) assert.ok(exported.includes(n), `${url} exports ${n} (has: ${exported.join(', ')})`);
  }

  assert.equal((await get('/src/shell/App.tsx')).status, 404, 'a module outside the list is not served');
  assert.equal((await get('/50%.png')).status, 400, 'a malformed path is refused');
  assert.equal((await get('/')).status, 200, 'and the server is still there after it');
});

test('bug_d1880_the_server_exits_when_its_port_is_taken', async (t) => {
  const port = await freePort();
  const holder = net.createServer();
  await new Promise<void>((r) => holder.listen(port, 'localhost', () => r()));
  t.after(() => holder.close());
  const s = start(port);
  t.after(() => s.child.kill());
  const code = await s.exit;
  assert.notEqual(code, 0, `a taken port ends the server with an error, never a second server\n${s.stderr()}`);
});

test('bug_d1880_a_missing_port_argument_is_a_usage_error', async () => {
  const child = spawn(process.execPath, ['webkit/serve-built.ts'], { cwd: APP, stdio: 'ignore' });
  assert.equal(await new Promise((r) => child.on('close', r)), 2);
});
