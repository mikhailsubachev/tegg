// Slice I2, L5 (WebKit + fake core): VoiceOver, motion, themes and strings of the Import window,
// docs/acceptance/import-capacities.md: FR-UX-08 AC-19 (dialog names, the stepper, radiogroups, the table, the status
// button, `needs a look`, the progress bar, alerts once, the phase list, step announcements, axe on every step; the
// spoken order is not asserted, contract §9.3 (2); the macOS tree is L6's), AC-20 (reduce motion), FR-UX-05 AC-21 (both
// themes: tokens and axe `color-contrast` on the listed states), NFR-OTH-02 AC-18 (the pseudo-locale on every step, menu,
// alert and the status element; content stays bare). Interface docs/contracts/v1-import-window.md §3.2…§3.11, §5, §6.
// Written from the ACs and the contract only (D-61). Lookups go through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  BOARD, C01, DECISIONS, DL, alertBox, attrRow, box, canned, click, cmd, continueBtn, description, dialog, enabledSoon, eventually, flat, goTo, heading,
  hideBtn, importFail, importHold, importPace, importRelease, liveRegion, menuNamed, must, mustStep, next, openImport, phases, progressbar, radioStarting, radiogroup,
  radios, seen, startImport, startImportRun, startOsobni, statusButton, statusElement, stepperInfo, targetButton, textOf, typeRow, typesTable,
  type FakeCoreHandle,
} from './import-helpers';
import { axeContrast, colourLeaks } from './read-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
/** axe (every rule) on the Import dialog: the violations' rule ids and targets. */
async function axeDialog(page: Page): Promise<string[]> {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const root = document.querySelector('[data-import-step]');
    if (!root) return ['no Import dialog'];
    const r = await (window as any).axe.run(root);
    return r.violations.flatMap((x: any) => x.nodes.map((n: any) => `${x.id}: ${n.target.join(' ')}`));
  });
}
const STEP_TITLE: Record<string, string> = { '0': 'Import', '1': 'Import from Capacities', '2': 'Import from Capacities', '3': 'Import from Capacities', '4a': 'Import from Capacities', '4c': 'Import from Capacities', '5': 'Import from Capacities', '6': 'Import from Capacities', '7': 'Import finished' };
const STEP_N: Record<string, number> = { '1': 1, '2': 2, '3': 3, '4a': 4, '4b': 4, '4c': 4, '5': 5, '6': 6 };
const LABELS = ['Source', 'Space', 'Where', 'Mapping', 'Preview', 'Import'];

/** R151 for the step shown: the dialog's name and modality, the heading, the stepper and the announcement. */
async function frame(page: Page, s: string, name = STEP_TITLE[s]) {
  await mustStep(page, s, `step ${s}`);
  const d = dialog(page);
  assert.equal(await d.getAttribute('aria-modal'), 'true', `${s}: aria-modal`);
  assert.equal(await page.getByRole('dialog', { name, exact: true }).count(), 1, `${s}: the dialog is named \`${name}\``);
  assert.equal(await textOf(heading(page)), name, `${s}: the heading is the name`);
  assert.equal(await heading(page).getAttribute('tabindex'), '-1', `${s}: the heading takes the focus (tabindex -1)`);
  assert.ok(await eventually(() => page.evaluate(() => document.activeElement?.tagName === 'H2' && !!document.activeElement.closest('[data-import-step]')), (v) => v, 2000), `${s}: the focus is on the heading`);
  assert.equal(await eventually(async () => flat(await liveRegion(page).first().textContent({ timeout: 300 }).catch(() => '')), (t) => t === name, 2000), name, `${s}: the live region announces the heading`);
  if (STEP_N[s]) {
    const st = await stepperInfo(page);
    assert.equal(st.name, `Step ${STEP_N[s]} of 6`, `${s}: the stepper reads \`Step ${STEP_N[s]} of 6\``);
    assert.deepEqual(st.items.map(([l]) => l), LABELS, `${s}: the six labels`);
    assert.ok(st.hidden.every(Boolean), `${s}: the items are aria-hidden`);
    assert.deepEqual(st.items.map(([, m]) => m), LABELS.map((_, i) => (i + 1 < STEP_N[s] ? 'done' : i + 1 === STEP_N[s] ? 'current' : '')), `${s}: current and done items`);
  } else assert.equal(await d.getByRole('group', { name: /^⟦?Step \d of 6⟧?$/ }).count(), 0, `${s}: no stepper`);
  assert.deepEqual(await axeDialog(page), [], `${s}: axe finds no violation`);
}

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-19

