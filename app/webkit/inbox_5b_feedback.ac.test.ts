// MS5 slice 5B preview feedback, L5 (WebKit + fake core): docs/acceptance/inbox.md FR-INB-01 AC-13 (the card text as
// simplified Markdown, D-590; tested through the DOM only, no L1 module interface exists) and FR-INB-03 AC-7 (the review
// toggle at the top of every reviewable object, D-591); docs/feedback/ms5-5b.md F7, F8. Interface: inbox.md R60 (card
// row: `.inbox-card-text`, `data-user-content`), R61, daily-notes.md D-330 (the toggle `Mark reviewed` / `Reviewed`,
// `aria-pressed`), the fake core of ms5-capture §11.2. Clock 2026-10-14T12:00 Europe/Prague, region `cs`. Written from
// the ACs and the public interfaces only (D-61). Every lookup goes through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  I, NOW, cardAt, eventually, fileWhen, inboxVault, main, must, nfc, original, reviewedText, runCommand, seen, sidebarCount, sleep, startInbox,
  startMain, swap, vaultWrites, type FakeCoreHandle,
} from './capture-helpers';

test.use({ timezoneId: 'Europe/Prague' });

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-13

/** Replaces the body (everything after the closing `---` line) of a fixture note. */
function withBody(text: string | undefined, body: string): string {
  assert.ok(text !== undefined, 'fixture note exists');
  const end = text!.indexOf('\n---\n', 3);
  assert.ok(end > 0, 'the note has frontmatter');
  return text!.slice(0, end + 5) + body;
}
// The AC's lines. Blank lines are added after `1. chleba` and between the last four lines, because the AC expects
// them as separate blocks (paragraph, `[image]`, `[embed: …]`, the literal HTML); without them CommonMark makes them
// lazy continuation lines of the numbered item (reported as an AC ambiguity).
const Q1_BODY = [
  '## Nákup', 'Polotučné **2 litry**', 'a *rohlíky*', '', '- vejce', '- [x] sýr', '1. chleba', '',
  'Viz [[Plán webu|plán]] a ~~nic~~ a `kód`.', '', '![[foto.png]]', '', '![[Plán webu]]', '', '<b>html</b>', '',
].join('\n');
const LONG = 'Dlouhý odstavec o tom, jak se v Tegg ukládají poznámky do obyčejných souborů Markdown, aby je šlo otevřít i v jiných aplikacích, synchronizovat přes libovolnou službu a číst ještě za dvacet let bez jakéhokoli převodu nebo zvláštního nástroje.';

