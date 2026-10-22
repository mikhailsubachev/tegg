// MS5 slice 5B preview feedback F9, L5 (WebKit + fake core): the capture page (`capture.html`, ms5-capture §4, §11.2)
// against the QuickCapture board's look, docs/acceptance/capture.md R55 "Look", FR-CAP-01 AC-16 (computed styles, light
// and dark, Quick Note and Task) and AC-17's L5 part (D-592: transparent page background, the first line drawn at 650
// weight by an `aria-hidden` mirror layer behind the transparent `textarea`). The L4 part is
// app/src-tauri/tests/ac_capture_chrome.rs, the L6 part app/e2e/ms5_capture_look.ac.test.ts. Colours are compared with
// the theme tokens (`--btn`, `--btn-fg`, `--bg`) as the page computes them. Written from the ACs and the contract only
// (D-61). Every lookup goes through `must` (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  capText, capValue, description, discardBtn, dropZone, dueBtn, focusName, must, prioBtn, saveBtn, sleep, startCapture, typeBtn, typeInCapture,
} from './capture-helpers';

test.use({ timezoneId: 'Europe/Prague' });

/** A theme token as a computed colour (`rgb(…)`), resolved on the page's root (the theme lives on `html`). */
async function token(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const p = document.createElement('span');
    p.style.color = `var(--${n})`;
    document.documentElement.appendChild(p);
    const c = getComputedStyle(p).color;
    p.remove();
    return c;
  }, name);
}
async function style(loc: Locator, what: string) {
  const el = await must(loc, what);
  return el.evaluate((e) => {
    const s = getComputedStyle(e);
    return {
      borderStyle: [s.borderTopStyle, s.borderRightStyle, s.borderBottomStyle, s.borderLeftStyle], borderWidth: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth],
      bg: s.backgroundColor, color: s.color, weight: s.fontWeight, fontSize: s.fontSize, boxShadow: s.boxShadow, outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth,
      height: e.getBoundingClientRect().height, text: ((e as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim(), label: e.getAttribute('aria-label'), title: e.getAttribute('title'),
    };
  });
}
async function tooltip(loc: Locator): Promise<string> {
  const el = await must(loc, 'element with a tooltip');
  return (await el.getAttribute('title')) ?? (await description(loc));
}

/** Texts whose contrast against their background is below 4.5:1 (WCAG AA). The background is the nearest opaque
 *  backgrounds composited; under a transparent page it is the theme's `--bg` (the window's material follows the theme).
 *  The drop zone is excepted while aria-disabled (AC-16). Same text-node scope as axe's `color-contrast`. */
async function lowContrast(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const parse = (c: string): [number, number, number, number] => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return [0, 0, 0, 0];
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    };
    const over = (top: number[], under: number[]) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
    const lum = (c: number[]) => { const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const probe = document.createElement('span');
    probe.style.color = 'var(--bg)';
    document.documentElement.appendChild(probe);
    const base = parse(getComputedStyle(probe).color);
    probe.remove();
    const out: string[] = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = (n.textContent ?? '').trim();
      const el = n.parentElement;
      if (!t || !el || el.getClientRects().length === 0) continue;
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none') continue;
      const dz = el.closest('[aria-disabled="true"]');
      if (dz && dz.getAttribute('aria-label') === 'Add an image or PDF') continue;
      const chain: Element[] = [];
      for (let a: Element | null = el; a; a = a.parentElement) chain.push(a);
      let bg = [...base];
      for (const a of [...chain].reverse()) bg = over(parse(getComputedStyle(a).backgroundColor), bg);
      let alpha = parse(s.color)[3];
      for (const a of chain) alpha *= Number(getComputedStyle(a).opacity || '1');
      if (alpha === 0) continue;
      const fg = over([...parse(s.color).slice(0, 3), alpha], bg);
      const [l1, l2] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      if (ratio < 4.5) out.push(`${t} (${ratio.toFixed(2)}:1)`);
    }
    return out;
  });
}

