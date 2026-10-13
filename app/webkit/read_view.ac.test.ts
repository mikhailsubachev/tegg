// MS3 slice 3B, L5 (WebKit + fake core): the read view in the running UI. FR-EDT-10 AC-1, AC-3…AC-8; FR-EDT-02 AC-2,
// AC-3 (fold), AC-7…AC-11, AC-13…AC-15; FR-TYP-08 AC-3 (dates in the page), AC-5, AC-6; NFR-PERF-05 AC-3;
// NFR-REL-03 AC-3, AC-4; FR-SYN-03 AC-10, AC-11; FR-SYN-06 AC-6 (write-command count).
// Written from docs/acceptance/read-view.md and docs/contracts/ms3-shell.md §5, §11 only (D-61). Every lookup goes
// through `must`/`seen` and node:assert, so a missing element is an AssertionError, not a Playwright timeout (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  absent, eventually, focused, mainName, must, mustBeOn, nonReadCalls, openNote, paletteDialog, paletteOptions, runCommand,
  seen, sidebar, sleep, switcherDialog, theme,
} from './helpers';
import {
  IDS, R, TITLES, article, axeContrast, cmds, colourLeaks, firstVisibleBlockText, headingFn, lineFn, mustArticle, openAt,
  placement, propsRegion, scrollToTop, sourceRegion, toFormattedButton, toSourceButton, tokenColour, ui, watchNetwork,
} from './read-helpers';

const TOGGLE = 'Alt+Meta+KeyU';
const nfc = (s: string) => s.normalize('NFC');

async function toSource(page: Page) {
  const btn = await must(toSourceButton(page), 'toggle "Show Markdown source"');
  assert.notEqual(await btn.getAttribute('aria-disabled'), 'true', 'the source toggle is built (not the 3A disabled control)');
  await btn.click();
  await must(sourceRegion(page), 'region "Markdown source"');
}

async function linkIn(page: Page, title: string, name: string) {
  return must(article(page, title).getByRole('link', { name, exact: true }), `link "${name}" in ${title}`);
}

async function visible(page: Page, fn: string): Promise<boolean> {
  const p = await placement(page, fn);
  return !!p && p.bottom > p.viewTop && p.top < p.viewBottom;
}

async function uiCalls(core: { calls(): Promise<{ cmd: string; args: unknown }[]> }, cmd: string) {
  return (await core.calls()).filter((c) => c.cmd === cmd);
}

// ------------------------------------------------------------------------------------------------ FR-EDT-10

test('fr_edt_10_ac1_toggle_by_button_shortcut_and_palette', async ({ page }) => {
  const core = await openAt(page, R.bloky);
  const btn = await must(toSourceButton(page), 'toggle "Show Markdown source"');
  assert.equal(await btn.getAttribute('aria-pressed'), 'false', 'formatted view: aria-pressed false');
  await btn.click();
  await must(sourceRegion(page), 'source view after the button');
  const back = await must(toFormattedButton(page), 'toggle now reads "Show formatted note"');
  assert.equal(await back.getAttribute('aria-pressed'), 'true');
  await back.click();
  await mustArticle(page, 'Bloky');
  assert.ok(await absent(sourceRegion(page)), 'button switches back to the formatted view');

  await page.keyboard.press(TOGGLE);
  assert.ok(await seen(sourceRegion(page)), '⌥⌘U shows the source');
  await page.keyboard.press(TOGGLE);
  assert.ok(await absent(sourceRegion(page)), '⌥⌘U switches back');
  assert.ok(await seen(article(page, 'Bloky')), 'formatted view again');

  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'palette');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Toggle Markdown source');
  await sleep(50);
  const opts = await paletteOptions(page);
  assert.ok(opts.some((o) => o.includes('Toggle Markdown source') && o.includes('⌥⌘U')), `palette lists "Toggle Markdown source ⌥⌘U": ${opts.join(' | ')}`);
  await page.keyboard.press('Enter');
  assert.ok(await seen(sourceRegion(page)), 'the palette command toggles');

  await runCommand(page, 'Go to Search');
  await mustBeOn(page, 'Search', 'Go to Search');
  const before = (await core.calls()).length;
  await runCommand(page, 'Toggle Markdown source');
  await page.keyboard.press(TOGGLE);
  await sleep(200);
  assert.equal(await mainName(page), 'Search', 'without a note the command changes nothing');
  assert.equal(await page.getByRole('alert').count(), 0, 'and shows no error');
  assert.deepEqual((await cmds(core, before)).filter((c) => !['index_search', 'ui_state_get', 'perf_mark'].includes(c)), [], 'and sends nothing');
});

