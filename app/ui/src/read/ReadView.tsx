// Read view: the formatted, read-only note body (FR-EDT-02 display, slice 3B; docs/contracts/ms3-shell.md §11.3).
// Built from the `@tegg/doc` mdast with the dialect's extensions. Note HTML is never rendered as HTML (D-145):
// it, math and footnotes are shown as source text. Embeds, queries and mindmaps are R5 placeholders (D-144).
import { cloneElement, Fragment, isValidElement, useState, type ReactNode } from 'react';
import { chipIcon } from '../links/icons';
import { chipParts, joinDescriptions } from '../links/ChipParts';
import { requestOffer } from '../links/offer';
import { displayTables, displayTablesAt, markdownTree, parse, wikilinks } from '@tegg/doc';
import { t } from '../i18n/catalog';
import type { LinkTargetDto } from '../ipc/types';
import type { EmbedTree } from '../embeds/tree';
import { Icon, typeIconName } from '../shell/Icon';
import { calloutType } from './callout';
import { InNotePlaceholder } from './InNotePlaceholder';
import { MediaView } from '../media/MediaView';
import { openDate } from '../daily/open';

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

type Ctx = ReadViewProps & { src: string; slug: (s: string) => string; inLink: boolean; lineOffset: number; tops: WeakSet<object>; readOnlyTables?: Set<number> };

function Chip({ kind, name, type, description, disabled, onActivate, info }: {
  kind: string; name: string; type: string | null; description?: string; disabled?: boolean; onActivate?: (el: HTMLElement) => void;
  /** D-600: the resolved target, for the Unreviewed mark and a task's suffix. */
  info?: LinkTargetDto;
}) {
  const act = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!disabled) onActivate?.(e.currentTarget as HTMLElement);
  };
  const icon = type && kind !== 'external' ? chipIcon(type) : null;
  const parts = info ? chipParts(info) : null;
  return (
    <a
      href="#"
      className={`chip link-chip kind-${kind}`}
      data-link-kind={kind}
      {...parts?.attrs}
      aria-description={joinDescriptions(description, parts?.description)}
      aria-disabled={disabled ? 'true' : undefined}
      onClick={act}
      onKeyDown={(e) => e.key === 'Enter' && act(e)}
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
    return <Chip kind={info.kind} name={name} type={info.type} info={info} onActivate={() => { if (!(info.kind === 'daily' && openDate(target))) c.onOpen(info.path!, subpath ?? undefined); }} />;
  }
  if (info?.kind === 'trashed' && info.path) {
    // 6A (R74): only in the trash: struck through, `In trash`; opens the Trash with its row focused.
    const name = shown ?? info.title ?? target;
    return <Chip kind="trashed" name={name} type={info.type} info={info} onActivate={() => c.onOpen(info.path!)} />;
  }
  if (info?.kind === 'date-missing') {
    // FR-DLY-08 AC-5, AC-6 (D-142 ended): never broken; opens the virtual Daily Note.
    const name = shown ?? (subpath && !subpath.startsWith('^') ? `${target} › ${subpath}` : target);
    return <Chip kind="date-missing" name={name} type="daily-note" onActivate={() => void openDate(target)} />;
  }
  return <Chip kind="unresolved" name={shown ?? (subpath && !subpath.startsWith('^') ? `${target} › ${subpath}` : target)} type={null} description={t('link.noNote', { target })}
    onActivate={(el) => requestOffer({ from: c.path, target, relationTo: null, anchor: el })} />;
}

