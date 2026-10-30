// QA review of slice "G3 in the panel" (NFR-OTH-02 AC-15, D-1163; docs/contracts/v1-graph.md §16.3, §17): in the List
// view only a row's title is user content. `data-user-content` on the whole `treeitem` hid its catalog strings (the
// connection phrase, `graph.connectionsCount`, the row's aria-description) from the pseudo-locale leak check, so it
// checked nothing; the same held for the canvas nodes. Their names go through `graph.a11y.name` (D-1163).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { pseudoLocale } from './helpers';
import { P, click, must } from './graph-helpers';
import { GP, VIEWPORT, openPanel, pListTree, pViewBtn } from './graph-panel-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US', viewport: VIEWPORT });

type RowText = { key: string | null; name: string; marked: boolean; meta: string[]; description: string; titleMarked: boolean };
async function rows(page: Page): Promise<RowText[]> {
  return pListTree(page).first().evaluate((t) => [...t.querySelectorAll('[role="treeitem"]')].map((e) => ({
    key: e.getAttribute('data-graph-row'),
    name: e.getAttribute('aria-label') ?? '',
    marked: e.hasAttribute('data-user-content'),
    meta: [...e.querySelectorAll(':scope > .graph-row .graph-row-meta')].map((m) => (m.textContent ?? '').replace(/^[\s·]+/, '').trim()),
    description: e.getAttribute('aria-description') ?? '',
    titleMarked: !!e.querySelector(':scope > .graph-row .graph-row-title')?.closest('[data-user-content]'),
  })));
}

test('bug_qag3p_nfr_oth_02_list_rows_checked_in_pseudo_locale', async ({ page }) => {
  await openPanel(page, P.plan, { prelude: pseudoLocale });
  await click(pViewBtn(page, 'List'), 'List');
  await must(pListTree(page), 'the panel\'s tree');
  const all = await rows(page);
  assert.ok(all.length >= 10, `Plán's rows (${all.length})`);
  assert.deepEqual(all.filter((r) => r.marked).map((r) => r.key), [], 'no treeitem is marked as user content as a whole');
  assert.deepEqual(all.filter((r) => !r.titleMarked).map((r) => r.key), [], 'each row title is user content');
  assert.ok(all.every((r) => r.meta.length > 0), 'the rows have meta texts');
  assert.deepEqual(all.flatMap((r) => r.meta).filter((m) => !/^⟦[\s\S]*⟧$/.test(m)), [], 'every row meta text is pseudo-localised');
  assert.deepEqual(all.filter((r) => !r.description.includes('⟦')).map((r) => r.key), [], 'every row description is pseudo-localised');
  assert.deepEqual(all.filter((r) => !/^⟦[\s\S]*⟧$/.test(r.name)).map((r) => r.name), [], 'every row name comes from `graph.a11y.name`');
});

test('bug_qag3p_nfr_oth_02_canvas_nodes_checked_in_pseudo_locale', async ({ page }) => {
  await openPanel(page, P.plan, { prelude: pseudoLocale });
  const nodes = await GP(page).locator('[data-graph-node]').evaluateAll((es) => es.map((e) => ({
    key: e.getAttribute('data-node-key'),
    marked: !!e.closest('[data-user-content]'),
    name: e.getAttribute('aria-label') ?? '',
    description: e.getAttribute('aria-description') ?? '',
    labels: [...e.querySelectorAll('text')].map((x) => !!x.closest('[data-user-content]')),
  })));
  assert.ok(nodes.length >= 10, `Plán's nodes (${nodes.length})`);
  assert.deepEqual(nodes.filter((n) => n.marked).map((n) => n.key), [], 'no node is marked as user content as a whole');
  assert.deepEqual(nodes.filter((n) => n.labels.length === 0 || n.labels.some((x) => !x)).map((n) => n.key), [], 'each node\'s label text is user content');
  assert.deepEqual(nodes.filter((n) => !/^⟦[\s\S]*⟧$/.test(n.name)).map((n) => n.name), [], 'every node name comes from `graph.a11y.name`');
  assert.deepEqual(nodes.filter((n) => !n.description.includes('⟦')).map((n) => n.key), [], 'every node description is pseudo-localised');
});