/** R55's Tab order from `Capture text` forward and Shift-Tab backward. */
async function tabOrder(page: Page): Promise<{ forward: string[]; back: string[] }> {
  const forward: string[] = [];
  const back: string[] = [];
  await capText(page).focus();
  for (let i = 0; i < 5; i++) { await page.keyboard.press('Tab'); forward.push((await focusName(page)).name); }
  await capText(page).focus();
  for (let i = 0; i < 2; i++) { await page.keyboard.press('Shift+Tab'); back.push((await focusName(page)).name); }
  return { forward, back };
}

// ------------------------------------------------------------------------------------------------ FR-CAP-01 AC-16

for (const theme of ['light', 'dark'] as const) {
  for (const kind of ['default', 'task'] as const) {
    const type = kind === 'task' ? 'Task' : 'Quick Note';
    test(`fr_cap_01_ac16_the_boards_look_${theme}_${kind === 'task' ? 'task' : 'quick_note'}`, async ({ page }) => {
      await startCapture(page, { theme, kind });
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme, `${theme} theme`);
      // Text: no border, no outline ring or shadow when focused, 15 px.
      await capText(page).focus();
      const text = await style(capText(page), 'textbox "Capture text"');
      assert.deepEqual(text.borderStyle, ['none', 'none', 'none', 'none'], 'Capture text: border-style none');
      assert.equal(text.boxShadow, 'none', 'Capture text: no box shadow when focused');
      assert.ok(text.outlineStyle === 'none' || text.outlineWidth === '0px', `Capture text: no outline when focused (${text.outlineStyle} ${text.outlineWidth})`);
      assert.equal(text.fontSize, '15px', 'Capture text: 15 px');
      // Type: a 28 px pill on a background, the type name as visible text, `Type: <Name>` as the name.
      const tb = await style(typeBtn(page), 'button "Type: …"');
      assert.ok(Math.abs(tb.height - 28) <= 0.5, `Type: 28 px high (${tb.height})`);
      assert.ok(!['rgba(0, 0, 0, 0)', 'transparent'].includes(tb.bg), `Type: a non-transparent background (${tb.bg})`);
      assert.equal(tb.text, type, 'Type: the visible text is the type name only');
      assert.equal(tb.label, `Type: ${type}`, 'Type: the accessible name stays "Type: <Name>"');
      // Discard: an icon button without visible text, tooltip `Discard · Esc`.
      const dc = await style(discardBtn(page), 'button "Discard"');
      assert.equal(dc.text, '', 'Discard: no visible text');
      assert.equal(await tooltip(discardBtn(page)), 'Discard · Esc', 'Discard: the tooltip');
      if (kind === 'task') {
        for (const [btn, icon, what] of [[dueBtn(page), 'calendar', 'Due'], [prioBtn(page), 'flag', 'Priority']] as const) {
          const el = await must(btn, `button "${what}: …"`);
          assert.equal(await el.locator(`svg[data-icon="${icon}"], [data-icon="${icon}"] svg, svg [data-icon="${icon}"]`).count() > 0, true, `${what}: an svg with data-icon ${icon}`);
          const s = await style(btn, `${what} chip`);
          assert.deepEqual([s.borderStyle[0] !== 'none', s.borderWidth[0]], [true, '1px'], `${what}: a 1 px border`);
        }
      }
      // Drop zone: a dashed border (on the button or its box).
      const dashed = await (await must(dropZone(page), 'drop zone')).evaluate((e) => {
        for (let a: Element | null = e; a && !a.querySelector('textarea'); a = a.parentElement) if (getComputedStyle(a).borderTopStyle === 'dashed') return true;
        return false;
      });
      assert.equal(dashed, true, 'the drop zone has a dashed border');
      // Footer: the box holding the hints and Save has a top border.
      const footer = await (await must(saveBtn(page), 'Save capture')).evaluate((save) => {
        const hint = [...document.querySelectorAll('body *')].find((e) => e.children.length === 0 && ['Lands in the Inbox · unreviewed', 'Saves to Tasks'].includes((e.textContent ?? '').trim())) ?? null; // D-604: a Task's hint is `Saves to Tasks`
        if (!hint) return 'no hint';
        let a: Element | null = save.parentElement;
        while (a && !a.contains(hint)) a = a.parentElement;
        for (; a && !a.querySelector('textarea'); a = a.parentElement) {
          const s = getComputedStyle(a);
          if (s.borderTopStyle !== 'none' && parseFloat(s.borderTopWidth) >= 1) return 'top border';
        }
        return 'no top border';
      });
      assert.equal(footer, 'top border', 'the footer has a top border');
      // Save: `--btn` background, `--btn-fg` text, 600 weight.
      const sv = await style(saveBtn(page), 'Save capture');
      assert.deepEqual([sv.bg, sv.color, sv.weight], [await token(page, 'btn'), await token(page, 'btn-fg'), '600'], 'Save: --btn background, --btn-fg colour, 600 weight');
      // Contrast (AA) of every text, the disabled drop zone excepted.
      assert.deepEqual(await lowContrast(page), [], `no text below 4.5:1 in ${theme}`);
      // The DOM keeps R55's names, roles and Tab order.
      const want = kind === 'task'
        ? ['Due: No date', 'Priority: None', 'Add tag…', 'Add an image or PDF', 'Save capture'] // `No date`: D-602
        : ['Add tag…', 'Add an image or PDF', 'Save capture'];
      const order = await tabOrder(page);
      assert.deepEqual({ forward: order.forward.slice(0, want.length), back: order.back }, { forward: want, back: ['Discard', `Type: ${type}`] }, 'R55 Tab order');
    });
  }
}

