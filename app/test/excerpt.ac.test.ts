// @vitest-environment jsdom
// MS4 slice 4A, L1: the excerpt link `links/Excerpt.tsx` (docs/contracts/ms4-links.md §5.2; D-277, D-280, D-282).
// FR-LNK-01 AC-4 (marks rendered, chips styled but not separate links, `data-link-here`, `…` at cut ends), FR-LNK-02
// AC-4 (attribute labels: schema Name, catalog label of a universal key, raw key), AC-5 (embed marker `Embed`).
// Written from docs/acceptance/backlinks.md (R15) and the contract only (D-61). The module loads inside each test and
// every lookup uses query* + node:assert, so a missing module fails an assertion (TS-I1).
import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { computeAccessibleName } from 'dom-accessibility-api';
import { catalog, need } from './read-helpers';

const EX = '../ui/src/links/Excerpt.tsx';
const nfc = (s: string) => s.normalize('NFC');
const flat = (s: string) => nfc(s.replace(/\s+/g, ' ').trim());
beforeEach(async () => { await catalog().catch(() => {}); });
afterEach(() => cleanup());

const CIL = { target: 'Cíl', kind: 'note', path: 'Pages/Cíl.md', title: 'Cíl', type: 'page' };
const JANA = { target: 'Jana Nováková', kind: 'note', path: 'Osoby/Jana Nováková.md', title: 'Jana Nováková', type: 'osoba' };
const text = (t: string, ...marks: string[]) => ({ kind: 'text', text: t, marks });
const chip = (t: string, here: boolean, target: any = CIL, ...marks: string[]) => ({ kind: 'link', text: t, target, here, marks });
const occurrence = (kind: 'body' | 'attribute' | 'embed', segments: any[], o: { attribute?: string; attributeName?: string | null; cutStart?: boolean; cutEnd?: boolean } = {}) => ({
  kind, attribute: o.attribute ?? null, attributeName: o.attributeName ?? null, at: { line: 8, byte: 4 },
  excerpt: { segments, cutStart: o.cutStart ?? false, cutEnd: o.cutEnd ?? false },
});

async function show(occ: any, source = 'Schůzky/2026-10-08 Porada.md', readOnly = false) {
  const m = await need(EX, 'Excerpt');
  const { container } = render(createElement(m.Excerpt, { occurrence: occ, source, readOnly }));
  const link = container.querySelector('a, [role="link"]') as HTMLElement | null;
  assert.ok(link, 'the excerpt is one link (R15)');
  return { container, link: link! };
}

test('fr_lnk_02_ac4_attribute_label_is_the_schema_name', async () => {
  const { link } = await show(occurrence('attribute', [text('Připravit '), chip('Cíl', true), text(' předem')], { attribute: 'poznámka', attributeName: 'Poznámka' }));
  assert.equal(flat(link.textContent ?? ''), 'Poznámka: Připravit Cíl předem');
  assert.equal(link.getAttribute('data-occurrence'), 'attribute');
});

test('fr_lnk_02_ac4_universal_keys_use_the_catalog_label_and_unknown_keys_the_raw_key', async () => {
  const d = await show(occurrence('attribute', [text('Souvisí s '), chip('Cíl', true)], { attribute: 'description' }));
  assert.equal(flat(d.link.textContent ?? ''), 'Description: Souvisí s Cíl');
  cleanup();
  const s = await show(occurrence('attribute', [chip('Cíl', true)], { attribute: 'source' }));
  assert.equal(flat(s.link.textContent ?? ''), 'Source: Cíl');
  cleanup();
  const r = await show(occurrence('attribute', [chip('Cíl', true)], { attribute: 'související' }), 'Pages/Bez typu s vlastností.md');
  assert.equal(flat(r.link.textContent ?? ''), 'související: Cíl', 'the raw key when the type has no definition');
});

test('fr_lnk_02_ac4_multiple_relation_marks_only_the_chip_pointing_here', async () => {
  const { link } = await show(occurrence('attribute', [chip('Jana Nováková', false, JANA), text(', '), chip('Cíl', true)], { attribute: 'účastníci', attributeName: 'Účastníci' }), 'Schůzky/Starší porada.md');
  assert.equal(flat(link.textContent ?? ''), 'Účastníci: Jana Nováková, Cíl');
  const chips = [...link.querySelectorAll('[data-link-kind]')] as HTMLElement[];
  assert.deepEqual(chips.map((c) => [flat(c.textContent ?? ''), c.hasAttribute('data-link-here')]), [['Jana Nováková', false], ['Cíl', true]]);
});

test('fr_lnk_02_ac5_embed_excerpt_has_the_embed_marker', async () => {
  const { link } = await show(occurrence('embed', [chip('Cíl', true)]), 'Quick Notes/Rychlá poznámka.md');
  assert.equal(link.getAttribute('data-occurrence'), 'embed');
  assert.match(flat(link.textContent ?? ''), /^Embed ?Cíl$/, 'the marker Embed before the chip');
});

test('fr_lnk_01_ac4_marks_are_rendered_and_chips_are_not_separate_links', async () => {
  const occ = occurrence('body', [text('Text '), text('tučně ', 'strong'), chip('Cíl', true, CIL, 'strong'), text(' a '), text('kurzíva', 'em'), text(', '), text('kód', 'code'), text(' a jiný text '), chip('jiný text', true)]);
  const { link, container } = await show(occ, 'Pages/Odkazy v textu.md');
  assert.equal(link.getAttribute('data-occurrence'), 'body');
  assert.equal(flat(link.textContent ?? ''), 'Text tučně Cíl a kurzíva, kód a jiný text jiný text');
  assert.ok(link.querySelector('strong')?.textContent?.includes('tučně'), 'strong rendered');
  assert.equal(link.querySelector('em')?.textContent, 'kurzíva', 'em rendered');
  assert.equal(link.querySelector('code')?.textContent, 'kód', 'code rendered');
  const chips = [...link.querySelectorAll('[data-link-kind]')] as HTMLElement[];
  assert.equal(chips.length, 2, 'two chips');
  for (const c of chips) {
    assert.equal(c.getAttribute('data-link-kind'), 'note');
    assert.ok(c.hasAttribute('data-link-here'), 'both chips point here');
    assert.notEqual(c.getAttribute('role'), 'link', 'a chip is not a link of its own (AP-208)');
    assert.ok(c.tagName !== 'A' || c.getAttribute('tabindex') === '-1', 'not focusable');
  }
  const links = [...container.querySelectorAll('a[href], [role="link"]')];
  assert.equal(links.length, 1, 'exactly one link: the excerpt');
  assert.ok(computeAccessibleName(link).includes('Cíl'), 'the accessible name is the excerpt text');
});

test('fr_lnk_01_ac4_cut_ends_show_an_ellipsis', async () => {
  const { link } = await show(occurrence('body', [text('být zkrácen na obou koncích: '), chip('Cíl', true), text(' uprostřed dlouhé věty')], { cutStart: true, cutEnd: true }), 'Pages/Odkazy v textu.md');
  const t = flat(link.textContent ?? '');
  assert.ok(t.startsWith('…') && t.endsWith('…'), `… at each cut end: ${t}`);
  cleanup();
  const u = await show(occurrence('body', [text('Nadpis s '), chip('Cíl', true)]), 'Pages/Odkazy v textu.md');
  assert.ok(!flat(u.link.textContent ?? '').includes('…'), 'no … without a cut');
});
