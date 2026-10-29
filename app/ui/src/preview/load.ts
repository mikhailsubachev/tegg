// What a preview shows (v1-previews §3.4; FR-LNK-10, D-933…D-939): read through `embed_load` only (no recency,
// D-138), the cards' targets in one more call, tags through `tag_objects`. A virtual day reads nothing.
import { embedSection, parse, type Section } from '@tegg/doc';
import { ipc } from '../ipc/client';
import type { EmbedNoteDto, LinkTargetDto, TagObjectRowDto, TypeDto, VersionDto } from '../ipc/types';
import { chipTypes, typeNameOf } from '../links/icons';
import { detailsText } from '../links/DuplicateDetails';
import { buildEmbedTree, type EmbedTree } from '../embeds/tree';
import { attributeRows } from '../read/properties';
import { noteTitle } from '../read/ReadView';
import { refreshTags, tagRows } from '../tags/store';
import { tagKey } from '../tags/keys';
import { stripColumns } from '../embeds/strip';
import type { TypeColumn } from '../types/cell';
import type { PreviewTarget } from './types';

/** A preview attribute of the strip (FR-TYP-11): the type's attribute, or a universal key. */
export type StripItem = TypeColumn;

export type PreviewModel =
  | { state: 'ok'; path: string; id: string | null; title: string; type: string; details: string | null;
      strip: StripItem[]; body: 'blocks' | 'properties' | 'empty'; text: string; links: LinkTargetDto[];
      notice: 'noHeading' | 'noBlock' | 'readError' | null; version: VersionDto | null;
      /** The shown part of `text` (a section, a block, or the body). */
      section: Exclude<Section, { kind: 'missing' }>; fragment: string | null; utf8: boolean; tree: EmbedTree; unreviewed: boolean; data: Record<string, unknown> }
  | { state: 'tag'; key: string; name: string; color: string | null; count: number; objects: TagObjectRowDto[]; path: string | null }
  | { state: 'day'; date: string }
  | { state: 'gone' }
  | { state: 'error' };

const nfc = (s: string) => s.normalize('NFC');
const TAG_LIMIT = 10;

function aborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('aborted', 'AbortError');
}

/** The type key of a note: `type:`, else Page (D-103). */
function typeKeyOf(data: Record<string, unknown> | null): string {
  const t = data?.type;
  return typeof t === 'string' && t.trim() !== '' ? nfc(t.trim()).toLowerCase() : 'page';
}

/** Whether the shown part has anything but whitespace and comments. */
function hasBody(text: string, from: number, to: number): boolean {
  return text.slice(from, to).replace(/%%[\s\S]*?%%/g, '').trim() !== '';
}

let dupCache: Promise<Map<string, string>> | null = null;
/** The D-289 details of objects whose title others share (FR-LNK-14; AP-818 e), by NFC path. */
function duplicateDetails(): Promise<Map<string, string>> {
  dupCache ??= ipc.duplicateTitles().then((groups) => {
    const m = new Map<string, string>();
    for (const g of groups ?? []) for (const o of g.objects ?? []) m.set(nfc(o.path), detailsText(o.details, typeNameOf(o.type)));
    return m;
  }, () => new Map());
  return dupCache;
}
/** Drops cached derived data after a vault change. */
export function forgetPreviewCaches(): void {
  dupCache = null;
}

export async function loadTag(key: string, signal: AbortSignal): Promise<PreviewModel> {
  const k = tagKey(key);
  const rows = await ipc.tagObjects(k);
  aborted(signal);
  // The tag's name and colour (its Tag file's, D-707); the tag list is read once if it isn't known yet.
  const known = (tagRows() ?? []).find((r) => r.key === k);
  const row = known ?? ((await refreshTags().catch(() => [])) ?? []).find((r) => r.key === k);
  aborted(signal);
  const sorted = [...rows].sort((a, b) => Number(BigInt(b.modifiedNs ?? '0') - BigInt(a.modifiedNs ?? '0')));
  return { state: 'tag', key: k, name: row?.name ?? key, color: row?.color ?? null, count: rows.length, objects: sorted.slice(0, TAG_LIMIT), path: row?.file ? nfc(row.file.path) : null };
}