// ------------------------------------------------------------------------------------------------ FR-CAP-01 AC-17 (L5)

test('fr_cap_01_ac17_the_page_background_is_transparent', async ({ browser }) => {
  for (const theme of ['light', 'dark'] as const) {
    for (const hash of ['', '#saved'] as const) {
      const ctx = await browser.newContext({ timezoneId: 'Europe/Prague' });
      const page = await ctx.newPage();
      await startCapture(page, { theme, hash: hash || undefined });
      if (hash) await sleep(300);
      const bg = await page.evaluate(() => [getComputedStyle(document.documentElement).backgroundColor, getComputedStyle(document.body).backgroundColor]);
      assert.deepEqual(bg, ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'], `capture.html${hash} in ${theme}: html and body backgrounds are transparent (D-592)`);
      await ctx.close();
    }
  }
});

type Line = { found: boolean; weight: string; bold: boolean; dx: number; dy: number };
/** The mirror's rendering of `needle` (on textarea line `line`): its font weight and its offset from where the
 *  textarea draws that line (left of the content box; the line box top from the line height, scroll included). */
async function mirrorLine(page: Page, needle: string, line: number): Promise<Line> {
  const ta = await must(capText(page), 'textbox "Capture text"');
  return ta.evaluate((t, [nd, ln]) => {
    const none = { found: false, weight: '', bold: false, dx: Infinity, dy: Infinity };
    const mirrors = [...document.querySelectorAll('[aria-hidden="true"]')].filter((m) => (m.textContent ?? '').normalize('NFC').includes(nd as string) && !m.contains(t));
    const m = mirrors[mirrors.length - 1];
    if (!m) return none;
    const walk = document.createTreeWalker(m, NodeFilter.SHOW_TEXT);
    let node: Text | null = null;
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if ((n.textContent ?? '').normalize('NFC').includes(nd as string)) { node = n as Text; break; }
    if (!node) return none;
    const at = (node.textContent ?? '').normalize('NFC').indexOf(nd as string);
    const r = document.createRange();
    r.setStart(node, at);
    r.setEnd(node, at + 1);
    const g = r.getBoundingClientRect();
    const s = getComputedStyle(t);
    const box = t.getBoundingClientRect();
    const lh = s.lineHeight === 'normal' ? parseFloat(s.fontSize) * 1.2 : parseFloat(s.lineHeight);
    const left = box.left + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft);
    const top = box.top + parseFloat(s.borderTopWidth) + parseFloat(s.paddingTop) - t.scrollTop + (ln as number) * lh;
    const glyphTop = g.top - (lh - g.height) / 2;
    const ps = getComputedStyle(node.parentElement!);
    // D-592 fix (v0.52): the title is drawn heavier by a text stroke at the body's weight, so glyph widths stay.
    const bold = parseFloat(ps.fontWeight) >= 600 || parseFloat((ps as any).webkitTextStrokeWidth || '0') > 0;
    return { found: true, weight: ps.fontWeight, bold, dx: Math.abs(g.left - left), dy: Math.abs(glyphTop - top) };
  }, [needle, line] as const);
}

