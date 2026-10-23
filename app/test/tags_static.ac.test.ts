// MS4 slice 4D-lite, L0: the capture window reads tag colours only (docs/acceptance/tags.md FR-TAG-05 AC-8, D-553,
// D-709; NFR-SEC-03): its capability file gains no other read, and its tag command answers `{ name, color }` per tag
// (`CaptureContextDto.tags: CaptureTagDto[]`, docs/contracts/ms4-tags.md §3, generated app/ui/src/ipc/types.ts).
// Written from the AC and the contract only (D-61).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APP = resolve(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(resolve(APP, rel), 'utf8');
/** The body of `export type <name> = { … }` in types.ts, as `key: type` pairs. */
function fields(ts: string, name: string): Record<string, string> | null {
  const m = new RegExp(`export type ${name} = \\{ ([^}]*) \\};`).exec(ts);
  if (!m) return null;
  return Object.fromEntries(m[1].split(/,\s*/).filter(Boolean).map((f) => { const i = f.indexOf(':'); return [f.slice(0, i).trim(), f.slice(i + 1).trim()]; }));
}

test('fr_tag_05_ac8_capture_window_reads_name_and_colour_only', () => {
  const cap = JSON.parse(read('src-tauri/capabilities/capture.json'));
  assert.deepEqual([...cap.permissions].sort(), [
    'allow-capture-context', 'allow-capture-create', 'allow-capture-draft-get', 'allow-capture-draft-set', 'allow-capture-hide',
    'allow-capture-media-add', 'allow-capture-open-main', 'allow-capture-ready', 'allow-capture-resize', 'allow-capture-saved-show',
    'allow-capture-suggest', 'core:event:allow-listen', 'core:event:allow-unlisten', 'core:window:allow-start-dragging',
  ], 'the capture capability gains no read (no index_tags, tag_objects, note_read)');
  const ts = read('ui/src/ipc/types.ts');
  assert.deepEqual(fields(ts, 'CaptureTagDto'), { name: 'string', color: 'string | null' }, 'CaptureTagDto is { name, color } and nothing else');
  assert.equal(fields(ts, 'CaptureContextDto')?.tags, 'Array<CaptureTagDto>', 'capture_context answers CaptureTagDto[] (was string[])');
});
