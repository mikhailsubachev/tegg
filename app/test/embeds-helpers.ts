// Helpers for the MS4 slice 4F L1/L2 tests (docs/contracts/ms4-embeds.md §5, §6). Test data and module loading only:
// no AC assertions here except `need` (from read-helpers), which turns a missing module or export into an
// AssertionError (TS-I1). The link resolution and the type list below are transcriptions of the contract rules
// (ms3-shell §11.1, ms4-embeds §3 / R31) over the synthetic fixture, as the note page would pass them in; the real
// resolution and type reading are tested at the core (L4).
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { need } from './read-helpers';

export const REPO = resolve(import.meta.dirname, '../..');
export const FIXTURE = join(REPO, 'tests/fixtures/vaults/embeds');
export const NFD_CIL = 'Cíl';
export const NFD_UVOD = 'Úvod';

/** Fixture file text exactly as on disk (`Pages/NFD vložení.md` keeps its NFD bytes). */
export function fixture(rel: string): string {
  return readFileSync(join(FIXTURE, rel), 'utf8');
}

export type LinkTargetDto = { target: string; kind: 'note' | 'daily' | 'date-missing' | 'unresolved'; path: string | null; title: string | null; type: string | null };
export type EmbedNoteDto = { path: string; state: 'ok' | 'missing' | 'io'; text: string | null; version: unknown; utf8: boolean; links: LinkTargetDto[] };

/** The objects of the fixture (README table): path, id, title, type (null: no or invalid frontmatter). */
export const OBJECTS: { path: string; id: string | null; title: string; type: string | null }[] = [
  ['Pages/Cíl.md', 'E001', 'Cíl', 'page'], ['Pages/Režimy.md', 'E002', 'Režimy', 'page'], ['Pages/Sekce.md', 'E003', 'Sekce', 'page'],
  ['Pages/Rozbitá vložení.md', 'E004', 'Rozbitá vložení', 'page'], ['Pages/Uvnitř textu.md', 'E005', 'Uvnitř textu', 'page'],
  ['Pages/NFD vložení.md', 'E006', 'NFD vložení', 'page'], ['Pages/Kruh A.md', 'E007', 'Kruh A', 'page'], ['Pages/Kruh B.md', 'E008', 'Kruh B', 'page'],
  ['Pages/Sama sebe.md', 'E009', 'Sama sebe', 'page'], ['Pages/Obsah.md', 'E010', 'Obsah', 'page'], ['Pages/Karta sebe.md', 'E011', 'Karta sebe', 'page'],
  ['Pages/Řetěz 1.md', 'E012', 'Řetěz 1', 'page'], ['Pages/Řetěz 2.md', 'E013', 'Řetěz 2', 'page'], ['Pages/Řetěz 3.md', 'E014', 'Řetěz 3', 'page'],
  ['Pages/Řetěz 4.md', 'E015', 'Řetěz 4', 'page'], ['Pages/Řetěz 5.md', 'E016', 'Řetěz 5', 'page'], ['Pages/Kosočtverec.md', 'E017', 'Kosočtverec', 'page'],
  ['Pages/Větev 1.md', 'E018', 'Větev 1', 'page'], ['Pages/Větev 2.md', 'E019', 'Větev 2', 'page'], ['Pages/List.md', 'E020', 'List', 'page'],
  ['Pages/Úpravy.md', 'E021', 'Úpravy', 'page'], ['Pages/Upravitelná.md', 'E022', 'Upravitelná', 'page'], ['Pages/Bez hlavičky.md', null, 'Bez hlavičky', null],
  ['Pages/Chyba hlavičky.md', 'E024', 'Chyba hlavičky', null], ['Pages/Vkládání.md', 'E025', 'Vkládání', 'page'],
  ['Osoby/Jana Nováková.md', 'E027', 'Jana Nováková', 'osoba'], ['Osoby/Šárka Malá.md', 'E028', 'Šárka Malá', 'osoba'],
  ['Recepty/Svíčková.md', 'E029', 'Svíčková', 'recept'], ['Knihy/Saturnin.md', 'E030', 'Saturnin', 'kniha'],
  ['Tasks/Zavolat Janě.md', 'E031', 'Zavolat Janě', 'task'], ['Místa/Praha.md', 'E032', 'Praha', 'místo'],
  ['Daily/2026-10-07.md', 'E033', '2026-10-07', 'daily-note'], ['Pages/Dvojník.md', 'E034', 'Dvojník', 'page'],
  ['Quick Notes/Dvojník.md', 'E035', 'Rychlý dvojník', 'quick-note'], ['Quick Notes/Vložení dvojníka.md', 'E036', 'Vložení dvojníka', 'quick-note'],
  ['Pages/Senior Product Manager.md', 'E037', 'Senior Product Manager', 'page'], ['Pages/Senior Product Manager (2).md', 'E038', 'Senior Product Manager', 'page'],
  ['Pages/C tips.md', 'E039', 'C# tips', 'page'],
].map(([path, id, title, type]) => ({ path: path as string, id: id ? `01JB4F0000000000000000${id}` : null, title: title as string, type: type as string | null }));

type Obj = { path: string; id: string | null; title: string; type: string | null };

