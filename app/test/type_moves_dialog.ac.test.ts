// @vitest-environment jsdom
// Slice 4E-1, L1: the `Change type?` dialog (board TypeJobs A) rendered from a `type_move_plan` answer: docs/acceptance/
// type-moves.md FR-STO-04 AC-5 ("L1 for R101"): fixed rows are disabled, each row offers Content and the plan's
// targets, an empty row is greyed, a target taken by one row is not offered in another, Confirm sends the mapping and
// Cancel sends nothing. The rows are what the core plans (ms4-jobs §14.7: `{ from, name, kind, value, default, offered,
// fixed }`; the UI never computes R101 itself), written here as R101 gives them for Duna › Schůzka.
// Red-test point AP-776: the contract names the module (§14.8) but not the component's props or the field holding
// the rows; this test takes `ChangeTypeDialog({ plan: { rows, needsDialog }, fromName, toName, targetNames, onConfirm,
// onCancel })`. Written from the AC and the contract only (D-61). The module loads inside the tests; its stub renders
// nothing, so the tests fail on the DOM (TS-I1).
import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { computeAccessibleName } from 'dom-accessibility-api';
import { catalog, need } from './read-helpers';

beforeEach(async () => { await catalog().catch(() => {}); });
afterEach(() => cleanup());

const nfc = (s: string) => s.normalize('NFC');
const name = (e: Element) => nfc(computeAccessibleName(e).replace(/\s+/g, ' ').trim());
const ROWS = [
  { from: 'autor', name: 'Autor', kind: 'text', value: 'Frank Herbert', default: 'content', offered: ['místo'], fixed: false },
  { from: 'vydáno', name: 'Vydáno', kind: 'date', value: '1965-08-01', default: 'content', offered: ['datum'], fixed: false },
  { from: 'stav', name: 'Stav', kind: 'select', value: 'Dočtená', default: 'stav', offered: [], fixed: true },
  { from: 'hodnocení', name: 'Hodnocení', kind: 'number', value: '5', default: 'content', offered: ['místo'], fixed: false },
  { from: 'související', name: 'Související', kind: 'relation', value: '[[Babička]]', default: 'content', offered: [], fixed: false },
  { from: 'poznámka', name: 'Poznámka', kind: 'text', value: 'Půjčená od Petra', default: 'content', offered: ['místo'], fixed: false },
  { from: 'isbn', name: 'ISBN', kind: 'text', value: null, default: 'content', offered: ['místo'], fixed: false },
];
const TARGETS = { datum: 'Datum', stav: 'Stav', místo: 'Místo', účastníci: 'Účastníci' };

async function open() {
  const m = await need('../ui/src/types/ChangeTypeDialog.tsx', 'ChangeTypeDialog');
  const confirmed: { from: string; to: string }[][] = [];
  let cancelled = 0;
  const r = render(createElement(m.ChangeTypeDialog, {
    plan: { rows: ROWS, needsDialog: true }, fromName: 'Kniha', toName: 'Schůzka', targetNames: TARGETS,
    onConfirm: (x: { from: string; to: string }[]) => confirmed.push(x), onCancel: () => { cancelled++; },
  }));
  return { r, confirmed, cancelled: () => cancelled };
}
function dialog(): HTMLElement {
  const d = [...document.querySelectorAll('[role="dialog"], dialog')].find((e) => name(e) === 'Change type?');
  assert.ok(d, `dialog "Change type?": ${[...document.querySelectorAll('[role="dialog"], dialog')].map(name).join(', ') || 'none'}`);
  return d as HTMLElement;
}
function combo(label: string): HTMLElement {
  const c = [...dialog().querySelectorAll('[role="combobox"], select')].find((e) => name(e) === label);
  assert.ok(c, `combobox "${label}"`);
  return c as HTMLElement;
}
const disabled = (e: Element) => (e as HTMLSelectElement).disabled === true || e.getAttribute('aria-disabled') === 'true';
/** The option labels a mapping combobox offers (a native select's options, or the listbox it opens). */
async function options(label: string): Promise<string[]> {
  const c = combo(label);
  if (c instanceof HTMLSelectElement) return [...c.options].map((o) => nfc(o.text.trim()));
  await act(async () => { fireEvent.click(c); });
  const id = c.getAttribute('aria-controls');
  const list = (id && document.getElementById(id)) || document.querySelector('[role="listbox"]');
  const out = list ? [...list.querySelectorAll('[role="option"]')].map((o) => nfc((o.textContent ?? '').trim())) : [];
  await act(async () => { fireEvent.keyDown(c, { key: 'Escape' }); });
  return out;
}
async function choose(label: string, option: string) {
  const c = combo(label);
  if (c instanceof HTMLSelectElement) {
    const o = [...c.options].find((x) => nfc(x.text.trim()) === option);
    assert.ok(o, `option ${option} of ${label}`);
    await act(async () => { fireEvent.change(c, { target: { value: o!.value } }); });
    return;
  }
  await act(async () => { fireEvent.click(c); });
  const o = [...document.querySelectorAll('[role="option"]')].find((x) => nfc((x.textContent ?? '').trim()) === option);
  assert.ok(o, `option ${option} of ${label}`);
  await act(async () => { fireEvent.click(o!); });
}
const shown = (label: string) => {
  const c = combo(label);
  return nfc(((c instanceof HTMLSelectElement ? c.options[c.selectedIndex]?.text : c.textContent) ?? '').trim());
};

