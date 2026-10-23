// MS4 slice 4D-lite L5 (WebKit, fake core): the sidebar order with the Tags section (docs/acceptance/tags.md FR-NAV-04
// AC-8, R83; changes trash-media FR-NAV-04 AC-6): `Search or jump to…`, `New object`, `Inbox`, `Today`, `Tasks`, the
// Types section, the Tags section, `Pinned`, `Saved queries`, `Trash`; no bottom `Tags` entry; Tag types and Tag files
// never in the Types list (D-121). Written from the AC and the contract only (D-61).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { must, sidebar, sidebarTagsHeader, startTags } from './tags-helpers';

test('fr_nav_04_ac8_sidebar_order_with_the_tags_section', async ({ page }) => {
  await startTags(page, { route: 'inbox' });
  await must(sidebarTagsHeader(page), 'the Tags section header "Tags, all 10"', 5000);
  const order = await sidebar(page).evaluate((nav) => {
    const out: string[] = [];
    const walk = (el: Element) => {
      for (const c of [...el.children]) {
        const label = (c.getAttribute('aria-label') ?? '').trim();
        const role = c.getAttribute('role') ?? c.tagName.toLowerCase();
        if (/^Tags, all \d+$/.test(label)) { out.push('Tags section'); continue; }
        if ((role === 'list' || role === 'ul') && label === 'Types') { out.push('Types'); continue; }
        if (['a', 'button', 'link'].includes(role) || c.getAttribute('role') === 'button' || c.getAttribute('role') === 'link') {
          const t = (label || (c.textContent ?? '')).replace(/\s+/g, ' ').trim();
          for (const n of ['Search or jump to…', 'New object', 'Inbox', 'Today', 'Tasks', 'Pinned', 'Saved queries', 'Trash', 'Tags']) if (t === n || t.startsWith(`${n} `)) { out.push(n); break; }
          continue;
        }
        walk(c);
      }
    };
    walk(nav);
    return out.filter((x, i) => out.indexOf(x) === i);
  });
  assert.deepEqual(order, ['Search or jump to…', 'New object', 'Inbox', 'Today', 'Tasks', 'Types', 'Tags section', 'Pinned', 'Saved queries', 'Trash'], 'FR-NAV-04 AC-8 order; no separate bottom Tags entry');
  const types = await sidebar(page).getByRole('list', { name: 'Types', exact: true }).innerText();
  assert.ok(!/\bTags\b/.test(types), 'the Tag type is not in the Types list (D-121)');
  assert.ok(!/Účty|Cizí štítek/.test(types), 'no Tag file in the Types list');
});