test('fr_edt_10_ac3_source_is_read_only_selectable_and_copyable', async ({ page }) => {
  const core = await openAt(page, R.bloky);
  await toSource(page);
  const region = sourceRegion(page);
  assert.equal(await region.locator('[contenteditable]:not([contenteditable="false"]), textarea, input').count(), 0, 'nothing editable');
  const before = await region.innerText();
  const callsBefore = (await core.calls()).length;

  // Pointer selection over lines 8–10, then ⌘C: the clipboard holds the selected source text.
  const l8 = await must(region.locator('[data-line="8"]'), 'line 8');
  const l10 = await must(region.locator('[data-line="10"]'), 'line 10');
  const a = await l8.boundingBox();
  const b = await l10.boundingBox();
  assert.ok(a && b, 'line boxes');
  await page.evaluate(() => {
    (window as any).__copied = null;
    document.addEventListener('copy', (e) => setTimeout(() => {
      (window as any).__copied = e.defaultPrevented ? e.clipboardData?.getData('text/plain') ?? '' : getSelection()?.toString() ?? '';
    }), true);
  });
  await page.mouse.move(a!.x + a!.width - 2, a!.y + a!.height / 2);
  await page.mouse.move(a!.x + 1, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width - 2, b!.y + b!.height / 2, { steps: 8 });
  await page.mouse.up();
  const sel = await page.evaluate(() => getSelection()?.toString() ?? '');
  assert.ok(sel.includes('# Nadpis 1') && sel.includes('## Nadpis 2'), `pointer selection holds the source text: ${JSON.stringify(sel)}`);
  await page.keyboard.press('Meta+c');
  const copied = await eventually(() => page.evaluate(() => (window as any).__copied as string | null), (v) => v !== null, 1000);
  assert.ok(copied && copied.includes('# Nadpis 1') && copied.includes('## Nadpis 2'), `⌘C copies the selected source: ${JSON.stringify(copied)}`);

  // Keyboard: ⌘A inside the source selects its text.
  await l8.click();
  await page.keyboard.press('Meta+a');
  const all = await page.evaluate(() => getSelection()?.toString() ?? '');
  assert.ok(all.includes('title: Bloky') && all.includes('![vzdálený](https://example.com/vzdaleny.png)'), 'keyboard selection covers the source');

  for (const k of ['x', 'Backspace', 'Meta+v', 'Enter']) await page.keyboard.press(k);
  await page.keyboard.type('ž');
  assert.equal(await region.innerText(), before, 'typing, paste and ⌫ change nothing');
  assert.deepEqual(await nonReadCalls(core), [], 'no write command');
  assert.deepEqual((await cmds(core, callsBefore)).filter((c) => !['perf_mark', 'ui_state_get'].includes(c)), [], 'no IPC command at all');
});

test('fr_edt_10_ac4_line_numbers_in_a_gutter_not_copied', async ({ page }) => {
  await openAt(page, R.bloky);
  await toSource(page);
  const region = sourceRegion(page);
  const n = await region.locator('[data-line]').count();
  assert.ok(n >= 124, `one line element per file line (${n})`);
  const gutters = await region.locator('[data-line]').evaluateAll((ls) => ls.map((l) => {
    const g = l.querySelector('[aria-hidden="true"]') ?? l.previousElementSibling;
    return g && g.getAttribute('aria-hidden') === 'true' ? (g.textContent ?? '').trim() : null;
  }));
  assert.deepEqual(gutters.slice(0, 10), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], 'each line shows its 1-based number in an aria-hidden gutter');
  assert.equal(gutters[n - 1], String(n));
  const sel = await page.evaluate(() => {
    const l = document.querySelector('[aria-label="Markdown source"] [data-line="8"]')!;
    const r = document.createRange();
    r.setStartBefore(l);
    r.setEndAfter(document.querySelector('[aria-label="Markdown source"] [data-line="9"]')!);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
    return getSelection()!.toString();
  });
  assert.equal(sel.replace(/\n+$/, ''), '# Nadpis 1\n', 'selecting lines 8–9 gives their text without line numbers');
});

test('fr_edt_10_ac5_not_remembered_and_writes_nothing', async ({ page }) => {
  const core = await openAt(page, R.bloky);
  const filesBefore = await core.files();
  const setsBefore = (await uiCalls(core, 'ui_state_set')).length;
  await toSource(page);
  await openNote(page, 'Cíl');
  await mustArticle(page, 'Cíl');
  assert.equal(await sourceRegion(page).count(), 0, 'another note opens formatted');
  await openNote(page, 'Bloky');
  await mustArticle(page, 'Bloky');
  assert.equal(await sourceRegion(page).count(), 0, 'coming back opens formatted');
  assert.equal((await uiCalls(core, 'ui_state_set')).length, setsBefore, 'toggling stores nothing in the Application Support root');
  assert.deepEqual(await nonReadCalls(core), [], 'no vault write');
  assert.deepEqual(await core.files(), filesBefore, 'vault unchanged');
});

test('fr_edt_10_ac6_reading_position_kept_across_the_toggle', async ({ page }) => {
  await openAt(page, R.cil);
  await mustArticle(page, 'Cíl');
  await scrollToTop(page, headingFn('Druhá kapitola'));
  await sleep(100);
  assert.equal(await firstVisibleBlockText(page), 'Druhá kapitola', 'setup: the heading is the first visible block');
  await page.keyboard.press(TOGGLE);
  await must(sourceRegion(page), 'source view');
  await sleep(150);
  assert.ok(await visible(page, lineFn(94)), 'the heading’s source line 94 is in the visible area');
  await page.keyboard.press(TOGGLE);
  await mustArticle(page, 'Cíl');
  await sleep(150);
  assert.ok(await visible(page, headingFn('Druhá kapitola')), 'back in the formatted view the heading is visible');
});

