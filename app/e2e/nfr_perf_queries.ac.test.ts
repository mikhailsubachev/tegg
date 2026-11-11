// Slice Q latency criteria, L6 timing (docs/acceptance/queries.md § NFR-PERF; docs/contracts/v1-queries.md §5, §6.1):
// - NFR-PERF-05 AC-5: on the reference vault (tools/gen-vault --seed 1 --small-images), a runtime 2,000-word note with
//   five reference blocks (List and Table, 10…200 results each) reaches `note-ready` within 112 ms p95 and its blocks show
//   their first rows within 225 ms p95 of opening (20 cold launches with TEGG_ROUTE=note/<path>, `− ui-ready`).
// - NFR-PERF-07 AC-2: `query/<name>` of a query with 1,000 results in Table view paints its visible rows
//   (`route-ready:query/<name>`) within 225 ms p95 of navigation (20 cold launches, `− ui-ready`). The `query_run` count and
//   the 60 fps scroll are checked at L5 / the L4 benchmark (FR-QRY-05 AC-9).
// - NFR-PERF-08 AC-2: on the slice Q fixture, a file changed by another process (helpers/external.ts) is reflected in a
//   visible block's results within 1.5 s p95 (20 changes, measured from the helper's write to the row appearing or going in
//   the macOS accessibility tree; the polling only adds to the time).
// Report-only until the v1.0 release gate (D-152 rule), enforced there with TEGG_PERF_REF=1 (VERIFY_GATE=release); every
// run must still reach its marks and rows, so the tests are red until the slice exists. Red-test point: the mark
// `query-ready` (written once, when every query block of the opened note has painted its first rows) isn't named by the
// contract; this file proposes it. Synthetic data only, never the owner's vault or Application Support (D-62). Written from
// the ACs and the contract only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { EXE, generateVault, p95, readMarks, tagNotes } from './perf_tag_page.ts';
import { FX, appiumDown, end, marks, session, sleep, support, testEnv, textContains, waitFor, type Driver } from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

const RUNS = 20;
const enforce = process.env.TEGG_PERF_REF === '1' && process.env.VERIFY_GATE === 'release';
const NOW_Q = '2026-11-10T10:00:00+01:00';
const EXTERNAL = resolve(import.meta.dirname, 'helpers/external.ts');