export async function loadPreview(target: PreviewTarget, signal: AbortSignal, t: (k: string) => string = (k) => k): Promise<PreviewModel> {
  try {
    if (target.kind === 'day') return { state: 'day', date: target.key ?? '' };
    if (target.kind === 'tag') return await loadTag(target.key ?? '', signal);
    const path = nfc(target.path);
    const [note] = await ipc.embedLoad([path], true);
    aborted(signal);
    if (!note || note.state === 'missing') return { state: 'gone' };
    if (note.state !== 'ok' || note.text === null) return { state: 'error' };
    return await modelOf(note, target, signal, t);
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') throw e;
    return { state: 'error' };
  }
}

async function modelOf(note: EmbedNoteDto, target: PreviewTarget, signal: AbortSignal, t: (k: string) => string): Promise<PreviewModel> {
  const text = (note.text ?? '').replace(/^﻿/, '');
  const doc = parse(text);
  const bad = !!doc.frontmatterError || (!!doc.frontmatter && doc.frontmatter.data === null);
  const data = (bad ? {} : (doc.frontmatter?.data ?? {})) as Record<string, unknown>;
  const typeKey = typeKeyOf(bad ? null : data);
  // D-937: a Tag file (`[[Účty]]`) previews its Tag: the tile, `#<name>`, its objects.
  if (typeKey === 'tag') return loadTag(noteTitle(doc, note.path), signal);
  const types = chipTypes() as TypeDto[];
  const type = types.find((x) => nfc(x.key) === typeKey);
  const title = bad ? nfc(note.path.split('/').pop()!.replace(/\.md$/i, '')) : noteTitle(doc, note.path);
  // `#Heading` / `#^id` (embeds.md FR-EMB-02 AC-3); a miss shows the notice above the whole body (D-936 b).
  const found = embedSection(text, target.fragment);
  let section: Exclude<Section, { kind: 'missing' }>;
  let notice: 'noHeading' | 'noBlock' | 'readError' | null = bad || !note.utf8 ? 'readError' : null;
  if (found.kind === 'missing') {
    notice = found.block ? 'noBlock' : 'noHeading';
    section = { kind: 'whole', from: doc.bodyStart, to: text.length };
  } else section = found;
  const all = note.links;
  const links = new Map<string, LinkTargetDto>();
  for (const l of all) { if (!links.has(l.target)) links.set(l.target, l); if (!links.has(nfc(l.target))) links.set(nfc(l.target), l); }
  const body = hasBody(text, section.from, section.to);
  const rows = bad ? [] : attributeRows(doc).rows;
  // D-936 a: an empty body shows every attribute instead, and no strip.
  // D-938: an Image or PDF object shows its file, then the body if any (no attributes list).
  const kind: 'blocks' | 'properties' | 'empty' = body || typeKey === 'image' || typeKey === 'pdf' ? 'blocks' : rows.length > 0 ? 'properties' : 'empty';
  const strip = body || typeKey === 'image' || typeKey === 'pdf' ? stripColumns(typeKey, data, 4) : [];
  void type; void t;
  // D-933: every embed inside a preview is a card; their targets are read in one more call.
  const tree = await buildEmbedTree({ path: note.path, text, links }, types, (paths) => ipc.embedLoad(paths), { readOnly: true, cards: true, section });
  aborted(signal);
  const details = (await duplicateDetails()).get(nfc(note.path)) ?? null;
  aborted(signal);
  const review = typeof data.review === 'string' ? data.review.trim().toLowerCase() : null;
  const unreviewed = review === 'unreviewed' || ((typeKey === 'quick-note' || typeKey === 'daily-note') && review !== 'reviewed');
  const id = typeof data.id === 'string' ? nfc(data.id) : null;
  return {
    state: 'ok', path: nfc(note.path), id, title, type: typeKey, details, strip, body: kind, text, links: all, notice,
    version: note.version, section, fragment: target.fragment, utf8: note.utf8, tree, unreviewed, data,
  };
}