test('fr_sto_04_ac5_dialog_rows_follow_the_plan', async () => {
  await open();
  const d = dialog();
  const group = [...d.querySelectorAll('[role="group"], fieldset')].find((g) => name(g) === 'Property mapping Kniha → Schůzka');
  assert.ok(group, 'group "Property mapping Kniha → Schůzka"');
  const help = 'Properties mapped to Content are written at the top of the note as Property: value, one line each.';
  assert.ok(nfc(d.textContent ?? '').includes(help), 'the Content help text');
  for (const t of ['Title', 'Tags']) assert.ok(nfc(d.textContent ?? '').includes(t), `${t} shown as fixed`);
  assert.equal(disabled(combo('Stav maps to')), true, 'Stav → Stav is fixed (same key, same value type)');
  assert.equal(shown('Stav maps to'), 'Stav');
  const want: [string, string, string[]][] = [
    ['Autor maps to', 'Content', ['Content', 'Místo']],
    ['Vydáno maps to', 'Content', ['Content', 'Datum']],
    ['Hodnocení maps to', 'Content', ['Content', 'Místo']],
    ['Související maps to', 'Content', ['Content']],
    ['Poznámka maps to', 'Content', ['Content', 'Místo']],
  ];
  const bad: string[] = [];
  for (const [l, def, opts] of want) {
    const got = await options(l);
    if (shown(l) !== def || JSON.stringify([...got].sort()) !== JSON.stringify([...opts].sort())) bad.push(`${l}: ${shown(l)} [${got.join(', ')}]`);
  }
  assert.deepEqual(bad, [], 'defaults and offered targets as planned (Účastníci never: narrower, D-808)');
  const isbn = combo('ISBN maps to');
  assert.ok(disabled(isbn) || isbn.closest('[aria-disabled="true"], [data-empty="true"]'), 'the empty ISBN row is greyed (nothing written)');
});

test('fr_sto_04_ac5_a_target_taken_by_one_row_is_not_offered_in_another', async () => {
  const { confirmed } = await open();
  await choose('Autor maps to', 'Místo');
  assert.deepEqual((await options('Hodnocení maps to')).sort(), ['Content'], 'Místo is taken by Autor');
  assert.deepEqual((await options('Poznámka maps to')).sort(), ['Content'], 'and not offered for Poznámka either');
  await choose('Vydáno maps to', 'Datum');
  const ok = [...dialog().querySelectorAll('button')].find((b) => name(b) === 'Change type');
  assert.ok(ok, 'button "Change type"');
  await act(async () => { fireEvent.click(ok!); });
  assert.equal(confirmed.length, 1, 'Confirm sends the mapping once');
  const m = Object.fromEntries(confirmed[0].map((x) => [x.from, x.to]));
  assert.deepEqual(m, { autor: 'místo', vydáno: 'datum', stav: 'stav', hodnocení: 'content', související: 'content', poznámka: 'content', isbn: 'content' }, 'one entry per schema property (D-813)');
});

test('fr_sto_04_ac5_cancel_sends_nothing', async () => {
  const { confirmed, cancelled } = await open();
  const c = [...dialog().querySelectorAll('button')].find((b) => name(b) === 'Cancel');
  assert.ok(c, 'button "Cancel"');
  await act(async () => { fireEvent.click(c!); });
  assert.equal(cancelled(), 1, 'onCancel');
  assert.equal(confirmed.length, 0, 'no mapping is sent: nothing is written');
});
