// @vitest-environment jsdom
// Slice G1, L1: the preview seam the graph's column uses (docs/contracts/v1-graph.md §7, amending v1-previews §3, §7;
// D-982, D-987): `show(target, anchor, origin, { placement: 'column', container }, extraLines, extraAction)` renders the
// slice P preview inside the container (no dialog, no resize handle), the lines in order, and the extra action before
// `Open`; FR-GRP-06 AC-1's L1 part. The IPC is mocked (`@tauri-apps/api/mocks`): `embed_load` answers Rozpočet's file of
// the graph fixture. Written from the ACs and the contracts only (D-61). Modules load inside the test (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { graphFiles } from './graph-data';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
afterEach(() => { cleanup(); clearMocks(); });

const ROZPOCET = 'Projekty/Rozpočet 2027.md';

test('fr_grp_06_ac1_preview_column_with_the_connections_line_seam', async () => {
  const prov = await load('../ui/src/preview/PreviewProvider.tsx');
  assert.ok(prov && typeof prov.PreviewProvider === 'function' && typeof prov.usePreview === 'function', 'preview/PreviewProvider.tsx exports PreviewProvider and usePreview (slice P)');
  const text = graphFiles()[ROZPOCET];
  const calls: string[] = [];
  mockIPC((cmd, args: any) => {
    calls.push(cmd);
    if (cmd === 'embed_load') return (args?.paths ?? [ROZPOCET]).map((p: string) => ({ path: p, state: p === ROZPOCET ? 'ok' : 'missing', text: p === ROZPOCET ? text : null, version: p === ROZPOCET ? { mtimeNs: '1', size: text.length, hash: '01' } : null, utf8: true, links: [] }));
    if (cmd === 'vault_types' || cmd === 'tag_objects') return [];
    return null;
  });
  let api: any = null;
  const Probe = () => { api = prov!.usePreview(); return null; };
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(createElement(prov!.PreviewProvider, null, createElement(Probe)));
  assert.ok(api && typeof api.show === 'function', 'usePreview().show');
  let centred = 0;
  await act(async () => {
    api.show({ path: ROZPOCET, fragment: null, kind: 'note' }, { rect: new DOMRect(0, 0, 10, 10) }, 'click', { placement: 'column', container },
      ['Projekt · 6 connections', 'Links to Plán čtvrtletí by relation Podklady · Linked from Plán čtvrtletí'], { label: 'Center graph here', run: () => { centred++; } });
  });
  await waitFor(() => assert.ok(container.querySelector(`[data-preview-path="${ROZPOCET}"]`), 'the preview inside the column container'), { timeout: 2000 }).catch(() => {});
  assert.ok(container.querySelector(`[data-preview-path="${ROZPOCET}"]`), 'the preview renders inside the column container (data-preview-path)');
  const t = (container.textContent ?? '').replace(/\s+/g, ' ');
  const a = t.indexOf('Projekt · 6 connections'), b = t.indexOf('Links to Plán čtvrtletí by relation Podklady · Linked from Plán čtvrtletí');
  assert.ok(a >= 0 && b > a, `both extra lines, in order: ${t}`);
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 0, 'no dialog in column placement');
  assert.equal(container.querySelectorAll('[data-preview-resize]').length, 0, 'no resize handle');
  const buttons = [...container.querySelectorAll('button')].map((x) => (x.textContent ?? '').trim());
  const ci = buttons.indexOf('Center graph here'), oi = buttons.findIndex((x) => x.startsWith('Open'));
  assert.ok(ci >= 0 && oi > ci, `the extra action before Open: ${JSON.stringify(buttons)}`);
  (container.querySelectorAll('button')[ci] as HTMLButtonElement).click();
  assert.equal(centred, 1, 'the extra action runs');
  assert.ok(calls.includes('embed_load') && !calls.includes('note_read') && !calls.includes('nav_opened'), `read through embed_load only: ${calls.join(', ')}`);
});
