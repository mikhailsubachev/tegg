// Read view: the formatted, read-only note body (FR-EDT-02 display, slice 3B; docs/contracts/ms3-shell.md §11.3).
// Built from the `@tegg/doc` mdast with the dialect's extensions. Note HTML is never rendered as HTML (D-145):
// it, math and footnotes are shown as source text. Query fences are query blocks (slice Q); a mindmap is drawn (slice MM).
import { cloneElement, Fragment, isValidElement, useMemo, useState, type ReactNode } from 'react';
import { chipIcon } from '../links/icons';
import { chipParts, joinDescriptions } from '../links/ChipParts';
import { requestOffer } from '../links/offer';
import { calloutBody, displayTables, displayTablesAt, isMindmapBlock, isMindmapHint, markdownTree, mindmapTree, parse, wikilinks } from '@tegg/doc';
import { MindmapMap } from '../mindmap/MindmapMap';
import type { MindmapEdit } from '@tegg/editor';
import { t } from '../i18n/catalog';
import type { LinkTargetDto } from '../ipc/types';
import type { EmbedTree } from '../embeds/tree';
import { Icon, typeIconName } from '../shell/Icon';
import { calloutType } from './callout';
import { QueryBlock } from '../queries/QueryBlock';
import { MediaView } from '../media/MediaView';
import { openDate } from '../daily/open';
import { useReference, type ReferenceOpts } from '../preview/useReference';
import type { PreviewTarget } from '../preview/types';

export type ReadViewProps = {
  text: string;
  path: string;
  links: Map<string, LinkTargetDto>;
  onOpen: (path: string, fragment?: string) => void;
  onTag: (key: string) => void;
  onExternal: (url: string) => void;
  onScrollInNote: (fragment: string) => void;
  /** 4F (ms4-embeds §6): the note's embed tree and the renderer of one embed; without it, embeds render as before. */
  embeds?: EmbedTree;
  renderEmbed?: (value: string, line: number, inline: boolean) => ReactNode;
  /** 4F: lines of the file before `text` (an embedded section), so embed lines are file lines. */
  lineBase?: number;
  /** 4F: inside an embed frame: a plain container instead of the note's `article`. */
  bare?: boolean;
  /** Slice MM: the note's title, for a synthesized root (D-681); default `title:` or the file name. */
  noteTitle?: string;
  /** Slice MM (mm-mindmap §3.3): only the map of the first block, for the editor's mindmap block. */
  mindmapOnly?: { onNode: (path: number[] | null) => void; readOnly: boolean; edit?: MindmapEdit | null; onFocusedNode?: (path: number[] | null | undefined) => void };
  /** Slice P (v1-previews §3.4): headings never above this level (the preview's title is its `h2`). */
  minHeading?: number;
  /** Slice P (D-934): only the top-level blocks `[from, to)`, each marked `data-preview-block` (a windowed preview). */
  range?: [number, number];
};

// mdast nodes of `@tegg/doc` (with its wikiLink, tag, highlight and comment nodes), read structurally.
type Any = { type: string; [k: string]: any };

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|svg|bmp|tiff?|avif)$/i;
const ATTACHMENT = /\.([A-Za-z0-9]{1,6})$/;
const EXTERNAL = /^(https?:|mailto:)/i;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const BLOCK_ID = /[ \t]\^([A-Za-z0-9-]+)[ \t]*$/;

/** A wikilink's inner text → target, subpath (without `#`) and alias; `\|` is the table-cell form. */
export function splitWikilink(value: string): { target: string; subpath: string | null; alias: string | null } {
  const bar = value.search(/\\?\|/);
  const head = bar < 0 ? value : value.slice(0, bar);
  const alias = bar < 0 ? null : value.slice(bar).replace(/^\\?\|/, '');
  const hash = head.indexOf('#');
  return {
    target: (hash < 0 ? head : head.slice(0, hash)).trim(),
    subpath: hash < 0 ? null : head.slice(hash + 1).trim() || null,
    alias: alias === null ? null : alias.trim() || null,
  };
}

const isAttachment = (target: string) => {
  const m = ATTACHMENT.exec(target);
  return !!m && m[1].toLowerCase() !== 'md' && !/^\d{4}-\d{2}-\d{2}$/.test(target);
};

