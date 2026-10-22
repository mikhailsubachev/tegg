// Helpers for the MS3 slice 3B L1 tests (read view, docs/contracts/ms3-shell.md §11.3). Test data and module loading
// only: no AC assertions here except `need`, which turns a missing module or element into an AssertionError (TS-I1).
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const REPO = resolve(import.meta.dirname, '../..');
export const FIXTURE = join(REPO, 'tests/fixtures/vaults/read-view');

/** Fixture file text exactly as on disk (UTF-8; `Pages/Odkazy.md` keeps its NFD bytes). */
export function fixture(rel: string): string {
  return readFileSync(join(FIXTURE, rel), 'utf8');
}

export const F = {
  bloky: 'Pages/Bloky.md',
  odkazy: 'Pages/Odkazy.md',
  cil: 'Pages/Cíl.md',
  dvojnikP: 'Pages/Dvojník.md',
  dvojnikQ: 'Quick Notes/Dvojník.md',
  denni: 'Daily/2026-10-07.md',
  vlastnosti: 'Pages/Vlastnosti.md',
  jenSys: 'Pages/Jen systémové.md',
  bez: 'Pages/Bez hlavičky.md',
  uvozovky: 'Pages/Chyba uvozovky.md',
  odsazeni: 'Pages/Chyba odsazení.md',
  klic: 'Pages/Chyba klíč.md',
  tabulator: 'Pages/Chyba tabulátor.md',
  neuzavrena: 'Pages/Neuzavřená.md',
  sablona: '_templates/Page/Šablona.md',
  smazana: '.trash/Pages/Smazaná.md',
} as const;

/** Every `.md` of the fixture (vault-relative), with templates and `.trash/` (for AC-12 "each fixture note"). */
export function fixtureNotes(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith('.md')) out.push(relative(FIXTURE, p));
    }
  };
  walk(FIXTURE);
  return out.sort();
}

type Mod = Record<string, any>;
export async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}

/** Loads a module under test; a missing module or export fails an assertion (TS-I1). */
export async function need(path: string, ...exports: string[]): Promise<Mod> {
  const m = await load(path);
  assert.ok(m, `${path} is missing`);
  for (const e of exports) assert.ok(e in m, `${path} has no export ${e}`);
  return m;
}

export async function catalog() {
  const cat = await need('../ui/src/i18n/catalog.ts', 'en', 't', 'setCatalog');
  cat.setCatalog(cat.en, 'en');
  return cat;
}

export type LinkTargetDto = { target: string; kind: 'note' | 'daily' | 'date-missing' | 'unresolved' | 'trashed'; path: string | null; title: string | null; type: string | null };

/** The fixture's link resolution as the contract states it (ms3-shell §11.1 rules 1–4), for rendering tests: the
 *  real resolution is tested at the core (L4). Keys are the targets exactly as the UI asked for them. */
export function resolveOnFixture(from: string, targets: string[]): Map<string, LinkTargetDto> {
  const objs: { path: string; id: string; title: string; type: string }[] = [
    { path: F.cil, id: '01JB0R0000000000000000R001', title: 'Cíl', type: 'page' },
    { path: F.dvojnikP, id: '01JB0R0000000000000000R002', title: 'Dvojník', type: 'page' },
    { path: F.dvojnikQ, id: '01JB0R0000000000000000R003', title: 'Dvojník', type: 'quick-note' },
    { path: F.denni, id: '01JB0R0000000000000000R004', title: '2026-10-07', type: 'daily-note' },
    { path: F.odkazy, id: '01JB0R0000000000000000R005', title: 'Odkazy', type: 'page' },
    { path: F.bloky, id: '01JB0R0000000000000000R006', title: 'Bloky', type: 'page' },
    { path: F.vlastnosti, id: '01JB0R0000000000000000R007', title: 'Vlastnosti', type: 'page' },
    { path: F.jenSys, id: '01JB0R0000000000000000R008', title: 'Jen systémové', type: 'page' },
  ];
  const fromDir = from.slice(0, from.lastIndexOf('/'));
  const low = (s: string) => s.normalize('NFC').toLowerCase();
  const out = new Map<string, LinkTargetDto>();
  for (const given of targets) {
    let t = given.normalize('NFC').trim();
    const cut = t.search(/[#|]/);
    if (cut >= 0) t = t.slice(0, cut).trim();
    const k = low(t);
    const kmd = k.endsWith('.md') ? k : `${k}.md`;
    const stem = kmd.slice(0, -3);
    let hit = objs.find((o) => low(o.path) === kmd) ?? objs.find((o) => low(o.id) === k);
    if (!hit) {
      const same = objs.filter((o) => low(o.path.split('/').pop()!.slice(0, -3)) === stem);
      hit = same.find((o) => o.path.startsWith(`${fromDir}/`) && !o.path.slice(fromDir.length + 1).includes('/'))
        ?? [...same].sort((a, b) => a.path.length - b.path.length || (a.path < b.path ? -1 : 1))[0];
    }
    // D-615, D-628 (6A): the fixture's trashed note resolves as `trashed` when nothing live matches.
    const inTrash = !hit && (k === 'smazaná' || k === '.trash/pages/smazaná' || k === 'pages/smazaná');
    if (hit) out.set(given, { target: given, kind: 'note', path: hit.path, title: hit.title, type: hit.type });
    else if (inTrash) out.set(given, { target: given, kind: 'trashed', path: '.trash/Pages/Smazaná.md', title: 'Smazaná', type: 'page' });
    else if (/^\d{4}-\d{2}-\d{2}$/.test(t)) out.set(given, { target: given, kind: 'date-missing', path: null, title: null, type: null });
    else out.set(given, { target: given, kind: 'unresolved', path: null, title: null, type: null });
  }
  return out;
}

/** The generated reference vault (gen-vault --seed 1 --small-images): `TEGG_REF_VAULT`, else the copy the core tests
 *  keep in `crates/target/`, else generated there once. Returns null when it can't be produced (the test asserts). */
export async function referenceVault(): Promise<string | null> {
  if (process.env.TEGG_REF_VAULT) return process.env.TEGG_REF_VAULT;
  const dest = join(REPO, 'crates/target/tegg-ref-vault-seed1-small');
  if (existsSync(join(dest, '.tegg/vault.yml'))) return dest;
  const { execFileSync } = await import('node:child_process');
  const { renameSync, rmSync } = await import('node:fs');
  const tmp = `${dest}.tmp-vitest-${process.pid}`;
  try {
    execFileSync('cargo', ['run', '--release', '--quiet', '--manifest-path', join(REPO, 'tools/gen-vault/Cargo.toml'), '--',
      '--seed', '1', '--small-images', '--out', tmp], { stdio: 'ignore' });
    renameSync(tmp, dest);
  } catch {
    rmSync(tmp, { recursive: true, force: true });
  }
  return existsSync(join(dest, '.tegg/vault.yml')) ? dest : null;
}
