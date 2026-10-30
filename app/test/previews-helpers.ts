// Helpers for the v1.0 slice P L1 tests (object previews; docs/contracts/v1-previews.md §3, §10). Test data, a fake IPC
// over the previews fixture and module loading only: no AC assertions here except `need` (from read-helpers), which
// turns a missing module or export into an AssertionError (TS-I1). The link resolution is the contract rule (ms3-shell
// §11.1 through `resolveIn` of embeds-helpers, plus media files and `.trash/`, ms6-trash-media §2, §3.2) over the
// synthetic fixture; the real resolution is tested at the core (crates/tegg-core/tests/ac_previews.rs).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createElement } from 'react';
import { act, render } from '@testing-library/react';
import { clearMocks, mockConvertFileSrc, mockIPC } from '@tauri-apps/api/mocks';
import { parse as parseYaml } from 'yaml';
import { computeAccessibleName } from 'dom-accessibility-api';
import { need } from './read-helpers';
import { resolveIn, type LinkTargetDto } from './embeds-helpers';

export const REPO = resolve(import.meta.dirname, '../..');
export const FIXTURE = join(REPO, 'tests/fixtures/vaults/previews');
/** previews.md test clock. */
export const NOW = '2026-10-28T10:00:00+01:00';
export const ZONE = 'Europe/Prague';

export const P = {
  rozpocet: 'Pages/Rozpočet 2027.md',
  jana: 'Osoby/Jana Nováková.md',
  petr: 'Osoby/Petr Dvořák.md',
  alfa: 'Projekty/Projekt Alfa.md',
  odkazy: 'Pages/Odkazy.md',
  vlozeni: 'Pages/Vložení.md',
  kruhA: 'Pages/Kruh A.md',
  kruhB: 'Pages/Kruh B.md',
  ukol: 'Tasks/Zavolat Janě.md',
  porada: 'Pages/Porada 2026-10-27.md',
  denni: 'Daily/2026-10-07.md',
  ucty: 'Tags/Účty.md',
  graf: 'Images/Graf.md',
  smlouva: 'PDFs/Smlouva.md',
  planP: 'Pages/Plán.md',
  planQ: 'Quick Notes/Plán.md',
  prazdna: 'Pages/Prázdná.md',
  neplatna: 'Pages/Neplatná hlavička.md',
  napad: 'Quick Notes/Nápad na podcast.md',
  mapa: 'Pages/Mapa.md',
} as const;

export const nfc = (s: string) => s.normalize('NFC');
export const name = (e: Element) => nfc(computeAccessibleName(e).trim());
export const text = (e: Element | null | undefined) => nfc(e?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Fixture file text exactly as on disk. */
export function fixture(rel: string): string {
  return readFileSync(join(FIXTURE, rel), 'utf8');
}

type Obj = { path: string; id: string | null; title: string; type: string | null };
/** The fixture's objects (README table). Neplatná has invalid frontmatter: title from the stem, no type. */
export const OBJECTS: Obj[] = [
  [P.rozpocet, 'P001', 'Rozpočet 2027', 'page'], [P.jana, 'P002', 'Jana Nováková', 'osoba'], [P.petr, 'P003', 'Petr Dvořák', 'osoba'],
  [P.alfa, 'P004', 'Projekt Alfa', 'projekt'], [P.odkazy, 'P005', 'Odkazy', 'page'], [P.vlozeni, 'P006', 'Vložení', 'page'],
  [P.kruhA, 'P007', 'Kruh A', 'page'], [P.kruhB, 'P008', 'Kruh B', 'page'], [P.ukol, 'P009', 'Zavolat Janě', 'task'],
  [P.porada, 'P010', 'Porada 2026-10-27', 'page'], [P.denni, 'P011', '2026-10-07', 'daily-note'], [P.ucty, 'P012', 'Účty', 'tag'],
  [P.graf, 'P013', 'Graf', 'image'], [P.smlouva, 'P014', 'Smlouva', 'pdf'], [P.planP, 'P015', 'Plán', 'page'],
  [P.planQ, 'P016', 'Plán', 'quick-note'], [P.prazdna, 'P017', 'Prázdná', 'page'], [P.neplatna, 'P018', 'Neplatná hlavička', null],
  [P.napad, 'P019', 'Nápad na podcast', 'quick-note'], [P.mapa, 'P020', 'Mapa', 'page'],
].map(([path, id, title, type]) => ({ path: path as string, id: id ? `01JBPV0000000000000000${id}` : null, title: title as string, type: type as string | null }));

/** The runtime attachments of the fixture README and their live objects. */
export const MEDIA: Record<string, string> = { '_attachments/graf.png': P.graf, '_attachments/Smlouva.pdf': P.smlouva };

/** ms3-shell §11.1 over the fixture, plus media files (kind `media`, `object`) and `.trash/` (kind `trashed`). */
export function resolvePreviews(from: string, targets: string[]): Map<string, LinkTargetDto & { object?: string | null }> {
  const out = new Map<string, LinkTargetDto & { object?: string | null }>();
  const rest: string[] = [];
  for (const given of targets) {
    let t = nfc(given).trim();
    const cut = t.search(/[#|]/);
    if (cut >= 0) t = t.slice(0, cut).trim();
    const low = t.toLowerCase();
    const file = Object.keys(MEDIA).find((m) => m.toLowerCase() === low || m.split('/').pop()!.toLowerCase() === low);
    if (file) out.set(given, { target: given, kind: 'media' as any, path: file, title: file.split('/').pop()!, type: null, object: MEDIA[file] });
    else if (low === 'smazaná') out.set(given, { target: given, kind: 'trashed' as any, path: '.trash/Pages/Smazaná.md', title: 'Smazaná', type: 'page' });
    else rest.push(given);
  }
  for (const [k, v] of resolveIn(OBJECTS, from, rest)) out.set(k, v);
  return out;
}

/** Every vault file of the fixture plus new-empty/.tegg (README excluded), vault path → text. */
export function vaultFiles(): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (root: string, prefix: string) => {
    const go = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) go(p);
        else if (n !== 'README.md') files.set(nfc(prefix + relative(root, p)), readFileSync(p, 'utf8'));
      }
    };
    go(root);
  };
  walk(join(REPO, 'tests/fixtures/vaults/new-empty/.tegg'), '.tegg/');
  walk(FIXTURE, '');
  return files;
}