function decode(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

/** A Markdown link URL that points at a note in the vault (relative, no scheme, not a fragment). */
function noteUrl(url: string): string | null {
  if (!url || url.startsWith('#') || SCHEME.test(url) || url.startsWith('//')) return null;
  const path = decode(url.split('#')[0]);
  if (path === '' || isAttachment(path)) return null;
  return path;
}

function walk(n: Any, f: (n: Any) => void) {
  f(n);
  if ('children' in n) for (const c of n.children as Any[]) walk(c, f);
}

/** The targets to send to `link_resolve` (body + frontmatter relations, no attachments), deduplicated. */
export function linkTargets(text: string): string[] {
  const out: string[] = [];
  const add = (t: string) => {
    if (t !== '' && !out.includes(t)) out.push(t); // 6A: file embeds resolve too (R77)
  };
  const doc = parse(text);
  for (const l of wikilinks(doc)) add(l.target.trim());
  walk(markdownTree(displayTables(text.slice(doc.bodyStart))) as Any, (n) => {
    if (n.type === 'link') {
      const p = noteUrl(n.url);
      if (p) add(p);
    }
    if (n.type === 'wikiLink' && !n.embed) add(splitWikilink(String(n.value)).target.trim()); // links of D-606 tables
  });
  return out;
}

/** Heading ids derived from the text, unique within the note. */
function slugger() {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = text.normalize('NFC').toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-') || 'heading';
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n + 1}`;
  };
}

function plainText(n: Any): string {
  if (n.type === 'text' || n.type === 'inlineCode') return n.value;
  if (n.type === 'wikiLink') return splitWikilink(n.value).alias ?? splitWikilink(n.value).target;
  if (n.type === 'tag') return `#${n.value}`;
  if ('children' in n) return (n.children as Any[]).map(plainText).join('');
  return '';
}

type Ctx = ReadViewProps & { src: string; slug: (s: string) => string; inLink: boolean; lineOffset: number; tops: WeakSet<object>; readOnlyTables?: Set<number>; title: string;
  /** Inside a mindmap node: embeds show their chip only and files are never read (D-774). */
  inMap?: boolean };

/** Slice P (R104 rows 2, 11): a chip that is a reference: click, double-click, keys and hover map through R103. */
function RefChip(p: Parameters<typeof Chip>[0] & { reference: ReferenceOpts }) {
  const parts = p.info ? chipParts(p.info) : null;
  const { props } = useReference(p.reference, { description: joinDescriptions(p.description, parts?.description) });
  return <Chip {...p} refProps={props} />;
}

function Chip({ kind, name, type, description, disabled, onActivate, info, reference, refProps }: {
  kind: string; name: string; type: string | null; description?: string; disabled?: boolean; onActivate?: (el: HTMLElement) => void;
  /** D-600: the resolved target, for the Unreviewed mark and a task's suffix. */
  info?: LinkTargetDto;
  /** Slice P: the chip is a reference (its target, or null when broken; its open; the Create offer). */
  reference?: ReferenceOpts;
  refProps?: React.HTMLAttributes<HTMLElement>;
}) {
  if (reference && !refProps) return <RefChip kind={kind} name={name} type={type} description={description} disabled={disabled} info={info} reference={reference} />;
  const act = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!disabled) onActivate?.(e.currentTarget as HTMLElement);
  };
  const icon = type && kind !== 'external' ? chipIcon(type) : null;
  const parts = info ? chipParts(info) : null;
  return (
    <a
      href="#"
      tabIndex={0}
      className={`chip link-chip kind-${kind}`}
      data-link-kind={kind}
      {...parts?.attrs}
      aria-description={joinDescriptions(description, parts?.description)}
      aria-disabled={disabled ? 'true' : undefined}
      onClick={act}
      onKeyDown={(e) => e.key === 'Enter' && act(e)}
      {...refProps}
    >
      {parts?.icon ?? (type && (icon ? <Icon name={icon.glyph} dataIcon={icon.def} size={13} /> : <Icon name="link" size={13} />))}
      <span data-user-content>{name}</span>
      {parts?.suffix}
    </a>
  );
}