test('fr_ux_08_ac19_import_for_voiceover: the board into This vault, every step', async ({ page }) => {
  const core = await startOsobni(page);
  await openImport(page);
  await frame(page, '0');
  // Step 0: radiogroup `Source`.
  await must(radiogroup(page, 'Source'), 'radiogroup `Source`');
  const src = radios(page, 'Source');
  assert.equal(await src.count(), 3, 'three sources');
  assert.equal(await src.nth(0).getAttribute('aria-checked'), 'true', '`Capacities export` checked');
  assert.equal(await description(src.nth(0)), 'A .zip or folder exported from Capacities.', 'its description');
  for (const i of [1, 2]) assert.equal(await src.nth(i).getAttribute('aria-disabled'), 'true', `source ${i + 1}: aria-disabled`);
  const obs = await description(src.nth(1));
  assert.ok(obs.startsWith('Open it in place, or copy it into a new vault.') && obs.endsWith('Coming later'), `Obsidian: its help, then \`Coming later\`: ${obs}`);
  assert.ok((await description(src.nth(2))).endsWith('Coming later'), 'Notion · Anytype: `Coming later`');
  assert.equal(await radiogroup(page, 'Source').getByText('Later', { exact: true }).count(), 2, 'the visible badge `Later` twice');
  await next(page, '1', 'step 0');
  await frame(page, '1');
  // The progress bar reads its text.
  await importPace(core, 150);
  await click(cmd(page, 'import.chooseZip'), 'Choose zip…');
  const bar = await must(progressbar(page), 'the progress bar', 3000);
  assert.match((await bar.getAttribute('aria-valuetext')) ?? '', /^Reading \d+ of \d+ files…$/, 'the progress bar reads `Reading <done> of <total> files…`');
  await importPace(core, 0);
  await next(page, '3', 'step 1 (one space)');
  await frame(page, '3');
  // Step 3: `A new vault, Recommended`, its description, `1 of 2` from the group's size.
  const dest = radios(page, 'Destination');
  assert.equal(await dest.count(), 2, 'two radios (VoiceOver\'s `1 of 2`)');
  assert.equal(await radiogroup(page, 'Destination').getByRole('radio', { name: 'A new vault, Recommended', exact: true }).count(), 1, 'the radio\'s name with its badge');
  const nd = await description(dest.nth(0));
  assert.ok(nd.startsWith('Keeps the import apart from your current notes.') && nd.includes('Capacities · PKM, ~/Documents/Capacities · PKM'), `the description: the help, then the name and path: ${nd}`);
  assert.ok((await description(dest.nth(1))).includes('38 objects were already imported into this vault.'), 'This vault: the warning in its description');
  await click(radioStarting(page, 'Destination', 'This vault'), '`This vault`');
  await next(page, '4a', 'step 3');
  await frame(page, '4a');
  // The table: column headers with each cell; the status button; `needs a look` in text.
  const headers = await typesTable(page).getByRole('columnheader').allInnerTexts();
  assert.deepEqual(headers.map((h) => h.trim()), ['In Capacities', 'Becomes in Tegg', 'Attributes'], 'the column headers');
  assert.equal(await typesTable(page).getAttribute('aria-labelledby'), await heading(page).getAttribute('id'), 'the table is named by the heading');
  const tasks = typeRow(page, 'Tasks');
  assert.equal(await tasks.getByRole('cell').count(), 3, 'three cells per row');
  assert.equal(await tasks.getByRole('button', { name: 'Map attributes, 3 of 5 mapped', exact: true }).count(), 1, '`Map attributes, 3 of 5 mapped`');
  assert.ok((await description(statusButton(tasks))).includes('needs a look'), '`needs a look` in text, not only the orange dot');
  // The menu.
  await click(targetButton(typeRow(page, 'People')), 'People');
  await must(menuNamed(page, 'People becomes'), 'menu `People becomes`');
  assert.deepEqual(await axeDialog(page), [], 'axe with the menu open');
  await page.keyboard.press('Escape');
  // 4b.
  await click(statusButton(tasks), 'the Tasks status');
  await frame(page, '4b', 'Tasks → Task');
  assert.equal(await attrRow(page, 'status').getByRole('button', { name: '4 values', exact: true }).getAttribute('aria-expanded'), 'false', 'the values chip is a disclosure');
  await page.keyboard.press('Escape');
  await next(page, '5', '4a');
  await frame(page, '5');
  // 6: the phase list.
  await importHold(core, 'writing');
  await startImportRun(page);
  await frame(page, '6');
  await importPace(core, 300);
  await importRelease(core);
  const running = await eventually(async () => (await phases(page)).find((p) => p.phase === 'objects' && p.state === 'running'), (p) => !!p && /\d+ of \d+/.test(p.text), 15_000);
  const accessible = running?.label || flat(await dialog(page).locator('li[data-phase="objects"]').textContent());
  assert.match(accessible ?? '', /^Writing objects,? \d[\d  ]* of \d[\d  ]*,? running$/, `the phase reads \`Writing objects, <k> of <n>, running\`: ${accessible}`);
  assert.equal(await dialog(page).getByRole('list', { name: 'Import steps' }).count(), 1, 'the list `Import steps`');
  await importPace(core, 0);
  await frame(page, '7');
});

