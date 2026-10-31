// Configurable type-page columns, real-app tests (L6, Appium mac2 on the built test app, D-382):
// docs/acceptance/type-columns.md FR-TYP-09 AC-30 (L6 once: a real pointer drag of `Resize Datum`), AC-32 (widths in
// Application Support survive a quit and relaunch; a second Application Support shows the R130 defaults while the
// `columns` choice of AC-20 is the same; no vault file is created, changed or moved by a resize: bytes, mtime and inode).
// BRD D-1240, D-1241, D-1248. Interface: docs/contracts/type-columns.md §2 (`UiStateDto.typeColumnWidths`), §4 (the
// `Resize <column>` separators, the Columns menu) and docs/contracts/ms3-shell.md §14.7.1 (TEGG_TEST, TEGG_APP_SUPPORT,
// TEGG_VAULT, TEGG_ROUTE, `route-ready:<route>`). Always TEGG_TEST=1 with temporary Application Support folders and a
// temporary copy of the synthetic types fixture (D-62). Written from the ACs and the contracts only (D-61).
// Widths are read as the accessibility frame of the header (points = CSS px at 100 % zoom), ± 2.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { FX, appiumDown, changedPaths, end, marks, need, press, ready, session, shown, sleep, support, testEnv, tmp, tree, waitFor, type Driver, type Env } from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

const NOW = '2026-10-14T12:00:00+02:00';
const typeRoute = (key: string) => `type/${key.normalize('NFC')}`;

/** A temp copy of tests/fixtures/vaults/types plus new-empty/.tegg (type-columns.md "Fixtures"). */
function typesCopy(base: string): string {
  const v = join(base, 'Typy');
  cpSync(join(FX, 'types'), v, { recursive: true });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  return v;
}
type Ctx = { base: string; vault: string; sup: string; log: string; d?: Driver; runs: number };
function fresh(name: string): Ctx {
  const base = tmp(`cols-${name}`);
  return { base, vault: typesCopy(base), sup: support(base), log: join(base, 'perf-0.jsonl'), runs: 0 };
}
async function waitRoute(log: string, route: string, ms = 20_000): Promise<boolean> {
  const want = `route-ready:${route.normalize('NFC')}`;
  return waitFor(() => marks(log).map((m) => m.normalize('NFC')).includes(want), ms);
}
async function launchOn(c: Ctx, route: string, sup = c.sup, extra: Env = {}): Promise<Driver> {
  await end(c.d);
  c.log = join(c.base, `perf-${c.runs++}.jsonl`);
  c.d = await session(testEnv(sup, c.log, { TEGG_VAULT: c.vault, TEGG_ROUTE: route, TEGG_NOW: NOW, ...extra }));
  assert.ok(await waitRoute(c.log, route), `${route} shown (route-ready)`);
  return c.d;
}
async function cleanup(c: Ctx) {
  await end(c.d);
  rmSync(c.base, { recursive: true, force: true });
}
const uiState = (sup: string) => (existsSync(join(sup, 'ui-state.json')) ? JSON.parse(readFileSync(join(sup, 'ui-state.json'), 'utf8')) : null);
const widthsOf = (sup: string, key: string): Record<string, number> | null => uiState(sup)?.typeColumnWidths?.[key.normalize('NFC')] ?? null;

/** The width in points of the column header labelled `name` (the first shown element with that label in a header row). */
async function headerWidth(d: Driver, name: string): Promise<number> {
  const e = await need(d, name, 5000);
  const { width } = await e.getSize();
  return width;
}
/** A real pointer drag of the element labelled `label` by `dx` points (mac2 `macos: clickAndDrag` by coordinates). */
async function dragBy(d: Driver, label: string, dx: number) {
  const e = await need(d, label, 5000);
  const { x, y } = await e.getLocation();
  const { width, height } = await e.getSize();
  const sx = Math.round(x + width / 2), sy = Math.round(y + height / 2);
  await d.execute('macos: clickAndDrag', { startX: sx, startY: sy, endX: sx + dx, endY: sy, duration: 1 });
  await sleep(400);
}
const near = (a: number, b: number, tol = 2) => Math.abs(a - b) <= tol;
const teggFiles = (vault: string) => readdirSync(join(vault, '.tegg'), { recursive: true }).map(String).sort();

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-30, AC-32