test('fr_edt_10_ac7_no_links_in_the_source_view', async ({ page }) => {
  const core = await openAt(page, R.odkazy);
  await toSource(page);
  const region = sourceRegion(page);
  assert.equal(await region.locator('a, button, [role="link"], [role="button"]').count(), 0, 'no links or buttons in the source');
  const navs = (await uiCalls(core, 'nav_opened')).length;
  for (const t of ['[[Cíl]]', '#projekt', 'https://example.com']) {
    const hit = region.getByText(t).first();
    assert.ok(await seen(hit), `${t} shown as text`);
    await hit.click();
  }
  await sleep(200);
  assert.equal(await mainName(page), 'Odkazy', 'clicking doesn’t navigate');
  assert.equal((await uiCalls(core, 'nav_opened')).length, navs);
  assert.ok(await seen(region), 'still in the source view');
});

test('fr_edt_10_ac8_source_view_theme_quality', async ({ browser }) => {
  test.setTimeout(120_000);
  const failures: string[] = [];
  for (const t of ['light', 'dark'] as const) {
    const page = await browser.newPage();
    await openAt(page, R.bloky, { uiState: ui(t) });
    assert.equal(await eventually(() => theme(page), (v) => v === t), t, `theme ${t}`);
    await toSource(page);
    const font = await sourceRegion(page).locator('[data-line="8"]').evaluate((e) => getComputedStyle(e).fontFamily).catch(() => '');
    const codeFont = await page.evaluate(() => {
      const c = document.createElement('code');
      document.querySelector('main')?.appendChild(c);
      const f = getComputedStyle(c).fontFamily;
      c.remove();
      return f;
    });
    assert.equal(font, codeFont, `${t}: source view uses the code font`);
    for (const v of await axeContrast(page)) failures.push(`${t} contrast: ${v}`);
    for (const v of await colourLeaks(page, t)) failures.push(`${t} colour: ${v}`);
    await page.close();
  }
  assert.deepEqual(failures, []);
});

// ------------------------------------------------------------------------------------------------ FR-EDT-02

test('fr_edt_02_ac2_checklist_click_changes_nothing', async ({ page }) => {
  const core = await openAt(page, R.bloky);
  const art = await mustArticle(page, 'Bloky');
  const box = await must(art.getByRole('checkbox', { name: 'nehotovo' }), 'checkbox "nehotovo"');
  const files = await core.files();
  await box.click();
  await box.focus();
  await page.keyboard.press('Space');
  await sleep(150);
  assert.equal(await box.getAttribute('aria-checked') ?? String(await box.isChecked()), 'false', 'still unchecked');
  assert.deepEqual(await nonReadCalls(core), [], 'no IPC write');
  assert.deepEqual(await core.files(), files, 'nothing written');
});

test('fr_edt_02_ac3_callout_fold_changes_only_the_view', async ({ page }) => {
  const core = await openAt(page, R.bloky);
  const art = await mustArticle(page, 'Bloky');
  const callout = await must(art.getByRole('note', { name: 'Složené' }), 'callout "Složené"');
  const fold = await must(callout.getByRole('button'), 'fold toggle');
  assert.equal(await fold.getAttribute('aria-expanded'), 'false');
  assert.equal(await seen(callout.getByText('Skrytý obsah.'), 300), false, '[!tip]- content hidden');
  await fold.click();
  assert.equal(await fold.getAttribute('aria-expanded'), 'true');
  assert.ok(await seen(callout.getByText('Skrytý obsah.')), 'expanded');
  await fold.click();
  assert.ok(await absent(callout.getByText('Skrytý obsah.')), 'collapsed again');
  const tint = await art.locator('[data-callout]').evaluateAll((cs) => cs.map((c) => getComputedStyle(c).borderLeftColor + '|' + getComputedStyle(c).backgroundColor));
  assert.equal(tint.length, 6, 'six callouts');
  assert.deepEqual(await nonReadCalls(core), [], 'folding writes nothing');
});