test('fr_ux_08_ac19_import_for_voiceover: the Space step, 4c, an alert announced once', async ({ page }) => {
  const core = await startImport(page, { imports: C01({ sources: { [`${DL}/Poznámky.zip`]: { error: 'NotCapacities' }, [`${DL}/c01-spaces.zip`]: { scan: 'scan-c01-spaces-zip.json' } } }) });
  await goTo(page, '1');
  const b = await box(cmd(page, 'import.chooseZip'));
  await core.dropFiles([`${DL}/Poznámky.zip`], { x: Math.round(b!.x), y: Math.round(b!.y) });
  await must(alertBox(page), 'the alert', 3000);
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole('alert').count(), 1, 'one alert (announced once)');
  assert.deepEqual(await axeDialog(page), [], 'axe with the alert');
  await click(cmd(page, 'import.chooseZip'), 'Choose zip…');
  await next(page, '2', 'step 1');
  await frame(page, '2');
  for (const [i, n] of ['PKM', 'Work', 'IDC'].entries()) {
    const r = radios(page, 'Space').nth(i);
    assert.equal(await radiogroup(page, 'Space').getByRole('radio', { name: n, exact: true }).count(), 1, `the radio \`${n}\``);
    assert.match(await description(r), /^\d+ objects · \d+ types$/, `${n}: its description`);
  }
  const page2 = await page.context().newPage();
  await startImport(page2, { imports: DECISIONS() });
  await goTo(page2, '4c', { how: 'folder' });
  await frame(page2, '4c');
  await click(dialog(page2).getByRole('button', { name: 'Review…', exact: true }), 'Review…');
  assert.deepEqual(await axeDialog(page2), [], 'axe on the case list');
  await page2.close();
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-20

test('fr_ux_08_ac20_import_reduce_motion', async ({ page }) => {
  const core = await startOsobni(page, { reducedMotion: 'reduce' });
  const moving = () => page.evaluate(() => document.getAnimations().filter((a) => {
    const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
    return !!t && (!!t.closest('[data-import-step]') || !!t.closest('.import-status')) && a.playState === 'running';
  }).map((a) => `${(a as any).animationName ?? (a as any).transitionProperty ?? a.constructor.name} on ${((a.effect as KeyframeEffect).target as Element).className}`));
  await openImport(page);
  assert.deepEqual(await moving(), [], 'opening: nothing animates');
  await click(continueBtn(page), 'Continue');
  assert.deepEqual(await moving(), [], 'a step change doesn\'t animate');
  await importPace(core, 200);
  await click(cmd(page, 'import.chooseZip'), 'Choose zip…');
  await must(progressbar(page), 'the progress bar', 3000);
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(await moving(), [], 'the progress bar jumps (no transition)');
    await page.waitForTimeout(100);
  }
  await importPace(core, 0);
  await next(page, '3', 'step 1');
  assert.deepEqual(await moving(), [], 'step 3: nothing animates');
  await click(radioStarting(page, 'Destination', 'This vault'), 'This vault');
  await next(page, '4a', 'step 3');
  await next(page, '5', '4a');
  await importPace(core, 200);
  await startImportRun(page);
  for (let i = 0; i < 8; i++) {
    assert.deepEqual(await moving(), [], 'the phase list doesn\'t animate; nothing moves on its own');
    await page.waitForTimeout(150);
  }
});