function embedPlaceholder(c: Ctx, value: string, inline: boolean, line = 0): ReactNode {
  const { target, subpath } = splitWikilink(value);
  const file = target.split('/').pop() ?? target;
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
  const act = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (ok) c.onOpen(info!.path!, subpath ?? undefined);
    else if (info?.kind === 'date-missing') void openDate(target);
    else requestOffer({ from: c.path, target, relationTo: null, anchor: e.currentTarget as HTMLElement });
  };
  return (
    <a href="#" role="link" className={`embed-chip embed-link${ok || info?.kind === 'date-missing' ? '' : ' kind-unresolved'}`} data-embed-mode="link"
      data-embed-state={ok || info?.kind === 'date-missing' ? 'ok' : 'broken'} data-embed-target={info?.path ?? target} data-icon={ok ? icon.def : undefined}
      aria-label={name} aria-description={ok ? t('embed.chip') : t('link.noNote', { target })} onClick={act} onKeyDown={(e) => e.key === 'Enter' && act(e)}>
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
      const act = (e: React.SyntheticEvent) => {
        e.preventDefault();
        c.onTag(key);
      };
      return (
        <a href="#" className="chip tag-chip" data-tag={key} data-tag-key={key} onClick={act} onKeyDown={(e) => e.key === 'Enter' && act(e)}>
          <span data-user-content>#{String(n.value).normalize('NFC')}</span>
        </a>
      );
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

/** A trailing ` ^id` block id (dialect §5) is removed from the last text node and returned. */
function takeBlockId(n: Any): string | null {
  const kids = n.children as Any[] | undefined;
  const last = kids?.[kids.length - 1];
  if (!last || last.type !== 'text') return null;
  const m = BLOCK_ID.exec(last.value);
  if (!m) return null;
  last.value = last.value.slice(0, m.index);
  return `^${m[1]}`;
}

function Callout({ c, n, line }: { c: Ctx; n: Any; line?: number }) {
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
        <span className="callout-label">{info.label}</span>
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
    </div>
  );
}

const isCallout = (n: Any) => {
  const p = n.children?.[0] as Any;
  return p?.type === 'paragraph' && p.children[0]?.type === 'text' && /^\[![^\]\s]+\][+-]?/.test(p.children[0].value);
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
      const Tag = `h${Math.min(6, n.depth + 1)}` as 'h2';
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
      if (isCallout(n)) return <Callout key={key} c={c} n={n} />;
      return <blockquote key={key}>{blocks(c, n.children)}</blockquote>;
    case 'code': {
      const lang = n.lang ? String(n.lang) : null;
      if (lang?.toLowerCase() === 'query') {
        return (
          <InNotePlaceholder key={key} id="query">
            <CodeBlock lang="query">{n.value}</CodeBlock>
          </InNotePlaceholder>
        );
      }
      if (lang?.toLowerCase() === 'mermaid' && /^\s*mindmap\b/.test(String(n.value).split('\n').find((l: string) => l.trim() !== '') ?? '')) {
        return (
          <InNotePlaceholder key={key} id="mindmap">
            <CodeBlock lang="mermaid">{n.value}</CodeBlock>
          </InNotePlaceholder>
        );
      }
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
  return nodes.map((n, i) => {
    const el = block(c, n, i);
    if (!isValidElement(el)) return el;
    const line = lineOffset + n.position!.start.line;
    return typeof el.type === 'string' ? cloneElement(el as React.ReactElement<Record<string, unknown>>, { 'data-src-line': line }) : cloneElement(el as React.ReactElement<{ line?: number }>, { line });
  });
}

/** The note's title: `title:` or the file name (D-103). */
export function noteTitle(doc: ReturnType<typeof parse>, path: string): string {
  const t = doc.frontmatter?.data?.title;
  return (typeof t === 'string' && t.trim() !== '' ? t : path.split('/').pop()!.replace(/\.md$/, '')).normalize('NFC');
}

export function ReadView(props: ReadViewProps) {
  const text = props.text.replace(/^﻿/, '');
  const doc = parse(text);
  // D-606: a table GFM would split inside a `[[…|…]]` or with uneven rows is shown as Tegg reads it (lines kept).
  const shown = displayTablesAt(text.slice(doc.bodyStart));
  const body = shown.text;
  const tree = markdownTree(body) as unknown as Any;
  const lineOffset = (props.lineBase ?? 0) + text.slice(0, doc.bodyStart).split('\n').length - 1;
  const c: Ctx = { ...props, src: body, slug: slugger(), inLink: false, lineOffset, tops: new WeakSet(), readOnlyTables: new Set(shown.lines) };
  if (props.bare) return <div className="read-view embed-read" data-user-content>{topBlocks(c, tree.children as Any[], lineOffset)}</div>;
  return (
    <article className="read-view" aria-label={noteTitle(doc, props.path)} data-user-content>
      {topBlocks(c, tree.children as Any[], lineOffset)}
    </article>
  );
}