/** ms3-shell §11.1 over a set of objects: path, id, stem (same folder first, else the shortest path), then a date. */
export function resolveIn(objs: Obj[], from: string, targets: string[]): Map<string, LinkTargetDto> {
  const fromDir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
  const low = (s: string) => s.normalize('NFC').toLowerCase();
  const out = new Map<string, LinkTargetDto>();
  for (const given of targets) {
    let t = given.normalize('NFC').trim();
    const cut = t.search(/[#|]/);
    if (cut >= 0) t = t.slice(0, cut).trim();
    const k = low(t);
    const kmd = k.endsWith('.md') ? k : `${k}.md`;
    const stem = kmd.slice(0, -3);
    let hit = objs.find((o) => low(o.path) === kmd) ?? objs.find((o) => o.id !== null && low(o.id) === k);
    if (!hit && /^\d{4}-\d{2}-\d{2}$/.test(t)) {
      hit = objs.find((o) => o.type === 'daily-note' && low(o.path) === `daily/${k}.md`);
      out.set(given, hit ? { target: given, kind: 'daily', path: hit.path, title: hit.title, type: hit.type } : { target: given, kind: 'date-missing', path: null, title: null, type: null });
      continue;
    }
    if (!hit) {
      const same = objs.filter((o) => low(o.path.split('/').pop()!.slice(0, -3)) === stem);
      hit = same.find((o) => (o.path.includes('/') ? o.path.slice(0, o.path.lastIndexOf('/')) : '') === fromDir)
        ?? [...same].sort((a, b) => a.path.length - b.path.length || (a.path < b.path ? -1 : 1))[0];
    }
    out.set(given, hit ? { target: given, kind: 'note', path: hit.path, title: hit.title, type: hit.type } : { target: given, kind: 'unresolved', path: null, title: null, type: null });
  }
  return out;
}
export const resolveOnEmbeds = (from: string, targets: string[]) => resolveIn(OBJECTS, from, targets);

/** `linkTargets` of the read view (ms3-shell §11.3): the targets a note page resolves in its one batch call. */
export async function linkTargetsOf(): Promise<(text: string) => string[]> {
  const rv = await need('../ui/src/read/ReadView.tsx', 'linkTargets');
  return rv.linkTargets as (text: string) => string[];
}

/** The host argument of `buildEmbedTree`: the open note with its `link_resolve` result (keys as asked, and NFC). */
export async function hostOf(path: string, text: string, resolver: (from: string, t: string[]) => Map<string, LinkTargetDto> = resolveOnEmbeds) {
  const lt = await linkTargetsOf();
  const targets = lt(text);
  return { path, text, links: resolver(path, [...targets, ...targets.map((t) => t.normalize('NFC'))]) };
}

/** An in-memory `embed_load` (ms4-embeds §4): one entry per distinct path, first-seen order; `missing` for absent
 *  paths and for `_templates/` / `.trash/`; each file's links resolved from its own path. Records every call. */
export async function memLoader(files: Map<string, string>, objs: Obj[]) {
  const lt = await linkTargetsOf();
  const calls: string[][] = [];
  const load = async (paths: string[]): Promise<EmbedNoteDto[]> => {
    calls.push([...paths]);
    const seen = new Set<string>();
    const out: EmbedNoteDto[] = [];
    for (const p0 of paths) {
      const p = p0.normalize('NFC');
      if (seen.has(p)) continue;
      seen.add(p);
      const text = /^(_templates|\.trash)\//.test(p) ? undefined : files.get(p);
      if (text === undefined) {
        out.push({ path: p, state: 'missing', text: null, version: null, utf8: true, links: [] });
        continue;
      }
      const targets = lt(text);
      const res = resolveIn(objs, p, targets);
      out.push({ path: p, state: 'ok', text, version: { mtimeNs: '1', size: text.length, hash: 'ab' }, utf8: true, links: targets.map((t) => res.get(t)!) });
    }
    return out;
  };
  return { load, calls };
}
/** `memLoader` over the fixture files. */
export async function fixtureLoader(overrides: Record<string, string | null> = {}) {
  const files = new Map<string, string>();
  for (const o of OBJECTS) {
    if (existsSync(join(FIXTURE, o.path))) files.set(o.path, fixture(o.path));
  }
  for (const [p, t] of Object.entries(overrides)) {
    if (t === null) files.delete(p);
    else files.set(p, t);
  }
  return memLoader(files, OBJECTS);
}

const SYSTEM = ['page', 'task', 'quick-note', 'daily-note', 'tag', 'image', 'pdf'];
const R10 = ['text', 'long-text', 'number', 'checkbox', 'date', 'date-time', 'date-range', 'select', 'multi-select', 'url', 'email', 'relation'];
/** R31 of embeds.md: the built-in default embed mode of a type key. */
export const r31 = (key: string) => (['page', 'quick-note', 'daily-note'].includes(key) ? 'full' : 'card');

/** `TypeDto` (ms3-shell §14.3 plus ms4-embeds §3) of a type file: system types from new-empty, user types from the
 *  embeds fixture. `embed` is the effective mode (D-417), `embedRaw` the raw value. */
export function typeDto(key: string): any {
  const system = SYSTEM.includes(key);
  const file = system ? join(REPO, `tests/fixtures/vaults/new-empty/.tegg/types/${key}.yml`) : join(FIXTURE, `.tegg/types/${key}.yml`);
  const y = parseYaml(readFileSync(file, 'utf8')) as any;
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
/** Every type of the embeds vault (7 system types + osoba, recept, kniha, místo). */
export const TYPES = () => [...SYSTEM, 'osoba', 'recept', 'kniha', 'místo'].map(typeDto);

/** Loads `app/ui/src/embeds/tree.ts`; a missing export fails an assertion. */
export async function treeModule() {
  return need('../ui/src/embeds/tree.ts', 'buildEmbedTree', 'embedModeFor');
}

/** Flattens a tree to `[depth, value, mode, state]` rows in document order. */
export function rows(nodes: any[]): [number, string, string, string][] {
  const out: [number, string, string, string][] = [];
  const walk = (ns: any[]) => {
    for (const n of ns) {
      out.push([n.depth, String(n.value).normalize('NFC'), n.mode, n.state]);
      walk(n.children ?? []);
    }
  };
  walk(nodes);
  return out;
}