// ------------------------------------------------------------------------------------------------ FR-UX-05 AC-21

for (const theme of ['light', 'dark'] as const) {
  test(`fr_ux_05_ac21_import_in_both_themes: ${theme}`, async ({ page }) => {
    test.setTimeout(180_000);
    const failures: string[] = [];
    const check = async (p: Page, what: string) => {
      for (const v of await axeContrast(p)) failures.push(`${what}: contrast ${v}`);
      for (const v of await colourLeaks(p, theme)) failures.push(`${what}: not a token: ${v}`);
    };
    const core = await startOsobni(page, { theme, imports: BOARD({ sources: { [`${DL}/Capacities export.zip`]: { scan: 'scan-board.json' }, [`${DL}/Poznámky.zip`]: { error: 'NotCapacities' } } }) });
    await openImport(page);
    await check(page, 'step 0 with a disabled source');
    await next(page, '1', 'step 0');
    await check(page, 'step 1 empty');
    const b = await box(cmd(page, 'import.chooseZip'));
    await core.dropFiles([`${DL}/Poznámky.zip`], { x: Math.round(b!.x), y: Math.round(b!.y) });
    await must(alertBox(page), 'the alert', 3000);
    await check(page, 'step 1 with an alert');
    await importPace(core, 300);
    await click(cmd(page, 'import.chooseZip'), 'Choose zip…');
    await must(progressbar(page), 'the progress bar', 3000);
    await check(page, 'step 1 reading');
    await importPace(core, 0);
    await next(page, '3', 'step 1');
    await must(dialog(page).getByText(/were already imported into this vault/), 'the repeat warning', 3000);
    await check(page, 'step 3 with the repeat warning');
    await click(radioStarting(page, 'Destination', 'This vault'), 'This vault');
    await next(page, '4a', 'step 3');
    await click(targetButton(typeRow(page, 'People')), 'People');
    await must(menuNamed(page, 'People becomes'), 'the menu');
    await check(page, '4a with an open `becomes` menu');
    await page.keyboard.press('Escape');
    await statusButton(typeRow(page, 'Tasks')).hover();
    await check(page, '4a with a hovered status button');
    await statusButton(typeRow(page, 'Meetings')).focus();
    await check(page, '4a with a focused status button');
    await click(statusButton(typeRow(page, 'Tasks')), 'Tasks');
    await mustStep(page, '4b', '4b');
    await check(page, '4b');
    await page.keyboard.press('Escape');
    await next(page, '5', '4a');
    await check(page, 'step 5');
    await importHold(core, 'writing');
    await startImportRun(page);
    await importPace(core, 300);
    await importRelease(core);
    await eventually(async () => (await phases(page)).some((p) => p.state === 'running'), (v) => v, 5000);
    await check(page, 'step 6 running');
    await importPace(core, 0);
    await mustStep(page, '7', 'done', 20_000);
    await check(page, 'step 7');
    // Step 2, 4c, and 6 failed on a second page.
    const p2 = await page.context().newPage();
    await startImport(p2, { theme, imports: C01() });
    await goTo(p2, '2', { spaces: 3 });
    await check(p2, 'step 2');
    await p2.close();
    const p3 = await page.context().newPage();
    const c3 = await startImport(p3, { theme, imports: DECISIONS() });
    await goTo(p3, '4c', { how: 'folder' });
    await check(p3, '4c');
    await next(p3, '5', '4c');
    await importFail(c3, { at: 'writing', error: { code: 'write', path: 'Pages/Deník.md', reason: 'Permission denied' } });
    await startImportRun(p3);
    await must(alertBox(p3), 'the failure alert', 10_000);
    await check(p3, 'step 6 failed');
    assert.deepEqual(failures, [], `${theme}: every listed state passes`);
  });
}

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-18