test('fr_typ_09_ac30_a_real_pointer_drag_resizes_datum_and_ac32_widths_survive_a_relaunch', { timeout: 600_000 }, async () => {
  await ready();
  const c = fresh('relaunch');
  try {
    const before = tree(c.vault);
    const tegg0 = teggFiles(c.vault);
    let d = await launchOn(c, typeRoute('schůzka'));
    assert.ok(await shown(d, 'Resize Datum', 5000), 'the separator `Resize Datum` (contract §4)');
    const w0 = await headerWidth(d, 'Datum');
    assert.ok(near(w0, 160), `Datum starts at 160 (${w0})`);
    await dragBy(d, 'Resize Datum', 100);
    const w1 = await headerWidth(d, 'Datum');
    assert.ok(near(w1, 260), `AC-30: a real drag of 100 px makes Datum 260 wide (${w1})`);
    assert.ok(await waitFor(() => widthsOf(c.sup, 'schůzka')?.datum === 260, 2000), `ui-state.json: typeColumnWidths.schůzka.datum 260 (${JSON.stringify(uiState(c.sup)?.typeColumnWidths)})`);
    d = await launchOn(c, typeRoute('nápad'));
    await (await need(d, 'Resize Hodnocení', 5000)).click();
    for (let i = 0; i < 4; i++) press('right');
    assert.ok(await waitFor(() => widthsOf(c.sup, 'nápad')?.['hodnocení'] === 200, 1500), 'Hodnocení 200 by keyboard, stored within 1 s');
    await end(c.d);
    c.d = undefined;
    d = await launchOn(c, typeRoute('schůzka'));
    assert.ok(near(await headerWidth(d, 'Datum'), 260), 'after quitting and relaunching: Datum 260');
    d = await launchOn(c, typeRoute('nápad'));
    assert.ok(near(await headerWidth(d, 'Hodnocení'), 200), 'and Hodnocení 200');
    d = await launchOn(c, typeRoute('projekt'));
    assert.ok(near(await headerWidth(d, 'Stav'), 160), 'type/projekt shows the R130 default');
    await end(c.d);
    c.d = undefined;
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'no vault file is created, changed or moved (bytes, mtime, inode)');
    assert.deepEqual(teggFiles(c.vault), tegg0, 'no new file under .tegg/');
  } finally { await cleanup(c); }
});

test('fr_typ_09_ac32_a_second_application_support_shows_defaults_with_the_same_columns', { timeout: 600_000 }, async () => {
  await ready();
  const c = fresh('second');
  try {
    let d = await launchOn(c, typeRoute('schůzka'));
    await (await need(d, 'Columns', 5000)).click();
    await (await need(d, 'Místo', 3000)).click();
    const yml = join(c.vault, '.tegg/types/schůzka.yml');
    assert.ok(await waitFor(() => readFileSync(yml, 'utf8').includes('columns: [datum, účastníci, modified, místo]\n'), 3000), 'AC-20: checking Místo writes columns');
    press('escape');
    await dragBy(d, 'Resize Datum', 100);
    assert.ok(await waitFor(() => widthsOf(c.sup, 'schůzka')?.datum === 260, 2000), 'machine A: Datum 260 stored');
    await end(c.d);
    c.d = undefined;
    const other = support(c.base, { name: 'support-b' });
    d = await launchOn(c, typeRoute('schůzka'), other);
    assert.ok(await shown(d, 'Místo', 5000), 'machine B: the same columns (Místo is a column, from the vault)');
    assert.ok(near(await headerWidth(d, 'Datum'), 160), 'machine B: Datum at the R130 default 160');
    assert.equal(widthsOf(other, 'schůzka')?.datum ?? null, null, 'machine B has no width for Datum');
  } finally { await cleanup(c); }
});