test('fr_cap_01_ac17_the_first_line_is_bold_through_a_mirror', async ({ page }) => {
  await startCapture(page);
  await typeInCapture(page, 'Koupit chleba\na máslo');
  await sleep(100);
  const first = await mirrorLine(page, 'Koupit chleba', 0);
  const second = await mirrorLine(page, 'a máslo', 1);
  assert.equal(first.found, true, 'an aria-hidden mirror layer shows the text');
  assert.equal(first.bold, true, 'the first line is drawn heavier (a stroke at the body weight, D-592 fix)');
  assert.deepEqual([second.weight, second.bold], ['400', false], 'the second line at 400, no stroke');
  for (const [l, n] of [[first, 'Koupit chleba'], [second, 'a máslo']] as const) {
    assert.ok(l.dx <= 1 && l.dy <= 1, `${n}: exactly over the textarea's text (dx ${l.dx}, dy ${l.dy})`);
  }
  // The textarea is still the only textbox; its value and selection are native.
  assert.deepEqual(await page.getByRole('textbox').evaluateAll((es) => es.map((e) => e.getAttribute('aria-label'))), ['Capture text'], 'the textarea is the only textbox');
  assert.equal(await capValue(page), 'Koupit chleba\na máslo', 'the value');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
  const sel = await capText(page).evaluate((t) => [(t as HTMLTextAreaElement).selectionStart, (t as HTMLTextAreaElement).selectionEnd]);
  assert.deepEqual(sel, [18, 21], 'the selection (⇧← three times)');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type(' x');
  await page.keyboard.press('Meta+z');
  await sleep(100);
  const undone = await capValue(page);
  assert.ok(undone.length < 'Koupit chleba\na máslo x'.length && 'Koupit chleba\na máslo x'.startsWith(undone), `⌘Z undoes typing (${JSON.stringify(undone)})`);
  // The mirror beside the textarea (WebKit under Playwright may undo all the typing at once, so its text can't be the
  // lookup key).
  const mirrorText = await capText(page).evaluate((t) => [...(t.parentElement?.querySelectorAll('[aria-hidden="true"]') ?? [])].map((m) => (m.textContent ?? '').normalize('NFC'))[0] ?? null);
  assert.equal(mirrorText?.trimEnd(), undone.trimEnd(), 'the mirror follows the value after ⌘Z');
  // With a vertical scroll: many lines, scrolled to the end; the first line stays aligned. The two lines are set again,
  // since ⌘Z may have undone all of them.
  await capText(page).fill('Koupit chleba\na máslo');
  await capText(page).focus();
  await page.keyboard.press('Meta+ArrowDown');
  for (let i = 1; i <= 30; i++) { await page.keyboard.press('Enter'); await page.keyboard.insertText(`řádek ${i}`); }
  await capText(page).evaluate((t) => { t.scrollTop = t.scrollHeight; t.dispatchEvent(new Event('scroll')); });
  await sleep(150);
  const scrolled = await mirrorLine(page, 'Koupit chleba', 0);
  assert.ok(scrolled.dx <= 1 && scrolled.dy <= 1, `scrolled: still over the textarea's first line (dx ${scrolled.dx}, dy ${scrolled.dy})`);
});

test('fr_cap_01_ac17_an_empty_first_line_makes_the_next_line_bold', async ({ page }) => {
  await startCapture(page);
  await typeInCapture(page, '\n\nKoupit chleba\na máslo');
  await sleep(100);
  const title = await mirrorLine(page, 'Koupit chleba', 2);
  const rest = await mirrorLine(page, 'a máslo', 3);
  assert.deepEqual([title.found, title.bold, rest.weight, rest.bold], [true, true, '400', false], 'the first non-empty line is drawn heavier (AP-467 title rule), the next at 400');
  assert.ok(title.dx <= 1 && title.dy <= 1, `aligned (dx ${title.dx}, dy ${title.dy})`);
});