/** Every visible text and accessible name in `root` (and in open menus and the status element) with the catalog's
 *  text inside ⟦ ⟧; what is left once the wrapped parts and the content are removed must be content punctuation. */
async function bare(page: Page, content: string[]): Promise<string[]> {
  return page.evaluate((allowed) => {
    const sorted = [...new Set(allowed.map((s) => s.normalize('NFC')))].filter(Boolean).sort((a, b) => b.length - a.length);
    const roots = [...document.querySelectorAll('[data-import-step], [role="menu"], span.import-status, [role="dialog"][aria-modal="true"]')];
    const left = (s: string) => {
      let r = s.normalize('NFC').replace(/⟦[^⟧]*⟧/g, ' ');
      for (const c of sorted) r = r.split(c).join(' ');
      r = r.replace(/\b(MB|GB|kB)\b/g, ' ');
      return /^[\s\d.,·→›…()%:/\-–+×|]*$/.test(r) ? null : r.replace(/\s+/g, ' ').trim();
    };
    const out = new Set<string>();
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el) continue;
        if (el.getClientRects().length === 0) continue;
        const t = n.textContent ?? '';
        if (!t.trim()) continue;
        const l = left(t);
        if (l) out.add(`text "${t.trim()}" (${l})`);
      }
      for (const el of [root, ...root.querySelectorAll('*')]) {
        for (const a of ['aria-label', 'aria-description', 'aria-valuetext', 'title', 'placeholder']) {
          const v = el.getAttribute(a);
          if (v && v.trim()) { const l = left(v); if (l) out.add(`${a} "${v}" (${l})`); }
        }
      }
    }
    return [...out].slice(0, 30);
  }, content);
}
/** Content of the canned data: names, keys, values, titles, paths (contract §5.1 "Content, not catalog text"). */
function contentOf(...files: string[]): string[] {
  const out = new Set<string>(['Capacities · PKM', 'Osobní', 'Trezor', 'PKM', 'Work', 'IDC', '~/Documents', '~/Documents/Capacities · PKM', '2026-11-12', 'Import report 2026-11-12 PKM', 'Capacities export.zip', 'Poznámky.zip', 'Rozhodnutí', 'c01-spaces.zip', 'c01-spaces']);
  const walk = (v: any) => {
    if (typeof v === 'string') out.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { out.add(k); walk(x); });
  };
  for (const f of files) walk(canned(f));
  for (const t of ['Page', 'Pages', 'Task', 'Tasks', 'Daily Note', 'Daily Notes', 'Meeting', 'Meetings', 'Project', 'Projects', 'Idea', 'Ideas', 'Image', 'Images', 'PDF', 'PDFs', 'Quick Note', 'Tag', 'Person', 'People', 'Due date', 'Assignees', 'Status', 'Priority', 'To do', 'In progress', 'Waiting', 'Done', 'Cancelled', 'Date', 'Attendees', 'url']) out.add(t);
  return [...out];
}

