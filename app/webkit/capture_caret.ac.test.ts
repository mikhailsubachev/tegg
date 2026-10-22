// v0.52 feedback, L5 (WebKit + fake core): the caret on the capture window's bold title. docs/acceptance/capture.md
// FR-CAP-01 AC-20 (D-592; regression `bug_v052_fr_cap_01_caret_matches_the_bold_title`). Interface
// docs/contracts/ms5-capture.md §16.4 (`.capture-mirror-title` keeps the textarea's font weight and draws bold with
// `-webkit-text-stroke`, so every glyph keeps its advance width). Written from the AC and the contract only (D-61);
// every lookup goes through `must`/node:assert (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { capText, must, sleep, startCapture, typeInCapture } from './capture-helpers';
import { caretProbe } from './v052-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const TITLE = 'Spike for multilanguage support and the translation memory';

test('fr_cap_01_ac20_the_caret_is_on_the_bold_title_at_every_offset', async ({ page }) => {
  await startCapture(page);
  await typeInCapture(page, `${TITLE}\nDruhý řádek těla.`);
  await sleep(150);
  const p = await caretProbe(await must(capText(page), 'textbox "Capture text"'), TITLE, 'multilanguage');
  assert.equal(p.mirror, true, 'the mirror draws the title (aria-hidden layer beside the textarea)');
  const off = p.dx.map((d, i) => [i, d] as const).filter(([, d]) => !(d <= 1));
  assert.deepEqual(off, [], `every caret offset 0…${TITLE.length} is within 1 px of the bold title (offset, px)`);
});

test('fr_cap_01_ac20_a_selected_word_covers_it_in_the_mirror_and_the_title_stays_bold', async ({ page }) => {
  await startCapture(page);
  await typeInCapture(page, `${TITLE}\nDruhý řádek těla.`);
  await sleep(150);
  const ta = await must(capText(page), 'textbox "Capture text"');
  const at = TITLE.indexOf('multilanguage');
  await ta.evaluate((t, [a, b]) => (t as HTMLTextAreaElement).setSelectionRange(a, b), [at, at + 'multilanguage'.length] as const);
  const p = await caretProbe(ta, TITLE, 'multilanguage');
  assert.ok(p.word, 'the word is drawn in the mirror');
  assert.ok(p.word!.left <= 1 && p.word!.right <= 1, `the selection of "multilanguage" covers the word in the mirror (left ${p.word!.left} px, right ${p.word!.right} px)`);
  const heavier = !!p.title && !!p.body && (p.title.stroke > p.body.stroke || p.title.weight > p.body.weight);
  assert.ok(heavier, `the title is drawn heavier than the body (title ${JSON.stringify(p.title)}, body ${JSON.stringify(p.body)})`);
});