function linkInfo(c: Ctx, target: string): LinkTargetDto | undefined {
  return c.links.get(target) ?? c.links.get(target.normalize('NFC')) ?? c.links.get(target.trim()) ?? c.links.get(target.normalize('NFC').trim());
}

/** A note link chip (wikilink or relative Markdown link). `shown` is the alias or link text, if any. */
function NoteLink({ c, target, subpath, shown }: { c: Ctx; target: string; subpath: string | null; shown: string | null }) {
  if (target === '' && subpath) {
    return <Chip kind="note" name={shown ?? subpath} type="page" onActivate={() => c.onScrollInNote(subpath)} />;
  }
  const info = linkInfo(c, target);
  if (info && (info.kind === 'note' || info.kind === 'daily') && info.path) {
    const title = info.title ?? target;
    const name = shown ?? (subpath && !subpath.startsWith('^') ? `${title} › ${subpath}` : title);
    const open = () => { if (!(info.kind === 'daily' && openDate(target))) c.onOpen(info.path!, subpath ?? undefined); };
    const pt: PreviewTarget = { path: info.path.normalize('NFC'), fragment: subpath, kind: 'note' };
    return <Chip kind={info.kind} name={name} type={info.type} info={info} reference={{ target: pt, kind: 'chip', open, menu: { name } }} />;
  }
  if (info?.kind === 'trashed' && info.path) {
    // 6A (R74): only in the trash: struck through, `In trash`; opens the Trash with its row focused. Never previews (D-939).
    const name = shown ?? info.title ?? target;
    const open = () => c.onOpen(info.path!);
    return <Chip kind="trashed" name={name} type={info.type} info={info} reference={{ target: null, kind: 'chip', open, createOffer: open }} />;
  }
  if (info?.kind === 'date-missing') {
    // FR-DLY-08 AC-5, AC-6 (D-142 ended): never broken; opens the virtual Daily Note, previews `No note for this day yet.`
    const name = shown ?? (subpath && !subpath.startsWith('^') ? `${target} › ${subpath}` : target);
    return <Chip kind="date-missing" name={name} type="daily-note" reference={{ target: { path: '', fragment: null, kind: 'day', key: target.trim() }, kind: 'chip', open: () => void openDate(target) }} />;
  }
  return <Chip kind="unresolved" name={shown ?? (subpath && !subpath.startsWith('^') ? `${target} › ${subpath}` : target)} type={null} description={t('link.noNote', { target })}
    reference={{ target: null, kind: 'chip', open: () => {}, createOffer: (el) => requestOffer({ from: c.path, target, relationTo: null, anchor: el }), menu: { name: target } }} />;
}

function embedPlaceholder(c: Ctx, value: string, inline: boolean, line = 0): ReactNode {
  const { target, subpath } = splitWikilink(value);
  const file = target.split('/').pop() ?? target;
  if (c.inMap) {
    // D-774: in a mindmap node an embed is its chip (D-600 states); a file is a file chip, never read.
    if (isAttachment(target) || IMAGE_EXT.test(target)) {
      return <Chip kind="media" name={file} type={IMAGE_EXT.test(target) ? 'image' : 'pdf'} />;
    }
    return <NoteLink c={c} target={target} subpath={subpath} shown={null} />;
  }
  // 6A (R77, D-630): files render as figures, PDF cards, file cards or `Can't find`; trashed ones as the placeholder.
  if (isAttachment(target) || IMAGE_EXT.test(target)) {
    void subpath; void file;
    const view = <MediaView target={target} info={linkInfo(c, target) as never} onOpen={(p) => c.onOpen(p)} />;
    return inline ? <span className="media-inline">{view}</span> : <div className="media-block">{view}</div>;
  }
  // 4F (ms4-embeds §6): note embeds are rendered by the embed renderer; without one, as a link-mode embed.
  if (c.renderEmbed) return c.renderEmbed(value, line, inline);
  return <LinkModeEmbed c={c} value={value} />;
}

