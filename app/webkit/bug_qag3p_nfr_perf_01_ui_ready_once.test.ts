// QA review of slice "G3 in the panel" (NFR-PERF-01; docs/contracts/ms3-shell.md §1): the app marks `ui-ready` once,
// when the frame or the chooser has painted. The 250 ms timer only backs up a frame callback that didn't come; when
// both fired, a late second mark looked like a new request (FR-UX-03 AC-34).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { sleep, start } from './helpers';
import { marks } from './graph-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US' });

for (const frame of ['vault', 'chooser'] as const) {
  test(`bug_qag3p_nfr_perf_01_ui_ready_marked_once_${frame}`, async ({ page }) => {
    const core = await start(page, frame === 'chooser' ? { vault: null } : {});
    await sleep(500);
    const n = (await marks(core)).filter((m) => m === 'ui-ready').length;
    assert.equal(n, 1, `${frame}: one perf_mark('ui-ready') after 500 ms (ms3-shell §1), got ${n}`);
  });
}
