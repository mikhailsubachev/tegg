// Test data for the slice Q L1/L2 tests (docs/acceptance/queries.md): the fixture vault as files, the test clock's
// environments (cs, en-US, the (Z) zones), the short names of the fixture table and R146 transcribed. No assertions.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const REPO = resolve(import.meta.dirname, '../..');
export const FX = resolve(REPO, 'tests/fixtures/vaults/queries');
export const QFX = resolve(REPO, 'tests/fixtures/queries-files');
export const NOW = '2026-11-10T10:00:00+01:00';
export type Env = { today: string; zone: string; weekStart: number; locale: string };
/** The test clock (a Tuesday) in Prague, region cs (week Monday–Sunday). */
export const CS: Env = { today: '2026-11-10', zone: 'Europe/Prague', weekStart: 1, locale: 'cs' };
/** (C): region en-US (week Sunday–Saturday). */
export const EN: Env = { ...CS, weekStart: 7, locale: 'en-US' };
/** (Z): the same instant in New York and Kiritimati (both still 10 Nov). */
export const NY: Env = { ...CS, zone: 'America/New_York' };
export const KI: Env = { ...CS, zone: 'Pacific/Kiritimati' };

/** The fixture vault plus `new-empty/.tegg` (README excluded), vault path → text. */
export function queriesVault(edit?: (files: Record<string, string>) => void): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (root: string, d: string, prefix: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { walk(root, p, prefix); continue; }
      const rel = (prefix + relative(root, p)).normalize('NFC');
      if (rel === 'README.md') continue;
      files[rel] = readFileSync(p, 'utf8');
    }
  };
  walk(FX, FX, '');
  const ne = resolve(REPO, 'tests/fixtures/vaults/new-empty/.tegg');
  walk(ne, ne, '.tegg/');
  edit?.(files);
  return files;
}
export const qfile = (name: string) => `.tegg/queries/${name.normalize('NFC')}.yml`;
export const expectedFile = (name: string) => readFileSync(join(QFX, 'expected', name), 'utf8');

/** The fixture's short names (queries.md "Fixture"). */
export const P = {
  porada7: 'Schůzky/2026-10-07 Týdenní porada.md', porada14: 'Schůzky/2026-10-14 Týdenní porada.md',
  t1: 'Tasks/Poslat návrh rozpočtu Janě.md', t2: 'Tasks/Zarezervovat místo v Lisabonu.md', t3: 'Tasks/Připravit program výjezdu.md',
  t4: 'Tasks/Zeptat se Jany na limit cest.md', t5: 'Tasks/Uzavřít zápis z porady.md', t6: 'Tasks/Úkol z druhé porady.md', t7: 'Tasks/Zaplatit zálohu.md',
  lisabon: 'Projekty/Výjezd Lisabon 2026.md', rozpocet: 'Projekty/Rozpočet Q4.md', cajovna: 'Projekty/Čajovna na nábřeží.md',
  cesta: 'Projekty/Cesta do Brna.md', maly: 'Projekty/Malý projekt.md', jana: 'Osoby/Jana Nováková.md', mloci: 'Knihy/Válka s mloky.md',
  krakatit: 'Knihy/Krakatit.md', dotaz: 'Quick Notes/Dotaz na rozpočet.md', den: 'Daily/2026-11-10.md', prehled: 'Pages/Přehled dotazů.md',
  bez: 'Pages/Bez hlavičky.md', sablona: '_templates/Schůzka/Schůzka.md', smazany: '.trash/Tasks/Smazaný úkol.md',
} as const;
export const TASKS = [P.t1, P.t2, P.t3, P.t4, P.t5, P.t6, P.t7];
/** FR-QRY-01 AC-1: every object outside `.trash/` and `_templates/` (21). */
export const ALL_OBJECTS = [
  P.porada7, P.porada14, ...TASKS, P.lisabon, P.rozpocet, P.cajovna, P.cesta, P.maly, P.jana, P.mloci, P.krakatit, P.dotaz, P.den, P.prehled, P.bez,
];

