// Setup for the slice I2 real-app tests (L6): docs/contracts/v1-import-window.md §8 (hooks `TEGG_TEST_PICK_FILE`,
// `TEGG_TEST_PICK_SOURCE_DIR`, `TEGG_TEST_PICK_DIR`, `TEGG_TEST_IMPORT_PACE`, `TEGG_TEST_IMPORT_FAIL`, marks
// `import-step:<step>` and `import-done`) and §9 (fixtures copied to a temporary folder, a temporary Application Support,
// vault checks by bytes, mtime and inode, keys only to Tegg, D-799). No AC assertions here except `ready`/`need` (setup
// lookups that fail as assertions, TS-I1). Synthetic fixtures only (D-62).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FX, REPO, end, marks, session, support, testEnv, tmp, tree, waitFor, type Driver, type Entry, type Env } from './capture.ts';

/** The test clock of import-capacities.md (the report is `Import report 2026-11-12 <space>.md`). */
export const NOW_I = '2026-11-12T10:00:00+01:00';
export const CAP = join(REPO, 'tests/fixtures/import/capacities');

export type ImportCtx = { base: string; vault: string; sup: string; log: string; place: string; d?: Driver; n: number };

/** A temporary copy of `target-existing-vault` with `new-empty/.tegg` copied in first (the fixture's README), named `name`. */
export function existingVault(base: string, name = 'Osobní'): string {
  const v = join(base, name);
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  cpSync(join(CAP, 'target-existing-vault'), v, { recursive: true });
  return v;
}
/** A temporary copy of one or more fixture exports in one folder `name` (c05 + c07 merge their `PKM`). */
export function exportCopy(base: string, name: string, fixtures: string[] = [name]): string {
  const to = join(base, 'zdroj', name);
  for (const f of fixtures) cpSync(join(CAP, f), to, { recursive: true });
  return to;
}
/** The folder zipped at test time (`ditto`, UTF-8 names, one wrapper folder the engine skips, v1-import §3). */
export function zipOf(dir: string): string {
  const zip = `${dir}.zip`;
  execFileSync('ditto', ['-c', '-k', '--keepParent', dir, zip]);
  return zip;
}
/** A fresh context: a vault copy (`target-existing-vault` as `Osobní`), a temporary Application Support. The new-vault
 *  place proposed by the window is the open vault's parent (D-1537), i.e. `base`. */
export function freshImport(name: string): ImportCtx {
  const base = tmp(`imp-${name}`);
  const vault = existingVault(base);
  return { base, vault, sup: support(base), log: join(base, 'perf-0.jsonl'), place: base, n: 0 };
}
export async function launchImport(c: ImportCtx, extra: Env = {}, route = 'inbox'): Promise<Driver> {
  c.n += 1;
  c.log = join(c.base, `perf-${c.n}.jsonl`);
  c.d = await session(testEnv(c.sup, c.log, { TEGG_VAULT: c.vault, TEGG_ROUTE: route, TEGG_NOW: NOW_I, ...extra }));
  assert.ok(await waitFor(() => marks(c.log).includes(`route-ready:${route}`), 20_000), `${route} shown (route-ready)`);
  return c.d;
}
export async function cleanupImport(c: ImportCtx) {
  await end(c.d);
  c.d = undefined;
  rmSync(c.base, { recursive: true, force: true });
}
/** Marks so far (to wait for the next `import-step:<s>` after an action). */
export const markCount = (c: ImportCtx) => marks(c.log).length;
/** Waits for `import-step:<s>` written after mark index `from` (§8: once per step change). */
export async function stepAfter(c: ImportCtx, s: string, from: number, ms = 10_000): Promise<boolean> {
  return waitFor(() => marks(c.log).slice(from).includes(`import-step:${s}`), ms);
}
export async function doneAfter(c: ImportCtx, from: number, ms = 60_000): Promise<boolean> {
  return waitFor(() => marks(c.log).slice(from).includes('import-done'), ms);
}
/** The vault's files and the Application Support folders an import writes to (jobs/ journals, backups/ zips). */
export function vaultTree(c: ImportCtx): Record<string, Entry> {
  return tree(c.vault);
}
export function supportTree(c: ImportCtx): Record<string, Entry> {
  const out: Record<string, Entry> = {};
  for (const sub of ['jobs', 'backups']) for (const [k, v] of Object.entries(tree(join(c.sup, sub)))) out[`${sub}/${k}`] = v;
  return out;
}
/** Entries of the new-vault place other than the vault copy, the source copies, Application Support and logs. */
export function placeEntries(c: ImportCtx): string[] {
  if (!existsSync(c.place)) return [];
  const own = new Set([relative(c.place, c.vault), 'zdroj', relative(c.place, c.sup), 'jinde', 'Projekty', 'Knihovna']);
  return readdirSync(c.place).filter((n) => !own.has(n) && !n.startsWith('perf-') && !n.endsWith('.jsonl')).sort();
}
export function ensureDir(p: string): string {
  mkdirSync(p, { recursive: true });
  return p;
}
/** The focused element's label. mac2 has no `hasKeyboardFocus` attribute in predicates; its own `amHasKeyboardInputFocus`
 *  matches the window, the web view and the focused web element, in that order, so the last match is the focused control. */
export async function focusedLabel(d: Driver): Promise<string> {
  const all = await d.$$('-ios predicate string:amHasKeyboardInputFocus == 1').catch(() => [] as any[]);
  const e = all[all.length - 1];
  if (!e || !(await e.isExisting().catch(() => false))) return '';
  return String((await e.getAttribute('label').catch(() => '')) || (await e.getAttribute('title').catch(() => '')) || '');
}