type TextModel = {
  found: boolean; user: boolean; text: string; strongs: string[]; ems: string[]; strikes: string[]; codes: string[]; anchors: number; bs: number;
  para: { text: string; br: boolean } | null; lis: { text: string; list: string; checkbox: { checked: boolean; disabled: boolean } | null }[];
  viz: boolean; overflow: string; clamped: boolean; ellipsis: boolean;
};
async function textModel(page: Page, path: string): Promise<TextModel> {
  const card = await must(cardAt(page, path), `card ${path}`);
  return card.evaluate((c) => {
    const r = c.querySelector('.inbox-card-text') as HTMLElement | null;
    const none: TextModel = { found: false, user: false, text: '', strongs: [], ems: [], strikes: [], codes: [], anchors: 0, bs: 0, para: null, lis: [], viz: false, overflow: '', clamped: false, ellipsis: false };
    if (!r) return none;
    const t = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
    const strong = [...r.querySelectorAll('strong')];
    const two = strong.find((s) => t(s) === '2 litry') ?? null;
    const em = [...r.querySelectorAll('em')].find((s) => t(s) === 'rohlíky') ?? null;
    let para: TextModel['para'] = null;
    if (two && em) {
      let a: Element | null = two.parentElement;
      while (a && !a.contains(em)) a = a.parentElement;
      if (a && r.contains(a)) para = { text: (a as HTMLElement).innerText.replace(/[ \t]+/g, ' ').replace(/\n+/g, '\n').trim().normalize('NFC'), br: !!a.querySelector('br') };
    }
    const lis = [...r.querySelectorAll('li')].map((li) => {
      const cb = li.querySelector('input[type="checkbox"], [role="checkbox"]') as HTMLInputElement | null;
      return {
        text: t(li), list: li.parentElement?.tagName.toLowerCase() ?? '',
        checkbox: cb ? { checked: cb.checked === true || cb.getAttribute('aria-checked') === 'true', disabled: cb.disabled === true || cb.getAttribute('aria-disabled') === 'true' } : null,
      };
    });
    const blocks = [...r.querySelectorAll('*')].filter((e) => t(e) === 'Viz plán a nic a kód.');
    const s = getComputedStyle(r);
    const clampOf = (e: Element) => { const cs = getComputedStyle(e) as CSSStyleDeclaration & { webkitLineClamp?: string }; return (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') || cs.textOverflow === 'ellipsis'; };
    return {
      found: true, user: r.hasAttribute('data-user-content'), text: (r.textContent ?? '').normalize('NFC'),
      strongs: strong.map(t), ems: [...r.querySelectorAll('em')].map(t), strikes: [...r.querySelectorAll('s')].map(t), codes: [...r.querySelectorAll('code')].map(t),
      anchors: r.querySelectorAll('a').length, bs: r.querySelectorAll('b').length, para, lis, viz: blocks.length > 0,
      overflow: s.overflowY, clamped: r.scrollHeight > r.clientHeight + 1,
      ellipsis: clampOf(r) || [...r.querySelectorAll('*')].some(clampOf) || (r.innerText ?? '').includes('…'),
    };
  });
}

test('fr_inb_01_ac13_the_card_text_is_simplified_markdown', async ({ page }) => {
  const v = inboxVault((f) => {
    f[nfc(I.Q1)] = withBody(f[nfc(I.Q1)], Q1_BODY);
    f[nfc(I.Q2)] = withBody(f[nfc(I.Q2)], `${LONG}\n`);
  });
  const core = await startInbox(page, { vault: v });
  const m = await textModel(page, I.Q1);
  assert.equal(m.found, true, 'the card text region `.inbox-card-text`');
  assert.equal(m.user, true, 'the region is user content (data-user-content)');
  assert.ok(m.strongs.includes('Nákup'), `the heading line Nákup in strong: ${JSON.stringify(m.strongs)}`);
  assert.ok(m.strongs.includes('2 litry'), '2 litry in strong');
  assert.ok(m.ems.includes('rohlíky'), 'rohlíky in em');
  assert.deepEqual(m.para, { text: 'Polotučné 2 litry\na rohlíky', br: true }, 'one paragraph `Polotučné 2 litry` / `a rohlíky` with a br between them');
  assert.deepEqual(m.lis.map((l) => [l.text, l.list, l.checkbox]), [
    ['vejce', 'ul', null], ['sýr', 'ul', { checked: true, disabled: true }], ['chleba', 'ol', null],
  ], 'a bullet list vejce, sýr (checked, disabled checkbox), then a numbered item chleba');
  assert.equal(m.viz, true, 'the paragraph `Viz plán a nic a kód.`');
  assert.equal(m.anchors, 0, 'plán is plain text (no `a` element)');
  assert.ok(m.strikes.includes('nic'), 'nic in s');
  assert.ok(m.codes.includes('kód'), 'kód in code');
  assert.ok(m.text.includes('[image]'), '[image] for the image embed');
  assert.ok(m.text.includes('[embed: Plán webu]'), '[embed: Plán webu] for the note embed');
  assert.ok(m.text.includes('<b>html</b>'), 'the literal text <b>html</b>');
  assert.equal(m.bs, 0, 'no `b` element is created (no HTML from the file is rendered)');
  const order = ['Nákup', 'Polotučné', 'rohlíky', 'vejce', 'sýr', 'chleba', 'Viz', '[image]', '[embed: Plán webu]', '<b>html</b>'].map((x) => m.text.indexOf(x));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), `in the AC's order: ${JSON.stringify(order)}`);
  assert.ok(order.every((i) => i >= 0), 'every part is there');
  for (const fm of ['review:', 'captured:', 'id:', '01JB5B', '---']) assert.ok(!m.text.includes(fm), `frontmatter never shows (${fm})`);
  assert.ok(['hidden', 'clip'].includes(m.overflow), `clamped at the card height (overflow ${m.overflow})`);
  assert.equal(m.clamped, true, 'the long body is cut at the card height');
  assert.equal(m.ellipsis, true, 'with …');
  const h1 = (await cardAt(page, I.Q1).boundingBox())?.height ?? 0;
  const h4 = (await cardAt(page, I.Q4).boundingBox())?.height ?? -1;
  assert.ok(Math.abs(h1 - h4) <= 1, `the fixed card height (Q1 ${h1}, Q4 ${h4})`);
  // A body of one long paragraph wraps instead of running on one line.
  const wrap = await (await must(cardAt(page, I.Q2), 'Q2')).evaluate((c) => {
    const r = c.querySelector('.inbox-card-text') as HTMLElement | null;
    if (!r) return { found: false, lines: 0, overflowX: true };
    const range = document.createRange();
    range.selectNodeContents(r);
    const tops = new Set([...range.getClientRects()].map((x) => Math.round(x.top)));
    return { found: true, lines: tops.size, overflowX: r.scrollWidth > r.clientWidth + 1 };
  });
  assert.deepEqual(wrap, { found: true, lines: wrap.lines, overflowX: false }, 'Q2: the text region, not wider than the card');
  assert.ok(wrap.lines >= 2, `the long paragraph wraps onto several lines (${wrap.lines})`);
  assert.deepEqual(await vaultWrites(core), [], 'rendering writes nothing');
});

