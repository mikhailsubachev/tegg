// The vault's tags for every surface (docs/contracts/ms4-tags.md §3, §6.2): one `index_tags` answer, re-read on
// `vault:changed` (debounced 200 ms). Colours, display names and Tag file paths come from here.
import { useEffect, useState, type CSSProperties } from 'react';
import { tagChipStyle } from '../theme/tagChip';
import { events, ipc } from '../ipc/client';
import type { TagRowDto } from '../ipc/types';
import { tagKey } from './keys';

let rows: TagRowDto[] = [];
let loaded = false;
const subs = new Set<(r: TagRowDto[]) => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function publish(next: TagRowDto[]) {
  rows = next;
  loaded = true;
  for (const f of subs) f(rows);
  applyColours(rows);
}

export function refreshTags(): Promise<TagRowDto[]> {
  return ipc.tags().then((r) => { publish(r); return r; }, () => rows);
}

function listen() {
  if (listening) return;
  listening = true;
  void events.changed(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void refreshTags(); }, 200);
  }).catch(() => {});
}

/** The current rows (empty before the first answer). */
export function tagRows(): TagRowDto[] {
  return rows;
}

export function useTags(): TagRowDto[] {
  const [r, setR] = useState<TagRowDto[]>(rows);
  useEffect(() => {
    subs.add(setR);
    listen();
    if (!loaded) void refreshTags();
    else setR(rows);
    return () => { subs.delete(setR); };
  }, []);
  return r;
}

/** The colour of a tag by name or key (D-707), or null. */
export function colourOf(nameOrKey: string): string | null {
  const k = tagKey(nameOrKey);
  return rows.find((r) => r.key === k)?.color ?? null;
}

/** The tag a Tag file belongs to (D-692): winners and losers. */
export function tagOfFile(path: string): string | null {
  const p = path.normalize('NFC');
  const r = rows.find((x) => x.file?.path.normalize('NFC') === p || x.losers.some((l) => l.normalize('NFC') === p));
  return r ? r.key : null;
}

/** Inline `#tags` in the editor and the read view carry `data-tag-key`; one style sheet colours them (D-709). */
function applyColours(list: TagRowDto[]) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('tegg-tag-colours') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'tegg-tag-colours';
    document.head.appendChild(el);
  }
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  el.textContent = list
    .filter((r) => r.color)
    .map((r) => `[data-tag-key="${esc(r.key)}"]{background:var(--type-${r.color}-bg) !important;color:var(--type-${r.color}) !important}`)
    .join('\n');
}

/** D-709, D-711: a tag's display name and chip style by name or key, re-rendering when the tags change. */
export function useTagLook(): (nameOrKey: string) => { name: string; style: CSSProperties } {
  const list = useTags();
  return (n: string) => {
    const r = list.find((x) => x.key === tagKey(n));
    return { name: r?.name ?? n.replace(/^#/, '').normalize('NFC'), style: tagChipStyle(r?.color) };
  };
}
