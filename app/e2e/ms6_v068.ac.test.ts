// Preview v0.68 feedback real-app test (L6, Appium mac2 on the built test app, D-382, TS-I7): docs/acceptance/tags.md
// FR-NAV-04 AC-8 (the sidebar order with the `New object` + `Search` row and the one `Tags` entry, D-759, D-761;
// "L6 once"). TEGG_TEST=1 with TEGG_NOW, a temporary Application Support and a temporary copy of the synthetic tags
// fixture (D-62). Written from the AC only (D-61). Shared helpers: app/e2e/helpers/capture.ts.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FX, appiumDown, end, marks, need, ready, session, shown, sleep, support, testEnv, tmp, type Driver } from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

const NOW4D = '2026-10-22T10:00:00+02:00';

function tagsCopy(base: string): string {
  const v = join(base, 'Štítky');
  const src = join(FX, 'tags');
  cpSync(src, v, { recursive: true, filter: (s) => relative(src, s) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  return v;
}
async function waitRoute(log: string, route: string, ms = 20_000): Promise<boolean> {
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    if (marks(log).includes(`route-ready:${route}`)) return true;
    await sleep(100);
  }
  return false;
}

test('fr_nav_04_ac8_sidebar_order_new_object_search_and_tags_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('v068-nav04ac8');
  const vault = tagsCopy(base);
  const sup = support(base);
  const log = join(base, 'perf.jsonl');
  let d: Driver | undefined;
  try {
    d = await session(testEnv(sup, log, { TEGG_VAULT: vault, TEGG_ROUTE: 'inbox', TEGG_NOW: NOW4D }));
    assert.ok(await waitRoute(log, 'inbox'), 'inbox shown');
    // Slice PIN (pinned.md FR-NAV-04 AC-9, AP-1232 = D-1375): the Pinned section sits between Tasks and the Types section.
    const order = ['New object', 'Search', 'Inbox', 'Today', 'Tasks', 'Pinned', 'Tags', 'Saved queries', 'Trash'];
    const ys: number[] = [];
    for (const label of order) {
      const e = await need(d, label, 3000);
      const r = await d.getElementRect(e.elementId);
      ys.push(r.y);
    }
    assert.ok(Math.abs(ys[0] - ys[1]) <= 2, `New object and Search share the first row (${ys[0]}, ${ys[1]})`);
    for (let i = 2; i < ys.length; i++) assert.ok(ys[i] > ys[i - 1], `${order[i]} below ${order[i - 1]} (${ys.join(', ')})`);
    for (const gone of ['Search or jump to…', 'Tags, all 10', 'All 10 ›']) assert.equal(await shown(d, gone, 500), false, `no "${gone}" in the sidebar`);
    await (await need(d, 'Tags')).click();
    assert.ok(await waitRoute(log, 'tags', 3000), 'the Tags entry opens tags');
    await (await need(d, 'Search')).click();
    assert.ok(await waitRoute(log, 'search', 3000), 'the Search button opens search');
  } finally {
    await end(d);
    rmSync(base, { recursive: true, force: true });
  }
});
