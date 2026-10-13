// @vitest-environment jsdom
// MS3 slice 3B, L1: the source view shows the file text exactly (FR-EDT-10 AC-2). Written from
// docs/acceptance/read-view.md and docs/contracts/ms3-shell.md §11.3–§11.4 (`read/SourceView.tsx`, region
// `Markdown source`, line elements `data-line`, gutter `aria-hidden`) only (D-61).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { F, fixture, need } from './read-helpers';

afterEach(() => cleanup());

/** Text of one line element without its gutter (aria-hidden parts). */
function lineText(e: Element): string {
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === 3) { out += n.textContent ?? ''; return; }
    if (n.nodeType === 1 && (n as Element).getAttribute('aria-hidden') === 'true') return;
    for (const c of n.childNodes) walk(c);
  };
  walk(e);
  return out;
}

async function shown(text: string): Promise<{ joined: string; numbers: number[] }> {
  const m = await need('../ui/src/read/SourceView.tsx', 'SourceView');
  const { container } = render(createElement(m.SourceView, { text }));
  const region = container.querySelector('[role="region"][aria-label="Markdown source"], section[aria-label="Markdown source"]');
  assert.ok(region, 'region "Markdown source"');
  const lines = [...region!.querySelectorAll('[data-line]')];
  assert.ok(lines.length > 0, 'line elements with data-line');
  return { joined: lines.map(lineText).join('\n'), numbers: lines.map((l) => Number(l.getAttribute('data-line'))) };
}

function expected(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
}
/** The file's final newline may be shown as an empty last line or not (AP: the AC doesn't say). */
function same(got: string, want: string) {
  return got === want || `${got}\n` === want;
}

test('fr_edt_10_ac2_exact_text', async () => {
  const crlf = fixture(F.odkazy).replace(/\r?\n/g, '\r\n');
  assert.ok(crlf.normalize('NFC') !== crlf, 'setup: the Odkazy copy keeps its NFD bytes');
  const cases: [string, string][] = [
    [F.bloky, fixture(F.bloky)],
    [F.vlastnosti, fixture(F.vlastnosti)],
    [F.tabulator, fixture(F.tabulator)],
    ['CRLF copy of Odkazy', crlf],
    ['CRLF copy of Odkazy with a BOM', `﻿${crlf}`],
  ];
  for (const [what, text] of cases) {
    const got = await shown(text);
    const want = expected(text);
    assert.ok(same(got.joined, want), `${what}: shown text differs from the file text\n--- shown (first 300)\n${JSON.stringify(got.joined.slice(0, 300))}\n--- file\n${JSON.stringify(want.slice(0, 300))}`);
    assert.deepEqual(got.numbers, got.numbers.map((_, i) => i + 1), `${what}: data-line numbers are 1-based and consecutive`);
    cleanup();
  }
});