// ------------------------------------------------------------------------------------------------ FR-INB-03 AC-7

const toggle = (page: Page) => main(page).getByRole('button', { name: /^(Mark reviewed|Reviewed)$/ });
const TEMPLATES = ['_templates/Quick Note/Quick Note.md', '_templates/Nápad/Nápad.md'];

/** Opens `path` in a fresh page of the same context and returns the toggle state there (null when absent). */
async function stateOn(page: Page, path: string): Promise<{ count: number; name: string | null; pressed: string | null; right: boolean | null; writes: string[] }> {
  const p = await page.context().newPage();
  try {
    // Templates are never restored as the last note: open every path by its route (as convert.ac.test.ts does).
    await p.addInitScript((r) => { (window as any).__TEGG_ROUTE__ = r; }, `note/${nfc(path)}`);
    const core = await startMain(p, { at: path });
    await must(p.getByRole('textbox', { name: 'Title', exact: true }).or(p.locator('[aria-label="Title"]')), `${path}: the note`, 5000);
    await sleep(400);
    const count = await toggle(p).count();
    if (count === 0) return { count, name: null, pressed: null, right: null, writes: await vaultWrites(core) };
    const t = toggle(p).first();
    const tb = await t.boundingBox();
    const title = p.locator('[aria-label="Title"]').first();
    const hb = await title.boundingBox();
    const right = !!tb && !!hb && tb.x > hb.x && tb.y < hb.y + hb.height && tb.y + tb.height > hb.y;
    return { count, name: (await t.getAttribute('aria-label')) ?? nfc((await t.innerText()).trim()), pressed: await t.getAttribute('aria-pressed'), right, writes: await vaultWrites(core) };
  } finally {
    await p.close();
  }
}