/** A note embed without the embed renderer (L1 of 3B, previews): a link-mode embed of its resolution (D-418). */
function LinkModeEmbed({ c, value }: { c: Ctx; value: string }) {
  const { target, subpath } = splitWikilink(value);
  const info = linkInfo(c, target);
  const ok = info && info.path && (info.kind === 'note' || info.kind === 'daily');
  const title = ok ? (info!.title ?? target) : target;
  const name = subpath && !subpath.startsWith('^') ? `${title} › ${subpath}` : title;
  const icon = chipIcon(ok ? info!.type : info?.kind === 'date-missing' ? 'daily-note' : null);
  const day = info?.kind === 'date-missing';
  const { props } = useReference({
    target: ok ? { path: info!.path!.normalize('NFC'), fragment: subpath, kind: 'note' } : day ? { path: '', fragment: null, kind: 'day', key: target.trim() } : null,
    kind: 'embedLink', // D-1166: an embed opens on a click and doesn't preview by pointer
    open: () => { if (ok) c.onOpen(info!.path!, subpath ?? undefined); else if (day) void openDate(target); },
    createOffer: (el) => requestOffer({ from: c.path, target, relationTo: null, anchor: el }),
  });
  return (
    <a href="#" role="link" tabIndex={0} className={`embed-chip embed-link${ok || info?.kind === 'date-missing' ? '' : ' kind-unresolved'}`} data-embed-mode="link"
      data-embed-state={ok || info?.kind === 'date-missing' ? 'ok' : 'broken'} data-embed-target={info?.path ?? target} data-icon={ok ? icon.def : undefined}
      aria-label={name} aria-description={ok ? t('embed.chip') : t('link.noNote', { target })} {...props}>
      {ok && <Icon name={icon.glyph} dataIcon={icon.def} size={13} />}
      <span data-user-content>{name}</span>
    </a>
  );
}

/** A Markdown image (`![alt](url)`): its alt text or file name, never loaded (no network, NFR-SEC-01; D-630). */
function imagePlaceholder(n: Any, inline: boolean): ReactNode {
  const file = decode(String(n.url).split(/[?#]/)[0]).split('/').pop() || n.url;
  const text = <span className="md-image" data-user-content>{n.alt || file}</span>;
  return inline ? text : <p className="md-image-block">{text}</p>;
}

const src = (c: Ctx, n: Any) => c.src.slice(n.position!.start.offset!, n.position!.end.offset!);
const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;

/** Inline children; inline HTML tags are merged with their closing tag into one source-text code span (D-145). */
function inlines(c: Ctx, nodes: Any[]): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.type === 'html') {
      const open = /^<([A-Za-z][\w-]*)[^>]*?(\/?)>$/.exec(n.value.trim());
      let end = i;
      if (open && !open[2] && !VOID.test(open[1])) {
        const close = nodes.findIndex((m, j) => j > i && m.type === 'html' && new RegExp(`^</${open[1]}\\s*>$`, 'i').test(m.value.trim()));
        if (close > 0) end = close;
      }
      out.push(<code key={i} className="html-source">{c.src.slice(n.position!.start.offset!, nodes[end].position!.end.offset!)}</code>);
      i = end;
      continue;
    }
    out.push(<Fragment key={i}>{inline(c, n)}</Fragment>);
  }
  return out;
}