test('fr_edt_02_ac7_following_links', async ({ page }) => {
  const core = await openAt(page, R.odkazy);
  const navTo = async (how: () => Promise<void>, what: string) => {
    const n = (await uiCalls(core, 'nav_opened')).length;
    await how();
    await mustBeOn(page, 'Cíl', what);
    await mustArticle(page, 'Cíl');
    const opened = (await uiCalls(core, 'nav_opened')).slice(n).map((c) => nfc(String((c.args as any)?.path)));
    assert.deepEqual(opened, [R.cil], `${what}: recorded with nav_opened`);
  };
  const back = async () => { await openNote(page, 'Odkazy'); await mustArticle(page, 'Odkazy'); };

  await navTo(async () => (await linkIn(page, 'Odkazy', 'Cíl')).click(), 'click');
  const f = await focused(page);
  assert.ok(f.heading && f.label.includes('Cíl'), `focus on the title: ${JSON.stringify(f)}`);
  assert.equal(await page.locator('[role="tooltip"], [role="dialog"]').count(), 0, 'no preview popover');

  await back();
  await navTo(async () => { (await linkIn(page, 'Odkazy', 'jiný text')).focus(); await page.keyboard.press('Enter'); }, '⏎ on a focused link');
  await back();
  await navTo(async () => (await linkIn(page, 'Odkazy', 'jiný text')).click({ modifiers: ['Meta'] }), '⌘-click');

  const topAligned = async (fn: string, what: string) => {
    await sleep(300);
    const p = await placement(page, fn);
    assert.ok(p, `${what}: target present`);
    assert.ok(Math.abs(p!.top - p!.viewTop) <= 8, `${what}: at the top of the centre pane (±8 px), off by ${p!.top - p!.viewTop}`);
  };
  await back();
  const heading = await must(page.locator('main li', { hasText: 'Nadpis:' }).getByRole('link'), 'heading link');
  await navTo(() => heading.click(), '[[Cíl#Druhá kapitola]]');
  await topAligned(headingFn('Druhá kapitola'), '#Druhá kapitola');
  await back();
  const block = await must(page.locator('main li', { hasText: 'Blok:' }).getByRole('link'), 'block link');
  await navTo(() => block.click(), '[[Cíl#^blok1]]');
  await topAligned(`() => document.getElementById('^blok1')`, '#^blok1');

  // A subpath that doesn't exist opens the note at the top, with no error.
  await core.setFile('Pages/Zkouška.md', '---\ntype: page\ntitle: Zkouška\n---\n[[Cíl#Neexistující kapitola]]\n');
  await openNote(page, 'Zkouška');
  await navTo(async () => (await linkIn(page, 'Zkouška', 'Cíl')).click(), 'missing subpath');
  await sleep(200);
  assert.equal(await firstVisibleBlockText(page), 'Úvod', 'opened at the top');
  assert.equal(await page.getByRole('alert').count(), 0, 'no error');

  // [[#Tagy]] scrolls within the note and keeps the route.
  await back();
  const n = (await uiCalls(core, 'nav_opened')).length;
  const inNote = await must(page.locator('main li', { hasText: 'V této poznámce:' }).getByRole('link'), 'in-note link');
  await inNote.click();
  await topAligned(headingFn('Tagy'), '[[#Tagy]]');
  assert.equal(await mainName(page), 'Odkazy', 'route unchanged');
  assert.equal((await uiCalls(core, 'nav_opened')).length, n, 'no navigation recorded');
});

test('fr_edt_02_ac8_unresolved_links_style_and_activation', async ({ page }) => {
  const core = await openAt(page, R.odkazy);
  const art = await mustArticle(page, 'Odkazy');
  const files = await core.files();
  const danger = await tokenColour(page, 'danger');
  assert.ok(danger, 'theme token danger');
  for (const name of ['Neexistuje', 'Reading list']) {
    const l = await must(art.getByRole('link', { name, exact: true }), `link "${name}"`);
    const st = await l.evaluate((e) => { const s = getComputedStyle(e); return { color: s.color, deco: s.textDecorationStyle, line: s.textDecorationLine, bg: s.backgroundColor }; });
    assert.equal(st.color, danger, `${name}: error colour token`);
    assert.equal(st.deco, 'dashed', `${name}: dashed underline`);
    assert.match(st.line, /underline/, `${name}: underlined`);
    assert.equal(st.bg, 'rgba(0, 0, 0, 0)', `${name}: no tint`);
    await l.click();
    await l.focus();
    await page.keyboard.press('Enter');
  }
  const d8 = await must(art.getByRole('link', { name: '2026-10-08', exact: true }), 'date link 2026-10-08');
  assert.equal(await d8.getAttribute('aria-disabled'), 'true');
  const d8style = await d8.evaluate((e) => getComputedStyle(e).textDecorationStyle);
  assert.notEqual(d8style, 'dashed', 'a date link without a note is not shown broken');
  await d8.click();
  await sleep(200);
  assert.equal(await mainName(page), 'Odkazy', 'no route change');
  assert.deepEqual(await nonReadCalls(core), [], 'no IPC write command');
  assert.deepEqual(Object.keys(await core.files()).sort(), Object.keys(files).sort(), 'no file created');
});

test('fr_edt_02_ac9_tag_opens_search_with_the_tag_filter', async ({ page }) => {
  const core = await openAt(page, R.odkazy);
  const art = await mustArticle(page, 'Odkazy');
  const chip = await must(art.getByRole('link', { name: '#Projekt/alfa', exact: true }), 'tag chip #Projekt/alfa');
  const n = (await core.calls()).length;
  await chip.click();
  await mustBeOn(page, 'Search', 'tag activation');
  const searches = (await core.calls()).slice(n).filter((c) => c.cmd === 'index_search').map((c) => (c.args as any)?.query);
  assert.ok(searches.length > 0, 'the search page queries the index');
  const last = searches[searches.length - 1];
  assert.deepEqual([last?.tags, last?.text ?? ''], [['projekt/alfa'], ''], 'tag filter = tagKey, empty text query');
  await openNote(page, 'Odkazy');
  const nfdChip = await must(article(page, 'Odkazy').getByRole('link', { name: '#Čeština' }), 'tag chip #Čeština (written in NFD)');
  await (nfdChip).click();
  await mustBeOn(page, 'Search', 'NFD tag activation');
  const s2 = (await core.calls()).filter((c) => c.cmd === 'index_search').map((c) => (c.args as any)?.query);
  assert.deepEqual(s2[s2.length - 1]?.tags, ['čeština'], 'NFC, lower-case key');
});