test('fr_inb_03_ac7_the_toggle_shows_on_reviewable_objects_only', async ({ page }) => {
  await startMain(page);
  const not = ['Q1', 'Q2', 'Q4', 'Q5', 'T1', 'S1', 'N1', 'N2'] as const;
  for (const k of not) {
    const s = await stateOn(page, I[k]);
    assert.deepEqual([s.count, s.name, s.pressed, s.right], [1, 'Mark reviewed', 'false', true], `${k}: "Mark reviewed" (not pressed) right of the title row`);
    assert.deepEqual(s.writes, [], `${k}: opening writes nothing`);
  }
  for (const k of ['Q3', 'DQ'] as const) {
    const s = await stateOn(page, I[k]);
    assert.deepEqual([s.count, s.name, s.pressed, s.right], [1, 'Reviewed', 'true', true], `${k}: "Reviewed" (pressed)`);
  }
  for (const p of [I.P2, I.DP, I.Holy, ...TEMPLATES]) {
    const s = await stateOn(page, p);
    assert.equal(s.count, 0, `${p}: no review toggle`);
  }
  // A Daily Note keeps only the daily header's toggle (D-330).
  for (const [k, pressed] of [['D1', 'false'], ['D2', 'true']] as const) {
    const s = await stateOn(page, I[k]);
    assert.deepEqual([s.count, s.pressed], [1, pressed], `${k}: one toggle (the daily header's), pressed ${pressed}`);
  }
});

async function inboxCountNow(page: Page) {
  return sidebarCount(page);
}
async function activate(page: Page) {
  const t = await must(toggle(page), 'the review toggle');
  await t.click();
}

test('fr_inb_03_ac7_activating_the_toggle_writes_review', async ({ page }) => {
  const core: FakeCoreHandle = await startMain(page, { at: I.N2 });
  await must(page.locator('[aria-label="Title"]'), 'N2', 5000);
  assert.equal(await inboxCountNow(page), '13', 'the Inbox count before');
  await activate(page);
  const n2 = swap(original(I.N2), 'modified: 2026-09-30T09:00:00+02:00\n---\n', `modified: ${NOW}\nreview: reviewed\n---\n`);
  assert.equal(await fileWhen(core, I.N2, (t) => t !== original(I.N2)), n2, 'N2: review: reviewed appended after the last entry, modified updated (D-562)');
  assert.deepEqual(await core.writesTo(), [nfc(I.N2)], 'N2 written once');
  const shown = await eventually(async () => [await toggle(page).first().getAttribute('aria-label') ?? (await toggle(page).first().innerText()).trim(), await toggle(page).first().getAttribute('aria-pressed')], (x) => x[1] === 'true', 2000);
  assert.deepEqual(shown, ['Reviewed', 'true'], 'shows Reviewed (pressed)');
  await sleep(500);
  assert.equal(await inboxCountNow(page), '13', 'the Inbox count is unchanged (N2 wasn\'t a member)');
  // Q1: unreviewed → reviewed, the count drops to 12; again: back to unreviewed.
  const p = await page.context().newPage();
  const core1 = await startMain(p, { at: I.Q1 });
  await must(p.locator('[aria-label="Title"]'), 'Q1', 5000);
  await activate(p);
  assert.equal(await fileWhen(core1, I.Q1, (t) => t !== original(I.Q1)), reviewedText(I.Q1), 'Q1: review: unreviewed → reviewed and modified');
  assert.equal(await eventually(() => inboxCountNow(p), (c) => c === '12', 2000), '12', 'the Inbox count drops to 12 within 2 s');
  await activate(p);
  const back = swap(original(I.Q1), 'modified: 2026-10-14T08:15:00+02:00', `modified: ${NOW}`);
  assert.equal(await fileWhen(core1, I.Q1, (t) => !!t?.includes('review: unreviewed')), back, 'activating again writes review: unreviewed');
  // The palette commands do the same on these objects (S1: an explicit value on a workflow-off type).
  const p2 = await page.context().newPage();
  const core2 = await startMain(p2, { at: I.S1 });
  await must(p2.locator('[aria-label="Title"]'), 'S1', 5000);
  await runCommand(p2, 'Mark reviewed');
  assert.ok((await fileWhen(core2, I.S1, (t) => !!t?.includes('review: reviewed')))?.includes('review: reviewed'), 'palette Mark reviewed on S1');
  assert.equal(await eventually(async () => toggle(p2).first().getAttribute('aria-pressed'), (x) => x === 'true', 2000), 'true', 'the toggle follows the palette');
  assert.ok(await seen(toggle(p2), 100), 'the toggle is there');
});