export type R146Row = { query: string; host: string | null; env: Env; paths: string[]; state: string; broken?: unknown[]; lookup?: string; line?: number };
/** R146's rows that run (results in order). */
export const R146: R146Row[] = [
  { query: 'Otevřené úkoly z této schůzky', host: P.porada7, env: CS, paths: [P.t1, P.t2, P.t3], state: 'ok' },
  { query: 'Otevřené úkoly z této schůzky', host: P.porada14, env: CS, paths: [P.t6], state: 'ok' },
  { query: 'Otevřené úkoly z této schůzky', host: P.sablona, env: CS, paths: [], state: 'ok' },
  { query: 'Otevřené úkoly z této schůzky', host: null, env: CS, paths: [], state: 'needsHost' },
  { query: 'Úkoly z této schůzky', host: P.porada7, env: CS, paths: [P.t5, P.t1, P.t2, P.t3, P.t4], state: 'ok' },
  { query: 'Vše, co sem odkazuje', host: P.lisabon, env: CS, paths: [P.dotaz, P.t2, P.porada7, P.bez], state: 'ok' },
  { query: 'Projekty v běhu', host: P.prehled, env: CS, paths: [P.cesta, P.cajovna, P.maly, P.lisabon], state: 'ok' },
  { query: 'Projekty v běhu', host: null, env: CS, paths: [P.cesta, P.cajovna, P.maly, P.lisabon], state: 'ok' },
  { query: 'Projekty v běhu', host: P.prehled, env: EN, paths: [P.cajovna, P.cesta, P.maly, P.lisabon], state: 'ok' },
  { query: 'Knihy s hodnocením', host: P.prehled, env: CS, paths: [P.krakatit], state: 'ok', broken: [{ reason: 'notAttribute', at: [0], key: 'hodnocení', type: 'kniha' }] },
  { query: 'Zrušené úkoly', host: P.prehled, env: CS, paths: [], state: 'ok' },
  { query: 'Úkoly po termínu', host: P.prehled, env: CS, paths: [P.t7], state: 'ok' },
  { query: 'Vytvořeno v tento den', host: P.den, env: CS, paths: [P.t7, P.krakatit, P.dotaz], state: 'ok' },
  { query: 'Vytvořeno v tento den', host: P.den, env: NY, paths: [P.dotaz], state: 'ok' },
  { query: 'Vytvořeno v tento den', host: P.den, env: KI, paths: [P.t7, P.krakatit, P.dotaz], state: 'ok' },
  { query: 'Komentáře a neznámé klíče', host: null, env: CS, paths: [P.cesta, P.cajovna, P.maly, P.lisabon], state: 'ok' },
  { query: 'Novější verze', host: null, env: CS, paths: [P.jana], state: 'ok', lookup: 'newer' },
];

/** A runtime query file in R138's create style. */
export function queryText(o: { title: string; types?: string[]; match?: 'all' | 'any'; filters?: string[]; sort?: string; limit?: number; view?: string; columns?: string[]; extra?: string[] }): string {
  return [
    `# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › ${o.title}.`, 'version: 1', `title: ${o.title}`, `types: [${(o.types ?? []).join(', ')}]`,
    `match: ${o.match ?? 'all'}`, ...(o.filters?.length ? ['filters:', ...o.filters.map((f) => `  - ${f}`)] : ['filters: []']),
    `sort: ${o.sort ?? '{ by: title, order: asc }'}`, `limit: ${o.limit ?? 50}`, `view: ${o.view ?? 'list'}`,
    `columns: [${(o.columns ?? ['modified']).join(', ')}]`, ...(o.extra ?? []), 'created: 2026-11-01T09:00:00+01:00', 'modified: 2026-11-01T09:00:00+01:00', '',
  ].join('\n');
}