function inline(c: Ctx, n: Any): ReactNode {
  switch (n.type) {
    case 'text':
      return n.value;
    case 'emphasis':
      return <em>{inlines(c, n.children)}</em>;
    case 'strong':
      return <strong>{inlines(c, n.children)}</strong>;
    case 'delete':
      return <del>{inlines(c, n.children)}</del>;
    case 'highlight':
      return <mark>{inlines(c, n.children)}</mark>;
    case 'inlineCode':
      return <code>{n.value}</code>;
    case 'inlineMath':
      return <code className="math-source">{src(c, n)}</code>;
    case 'break':
      return <br />;
    case 'comment':
      return null;
    case 'footnoteReference':
      return src(c, n);
    case 'html':
      return <code className="html-source">{n.value}</code>;
    case 'tag': {
      if (c.inLink) return `#${n.value}`;
      const key = String(n.value).normalize('NFC').toLowerCase();
      return <TagChip value={String(n.value)} tagKey={key} onTag={c.onTag} />;
    }
    case 'wikiLink': {
      const w = splitWikilink(n.value);
      if (n.embed) return embedPlaceholder(c, n.value, true, c.lineOffset + (n.position?.start.line ?? 0));
      if (c.inLink) return w.alias ?? w.target;
      return <NoteLink c={c} target={w.target} subpath={w.subpath} shown={w.alias} />;
    }
    case 'image':
      return imagePlaceholder(n, true);
    case 'link': {
      const label = inlines({ ...c, inLink: true }, n.children);
      const url = String(n.url);
      if (EXTERNAL.test(url)) {
        const act = (e: React.SyntheticEvent) => {
          e.preventDefault();
          c.onExternal(url);
        };
        return (
          <a href="#" className="external-link" data-link-kind="external" aria-description={t('link.external')} title={url} onClick={act} onKeyDown={(e) => e.key === 'Enter' && act(e)}>
            {label}
            <Icon name="external" size={12} />
          </a>
        );
      }
      const path = noteUrl(url);
      if (path) {
        const sub = url.includes('#') ? decode(url.slice(url.indexOf('#') + 1)) : null;
        return <NoteLink c={c} target={path} subpath={sub} shown={plainText(n) || null} />;
      }
      // Any other scheme (javascript:, file:, data:, …) is plain text with the URL shown (D-145).
      return (
        <span className="unsafe-link">
          {label} <span data-user-content>({url})</span>
        </span>
      );
    }
    case 'linkReference':
    case 'imageReference':
      return src(c, n);
    default:
      return 'children' in n ? inlines(c, n.children) : 'value' in n ? String(n.value) : null;
  }
}

/** A `#tag` chip (R104 row 12, D-937): previews the Tag; opens `tag/<key>`. */
function TagChip({ value, tagKey, onTag }: { value: string; tagKey: string; onTag: (k: string) => void }) {
  const { props } = useReference({ target: { path: '', fragment: null, kind: 'tag', key: tagKey }, kind: 'chip', open: () => onTag(tagKey) });
  return (
    <a href="#" tabIndex={0} className="chip tag-chip" data-tag={tagKey} data-tag-key={tagKey} {...props}>
      <span data-user-content>#{value.normalize('NFC')}</span>
    </a>
  );
}

/** Block ids already taken, per node: the parsed tree is reused across renders (ReadView's memo). */
const takenIds = new WeakMap<object, string | null>();
/** A trailing ` ^id` block id (dialect §5) is removed from the last text node and returned (again on a re-render). */
function takeBlockId(n: Any): string | null {
  if (takenIds.has(n)) return takenIds.get(n)!;
  const kids = n.children as Any[] | undefined;
  const last = kids?.[kids.length - 1];
  const m = last && last.type === 'text' ? BLOCK_ID.exec(last.value) : null;
  if (m && last) last.value = last.value.slice(0, m.index);
  const id = m ? `^${m[1]}` : null;
  takenIds.set(n, id);
  return id;
}

function Callout({ c, n, line, hint }: { c: Ctx; n: Any; line?: number; hint?: boolean }) {
  const first = n.children[0] as Any;
  const firstText = first.children[0] as Any;
  const nl = firstText.value.indexOf('\n');
  const info = calloutType(nl < 0 ? firstText.value : firstText.value.slice(0, nl));
  const [open, setOpen] = useState(info.fold !== '-');
  const rest: Any = { ...first, children: [...(nl < 0 ? [] : [{ ...firstText, value: firstText.value.slice(nl + 1) }]), ...first.children.slice(1)] };
  const body = [...(rest.children.length ? [rest] : []), ...n.children.slice(1)] as Any[];
  const name = info.title ?? info.label;
  return (
    <div role="note" className={`callout callout-${info.type}`} data-callout={info.type} aria-label={name} data-src-line={line}>
      <div className="callout-title">
        {hint && <Icon name="mindmap" size={14} />}
        <span className="callout-label">{hint ? t('callout.mindmap') : info.label}</span>
        {info.title && <span className="callout-text" data-user-content>{info.title}</span>}
        {info.fold && (
          <button
            type="button"
            className="callout-fold"
            aria-expanded={open}
            aria-label={t(open ? 'callout.collapse' : 'callout.expand', { title: name })}
            onClick={() => setOpen(!open)}
          >
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
          </button>
        )}
      </div>
      <div className="callout-body" hidden={!open}>
        {blocks(c, body)}
      </div>
      {hint && <div className="mindmap-hint-text">{t('mindmap.notOneList')}</div>}
    </div>
  );
}

