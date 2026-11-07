// Slice PIN (docs/contracts/v1-pinned.md §3.1 `editorDrag.ts`; R135, D-1381; FR-HOM-02 AC-13): the editor's chips as
// drag sources. A resolved link chip pins its note, a `#tag` chip its tag, an embed its target. Broken chips, and chips of
// a note in `.trash/`, aren't sources. A drag never edits the note: the press isn't taken from ProseMirror (a short press
// stays the chip's click), the native drag of the chip is refused, and the click after a drag is swallowed (drag.ts).
/** What the editor knows about a link target (its resolver's answer). */
type LinkInfo = { kind: string; path?: string | null; title?: string | null };
import type { DragItem } from './drag';
import { tagKey } from './model';

const nfc = (s: string) => s.normalize('NFC');
const targetOf = (v: string) => v.replace(/^!/, '').split('|')[0].split('#')[0].trim();

/** The drag item for a pressed element inside the editor, or null when it isn't a source. */
export function chipPinRequest(el: Element | null, notePath: string, resolve: (target: string) => LinkInfo | undefined): DragItem | null {
  if (!el || nfc(notePath).startsWith('.trash/')) return null;
  const tag = el.closest('span[data-tag]');
  if (tag) {
    const key = tagKey(tag.getAttribute('data-tag') ?? '');
    return key ? { request: { kind: 'tag', key }, label: `#${tag.getAttribute('data-tag')}`, icon: 'hash' } : null;
  }
  const chip = el.closest('[data-wikilink], [data-embed-target]');
  if (!chip) return null;
  if (chip.getAttribute('data-link-state') && chip.getAttribute('data-link-state') !== 'ok') return null;
  const raw = chip.getAttribute('data-wikilink') ?? chip.getAttribute('data-embed-target') ?? '';
  const info = resolve(nfc(targetOf(raw)));
  if (!info?.path || !(info.kind === 'note' || info.kind === 'daily') || nfc(info.path).startsWith('.trash/')) return null;
  return { request: { kind: 'object', path: nfc(info.path) }, label: info.title ?? targetOf(raw), icon: 'file' };
}