const SYSTEM = ['page', 'task', 'quick-note', 'daily-note', 'tag', 'image', 'pdf'];
const R10 = ['text', 'long-text', 'number', 'checkbox', 'date', 'date-time', 'date-range', 'select', 'multi-select', 'url', 'email', 'relation'];
const r31 = (key: string) => (['page', 'quick-note', 'daily-note'].includes(key) ? 'full' : 'card');

/** `TypeDto` (ms3-shell §14.3, ms4-embeds §3) of a type file: system types from new-empty, osoba and projekt from the
 *  previews fixture. `yml` overrides the file text (live type changes). */
export function typeDto(key: string, yml?: string): any {
  const system = SYSTEM.includes(key);
  const file = system ? join(REPO, `tests/fixtures/vaults/new-empty/.tegg/types/${key}.yml`) : join(FIXTURE, `.tegg/types/${key}.yml`);
  const y = parseYaml(yml ?? readFileSync(file, 'utf8')) as any;
  const raw = y.embed === undefined ? null : String(y.embed).trim();
  const mode = raw && ['full', 'card', 'link'].includes(raw.toLowerCase()) ? raw.toLowerCase() : r31(key);
  return {
    key, name: y.name ?? key, plural: y.plural ?? key, folder: y.folder ?? key, icon: y.icon ?? 'file-text', color: y.color ?? 'gray',
    system, invalid: false, exists: true, version: { mtimeNs: '1', size: 1, hash: '00' }, state: 'ok', error: null, declaredVersion: y.version ?? null,
    description: null, review: y.review === 'locked' ? 'locked' : y.review === true ? 'on' : 'off', preview: y.preview ?? [], previewIgnored: [],
    hidden: y.hidden ?? [], embed: mode, embedRaw: raw, template: null,
    attributes: (y.attributes ?? []).map((a: any) => ({
      key: a.key, name: a.name ?? a.key, type: a.type, supported: R10.includes(a.type),
      readOnlyReason: R10.includes(a.type) ? null : ['file', 'color', 'recurrence'].includes(a.type) ? a.type : 'unsupported',
      default: a.default ?? null, required: a.required === true,
      options: (a.options ?? []).map((o: any) => ({ label: o.label, color: o.color ?? null })),
      to: a.to ?? null, multiple: a.multiple === true, description: a.description ?? null, builtIn: system,
    })),
  };
}
export const TYPES = () => [...SYSTEM, 'osoba', 'projekt'].map((k) => typeDto(k));

/** Tag rows of `tag_objects` (ms4-tags §3) on the fixture: `účty` on Rozpočet and Odkazy, virtual `nápad` on Odkazy.
 *  Given oldest first, so the UI's own sort (modifiedNs descending, D-937) is what puts Rozpočet first. */