/** Each item's first paragraph by its path id, read as `mindmapTree` reads the list (children of every list directly
 *  inside an item, D-774), from the callout's body read on its own (D-765). */
function mindmapParagraphs(raw: string): { body: string; paragraphs: Map<string, Any | null> } {
  const body = calloutBody(raw);
  const paragraphs = new Map<string, Any | null>();
  const walk = (li: Any, path: number[]) => {
    const kids = li.children as Any[];
    paragraphs.set(path.join('.'), kids[0]?.type === 'paragraph' ? kids[0] : null);
    let k = 0;
    for (const l of kids.filter((x) => x.type === 'list')) for (const c of l.children as Any[]) walk(c, [...path, k++]);
  };
  const list = (markdownTree(body) as unknown as Any).children[0];
  if (list?.type === 'list') (list.children as Any[]).forEach((li, i) => walk(li, [i]));
  return { body, paragraphs };
}

/** Slice MM (R91): the mindmap block of the read view: always the Map, nodes read-only, links clickable (D-684). */
function MindmapFigure({ c, raw, line }: { c: Ctx; raw: string; line?: number }) {
  const tree = mindmapTree(raw, c.title)!;
  const { body, paragraphs } = mindmapParagraphs(raw);
  const [open, setOpen] = useState(tree.fold !== '-');
  const title = tree.title;
  const cMap: Ctx = { ...c, src: body, inMap: true, inLink: false };
  const content = (id: string) => {
    if (id === 'root') return tree.root.kind === 'synthesized' ? <span data-user-content>{tree.root.text}</span> : null;
    const p = paragraphs.get(id);
    return p ? inlines(cMap, p.children as Any[]) : null;
  };
  // D-600: a task chip's `<due> · <status>` suffix takes room in its node.
  const chipSuffix = (target: string) => { const i = linkInfo(c, target); return i && i.status ? [i.due, i.status].filter(Boolean).join(' · ') + ' ·' : null; };
  const map = <MindmapMap tree={tree} label={t('mindmap.tree', { title: title ?? t('mindmap.untitled') })} content={content} chipSuffix={chipSuffix}
    onNode={c.mindmapOnly?.onNode} readOnly={c.mindmapOnly ? c.mindmapOnly.readOnly : true} edit={c.mindmapOnly?.edit ?? null} onFocusedNode={c.mindmapOnly?.onFocusedNode} />;
  if (c.mindmapOnly) return map;
  return (
    <figure className="mindmap-block" data-mindmap="" data-view="map" data-layout={tree.layout} data-callout="mindmap" aria-label={title ? t('mindmap.figure', { title }) : t('mindmap.untitled')} data-src-line={line}>
      <div className="mindmap-header">
        <Icon name="mindmap" size={15} dataIcon="mindmap" />
        <span className={`mindmap-title${title ? '' : ' untitled'}`} data-user-content={title ? '' : undefined}>{title ?? t('mindmap.untitled')}</span>
        {tree.fold && (
          <button type="button" className="icon-button small mindmap-fold" aria-expanded={open}
            aria-label={t(open ? 'callout.collapse' : 'callout.expand', { title: title ?? t('mindmap.untitled') })} onClick={() => setOpen(!open)}>
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
          </button>
        )}
      </div>
      {open && <div className="mindmap-map" data-map-area="">{map}</div>}
    </figure>
  );
}

const isCallout = (n: Any) => {
  const p = n.children?.[0] as Any;
  return p?.type === 'paragraph' && p.children[0]?.type === 'text' && /^\[![^\]|\s]+(?:\|[^\]]*)?\][+-]?/.test(p.children[0].value);
};

function CodeBlock({ lang, children, className, line }: { lang?: string | null; children: string; className?: string; line?: number }) {
  return (
    <div className={`code-block ${className ?? ''}`} data-src-line={line}>
      {lang && <span className="code-lang" data-user-content>{lang}</span>}{lang && ' '}
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  );
}