test('fr_edt_02_ac10_external_links_open_outside_and_no_network', async ({ page }) => {
  const net = watchNetwork(page);
  const core = await openAt(page, R.odkazy);
  const art = await mustArticle(page, 'Odkazy');
  const web = await must(art.getByRole('link', { name: 'web', exact: true }), 'external link "web"');
  assert.equal(await web.evaluate((e) => (e as HTMLElement).getAttribute('aria-describedby') ? document.getElementById(e.getAttribute('aria-describedby')!.split(' ')[0])?.textContent?.trim() : e.getAttribute('aria-description')), 'Opens in your browser');
  assert.equal(await web.getAttribute('data-link-kind'), 'external');
  await web.click();
  const bare = await must(art.getByRole('link', { name: 'https://example.com', exact: true }), 'bare URL autolink');
  await bare.click();
  const mail = await must(art.getByRole('link', { name: 'pošta', exact: true }), 'mailto link');
  await mail.focus();
  await page.keyboard.press('Enter');
  const opened = await eventually(() => core.externalOpened(), (v) => v.length >= 3, 1000);
  assert.deepEqual(opened.map((u) => u.replace(/\/$/, '')), ['https://example.com/a?b=c', 'https://example.com', 'mailto:eva@example.com'], 'open_external with each URL');
  for (const [label, url] of [['skript', 'javascript:alert(1)'], ['soubor', 'file:///etc/hosts'], ['data', 'data:text/html,x']]) {
    assert.equal(await art.getByRole('link', { name: label, exact: true }).count(), 0, `${label}: never a link`);
    assert.ok(await seen(art.getByText(url, { exact: false })), `${label}: the URL is shown as text`);
  }
  const all = (await core.calls()).filter((c) => c.cmd === 'open_external').map((c) => String((c.args as any)?.url));
  assert.ok(all.every((u) => /^(https?:|mailto:)/.test(u)), `only http(s)/mailto passed to open_external: ${all.join(', ')}`);
  assert.equal(await mainName(page), 'Odkazy', 'route unchanged');
  assert.deepEqual(net, [], 'no request to a non-local host (NFR-SEC-01)');
});

test('fr_edt_02_ac11_no_script_and_no_remote_requests', async ({ page }) => {
  const net = watchNetwork(page);
  await openAt(page, R.bloky);
  const art = await mustArticle(page, 'Bloky');
  assert.ok(await seen(art.getByText('<script>window.__teggPwned = 1</script>')), 'the script tag is shown as text');
  assert.equal(await page.evaluate(() => (window as any).__teggPwned), undefined, 'no script from the note ran');
  assert.equal(await art.locator('script, iframe, object, embed, style, [onclick]').count(), 0, 'no HTML elements from the note');
  await sleep(300);
  assert.deepEqual(net, [], 'no remote request (iframe, img, remote image)');
});

test('fr_edt_02_ac13_placeholders_send_nothing_and_note_embed_opens', async ({ page }) => {
  const core = await openAt(page, R.odkazy);
  const art = await mustArticle(page, 'Odkazy');
  await sleep(300);
  const sent = await cmds(core);
  const allowed = new Set(['vault_current', 'vault_last', 'vault_types', 'index_type_counts', 'index_list', 'ui_state_get', 'nav_opened', 'perf_mark', 'note_read', 'link_resolve', 'index_switcher']);
  assert.deepEqual(sent.filter((c) => !allowed.has(c)), [], 'no other IPC command while rendering placeholders');
  const reads = (await uiCalls(core, 'note_read')).map((c) => nfc(String((c.args as any)?.path)));
  assert.deepEqual(reads, [R.odkazy], 'no attachment or embedded note is read');
  const ph = art.locator('[data-placeholder="embed-note"]');
  assert.equal(await ph.count(), 2, 'two note embed placeholders');
  const chip = await must(ph.first().getByRole('link', { name: 'Cíl', exact: true }), 'note embed chip');
  await chip.click();
  await mustBeOn(page, 'Cíl', 'the note embed chip opens the note');
});

test('fr_edt_02_ac14_formatted_view_is_read_only_with_disabled_edit', async ({ page }) => {
  const core = await openAt(page, R.bloky);
  const art = await mustArticle(page, 'Bloky');
  assert.equal(await page.locator('main [contenteditable]:not([contenteditable="false"]), main textarea').count(), 0, 'nothing contenteditable');
  const inputs = await page.locator('main input').evaluateAll((is) => is.map((i) => `${(i as HTMLInputElement).type}:${i.getAttribute('aria-readonly') ?? (i as HTMLInputElement).readOnly}`));
  assert.ok(inputs.every((x) => /^checkbox:(true)$/.test(x)), `only read-only checkboxes: ${inputs.join(', ')}`);
  const before = await art.innerText();
  await art.locator('p').first().click();
  for (const k of ['x', 'Backspace', 'Meta+v', 'Enter']) await page.keyboard.press(k);
  assert.equal(await art.innerText(), before, 'typing, paste and ⌫ change nothing');
  assert.deepEqual(await nonReadCalls(core), [], 'no write');
  const edit = await must(page.getByRole('button', { name: 'Edit', exact: true }), 'disabled control "Edit"');
  assert.equal(await edit.getAttribute('aria-disabled'), 'true');
  assert.ok(await seen(page.getByText('Editing comes in MS3 (3C)')), 'visible note "Editing comes in MS3 (3C)"');
});

