// MS4 slice 4F, L5 (WebKit + fake core): circular embeds and depth 3 (D-420). docs/acceptance/embeds.md FR-EMB-04
// AC-1…AC-6, AC-9 (AC-7 is L2, AC-8 is L6); table R30a. Interface docs/contracts/ms4-embeds.md §1 (depth, circularity),
// §5, §6. Written from the ACs and the contracts only (D-61). Every lookup goes through `must`/`seen` and node:assert
// (TS-I1). Test clock 2026-10-17T10:00:00+02:00, Europe/Prague, region en-US.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  M, blockTexts, callsOf, embedBody, embedList, embedLoads, embedMessage, embedsVault, eventually, frameAt, headerText, main,
  mainName, must, mustBeOn, nfc, occurrences, openButton, openEmbeds, original, seen, sleep, writeCalls, type EmbedInfo,
} from './embeds-helpers';

test.use({ timezoneId: 'Europe/Prague' });

async function list(page: Page, n: number): Promise<EmbedInfo[]> {
  return eventually(() => embedList(main(page)).catch(() => [] as EmbedInfo[]), (l) => l.length >= n, 5000);
}
/** The text blocks of the host body in order, embeds shown as `[<state> <label>]`. */
async function hostOrder(page: Page): Promise<string[]> {
  return main(page).first().evaluate((m) => {
    const out: string[] = [];
    const host = m.querySelector('[aria-label="Note body"]') ?? m.querySelector('article') ?? m;
    for (const c of host.children) {
      const e = c.matches('[data-embed-mode]') ? c : c.querySelector('[data-embed-mode]');
      if (e && c.tagName !== 'P') { out.push(`[${e.getAttribute('data-embed-state')} ${e.getAttribute('aria-label') ?? ''}]`); continue; }
      const t = (c.textContent ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
      if (t) out.push(t);
    }
    return out;
  });
}

// ------------------------------------------------------------------------------------------------ AC-1

test('fr_emb_04_ac1_self_embed_is_a_circular_frame', async ({ page }) => {
  const core = await openEmbeds(page, M.samaSebe);
  const l = await list(page, 1);
  assert.equal(l.length, 1, 'one embed frame');
  assert.deepEqual([l[0].state, l[0].depth, l[0].mode], ['circular', '1', 'full'], 'data-embed-state="circular" at depth 1');
  assert.deepEqual(await hostOrder(page), ['Před vložením sebe.', '[circular Embedded: Sama sebe]', 'Po vložení sebe.'], 'before, the frame, after');
  const f = main(page).locator('[data-embed-state="circular"]').first();
  assert.ok((await headerText(f)).includes('Sama sebe'), 'the header shows Sama sebe');
  await must(openButton(f, 'Sama sebe'), 'Open Sama sebe');
  assert.equal((await embedMessage(f).innerText()).trim(), 'Circular embed: "Sama sebe" is already shown above.', 'the message');
  assert.equal(await occurrences(main(page), 'Před vložením sebe.'), 1, 'Před vložením sebe. occurs once in the DOM');
  const marks = (await callsOf(core, 'perf_mark')).map((c) => String((c.args as any)?.mark ?? (c.args as any)?.name ?? ''));
  assert.ok(marks.includes('note-ready'), 'note-ready is written');
  assert.equal((await embedLoads(core)).flat().includes(nfc(M.samaSebe)), false, 'no embed content loaded for Sama sebe beyond the host’s own read');
});

// ------------------------------------------------------------------------------------------------ AC-2

for (const [host, other, startHost, startOther] of [[M.kruhA, 'Kruh B', 'Začátek A.', 'Začátek B.'], [M.kruhB, 'Kruh A', 'Začátek B.', 'Začátek A.']] as const) {
  const self = host === M.kruhA ? 'Kruh A' : 'Kruh B';
  test(`fr_emb_04_ac2_a_b_a_from_${self.replace(' ', '_')}`, async ({ page }) => {
    await openEmbeds(page, host);
    const l = await list(page, 2);
    const d1 = await must(frameAt(main(page), other, 1), `${other} at depth 1`, 5000);
    assert.equal(await d1.getAttribute('data-embed-state'), 'ok', `${other} is expanded`);
    assert.ok((await blockTexts(embedBody(d1))).includes(startOther), `${other} shows ${startOther}`);
    const d2 = await must(frameAt(main(page), self, 2), `${self} at depth 2 inside it`, 5000);
    assert.equal(await d2.getAttribute('data-embed-state'), 'circular', `${self} at depth 2 is circular`);
    assert.equal(await occurrences(main(page), startHost), 1, `${startHost} occurs once`);
    assert.equal(await embedBody(d1).first().getAttribute('data-embed-editable'), 'true', `${other} is editable at depth 1`);
    assert.equal(await d2.locator('[contenteditable="true"]').count(), 0, 'the circular frame is not editable');
    assert.equal(l.length, 2, 'exactly two embed elements');
  });
}

// ------------------------------------------------------------------------------------------------ AC-3

test('fr_emb_04_ac3_own_section_is_circular', async ({ page }) => {
  await openEmbeds(page, M.obsah);
  const l = await list(page, 1);
  assert.equal(l[0]?.state, 'circular', 'circular by note, not by heading');
  const f = main(page).locator('[data-embed-mode]').first();
  assert.match(await headerText(f), /Obsah › Kapitola jedna/, 'header Obsah › Kapitola jedna');
  assert.equal(await occurrences(main(page), 'Text první kapitoly.'), 1, 'Text první kapitoly. occurs once');
});

// ------------------------------------------------------------------------------------------------ AC-4

test('fr_emb_04_ac4_card_of_itself_is_a_normal_card', async ({ page }) => {
  await openEmbeds(page, M.kartaSebe);
  const l = await list(page, 1);
  assert.deepEqual([l[0]?.mode, l[0]?.state], ['card', 'ok'], 'a normal card, state ok');
  const f = main(page).locator('[data-embed-mode]').first();
  assert.equal(await embedBody(f).count(), 0, 'header only (no body)');
});

test('fr_emb_04_ac4_link_mode_of_itself_is_a_normal_link_embed', async ({ page }) => {
  const vault = embedsVault((f) => { f[M.kartaSebe] = `${f[M.kartaSebe]}\n![[Karta sebe|link]]\n`; });
  await openEmbeds(page, M.kartaSebe, { vault });
  const l = await list(page, 2);
  assert.deepEqual([l[1]?.mode, l[1]?.state], ['link', 'ok'], 'a normal link-mode embed');
});

// ------------------------------------------------------------------------------------------------ AC-5

test('fr_emb_04_ac5_depth_three_then_too_deep', async ({ page }) => {
  await openEmbeds(page, M.retez1);
  const l = await list(page, 4);
  const d = (t: string) => l.find((e) => e.target === nfc(t));
  assert.deepEqual([d(M.retez2)?.depth, d(M.retez3)?.depth, d(M.retez4)?.depth], ['1', '2', '3'], 'Řetěz 2, 3, 4 at depths 1, 2, 3');
  const deep = d(M.retez5);
  assert.deepEqual([deep?.mode, deep?.state], ['link', 'too-deep'], 'Řetěz 5 inside Řetěz 4: link mode, too-deep');
  assert.equal(deep?.description, 'Embedded too deeply to show here', 'its description');
  assert.equal(await occurrences(main(page), 'Úroveň 5.'), 0, 'Úroveň 5. isn’t in the DOM');
  assert.equal(await main(page).locator('[data-embed-depth]').evaluateAll((es) => es.filter((e) => Number(e.getAttribute('data-embed-depth')) > 3).length), 0, 'no depth above 3');
  await main(page).locator('[data-embed-state="too-deep"]').first().click();
  await mustBeOn(page, 'Řetěz 5', 'activating the chip opens Řetěz 5');
});

test('fr_emb_04_ac5_from_retez_2_level_5_shows_at_depth_3', async ({ page }) => {
  await openEmbeds(page, M.retez2);
  const l = await list(page, 3);
  const r5 = l.find((e) => e.target === nfc(M.retez5));
  assert.equal(r5?.depth, '3', 'Řetěz 5 at depth 3');
  assert.equal(await occurrences(main(page), 'Úroveň 5.'), 1, 'Úroveň 5. is shown');
  assert.equal(await main(page).locator('[data-embed-depth]').evaluateAll((es) => es.filter((e) => Number(e.getAttribute('data-embed-depth')) > 3).length), 0, 'no depth above 3');
});

// ------------------------------------------------------------------------------------------------ AC-6

test('fr_emb_04_ac6_repeats_are_not_cycles', async ({ page }) => {
  await openEmbeds(page, M.kosoctverec);
  const l = await list(page, 4);
  assert.equal(await occurrences(main(page), 'Společný list.'), 2, 'Společný list. twice');
  assert.deepEqual(l.filter((e) => e.target === nfc(M.list)).map((e) => e.depth), ['2', '2'], 'both at depth 2');
  assert.equal(l.filter((e) => e.state === 'circular').length, 0, 'no circular frame');
});

// ------------------------------------------------------------------------------------------------ AC-9

test('fr_emb_04_ac9_cycle_made_outside_tegg', async ({ page }) => {
  const core = await openEmbeds(page, M.retez1);
  await list(page, 4);
  await core.setFile(M.retez3, `${original(M.retez3)}\n![[Řetěz 1]]\n`);
  const r3 = frameAt(main(page), 'Řetěz 3', 2);
  const last = await eventually(async () => {
    const inner = await r3.first().evaluate((f) => [...f.querySelectorAll('[data-embed-mode]')]
      .filter((e) => e.parentElement?.closest('[data-embed-mode]') === f)
      .map((e) => `${e.getAttribute('data-embed-state')} ${e.getAttribute('data-embed-target')?.normalize('NFC')}`)).catch(() => [] as string[]);
    return inner[inner.length - 1] ?? '';
  }, (x) => x.startsWith('circular'), 2000);
  assert.equal(last, `circular ${nfc(M.retez1)}`, "within 2 s Řetěz 3's frame ends with a circular frame for Řetěz 1");
  await page.keyboard.press('Meta+k');
  assert.ok(await seen(page.getByRole('dialog', { name: 'Command palette' }), 1000), 'the view keeps responding to input');
  await page.keyboard.press('Escape');
  await sleep(500);
  assert.equal(await mainName(page), 'Řetěz 1');
  assert.deepEqual(await writeCalls(core), [], 'nothing is written');
});