const row = (path: string, title: string, modified: string, ns: string, tags: string[]) =>
  ({ path, id: OBJECTS.find((o) => o.path === path)!.id, title, type: 'page', modified, modifiedNs: ns, tags, review: null, status: null, due: null, completed: null });
export const TAG_ROWS: Record<string, any[]> = {
  'účty': [row(P.odkazy, 'Odkazy', '2026-10-27T10:00:00+01:00', '1793091600000000000', ['nápad']), row(P.rozpocet, 'Rozpočet 2027', '2026-10-27T16:00:00+01:00', '1793113200000000000', [])],
  'nápad': [row(P.odkazy, 'Odkazy', '2026-10-27T10:00:00+01:00', '1793091600000000000', ['účty'])],
};

export const DEFAULT_UI_STATE = { version: 1, theme: 'system', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' }, propertiesOpen: true, typeSort: {}, otherPropertiesOpen: false };

export type Call = { cmd: string; args: any };
export type Ipc = {
  calls: Call[];
  files: Map<string, string>;
  /** Paths `embed_load` answers with state `io`, and paths answered with `utf8: false`. */
  io: Set<string>;
  invalidUtf8: Set<string>;
  uiState: any;
  /** Replaces the answer of one command. */
  on(cmd: string, f: (args: any) => unknown): void;
  count(cmd: string): number;
};

/** A fake core over the previews fixture through `mockIPC` (with event mocking): `embed_load` (ms4-embeds §4: one
 *  entry per distinct path, `missing` for absent paths, `_templates/` and `.trash/`, links resolved from each file's own
 *  path in `linkTargets` order), `tag_objects`, `vault_types`, `type_get`, `index_path_by_id`, `link_resolve`,
 *  `ui_state_get` / `ui_state_set`; every other command answers null. Every call is recorded. */
export async function installIpc(opts: { uiState?: any; files?: Record<string, string | null> } = {}): Promise<Ipc> {
  const rv = await need('../ui/src/read/ReadView.tsx', 'linkTargets');
  const linkTargets = rv.linkTargets as (t: string) => string[];
  const files = vaultFiles();
  for (const [p, t] of Object.entries(opts.files ?? {})) {
    if (t === null) files.delete(p);
    else files.set(p, t);
  }
  const over = new Map<string, (args: any) => unknown>();
  const ipc: Ipc = {
    calls: [], files, io: new Set(), invalidUtf8: new Set(), uiState: opts.uiState ?? { ...DEFAULT_UI_STATE },
    on: (cmd, f) => { over.set(cmd, f); },
    count: (cmd) => ipc.calls.filter((c) => c.cmd === cmd).length,
  };
  const embedLoad = (paths: string[]) => {
    const seen = new Set<string>();
    const out: any[] = [];
    for (const p0 of paths) {
      const p = nfc(p0);
      if (seen.has(p)) continue;
      seen.add(p);
      if (ipc.io.has(p)) { out.push({ path: p, state: 'io', text: null, version: null, utf8: true, links: [] }); continue; }
      const t = /^(_templates|\.trash)\//.test(p) ? undefined : files.get(p);
      if (t === undefined) { out.push({ path: p, state: 'missing', text: null, version: null, utf8: true, links: [] }); continue; }
      const targets = linkTargets(t);
      const res = resolvePreviews(p, targets);
      out.push({ path: p, state: 'ok', text: t, version: { mtimeNs: '1793113200000000000', size: t.length, hash: 'ab' }, utf8: !ipc.invalidUtf8.has(p), links: targets.map((x) => res.get(x)!) });
    }
    return out;
  };
  mockConvertFileSrc('macos');
  mockIPC((cmd, args: any) => {
    ipc.calls.push({ cmd, args });
    const f = over.get(cmd);
    if (f) return f(args);
    switch (cmd) {
      case 'embed_load': return embedLoad(args?.paths ?? []);
      case 'index_tags': return []; // ms4-tags §3: a list, never null
      case 'tag_objects': return TAG_ROWS[nfc(String(args?.key ?? '')).toLowerCase()] ?? [];
      case 'vault_types': return TYPES();
      case 'type_get': return TYPES().find((t) => t.key === args?.key) ?? null;
      case 'index_path_by_id': return OBJECTS.find((o) => o.id === args?.id && files.has(o.path))?.path ?? null;
      case 'link_resolve': { const m = resolvePreviews(String(args?.from ?? ''), args?.targets ?? []); return (args?.targets ?? []).map((t: string) => m.get(t)); }
      case 'ui_state_get': return ipc.uiState;
      case 'ui_state_set': ipc.uiState = args?.state; return null;
      case 'vault_current': return { name: 'Náhledy', path: '/tmp/Náhledy', placeholders: 0 };
      default: return null;
    }
  }, { shouldMockEvents: true });
  return ipc;
}
/** Clears the IPC mocks after a macrotask, so the unlisten calls of components unmounted just before (`cleanup()`) run
 *  while the event mocks still exist (clearMocks removes `unregisterListener`). */
export async function uninstallIpc() {
  await new Promise((r) => setTimeout(r, 0));
  clearMocks();
}

/** The type store the app fills (D-451: chips, embeds and previews read type names, icons and preview keys there). */
export async function setTypes(types = TYPES()) {
  const icons = await need('../ui/src/links/icons.ts', 'setChipTypes');
  icons.setChipTypes(types);
}

export type PreviewApi = {
  mode: 'click' | 'hover' | 'off';
  hoverDelay: number;
  show(target: any, anchor: any, origin: 'click' | 'hover' | 'key', host?: any, extraLine?: string): void;
  close(reason: string): void;
  current: { target: any; origin: string } | null;
};

/** Mounts `PreviewProvider` (v1-previews §3) with a probe child that holds `usePreview()` and an anchor button. */
export async function mountProvider() {
  const mod = await need('../ui/src/preview/PreviewProvider.tsx', 'PreviewProvider', 'usePreview');
  let api: PreviewApi | null = null;
  function Probe() {
    api = mod.usePreview() as PreviewApi;
    return createElement('div', null,
      createElement('p', null, 'Hlavní ', createElement('button', { type: 'button', id: 'kotva' }, 'Rozpočet 2027'), '.'),
      createElement('button', { type: 'button', id: 'jinde' }, 'Jinde'),
      createElement('div', { id: 'sloupec' }));
  }
  let error: unknown = null;
  let r: ReturnType<typeof render> | null = null;
  try {
    r = render(createElement(mod.PreviewProvider, null, createElement(Probe)));
  } catch (e) { error = e; }
  assert.equal(error, null, `PreviewProvider threw: ${String(error)}`);
  assert.ok(api, 'usePreview() returned the preview API inside the provider');
  const anchor = document.getElementById('kotva') as HTMLElement;
  return {
    r: r!,
    api: () => api as PreviewApi,
    anchor,
    elsewhere: document.getElementById('jinde') as HTMLElement,
    column: document.getElementById('sloupec') as HTMLElement,
  };
}

/** A note target (v1-previews §3 `PreviewTarget`). */
export const note = (path: string, fragment: string | null = null) => ({ path, fragment, kind: 'note' as const });

/** Calls `show` inside `act` and lets the load settle. */
export async function show(api: PreviewApi, target: any, anchor: HTMLElement, origin: 'click' | 'hover' | 'key' = 'click', host?: any, extraLine?: string) {
  await act(async () => {
    if (extraLine !== undefined) api.show(target, { el: anchor }, origin, host, extraLine);
    else if (host !== undefined) api.show(target, { el: anchor }, origin, host);
    else api.show(target, { el: anchor }, origin);
  });
  await settle();
}
/** Flushes pending promises and a few timers' worth of React work. */
export async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }
}

/** Every `dialog` whose accessible name starts with `Preview: ` (R102). */
export function previewDialogs(root: ParentNode = document): HTMLElement[] {
  return ([...root.querySelectorAll('[role="dialog"], dialog')] as HTMLElement[]).filter((d) => name(d).startsWith('Preview: '));
}
/** The one preview dialog; anything else is an assertion failure. */
export function theDialog(): HTMLElement {
  const ds = previewDialogs();
  assert.equal(ds.length, 1, `exactly one dialog named "Preview: …" (got ${ds.length})`);
  return ds[0];
}
/** Elements with an explicit or implicit role inside `root`. */
export function byRole(root: ParentNode, role: string, n?: string): HTMLElement[] {
  const implicit: Record<string, string> = { button: 'button', article: 'article', region: 'section', heading: 'h1,h2,h3,h4,h5,h6', link: 'a[href]', banner: 'header', textbox: 'input:not([type]),input[type=text],textarea', checkbox: 'input[type=checkbox]' };
  const sel = `[role="${role}"]${implicit[role] ? `, ${implicit[role]}` : ''}`;
  const all = [...root.querySelectorAll(sel)] as HTMLElement[];
  return n === undefined ? all : all.filter((e) => name(e) === n);
}