test('fr_edt_02_ac15_both_themes_on_bloky_odkazy_vlastnosti', async ({ browser }) => {
  test.setTimeout(180_000);
  const failures: string[] = [];
  for (const t of ['light', 'dark'] as const) {
    for (const p of [R.bloky, R.odkazy, R.vlastnosti]) {
      const page = await browser.newPage();
      await openAt(page, p, { uiState: ui(t) });
      await mustArticle(page, TITLES[p]);
      assert.equal(await eventually(() => theme(page), (v) => v === t), t, `theme ${t}`);
      await sleep(100);
      for (const v of await axeContrast(page)) failures.push(`${t} ${p} contrast: ${v}`);
      for (const v of await colourLeaks(page, t)) failures.push(`${t} ${p} colour: ${v}`);
      await page.close();
    }
  }
  assert.deepEqual(failures, []);
});

// ------------------------------------------------------------------------------------------------ FR-TYP-08

test.describe('in America/Los_Angeles with region cs-CZ', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('fr_typ_08_ac3_strip_shows_values_dates_in_region_locale_never_shifted', async ({ page }) => {
    await openAt(page, R.vlastnosti, { region: 'cs-CZ' });
    const strip = await must(propsRegion(page), 'region "Properties"');
    const txt = nfc(await strip.innerText());
    const want = await page.evaluate(() => ({
      date: new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium' }).format(new Date(2026, 9, 20)),
      dt: new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium' }).format(new Date('2026-10-07T14:30:00+02:00')),
      start: new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium' }).format(new Date(2026, 6, 1)),
      end: new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium' }).format(new Date(2026, 6, 14)),
    }));
    assert.ok(txt.includes(want.date), `termín 2026-10-20 as "${want.date}" (not shifted): ${txt}`);
    assert.ok(txt.includes(want.dt), `schůzka-v in the machine zone, "${want.dt}"`);
    assert.ok(txt.includes(want.start) && txt.includes(want.end), 'cesta shows both dates in one row');
    for (const l of ['Tags', 'Aliases', 'stav', 'počet', 'Source', 'Review', 'Created', 'Modified', 'Unreviewed', 'Rozpracováno', 'hodnota']) assert.ok(txt.includes(l), `shows ${l}`);
    for (const hidden of ['abc-123', 'obal.jpg', 'prázdné', 'seznam', '01JB0R0000000000000000R007']) assert.ok(!txt.includes(hidden), `hides ${hidden}`);
    assert.ok(await seen(page.locator('main [data-user-content]', { hasText: 'Poznámka se všemi druhy vlastností.' })), 'description as the subtitle');
    assert.ok(await seen(strip.getByRole('link', { name: '#projekt' })), 'tags as tag chips');
    assert.ok(await seen(strip.getByRole('link', { name: 'Dvojník', exact: true })), 'relations as link chips');
    const box = await must(strip.getByRole('checkbox'), 'hotovo as a read-only checkbox');
    assert.equal(await box.getAttribute('aria-checked') ?? String(await box.isChecked()), 'true');
    assert.ok(await seen(strip.locator('code', { hasText: 'b: dvě' })), 'nested map as YAML source in code style');
  });
});

test('fr_typ_08_ac5_properties_collapse_is_machine_local_for_every_note', async ({ page }) => {
  const core = await openAt(page, R.vlastnosti);
  const strip = await must(propsRegion(page), 'region "Properties"');
  const head = await must(strip.getByRole('button', { name: 'Properties', exact: true }), 'header button "Properties"');
  assert.equal(await head.getAttribute('aria-expanded'), 'true', 'expanded by default');
  const files = await core.files();
  await head.click();
  assert.equal(await head.getAttribute('aria-expanded'), 'false', 'collapsed');
  assert.ok(await absent(strip.getByText('Rozpracováno')), 'content hidden');
  const stored = await eventually(() => core.uiState(), (s) => s?.propertiesOpen === false, 1000);
  assert.equal(stored?.propertiesOpen, false, 'stored in UI state (machine-local)');
  await openNote(page, 'Jen systémové');
  const other = await must(propsRegion(page).getByRole('button', { name: 'Properties', exact: true }), 'strip of another note');
  assert.equal(await other.getAttribute('aria-expanded'), 'false', 'the state applies to every note');
  assert.deepEqual(await nonReadCalls(core), [], 'no vault write');
  assert.deepEqual(await core.files(), files);
});