/** A paragraph that holds only one embed or image becomes a block placeholder. */
function soleEmbed(n: Any): Any | null {
  const kids = (n.children as Any[]).filter((k) => !(k.type === 'text' && k.value.trim() === ''));
  if (kids.length !== 1) return null;
  const k = kids[0];
  return (k.type === 'wikiLink' && k.embed) || k.type === 'image' ? k : null;
}

function block(c: Ctx, n: Any, key: number): ReactNode {
  switch (n.type) {
    case 'heading': {
      const id = takeBlockId(n);
      const Tag = `h${Math.min(6, Math.max(c.minHeading ?? 0, n.depth + 1))}` as 'h2';
      const text = plainText(n).normalize('NFC').trim();
      return (
        <Tag key={key} id={id ?? c.slug(text)} data-heading={text}>
          {inlines(c, n.children)}
        </Tag>
      );
    }
    case 'paragraph': {
      const raw = src(c, n).trim();
      if (/^%%[\s\S]*%%$/.test(raw)) return null; // comment block (dialect §4)
      const sole = soleEmbed(n);
      // D-419: only a top-level sole-embed paragraph is a block embed; elsewhere the embed stays in its paragraph.
      if (sole && (sole.type === 'image' || !c.renderEmbed || c.tops.has(n))) {
        const ph = sole.type === 'image' ? imagePlaceholder(sole, false) : embedPlaceholder(c, sole.value, false, c.lineOffset + (sole.position?.start.line ?? 0));
        return isValidElement(ph) ? cloneElement(ph, { key }) : ph;
      }
      const id = takeBlockId(n);
      return (
        <p key={key} id={id ?? undefined}>
          {inlines(c, n.children)}
        </p>
      );
    }
    case 'list': {
      const items = (n.children as Any[]).map((li, i) => {
        const id = li.children?.length ? takeBlockId(li.children[li.children.length - 1]) : null;
        const content = li.children.length === 1 && li.children[0].type === 'paragraph' && !n.spread ? inlines(c, li.children[0].children) : blocks(c, li.children);
        // The source markers stay in the text (`3.`, `1)`, `[x]`), styled as markers, so nothing written is lost.
        const head = /^\s*(\d+[.)]|[-*+])\s*(?:\[([ xX])\])?/.exec(src(c, li));
        const marker = n.ordered ? <span className="list-marker">{head?.[1] ?? `${(n.start ?? 1) + i}.`}{' '}</span> : null;
        if (typeof li.checked === 'boolean') {
          const label = plainText(li).trim();
          return (
            <li key={i} id={id ?? undefined} className="check-item">
              {marker}
              <span role="checkbox" aria-checked={li.checked} aria-readonly="true" aria-label={label} className={`check ${li.checked ? 'on' : ''}`} tabIndex={0}>
                <span className="check-src">{head?.[2] ?? ''}</span>
              </span>{' '}
              <span>{content}</span>
            </li>
          );
        }
        return (
          <li key={i} id={id ?? undefined}>
            {marker}
            {content}
          </li>
        );
      });
      return n.ordered ? (
        <ol key={key} start={n.start ?? 1} className="with-markers">
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      );
    }
    case 'blockquote':
      // Slice MM (D-680, D-769): a top-level `mindmap` callout holding one list is drawn; one holding anything else
      // is the hint callout. Nested ones are ordinary callouts.
      if (c.tops.has(n) && isMindmapBlock(src(c, n))) return <MindmapFigure key={key} c={c} raw={src(c, n)} />;
      if (isCallout(n)) return <Callout key={key} c={c} n={n} hint={c.tops.has(n) && isMindmapHint(src(c, n))} />;
      return <blockquote key={key}>{blocks(c, n.children)}</blockquote>;
    case 'code': {
      const lang = n.lang ? String(n.lang) : null;
      // Slice Q (R140, R141, D-1464, D-1499): a fence whose info string's first word is exactly `query` is a query
      // block at any depth; the host is the note shown (an embed's own note, FR-QRY-03 AC-6).
      if (lang === 'query') return <QueryBlock key={key} source={{ kind: 'fence', body: String(n.value ?? '') }} host={c.path} />;
      return <CodeBlock key={key} lang={lang}>{n.value}</CodeBlock>;
    }
    case 'math':
      return <CodeBlock key={key} className="math-source">{src(c, n)}</CodeBlock>;
    case 'thematicBreak':
      return <hr key={key} />;
    case 'table': {
      const align = (i: number) => (n.align?.[i] ?? undefined) as 'left' | 'center' | 'right' | undefined;
      const [head, ...rows] = n.children as Any[];
      return (
        <div key={key} className="table-wrap" {...(c.readOnlyTables?.has(n.position?.start?.line) ? { 'data-table-readonly': '', 'aria-description': t('table.readOnly') } : {})}>
          <table>
            <thead>
              <tr>
                {head.children.map((cell: Any, i: number) => (
                  <th key={i} style={{ textAlign: align(i) }}>
                    {inlines(c, cell.children)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, j) => (
                <tr key={j}>
                  {r.children.map((cell: Any, i: number) => (
                    <td key={i} style={{ textAlign: align(i) }}>
                      {inlines(c, cell.children)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'html':
      return <CodeBlock key={key} className="html-source">{n.value}</CodeBlock>;
    case 'footnoteDefinition':
    case 'definition':
      return (
        <p key={key} className="source-text">
          {src(c, n)}
        </p>
      );
    default:
      return 'children' in n ? <div key={key}>{blocks(c, n.children)}</div> : 'value' in n ? <p key={key}>{String(n.value)}</p> : null;
  }
}

function blocks(c: Ctx, nodes: Any[]): ReactNode[] {
  return nodes.map((n, i) => block(c, n, i));
}

/** Top-level blocks carry their 1-based file line (`data-src-line`), so the view can keep the reading position when
 *  the source view is toggled (D-146). Components take it as the `line` prop. */
function topBlocks(c: Ctx, nodes: Any[], lineOffset: number): ReactNode[] {
  for (const n of nodes) c.tops.add(n);
  const [from, to] = c.range ?? [0, nodes.length];
  return nodes.slice(from, to).map((n, k) => {
    const i = from + k;
    const el = block(c, n, i);
    if (!isValidElement(el)) return el;
    const line = lineOffset + n.position!.start.line;
    const mark = c.range ? { 'data-preview-block': i } : {};
    if (typeof el.type === 'string') return cloneElement(el as React.ReactElement<Record<string, unknown>>, { 'data-src-line': line, ...mark });
    if (c.range) return <div key={i} data-preview-block={i}>{cloneElement(el as React.ReactElement<{ line?: number }>, { line })}</div>;
    return cloneElement(el as React.ReactElement<{ line?: number }>, { line });
  });
}

/** The note's title: `title:` or the file name (D-103). */
export function noteTitle(doc: ReturnType<typeof parse>, path: string): string {
  const t = doc.frontmatter?.data?.title;
  return (typeof t === 'string' && t.trim() !== '' ? t : path.split('/').pop()!.replace(/\.md$/, '')).normalize('NFC');
}

export function ReadView(props: ReadViewProps) {
  const text = props.text.replace(/^﻿/, '');
  // Parsed once per text: a windowed preview (D-934) renders again for every scroll step of a long note.
  const { doc, shown, tree } = useMemo(() => {
    const doc = parse(text);
    // D-606: a table GFM would split inside a `[[…|…]]` or with uneven rows is shown as Tegg reads it (lines kept).
    const shown = displayTablesAt(text.slice(doc.bodyStart));
    return { doc, shown, tree: markdownTree(shown.text) as unknown as Any };
  }, [text]);
  const body = shown.text;
  const lineOffset = (props.lineBase ?? 0) + text.slice(0, doc.bodyStart).split('\n').length - 1;
  const c: Ctx = { ...props, src: body, slug: slugger(), inLink: false, lineOffset, tops: new WeakSet(), readOnlyTables: new Set(shown.lines), title: props.noteTitle ?? noteTitle(doc, props.path) };
  if (props.mindmapOnly) {
    const first = (tree.children as Any[])[0];
    if (!first) return null;
    c.tops.add(first);
    return <>{block(c, first, 0)}</>;
  }
  if (props.bare) return <div className="read-view embed-read" data-user-content>{topBlocks(c, tree.children as Any[], lineOffset)}</div>;
  return (
    <article className="read-view" aria-label={noteTitle(doc, props.path)} data-user-content>
      {topBlocks(c, tree.children as Any[], lineOffset)}
    </article>
  );
}
