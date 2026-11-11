// Owner report on preview v0.123 (2026-11-11): "on long notes, sometimes the page blinks and content suddenly moves
// back and forth when typing". Every autosave stamps `modified:`, and the editor then synced its `frontmatter` document
// attribute with the saved text (`markSaved` → `syncHead`). ProseMirror redraws the whole document when the document
// node's attributes change, so every block of the note was removed and built again about once a second while typing.
// Text, embeds and mindmaps come back at the same size within the same frame; a query block (slice Q, v0.122) is drawn
// by React a moment later and asks `query_run` again, so it came back empty, then as its loading state, then with its
// rows: everything below the note's query blocks jumped up by their height and back.
// FR-EDT-08 (autosave never disturbs the typing), FR-QRY-09 AC-5 (no re-run while typing), FR-SYN-06.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { Q, anyBlock, callsOf, editorBody, eventually, must, noteRoute, queriesVault, startQueries } from './queries-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const LONG = 'Pages/Dlouhá poznámka.md';
const WORDS = ['žluťoučký', 'kůň', 'úpěl', 'ďábelské', 'ódy', 'příliš', 'čeština', 'řeka', 'šťovík', 'les', 'dům', 'cesta'];
/** 60 paragraphs (several screens), two query blocks, an embed and a mindmap above paragraph 40. */
function longNote(): string {
  const blocks: string[] = [];
  for (let p = 0; p < 60; p++) {
    blocks.push(`Odstavec ${p}: ${Array.from({ length: 40 }, (_, i) => WORDS[(p * 7 + i * 3) % WORDS.length]).join(' ')}.`);
    if (p === 10) blocks.push('```query\nsaved: ' + Q.running + '\n```');
    if (p === 20) blocks.push('![[Jana Nováková]]');
    if (p === 25) blocks.push('> [!mindmap]\n> - Kořen\n>   - Větev A\n>   - Větev B');
    if (p === 30) blocks.push('```query\nsaved: ' + Q.books + '\n```');
  }
  return `---\nid: 01JB5Q000000000000000000L1\ntype: page\ntitle: Dlouhá poznámka\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\n${blocks.join('\n\n')}\n`;
}

type Watch = { removed: string[]; tops: number[]; scrolls: number[] };

test('bug_v0123_fr_edt_08_autosave_does_not_redraw_a_long_note', async ({ page }) => {
  // The real clock: every save stamps a new `modified:`, as in the app.
  const core = await startQueries(page, { vault: queriesVault((f) => { f[LONG] = longNote(); }), route: noteRoute(LONG), realTime: true });
  const body = await must(editorBody(page), 'Note body', 8000);
  const drawn = await eventually(() => anyBlock(page).locator('[data-query-result]').count(), (n) => n > 0, 5000);
  assert.ok(drawn > 0, 'the query blocks show their rows');
  const para = body.locator('p', { hasText: 'Odstavec 40:' }).first();
  await para.scrollIntoViewIfNeeded();
  const box = (await para.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 8);
  await page.keyboard.press('End');
  await page.waitForTimeout(500);
  // From here on: every other top-level block removed from the editor, and where the typed paragraph is in every frame.
  await page.evaluate(() => {
    const w = window as unknown as { __watch: Watch; __watching: boolean };
    const pm = document.querySelector('main .editor-host .ProseMirror')!;
    const p = [...pm.querySelectorAll(':scope > p')].find((e) => e.textContent!.startsWith('Odstavec 40:'))!;
    p.setAttribute('data-typed', '');
    const main = document.querySelector('main')!;
    w.__watch = { removed: [], tops: [], scrolls: [] };
    w.__watching = true;
    new MutationObserver((ms) => {
      // The paragraph being typed in is the editor's to redraw; no other block is.
      for (const m of ms) if (m.target === pm) for (const n of m.removedNodes) if (!n.textContent!.startsWith('Odstavec 40:')) w.__watch.removed.push((n as HTMLElement).className || n.nodeName);
    }).observe(pm, { childList: true });
    const frame = () => {
      if (!w.__watching) return;
      // The paragraph that is typed in, by its text: a redraw replaces the element.
      const now = pm.querySelector(':scope > p[data-typed]') ?? [...pm.querySelectorAll(':scope > p')].find((e) => e.textContent!.startsWith('Odstavec 40:'));
      w.__watch.tops.push(now ? Math.round(now.getBoundingClientRect().top) : NaN);
      w.__watch.scrolls.push(main.scrollTop);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  const writes0 = (await callsOf(core, 'note_write')).length;
  // Steady typing across several autosaves.
  for (let k = 0; k < 60; k++) { await page.keyboard.type('abc defg '[k % 9]); await page.waitForTimeout(50); }
  const writes = await eventually(async () => (await callsOf(core, 'note_write')).length - writes0, (n) => n >= 2, 5000);
  assert.ok(writes >= 2, `the typing was autosaved at least twice (${writes})`);
  await page.waitForTimeout(600); // past the last save's redraw and the blocks' answers
  const got = await page.evaluate(() => { const w = window as unknown as { __watch: Watch; __watching: boolean }; w.__watching = false; return w.__watch; });
  assert.ok(got.tops.length > 30, 'the paragraph was watched frame by frame');
  assert.deepEqual([...new Set(got.tops)], [got.tops[0]], 'the paragraph being typed in stays where it is in every frame');
  assert.deepEqual(got.removed, [], 'autosave removes no other block of the note from the editor (no redraw of the document)');
  assert.deepEqual([...new Set(got.scrolls)], [got.scrolls[0]], 'the note is not scrolled');
});