test('fr_typ_08_ac6_attribute_values_not_editable', async ({ page }) => {
  const core = await openAt(page, R.vlastnosti);
  const strip = await must(propsRegion(page), 'region "Properties"');
  assert.equal(await strip.locator('[contenteditable]:not([contenteditable="false"]), textarea, input:not([type="checkbox"]), select').count(), 0, 'no editable value');
  const box = await must(strip.getByRole('checkbox'), 'hotovo checkbox');
  await box.click();
  assert.equal(await box.getAttribute('aria-checked') ?? String(await box.isChecked()), 'true', 'unchanged by a click');
  await strip.getByText('Rozpracováno').click();
  await page.keyboard.type('x');
  assert.ok(await seen(strip.getByText('Rozpracováno', { exact: true })), 'text unchanged');
  assert.deepEqual(await nonReadCalls(core), [], 'no write');
});

// ------------------------------------------------------------------------------------------------ NFR-PERF-05

test('nfr_perf_05_ac3_one_link_resolution_call_and_one_read', async ({ page }) => {
  const core = await openAt(page, R.odkazy);
  await mustArticle(page, 'Odkazy');
  await sleep(300);
  const lr = await uiCalls(core, 'link_resolve');
  assert.equal(lr.length, 1, `exactly one link_resolve call (got ${lr.length})`);
  const args = lr[0].args as { from: string; targets: string[] };
  assert.equal(nfc(args.from), R.odkazy, 'from = the note');
  const norm = (t: string) => nfc(t).toLowerCase().replace(/\.md$/, '');
  assert.deepEqual([...new Set(args.targets.map(norm))].sort(), ['2026-10-07', '2026-10-08', 'cíl', 'dvojník', 'neexistuje', 'reading list', 'smazaná', 'šablona'].sort(), 'all body links in the one call');
  assert.deepEqual((await uiCalls(core, 'note_read')).map((c) => nfc(String((c.args as any)?.path))), [R.odkazy], 'note_read exactly once');

  await openNote(page, 'Vlastnosti');
  await mustArticle(page, 'Vlastnosti');
  await sleep(300);
  const lr2 = (await uiCalls(core, 'link_resolve')).slice(1);
  assert.equal(lr2.length, 1, 'one call for Vlastnosti');
  assert.deepEqual([...new Set((lr2[0].args as any).targets.map(norm))].sort(), ['cíl', 'dvojník'], 'frontmatter relations in the same call');
});

// ------------------------------------------------------------------------------------------------ NFR-REL-03

const INVALID: [string, string, number][] = [
  [R.uvozovky, 'invalid YAML', 3], [R.odsazeni, 'invalid YAML', 6], [R.klic, 'invalid YAML', 5],
  [R.tabulator, 'invalid YAML', 5], [R.neuzavrena, 'frontmatter not closed', 1],
];

