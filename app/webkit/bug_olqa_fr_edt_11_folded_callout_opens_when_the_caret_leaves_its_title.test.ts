// Slice OL, D-1660 (QA review of the build): a callout folded in the editor opens when the selection enters its hidden content,
// so the caret or an edit never lands in hidden text. The fold stays view state only (D-159): nothing is written.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { P, caret, editorBody, eventually, must, noteRoute, original, placeCaret, seen, sleep, startOutline } from './outline-helpers';

test('d1660_a_folded_callout_opens_when_the_caret_enters_its_hidden_content', async ({ page }) => {
  const core = await startOutline(page, noteRoute(P.okraje));
  const title = await must(editorBody(page).getByText('Sbalený callout', { exact: true }), 'the folded callout\'s title');
  const expand = page.getByRole('button', { name: 'Expand Sbalený callout', exact: true });
  assert.ok(await seen(expand, 1000), 'setup: `[!tip]-` starts folded in the editor');
  await placeCaret(title, 'end');
  await sleep(100);
  assert.ok(await seen(expand, 300), 'the caret in the title keeps the callout folded');
  // WebKit's own arrow keys skip the hidden text; a caret placed there another way (a restored caret, a deletion that
  // joins into it) is what must open the callout. Put the DOM selection in the hidden `Text uvnitř.`.
  await page.evaluate(() => {
    const body = document.querySelector('[data-callout] .callout-content') as HTMLElement;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) if (n.textContent?.includes('Text uvnitř')) break;
    const sel = window.getSelection()!;
    sel.collapse(n!, 2);
    document.dispatchEvent(new Event('selectionchange'));
  });
  const collapse = page.getByRole('button', { name: 'Collapse Sbalený callout', exact: true });
  assert.ok(await seen(collapse, 1000), 'a caret in the hidden content opens the callout');
  const c = await eventually(() => caret(page), (x) => x?.block === 'Text uvnitř.');
  assert.equal(c?.block, 'Text uvnitř.', 'the caret is in the now visible text');
  await sleep(500);
  assert.equal((await core.files())[P.okraje], original(P.okraje), 'nothing is written');
  assert.deepEqual(await core.writesTo(), [], 'no write');
});
