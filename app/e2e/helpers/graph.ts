// Shared helpers of the local-graph real-app tests from slice G2 on (L6, Appium mac2 on the built test app): a temporary
// copy of the synthetic graph fixture (tests/fixtures/vaults/graph, its runtime attachments and optionally the hub of
// make-hub.mjs), a temporary Application Support with a seeded `ui-state.json`, launching on a route, the external
// helper of ms3-shell §13.6, and readers of the machine-local graph state (docs/contracts/v1-graph.md §5, §15.3).
// Synthetic data only (D-62). No assertions about AC outcomes here except the launch's `route-ready` check.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { writeHub } from '../../../tests/fixtures/vaults/graph/make-hub.mjs';
import { FX, end, marks, session, sleep, support, testEnv, textContains, tmp, waitFor, type Driver, type Env } from './capture.ts';

/** The graph test clock (graph.md, graph-panel.md). */
export const NOW_GRAPH = '2026-10-28T10:00:00+01:00';
export const PLAN = 'Pages/Plán čtvrtletí.md';
const EXTERNAL = resolve(import.meta.dirname, 'external.ts');
export const noteRoute = (p: string) => `note/${p.normalize('NFC')}`;
export const graphRoute = (p: string) => `graph/${p.normalize('NFC')}`;

/** A temp copy of tests/fixtures/vaults/graph (without README.md and make-hub.*) plus new-empty/.tegg and the README's
 *  runtime attachments; `hub` writes the hub. */
export function graphCopy(base: string, o: { hub?: boolean; name?: string } = {}): string {
  const v = join(base, o.name ?? 'Graf');
  const src = join(FX, 'graph');
  cpSync(src, v, { recursive: true, filter: (s) => { const r = relative(src, s); return r !== 'README.md' && !r.startsWith('make-hub.'); } });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  mkdirSync(join(v, '_attachments'), { recursive: true });
  cpSync(join(FX, 'trash-media/_attachments/záhon.png'), join(v, '_attachments/graf.png'));
  cpSync(join(FX, 'trash-media/_attachments/Rozpočet.pdf'), join(v, '_attachments/Smlouva.pdf'));
  if (o.hub) writeHub(v);
  return v;
}

export type GraphCtx = { base: string; vault: string; sup: string; log: string; d?: Driver; runs: number };
/** A fresh temp base with a vault copy and an Application Support whose `ui-state.json` has the panel open on `tab`. */
export function freshGraph(name: string, o: { hub?: boolean; tab?: 'graph' | 'backlinks'; open?: boolean; ui?: Record<string, unknown> } = {}): GraphCtx {
  const base = tmp(`g2-${name}`);
  const vault = graphCopy(base, o);
  const sup = support(base, { ui: { rightPanel: { open: o.open ?? true, tab: o.tab ?? 'graph' }, ...(o.ui ?? {}) } });
  return { base, vault, sup, log: join(base, 'perf-0.jsonl'), runs: 0 };
}
export async function waitRoute(log: string, route: string, ms = 20_000): Promise<boolean> {
  const want = `route-ready:${route.normalize('NFC')}`;
  return waitFor(() => marks(log).map((m) => m.normalize('NFC')).includes(want), ms);
}
/** Launches the app on `route` (a new perf log per launch) and waits for `route-ready`. */
export async function launchOn(c: GraphCtx, route: string, extra: Env = {}): Promise<Driver> {
  await end(c.d);
  c.log = join(c.base, `perf-${c.runs++}.jsonl`);
  c.d = await session(testEnv(c.sup, c.log, { TEGG_VAULT: c.vault, TEGG_ROUTE: route, TEGG_NOW: NOW_GRAPH, ...extra }));
  assert.ok(await waitRoute(c.log, route), `${route} shown (route-ready)`);
  return c.d;
}
export async function quit(c: GraphCtx) {
  await end(c.d);
  c.d = undefined;
}
export async function cleanupGraph(c: GraphCtx) {
  await end(c.d);
  rmSync(c.base, { recursive: true, force: true });
}
export function external(...args: string[]) {
  execFileSync(process.execPath, [EXTERNAL, ...args], { encoding: 'utf8' });
}
export function externalWrite(path: string, text: string) {
  const f = join(tmpdir(), `tegg-graph-ext-${process.pid}-${Date.now()}.md`);
  writeFileSync(f, text);
  external('write', path, f);
  rmSync(f, { force: true });
}
/** Some element's text contains `text` within `ms`. */
export async function textShown(d: Driver, text: string, ms = 3000): Promise<boolean> {
  return waitFor(async () => {
    for (const e of await d.$$(`-ios predicate string:${textContains(text)}`).catch(() => [] as any[])) if (await e.isDisplayed().catch(() => false)) return true;
    return false;
  }, ms);
}
/** A control inside the group named `group` whose name starts with `prefix` (a type row is `<Plural> <count>`). */
export async function needStarting(d: Driver, group: string, prefix: string, ms = 3000): Promise<any> {
  const g = group.replace(/"/g, '\\"'), p = prefix.replace(/"/g, '\\"');
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    for (const box of await d.$$(`-ios predicate string:label ==[c] "${g}"`).catch(() => [] as any[])) {
      for (const e of await box.$$(`-ios predicate string:label BEGINSWITH "${p}" OR title BEGINSWITH "${p}"`).catch(() => [] as any[])) {
        if (await e.isDisplayed().catch(() => false)) return e;
      }
    }
    await sleep(100);
  }
  assert.fail(`a control starting "${prefix}" in the group "${group}" is shown`);
}
export const uiStateOf = (sup: string) => (existsSync(join(sup, 'ui-state.json')) ? JSON.parse(readFileSync(join(sup, 'ui-state.json'), 'utf8')) : null);
export const graphStateOf = (sup: string, vault: string, view: 'full' | 'panel') => uiStateOf(sup)?.vaults?.[vault.normalize('NFC')]?.graph?.[view] ?? null;