/** A query file over the objects tagged `tag` (R138 keys; tags match frontmatter and inline `#tags`, R139). */
function queryFile(title: string, tag: string, view: 'list' | 'table', limit: number): string {
  return `version: 1\ntitle: ${title}\ntypes: []\nmatch: all\nfilters:\n  - tags: { has_any_of: [${tag}] }\nsort: { by: title, order: asc }\nlimit: ${limit}\nview: ${view}\n` +
    'created: 2026-11-01T09:00:00+01:00\nmodified: 2026-11-01T09:00:00+01:00\n';
}
const WORDS = ['rozpočet', 'porada', 'výjezd', 'úkol', 'žluťoučký', 'kůň', 'čajovna', 'nábřeží', 'přehled', 'řeka', 'šablona', 'ďábel'];
/** About 2,000 words of Czech text with the five reference fences spread through it. */
function hostNote(names: string[]): string {
  const parts: string[] = [];
  let w = 0;
  for (let p = 0; p < 40; p++) {
    const words: string[] = [];
    for (let i = 0; i < 50; i++) words.push(WORDS[(w++ * 7 + p) % WORDS.length]);
    parts.push(`${words.join(' ')}.`);
    if (p % 8 === 3) parts.push(`\`\`\`query\nsaved: ${names[Math.floor(p / 8)]}\n\`\`\``);
  }
  return `---\nid: 01JBPERFQ00000000000000001\ntype: page\ntitle: Výkon dotazů\n---\n${parts.join('\n\n')}\n`;
}
async function coldRun(vault: string, sup: string, log: string, route: string, want: string[], timeoutMs = 60_000): Promise<Record<string, number | null>> {
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith('TEGG_')) delete clean[k];
  const child = spawn(EXE, [], { env: { ...clean, TEGG_TEST: '1', TEGG_APP_SUPPORT: sup, TEGG_VAULT: vault, TEGG_ROUTE: route, TEGG_PERF_LOG: log, TEGG_NOW: NOW_Q }, stdio: 'ignore' });
  const endAt = Date.now() + timeoutMs;
  const has = () => { const m = readMarks(log).map((x) => String(x.mark).normalize('NFC')); return want.every((w) => m.includes(w)); };
  while (Date.now() < endAt && !has() && child.exitCode === null) await sleep(50);
  if (child.exitCode === null) child.kill('SIGKILL');
  await sleep(200);
  const m = readMarks(log);
  const ui = m.find((x) => x.mark === 'ui-ready')?.ms;
  const out: Record<string, number | null> = {};
  for (const w of want) {
    const at = m.find((x) => String(x.mark).normalize('NFC') === w)?.ms;
    out[w] = ui !== undefined && at !== undefined ? at - ui : null;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ NFR-PERF-05 AC-5

test('nfr_perf_05_ac5_note_with_query_blocks', { timeout: 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const base = mkdtempSync(join(tmpdir(), 'tegg-nfr-perf-05-ac5-'));
  try {
    const vault = generateVault(join(base, 'ref'));
    assert.ok(vault, 'the reference vault (tools/gen-vault --seed 1 --small-images)');
    const sizes = [10, 50, 100, 150, 200];
    const names = sizes.map((n) => `Výkon ${n}`);
    mkdirSync(join(vault!, '.tegg/queries'), { recursive: true });
    sizes.forEach((n, i) => {
      assert.equal(tagNotes(vault!, n, `vykon-${n}`).length, n, `setup: ${n} objects tagged vykon-${n}`);
      writeFileSync(join(vault!, '.tegg/queries', `${names[i]}.yml`), queryFile(names[i], `vykon-${n}`, i % 2 ? 'table' : 'list', 200));
    });
    mkdirSync(join(vault!, 'Pages'), { recursive: true });
    const host = 'Pages/Výkon dotazů.md';
    const text = hostNote(names);
    writeFileSync(join(vault!, host), text);
    const words = text.replace(/^---\n[\s\S]*?\n---\n/, '').split(/\s+/).filter((x) => x && !x.startsWith('```') && !x.startsWith('saved:')).length;
    assert.ok(words >= 2000, `setup: the host note has ${words} words`);
    const notes: number[] = [], blocks: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const r = await coldRun(vault!, join(base, `support-${i}`), join(base, `perf-${i}.jsonl`), `note/${host}`, ['note-ready', 'query-ready']);
      assert.ok(r['note-ready'] !== null, `run ${i}: note-ready`);
      assert.ok(r['query-ready'] !== null, `run ${i}: query-ready (the five blocks painted their first rows)`);
      notes.push(r['note-ready']!);
      blocks.push(r['query-ready']!);
    }
    console.log(`NFR-PERF-05 AC-5: note-ready p95 ${p95(notes).toFixed(1)} ms (target < 112), blocks' first rows p95 ${p95(blocks).toFixed(1)} ms (target < 225)`);
    if (enforce) {
      assert.ok(p95(notes) < 112, `note-ready p95 ${p95(notes).toFixed(1)} ms ≥ 112 ms`);
      assert.ok(p95(blocks) < 225, `query-ready p95 ${p95(blocks).toFixed(1)} ms ≥ 225 ms`);
    } else console.log('NFR-PERF-05 AC-5: reported only (D-152 rule; enforced with TEGG_PERF_REF=1 at the v1.0 release gate)');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------------------------------------ NFR-PERF-07 AC-2

test('nfr_perf_07_ac2_query_view_1000_results', { timeout: 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const base = mkdtempSync(join(tmpdir(), 'tegg-nfr-perf-07-ac2-'));
  try {
    const vault = generateVault(join(base, 'ref'));
    assert.ok(vault, 'the reference vault (tools/gen-vault --seed 1 --small-images)');
    assert.equal(tagNotes(vault!, 1000, 'tisic').length, 1000, 'setup: 1,000 objects tagged tisic');
    mkdirSync(join(vault!, '.tegg/queries'), { recursive: true });
    writeFileSync(join(vault!, '.tegg/queries/Tisíc výsledků.yml'), queryFile('Tisíc výsledků', 'tisic', 'table', 1000));
    const route = 'query/Tisíc výsledků';
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const r = await coldRun(vault!, join(base, `support-${i}`), join(base, `perf-${i}.jsonl`), route, [`route-ready:${route}`]);
      assert.ok(r[`route-ready:${route}`] !== null, `run ${i}: route-ready:${route}`);
      times.push(r[`route-ready:${route}`]!);
    }
    console.log(`NFR-PERF-07 AC-2: query page of 1,000 results, visible rows p95 ${p95(times).toFixed(1)} ms (target < 225)`);
    if (enforce) assert.ok(p95(times) < 225, `p95 ${p95(times).toFixed(1)} ms ≥ 225 ms`);
    else console.log('NFR-PERF-07 AC-2: reported only (D-152 rule; enforced with TEGG_PERF_REF=1 at the v1.0 release gate)');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------------------------------------ NFR-PERF-08 AC-2

async function rowShown(d: Driver, block: string, title: string): Promise<boolean> {
  for (const b of await d.$$(`-ios predicate string:label BEGINSWITH "Query: ${block}"`).catch(() => [] as any[])) {
    if (!(await b.isDisplayed().catch(() => false))) continue;
    for (const e of await b.$$(`-ios predicate string:${textContains(title)}`).catch(() => [] as any[])) if (await e.isDisplayed().catch(() => false)) return true;
  }
  return false;
}

test('nfr_perf_08_ac2_external_change_in_query_block', { timeout: 30 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const base = mkdtempSync(join(tmpdir(), 'tegg-nfr-perf-08-ac2-'));
  const vault = join(base, 'Dotazy');
  const src = join(FX, 'queries');
  cpSync(src, vault, { recursive: true, filter: (s) => relative(src, s) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(vault, '.tegg'), { recursive: true });
  const T4 = 'Tasks/Zeptat se Jany na limit cest.md';
  const t4 = readFileSync(join(vault, T4), 'utf8');
  const withDue = t4.replace('priority: Low\n', 'priority: Low\ndue: 2026-11-20\n');
  const log = join(base, 'perf.jsonl');
  let d: Driver | undefined;
  try {
    const route = 'note/Schůzky/2026-10-07 Týdenní porada.md';
    d = await session(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: route, TEGG_NOW: NOW_Q }));
    assert.ok(await waitFor(() => marks(log).map((m) => m.normalize('NFC')).includes(`route-ready:${route.normalize('NFC')}`), 20_000), 'Porada 7 shown');
    assert.ok(await waitFor(() => rowShown(d!, 'Otevřené úkoly z této schůzky', 'Poslat návrh rozpočtu Janě'), 8000), 'the block lists T1');
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const add = i % 2 === 0;
      const f = join(base, `ext-${i}.md`);
      writeFileSync(f, add ? withDue : t4);
      const t0 = Date.now();
      execFileSync(process.execPath, [EXTERNAL, 'write', join(vault, T4), f]);
      const ok = await waitFor(async () => (await rowShown(d!, 'Otevřené úkoly z této schůzky', 'Zeptat se Jany na limit cest')) === add, 10_000);
      assert.ok(ok, `change ${i}: T4 ${add ? 'appears in' : 'leaves'} the block`);
      times.push(Date.now() - t0);
      await sleep(500);
    }
    console.log(`NFR-PERF-08 AC-2: external change in a visible block p95 ${p95(times).toFixed(0)} ms (target < 1500)`);
    if (enforce) assert.ok(p95(times) < 1500, `p95 ${p95(times).toFixed(0)} ms ≥ 1500 ms`);
    else console.log('NFR-PERF-08 AC-2: reported only (D-152 rule; enforced with TEGG_PERF_REF=1 at the v1.0 release gate)');
  } finally {
    await end(d);
    rmSync(base, { recursive: true, force: true });
  }
});
