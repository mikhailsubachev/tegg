// D-1880: the WebKit tests (L5) load a built bundle, not the Vite dev server. A page load from the dev server made
// about 356 requests and took about 610 ms; from the bundle it makes 5 and takes about 180 ms, and the server no
// longer limits how many workers pay off (measured 2026-11-19, tools/qa/CONTRACT.md §3.2.1).
//
// Usage: node webkit/serve-built.ts <port>
// Builds the UI once with the app's own vite.config.ts, keeps the output in memory (nothing is written, so runs in
// one checkout never share or wipe a folder) and serves it on <port>. It exits if the port is taken.
//
// The tests reach into the app through source paths, as they did on the dev server: a prelude is put in front of
// `/src/main.tsx`, and pages import modules such as `/src/theme/tokens.ts`. So the two page entries and the modules
// in EXPOSED are built as entry chunks named by their source path: each keeps its exports, and the app imports the
// same chunk, so a test that sets the catalog or the collation locale changes the app's own module.
import http from 'node:http';
import path from 'node:path';
import { build, type Rollup } from 'vite';

const APP = path.resolve(import.meta.dirname, '..');
const UI = path.join(APP, 'ui');
const REPO = path.resolve(APP, '..');

/** App modules the tests import in the page. A test that needs another one adds it here. */
export const EXPOSED = [
  'src/i18n/catalog.ts',
  'src/i18n/collate.ts',
  'src/mindmap/layout.ts',
  'src/shell/registry.ts',
  'src/shell/vaultColor.ts',
  'src/theme/contrast.ts',
  'src/theme/tokens.ts',
];

/** Modules outside the UI folder, which the tests import by Vite's `/@fs/<absolute path>` URL. They are served at
 *  `/@fs<repository root>/<path>`, the URL the dev server gave them. */
export const EXPOSED_FS = ['packages/doc/src/index.ts'];

/** Entry chunk → the path it is served at: the page entries take the place of the scripts their HTML names. */
const PAGE_ENTRIES: Record<string, string> = { 'index.html': 'src/main.tsx', 'capture.html': 'src/capture/main.tsx' };

function servedName(chunk: Rollup.PreRenderedChunk): string {
  const id = chunk.facadeModuleId ? path.relative(UI, chunk.facadeModuleId.split('?')[0]).split(path.sep).join('/') : '';
  const outside = chunk.facadeModuleId ? path.relative(REPO, chunk.facadeModuleId.split('?')[0]).split(path.sep).join('/') : '';
  if (EXPOSED_FS.includes(outside)) return `fs/${outside}`;
  return PAGE_ENTRIES[id] ?? (EXPOSED.includes(id) ? id : 'assets/[name]-[hash].js');
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.tsx': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

async function bundle(): Promise<Map<string, string | Uint8Array>> {
  const result = await build({
    configFile: path.join(APP, 'vite.config.ts'),
    logLevel: 'error',
    build: {
      write: false,
      rollupOptions: {
        input: Object.fromEntries([...EXPOSED.map((m) => [m.replace(/[/.]/g, '_'), path.join(UI, m)]), ...EXPOSED_FS.map((m) => [m.replace(/[/.]/g, '_'), path.join(REPO, m)])]),
        preserveEntrySignatures: 'strict',
        output: { entryFileNames: servedName },
      },
    },
  });
  const files = new Map<string, string | Uint8Array>();
  for (const out of Array.isArray(result) ? result : [result as Rollup.RollupOutput]) {
    for (const f of out.output) files.set(`/${f.fileName}`, f.type === 'chunk' ? f.code : f.source);
  }
  for (const need of ['/index.html', '/capture.html', ...Object.values(PAGE_ENTRIES).map((p) => `/${p}`), ...EXPOSED.map((m) => `/${m}`), ...EXPOSED_FS.map((m) => `/fs/${m}`)]) {
    if (!files.has(need)) throw new Error(`serve-built: the build has no ${need}`);
  }
  return files;
}

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
  process.stderr.write('usage: node webkit/serve-built.ts <port>\n');
  process.exit(2);
}

const files = await bundle();
const server = http.createServer((req, res) => {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain' }).end('malformed path\n');
    return;
  }
  const fsPrefix = `/@fs${REPO.split(path.sep).join('/')}/`;
  const name = pathname === '/' ? '/index.html' : pathname.startsWith(fsPrefix) ? `/fs/${pathname.slice(fsPrefix.length)}` : pathname;
  const body = files.get(name);
  if (body === undefined) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end(`not in the test bundle: ${name}\n`);
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(name)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
});
server.on('error', (e) => {
  process.stderr.write(`serve-built: ${e.message}\n`);
  process.exit(1);
});
// If the runner that started this server is gone (killed without cleanup), the server would keep the run's port:
// it ends itself once its parent changes.
const parent = process.ppid;
setInterval(() => {
  if (process.ppid !== parent) process.exit(0);
}, 2_000).unref();
// `localhost` like the dev server did; the port is this run's own (VERIFY_PORT_BASE or TEGG_WEBKIT_PORT).
server.listen(port, 'localhost', () => process.stdout.write(`serve-built: ${files.size} files on http://localhost:${port}\n`));