test('nfr_rel_03_ac3_invalid_frontmatter_opens_in_source_with_a_warning', async ({ browser }) => {
  test.setTimeout(120_000);
  for (const [path, kind, line] of INVALID) {
    const page = await browser.newPage();
    const core = await openAt(page, path);
    const alert = await must(page.getByRole('alert'), `${path}: alert`, 5000);
    const tx = await alert.innerText();
    assert.ok(tx.includes(kind) && new RegExp(`\\b${line}\\b`).test(tx), `${path}: "${kind}", line ${line}: ${tx}`);
    assert.ok(await seen(sourceRegion(page)), `${path}: opens in the source view`);
    const ab = await alert.boundingBox();
    const sb = await sourceRegion(page).boundingBox();
    assert.ok(ab && sb && ab.y < sb.y, `${path}: the warning is above the source`);
    await page.keyboard.press('Meta+k');
    assert.ok(await seen(paletteDialog(page)), `${path}: palette works`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+o');
    assert.ok(await seen(switcherDialog(page)), `${path}: switcher works`);
    await page.keyboard.press('Escape');
    assert.ok(await seen(sidebar(page)), `${path}: sidebar shown`);
    assert.deepEqual(await nonReadCalls(core), [], `${path}: no write`);
    await page.close();
  }
});

test('nfr_rel_03_ac4_formatted_view_still_available_with_the_warning', async ({ browser }) => {
  test.setTimeout(120_000);
  const bodies: Record<string, string> = {
    [R.uvozovky]: 'Tělo s chybnou uvozovkou.', [R.odsazeni]: 'Tělo se špatným odsazením.', [R.klic]: 'Tělo s duplicitním klíčem.',
    [R.tabulator]: 'Tělo s tabulátorem.', [R.neuzavrena]: 'Tělo bez uzavřené hlavičky.',
  };
  for (const [path] of INVALID) {
    const page = await browser.newPage();
    await openAt(page, path);
    await must(sourceRegion(page), `${path}: source view`, 5000);
    await (await must(toFormattedButton(page), `${path}: toggle "Show formatted note"`)).click();
    assert.ok(await absent(sourceRegion(page)), `${path}: formatted view`);
    const art = await must(page.getByRole('article'), `${path}: note body`);
    assert.ok((await art.innerText()).includes(bodies[path]), `${path}: body rendered`);
    if (path === R.neuzavrena) assert.ok((await art.innerText()).includes('title: Neuzavřená'), 'Neuzavřená: the whole file is body');
    assert.ok(await seen(page.getByRole('alert')), `${path}: warning still shown`);
    assert.equal(await propsRegion(page).count(), 0, `${path}: no Properties region`);
    await page.close();
  }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03

test('fr_syn_03_ac10_external_change_reloads_in_place', async ({ page }) => {
  const core = await openAt(page, R.cil);
  await mustArticle(page, 'Cíl');
  await scrollToTop(page, headingFn('Druhá kapitola'));
  await sleep(100);
  assert.equal(await firstVisibleBlockText(page), 'Druhá kapitola', 'setup');
  const text = (await core.files())[R.cil];
  await core.setFile(R.cil, text.replace('Výplňový odstavec 3,', 'Změněný odstavec 3,'));
  assert.ok(await seen(page.getByText('Změněný odstavec 3,', { exact: false }), 2000), 'new text shown within 2 s');
  const p = await placement(page, headingFn('Druhá kapitola'));
  assert.ok(p && Math.abs(p.top - p.viewTop) <= 24, `Druhá kapitola still first visible (± one line): ${p && p.top - p.viewTop}`);

  await page.keyboard.press(TOGGLE);
  await must(sourceRegion(page), 'source view');
  await scrollToTop(page, lineFn(94));
  await core.setFile(R.cil, (await core.files())[R.cil].replace('Výplňový odstavec 4,', 'Změněný odstavec 4,'));
  assert.ok(await seen(sourceRegion(page).getByText('Změněný odstavec 4,', { exact: false }), 2000), 'source updates within 2 s');
  assert.ok(await visible(page, lineFn(94)), 'the same line stays visible');
  assert.equal(await page.getByRole('dialog').count(), 0, 'no dialog');
  assert.deepEqual(await nonReadCalls(core), [], 'no write');
});

test('fr_syn_03_ac11_deleted_or_renamed_while_open', async ({ page }) => {
  const core = await openAt(page, R.cil);
  await mustArticle(page, 'Cíl');
  // Renamed by another program: same id, new path.
  await page.evaluate(([from, to]) => {
    const f = (window as any).__teggFake;
    f.vault.files[to] = f.vault.files[from];
    delete f.vault.files[from];
    return f.emit('vault:changed', { paths: [from, to] });
  }, [R.cil, 'Pages/Cíl nový.md']);
  await sleep(500);
  assert.ok(await seen(article(page, 'Cíl')), 'view follows the renamed note');
  assert.match(nfc(await page.getByRole('main').innerText()), /Cíl nový/, 'breadcrumb shows the new name');
  const reads = (await uiCalls(core, 'note_read')).map((c) => nfc(String((c.args as any)?.path)));
  assert.ok(reads.includes('Pages/Cíl nový.md'), 'reloaded from the new path');
  assert.equal(await page.getByRole('status', { name: 'This note was moved or deleted' }).count(), 0, 'not shown as deleted');

  // Moved to .trash/ by another program.
  await page.evaluate(([from, to]) => {
    const f = (window as any).__teggFake;
    f.vault.files[to] = f.vault.files[from];
    delete f.vault.files[from];
    return f.emit('vault:changed', { paths: [from, to] });
  }, ['Pages/Cíl nový.md', '.trash/Pages/Cíl nový.md']);
  assert.ok(await seen(page.getByText('This note was moved or deleted'), 2000), 'deleted-note message');
  assert.equal(await page.getByRole('article').count(), 0, 'no content');
  assert.deepEqual(await nonReadCalls(core), [], 'no write');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06

test('fr_syn_06_ac6_read_view_tour_sends_zero_write_commands', async ({ page }) => {
  test.setTimeout(180_000);
  const core = await openAt(page, R.odkazy);
  const files = await core.files();
  const art = await mustArticle(page, 'Odkazy');
  // Every link, date link and tag of Odkazy.
  const names = await art.getByRole('link').evaluateAll((ls) => ls.map((l) => (l as HTMLElement).getAttribute('aria-label') ?? l.textContent?.trim() ?? ''));
  assert.ok(names.length >= 20, `Odkazy links and tags: ${names.length}`);
  for (let i = 0; i < names.length; i++) {
    await openNote(page, 'Odkazy');
    const l = article(page, 'Odkazy').getByRole('link').nth(i);
    if (!(await seen(l, 1000))) continue;
    await l.click();
    await sleep(100);
  }
  // Every note: open, toggle the source view twice.
  for (const t of ['Bloky', 'Cíl', 'Vlastnosti', 'Jen systémové', 'Bez hlavičky', '2026-10-07', 'Odkazy']) {
    await openNote(page, t);
    await page.keyboard.press(TOGGLE);
    await page.keyboard.press(TOGGLE);
  }
  await openNote(page, 'Vlastnosti');
  const head = propsRegion(page).getByRole('button', { name: 'Properties', exact: true });
  if (await seen(head, 1000)) await head.click();
  await openNote(page, 'Bloky');
  for (const b of await article(page, 'Bloky').locator('[data-callout] button[aria-expanded]').all()) await b.click();
  assert.deepEqual(await nonReadCalls(core), [], 'zero write commands during the tour');
  assert.deepEqual(await core.files(), files, 'in-memory vault unchanged');
  assert.ok((await uiCalls(core, 'link_resolve')).length > 0, 'links were resolved during the tour');
});