test('nfr_oth_02_ac18_import_strings: the pseudo-locale on every step, menu, alert and the status element', async ({ page }) => {
  test.setTimeout(180_000);
  const content = contentOf('plan-board.json', 'where-osobni.json', 'scan-board.json');
  const failures: string[] = [];
  const check = async (p: Page, what: string, extra: string[] = []) => { for (const f of await bare(p, [...content, ...extra])) failures.push(`${what}: ${f}`); };
  const core = await startOsobni(page, { pseudo: true, imports: BOARD({ sources: { [`${DL}/Capacities export.zip`]: { scan: 'scan-board.json' }, [`${DL}/Poznámky.zip`]: { error: 'NotCapacities' } } }) });
  await openImport(page);
  await check(page, 'step 0');
  const pc = (s: string) => dialog(page).locator(`button[data-command="${s}"]`);
  await click(pc('import.continue'), 'Continue');
  await mustStep(page, '1', 'step 1');
  await check(page, 'step 1');
  const b = await box(pc('import.chooseZip'));
  await core.dropFiles([`${DL}/Poznámky.zip`], { x: Math.round(b!.x), y: Math.round(b!.y) });
  await must(alertBox(page), 'the alert', 3000);
  await check(page, 'step 1 alert');
  await importPace(core, 300);
  await click(pc('import.chooseZip'), 'Choose zip…');
  await must(dialog(page).getByRole('progressbar'), 'the progress bar', 3000);
  await check(page, 'step 1 reading');
  await importPace(core, 0);
  await enabledSoon(pc('import.continue'), 'Continue');
  await click(pc('import.continue'), 'Continue');
  await mustStep(page, '3', 'step 3');
  await check(page, 'step 3');
  await click(dialog(page).getByRole('radio').nth(1), 'This vault');
  await enabledSoon(pc('import.continue'), 'Continue');
  await click(pc('import.continue'), 'Continue');
  await mustStep(page, '4a', '4a');
  await check(page, '4a');
  await click(targetButton(typeRow(page, 'People')), 'People');
  await must(page.getByRole('menu'), 'the menu');
  await check(page, '4a menu');
  await page.keyboard.press('Escape');
  await click(statusButton(typeRow(page, 'Tasks')), 'Tasks');
  await mustStep(page, '4b', '4b');
  await click(attrRow(page, 'status').getByRole('button').filter({ hasText: /4/ }).first(), 'the values chip');
  await check(page, '4b');
  await page.keyboard.press('Escape');
  await click(pc('import.continue'), 'Continue');
  await mustStep(page, '5', 'step 5');
  await check(page, 'step 5');
  await importHold(core, 'writing');
  await startImportRun(page);
  await importPace(core, 300);
  await importRelease(core);
  await eventually(async () => (await phases(page)).some((p) => p.state === 'running'), (v) => v, 5000);
  await check(page, 'step 6');
  await click(hideBtn(page), 'Hide');
  await must(statusElement(page), 'the status element', 3000);
  await check(page, 'the status element');
  await importPace(core, 0);
  await eventually(() => statusElement(page).innerText().catch(() => ''), (t) => /finished/.test(t), 20_000);
  await check(page, 'the finished status');
  await click(statusElement(page).locator('button[data-command="import.open"]'), 'the status');
  await mustStep(page, '7', 'step 7');
  await check(page, 'step 7');
  // Step 2 and 4c with its lists on second pages.
  const p2 = await page.context().newPage();
  await startImport(p2, { pseudo: true, imports: C01() });
  await openImport(p2);
  await click(dialog(p2).locator('button[data-command="import.continue"]'), 'Continue');
  await click(dialog(p2).locator('button[data-command="import.chooseZip"]'), 'Choose zip…');
  await enabledSoon(dialog(p2).locator('button[data-command="import.continue"]'), 'Continue');
  await click(dialog(p2).locator('button[data-command="import.continue"]'), 'Continue');
  await mustStep(p2, '2', 'step 2');
  await check(p2, 'step 2', contentOf('scan-c01-spaces-zip.json'));
  await p2.close();
  const p3 = await page.context().newPage();
  await startImport(p3, { pseudo: true, imports: DECISIONS() });
  await openImport(p3);
  const c = (s: string) => dialog(p3).locator(`button[data-command="${s}"]`);
  await click(c('import.continue'), 'Continue');
  await click(c('import.chooseFolder'), 'Choose folder…');
  await enabledSoon(c('import.continue'), 'Continue');
  await click(c('import.continue'), 'Continue');
  await mustStep(p3, '3', 'step 3');
  await enabledSoon(c('import.continue'), 'Continue');
  await click(c('import.continue'), 'Continue');
  await mustStep(p3, '4a', '4a');
  await click(c('import.continue'), 'Continue');
  await mustStep(p3, '4c', '4c');
  const extra = contentOf('plan-decisions.json');
  await check(p3, '4c', extra);
  await click(dialog(p3).getByRole('button').filter({ hasText: /Review/ }).first(), 'Review…');
  await check(p3, '4c case list', extra);
  await p3.close();
  assert.deepEqual(failures, [], 'every text and accessible name of the window is the catalog\'s (⟦ ⟧) or content');
});
