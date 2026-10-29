// One embed of R30 (docs/contracts/ms4-embeds.md §6; FR-EMB-02, FR-LNK-07, D-418, D-423…D-425, D-427): a framed full
// embed, a card, a link-mode embed, or a frame for a state that can't show content (R30a). Strings from R33.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { parse, type EmbedMode } from '@tegg/doc';
import { ipc } from '../ipc/client';
import { t } from '../i18n/catalog';
import type { LinkTargetDto, TypeDto } from '../ipc/types';
import { chipIcon, chipTypes } from '../links/icons';
import { isUnreviewed } from '../links/chip';
import { chipParts, joinDescriptions } from '../links/ChipParts';
import { requestOffer } from '../links/offer';
import { openDate } from '../daily/open';
import { Icon } from '../shell/Icon';
import { ReadView } from '../read/ReadView';
import { formatDate } from '../read/PropertiesStrip';
import { TypeCell, type TypeColumn } from '../types/cell';
import type { EmbedNode } from './tree';
import { isTaskCard, TaskEmbed } from './TaskEmbed';
import { useReference } from '../preview/useReference';
import type { PreviewTarget } from '../preview/types';

export type EmbedProps = {
  node: EmbedNode;
  host: string;
  editable: boolean;
  onOpen: (path: string, fragment?: string) => void;
  onMode?: (mode: EmbedMode) => void;
  onEnter?: () => void;
  onCreate?: (el: HTMLElement) => void;
  /** The nested editor of an editable full embed (EmbedEditor), shown instead of the read-only body. */
  body?: ReactNode;
  /** Why `Display as` is unavailable (the read view, D-215), or null. */
  modeDisabled?: string | null;
  onTag?: (key: string) => void;
  onExternal?: (url: string) => void;
  /** Slice P (D-933, FR-LNK-11 AC-10): a card inside a preview is one chip: its values aren't links of their own. */
  inPreview?: boolean;
};

const nfc = (s: string) => s.normalize('NFC');
const UNIVERSAL: Record<string, string> = { tags: 'attr.tags', aliases: 'attr.aliases', source: 'attr.source', created: 'attr.created', modified: 'attr.modified', review: 'attr.review' };

/** The title an embed shows: the target's title, `<title> › <heading>` for a heading subpath (D-156). */
function titleOf(node: EmbedNode): string {
  const base = node.target.title ?? node.target.target;
  const sub = node.subpath;
  return sub && !sub.startsWith('^') ? `${base} › ${sub}` : base;
}

function typeOf(node: EmbedNode): string {
  if (node.state === 'date-missing') return 'daily-note';
  return node.target.type ?? 'page';
}

function TypeIcon({ type }: { type: string }) {
  const icon = chipIcon(type);
  return <Icon name={icon.glyph} dataIcon={icon.def} size={14} />;
}

function open(node: EmbedNode, onOpen: EmbedProps['onOpen']) {
  if (node.target.kind === 'daily' || node.target.kind === 'date-missing') {
    if (openDate(node.target.target)) return;
  }
  if (node.target.path) onOpen(node.target.path, node.subpath && !node.subpath.startsWith('^') ? node.subpath : undefined);
}

/** Slice P (R104 row 3): what a preview of the embed shows: its target (a section of it), the virtual day, or null
 *  when it doesn't resolve (D-939). */
export function embedPreviewTarget(node: EmbedNode): PreviewTarget | null {
  if (node.state === 'date-missing') return { path: '', fragment: null, kind: 'day', key: node.target.target.trim() };
  if (node.state === 'broken' || node.state === 'trashed' || !node.target.path) return null;
  return { path: node.target.path.normalize('NFC'), fragment: node.subpath, kind: 'note' };
}

/** D-418: a link-mode embed: an inline chip with the embed look. */
function LinkEmbed({ node, onOpen, host }: EmbedProps) {
  const broken = node.state === 'broken';
  const type = typeOf(node);
  const icon = chipIcon(type);
  const description = broken ? t('link.noNote', { target: node.target.target }) : node.state === 'too-deep' ? t('embed.tooDeep') : t('embed.chip');
  const parts = broken ? null : chipParts(node.target); // D-600
  const { props: ref } = useReference({
    target: node.state === 'too-deep' ? null : embedPreviewTarget(node),
    kind: 'chip',
    open: () => open(node, onOpen),
    createOffer: (el) => { if (broken) requestOffer({ from: host, target: node.target.target, relationTo: null, anchor: el, stay: true }); else open(node, onOpen); },
  }, { description: joinDescriptions(description, parts?.description) });
  return (
    <a
      href="#"
      tabIndex={0}
      role="link"
      data-command={broken ? 'link.createOffer' : 'edit.openEmbed'}
      className={`embed-chip embed-link${broken ? ' kind-unresolved' : ''}`}
      data-embed-mode="link"
      data-embed-state={node.state}
      data-embed-depth={Math.min(node.depth, 3)}
      data-embed-target={node.target.path ?? node.target.target}
      data-icon={broken ? undefined : icon.def}
      data-link-kind={broken ? 'unresolved' : undefined}
      aria-label={broken ? node.target.target : titleOf(node)}
      {...parts?.attrs}
      aria-description={joinDescriptions(description, parts?.description)}
      onMouseDown={(e) => e.preventDefault()}
      {...ref}
    >
      {!broken && (parts?.icon ?? <Icon name={icon.glyph} dataIcon={icon.def} size={13} />)}
      <span data-user-content>{broken ? node.target.target : titleOf(node)}</span>
      {parts?.suffix}
    </a>
  );
}

function ModeMenu({ mode, disabled, onMode }: { mode: EmbedMode; disabled: string | null; onMode?: (m: EmbedMode) => void }) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement | null>(null);
  const modes: EmbedMode[] = ['full', 'card', 'link'];
  const choose = (m: EmbedMode) => {
    setOpen(false);
    if (m !== mode) onMode?.(m);
  };
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [open]);
  // The menu takes the keys while open, wherever the focus is (the palette may have run `Display embed as…`).
  useEffect(() => {
    if (!open) return;
    const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const onKey = (e: KeyboardEvent) => {
      const list = items();
      const i = list.indexOf(document.activeElement as HTMLElement);
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      if (e.key === 'Escape') { stop(); setOpen(false); }
      else if (e.key === 'ArrowDown') { stop(); list[i < 0 ? Math.max(0, list.findIndex((x) => x.getAttribute('aria-checked') === 'true')) : (i + 1) % list.length]?.focus(); }
      else if (e.key === 'ArrowUp') { stop(); list[i < 0 ? 0 : (i - 1 + list.length) % list.length]?.focus(); }
      else if (e.key === 'Enter' && i >= 0) { stop(); choose(modes[i]); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, mode]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!menu.current?.parentElement?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away, true);
    return () => document.removeEventListener('mousedown', away, true);
  }, [open]);
  return (
    <span className="embed-mode">
      <button
        type="button"
        tabIndex={0}
        className="embed-btn"
        data-command="edit.displayEmbedAs"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-disabled={disabled ? 'true' : undefined}
        aria-description={disabled ?? undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => { e.stopPropagation(); if (!disabled) setOpen(!open); }}
      >
        {t('embed.displayAs')}
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={t('embed.displayAs')}
          className="menu embed-menu"
        >
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              data-command="edit.displayEmbedAs"
              role="menuitemradio"
              aria-checked={m === mode}
              onClick={(e) => { e.stopPropagation(); choose(m); }}
            >
              {t(`embed.mode.${m}`)}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function OpenButton({ props }: { props: EmbedProps }) {
  const { node } = props;
  // `Open <title>` names the note, without the heading (R30).
  const name = node.target.title ?? node.target.target;
  return (
    <button type="button" tabIndex={0} className="embed-btn" data-command="edit.openEmbed" onMouseDown={(e) => e.preventDefault()} aria-label={t('embed.open', { title: name })} onClick={(e) => { e.stopPropagation(); open(node, props.onOpen); }}>
      <Icon name="external" size={13} />
    </button>
  );
}

function Header({ props, title, showIcon }: { props: EmbedProps; title: ReactNode; showIcon: boolean }) {
  const { node } = props;
  // Slice P (FR-LNK-09 AC-3): the header's icon and title are a reference to the embedded note (or its section).
  const { props: ref } = useReference({ target: embedPreviewTarget(node), kind: 'chip', open: () => open(node, props.onOpen) });
  return (
    <div className="embed-header">
      <span className="embed-head-ref" data-embed-title="" {...ref} onMouseDown={(e) => e.preventDefault()}>
        {showIcon && <TypeIcon type={typeOf(node)} />}
        <span className="embed-title" data-user-content>{title}</span>
      </span>
      {node.state === 'ok' && isUnreviewed(node.target) && <span className="embed-unrev" data-review="unreviewed"><span className="chip-unrev" aria-hidden="true" />{t('link.unreviewed')}</span>}
      {node.mode === 'full' && node.readOnly && node.state === 'ok' && props.editable === false && node.note && (!node.note.utf8 || badFrontmatter(node.note.text ?? '')) && (
        <span className="embed-readonly">{t('embed.readOnly')}</span>
      )}
      <OpenButton props={props} />
      {node.state !== 'date-missing' && <ModeMenu mode={node.mode} disabled={props.modeDisabled ?? null} onMode={props.onMode} />}
    </div>
  );
}

function badFrontmatter(text: string): boolean {
  const d = parse(text);
  return !!d.frontmatterError || (!!d.frontmatter && d.frontmatter.data === null);
}

/** D-427: the type's preview properties that are set, in preview order, formatted as on the type page. */
function CardStrip({ node, onOpen, onTag }: { node: EmbedNode; onOpen: EmbedProps['onOpen']; onTag?: (k: string) => void }) {
  const text = node.note?.text;
  if (!text) return null;
  const data = (parse(text).frontmatter?.data ?? {}) as Record<string, unknown>;
  const types: TypeDto[] = chipTypes() as TypeDto[];
  const type = types.find((x) => nfc(x.key) === nfc(node.target.type ?? ''));
  const cols: TypeColumn[] = [];
  for (const k of type?.preview ?? []) {
    const a = type?.attributes.find((x) => nfc(x.key) === nfc(k));
    if (a) cols.push({ key: a.key, label: a.name, attr: a, userNamed: true });
    else if (UNIVERSAL[k]) cols.push({ key: k, label: t(UNIVERSAL[k]), attr: null, userNamed: false });
  }
  const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
  const shown = cols.filter((c) => (c.attr?.type === 'date-range' ? !empty(data[`${c.key}-start`]) : !empty(data[c.key])));
  if (shown.length === 0) return null;
  const links: LinkTargetDto[] = node.note?.links ?? [];
  const row = { path: node.note!.path, id: null, title: titleOf(node), created: null, modified: null, values: data, links, typeSingle: true };
  return (
    <ul className="embed-props" aria-label={t('embed.properties')}>
      {shown.map((c) => (
        <li key={c.key}>
          <span className="embed-prop-name" data-user-content>{c.label}</span>{' '}
          <span className="embed-prop-value">
            {c.attr?.type === 'date' && typeof data[c.key] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(String(data[c.key]).trim())
              ? <span data-user-content>{formatDate(String(data[c.key]).trim())}</span> // D-160 medium date (FR-EMB-02 AC-4)
              : <TypeCell row={row} col={c} type={type} types={types} onOpen={(p) => onOpen(p)} onTag={onTag ?? (() => {})} typeKey={node.target.type ?? 'page'} />}
          </span>
        </li>
      ))}
    </ul>
  );
}

function lineBefore(text: string, at: number): number {
  let n = 0;
  for (let i = text.indexOf('\n'); i >= 0 && i < at; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

/** The read-only body of a full embed: the shown section through the read view, nested embeds as their nodes. */
export function EmbedBody(props: EmbedProps) {
  const { node } = props;
  const note = node.note!;
  const text = note.text ?? '';
  const sec = node.section;
  const from = sec && sec.kind !== 'missing' ? sec.from : parse(text).bodyStart;
  const to = sec && sec.kind !== 'missing' ? sec.to : text.length;
  const slice = text.slice(from, to);
  if (slice.trim() === '') return <p className="embed-message" data-embed-message>{t('embed.empty')}</p>;
  const links = new Map<string, LinkTargetDto>();
  for (const l of note.links) {
    links.set(l.target, l);
    links.set(nfc(l.target), l);
  }
  const used = new Set<EmbedNode>();
  const renderEmbed = (value: string, line: number, inline: boolean): ReactNode => {
    const child = node.children.find((c) => !used.has(c) && c.line === line && nfc(c.value) === nfc(value) && c.inline === inline)
      ?? node.children.find((c) => !used.has(c) && nfc(c.value) === nfc(value));
    if (!child) return null;
    used.add(child);
    return <Embed {...props} node={child} body={undefined} editable={false} modeDisabled={t('embed.cantEdit')} />;
  };
  return (
    <ReadView
      text={slice}
      path={note.path}
      links={links}
      lineBase={lineBefore(text, from)}
      bare
      onOpen={props.onOpen}
      onTag={props.onTag ?? (() => {})}
      onExternal={props.onExternal ?? (() => {})}
      onScrollInNote={(f) => props.onOpen(note.path, f)}
      renderEmbed={renderEmbed}
    />
  );
}

export function Embed(props: EmbedProps): ReactNode {
  const { node } = props;
  // Slice P (FR-LNK-09 AC-1, R104 row 3): a card is a reference (click and ⏎ preview in click mode, D-929).
  const { props: cardRef } = useReference({ target: embedPreviewTarget(node), kind: 'chip', open: () => open(node, props.onOpen) });
  if (node.inline || node.mode === 'link' || node.state === 'too-deep') {
    // D-598 (D-428): a block embed in link mode keeps its `Display as` menu after the chip; inline ones don't (D-419).
    if (!node.inline && node.state !== 'too-deep' && node.state !== 'broken' && node.state !== 'date-missing') {
      return (
        <span className="embed-link-block">
          <LinkEmbed {...props} />
          <ModeMenu mode={node.mode} disabled={props.modeDisabled ?? null} onMode={props.onMode} />
        </span>
      );
    }
    return <LinkEmbed {...props} />;
  }
  const depth = Math.min(node.depth, 3);
  const card = node.mode === 'card' && node.state === 'ok';
  const base = {
    role: 'group',
    'data-embed-mode': node.mode,
    'data-embed-depth': depth,
    // D-423: a click or ⏎ on a card (outside its buttons) opens the note; the card isn't a Tab stop (AP-350).
    ...(card ? { tabIndex: -1 } : {}),
    ...(card ? {
      'data-preview-ref': '',
      'aria-description': cardRef['aria-description'],
      onPointerMove: cardRef.onPointerMove,
      onPointerLeave: cardRef.onPointerLeave,
      onFocus: cardRef.onFocus,
      onBlur: cardRef.onBlur,
    } : {}),
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      if (card && (props.inPreview || !(e.target as HTMLElement).closest('button, a, [role="menu"], [data-embed-title]'))) cardRef.onClick?.(e);
    },
    onDoubleClick: (e: React.MouseEvent<HTMLElement>) => {
      if (card && (props.inPreview || !(e.target as HTMLElement).closest('button, a, [role="menu"], [data-embed-title]'))) cardRef.onDoubleClick?.(e);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (card && e.target === e.currentTarget) cardRef.onKeyDown?.(e);
    },
  };
  if (node.state === 'trashed') {
    const title = node.target.title ?? node.target.target;
    const from = node.target.path ?? '';
    return (
      <section {...base} className="embed embed-trashed" data-embed-state="trashed" data-embed-target={from}>
        <p className="embed-trashed-text">
          {t('trash.placeholder', { title })}
          {/* A preview writes nothing (FR-SYN-06 AC-37, FR-LNK-11 AC-9): no Restore inside one. */}
          {!props.inPreview && <>{' '}<button type="button" tabIndex={0} onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (from) void ipc.trashRestore(from).catch(() => {}); }}>{t('cmd.trashRestore')}</button></>}
        </p>
      </section>
    );
  }
  if (node.state === 'broken') {
    const target = node.target.target;
    return (
      <section {...base} className="embed embed-broken" aria-label={target} data-embed-state="broken" data-embed-target={target}>
        <div className="embed-header">
          <a
            href="#"
            data-command="link.createOffer"
            className="chip link-chip kind-unresolved"
            data-link-kind="unresolved"
            aria-description={t('link.noNote', { target })}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (props.onCreate) props.onCreate(e.currentTarget);
              else requestOffer({ from: props.host, target, relationTo: null, anchor: e.currentTarget, stay: true });
            }}
          >
            <span data-user-content>{target}</span>
          </a>
        </div>
      </section>
    );
  }
  const title = titleOf(node);
  if (isTaskCard(node)) {
    // D-74, D-497: the Task card (R52) in the 4F card frame; no preview strip.
    return (
      <section {...base} onClick={undefined} onDoubleClick={undefined} onKeyDown={undefined} onPointerMove={undefined} onFocus={undefined} onBlur={undefined} data-preview-ref={undefined} aria-description={undefined} className="embed embed-card embed-task" aria-label={t('embed.name', { title })} data-embed-state="ok" data-embed-target={node.target.path ?? node.target.target} data-task-card="">
        <TaskEmbed node={node} editable={props.editable} title={title} body={props.body} onOpen={() => open(node, props.onOpen)} titleRef={cardRef}
          openButton={<OpenButton props={props} />}
          modeMenu={<ModeMenu mode={node.mode} disabled={props.modeDisabled ?? null} onMode={props.onMode} />} />
      </section>
    );
  }
  const state = node.state === 'ok' && node.mode === 'full' && node.readOnly && node.note && (!node.note.utf8 || badFrontmatter(node.note.text ?? '')) ? 'read-only' : node.state;
  const common = { ...base, className: `embed embed-${node.mode}`, 'aria-label': t('embed.name', { title }), 'data-embed-state': state, 'data-embed-target': node.target.path ?? node.target.target };
  let content: ReactNode = null;
  if (node.state === 'circular') content = <p className="embed-message" data-embed-message>{t('embed.circular', { title: node.target.title ?? node.target.target })}</p>;
  else if (node.state === 'missing-section') {
    const sub = node.subpath ?? '';
    const msg = sub.startsWith('^') ? t('embed.noBlock', { id: sub.slice(1), title: node.target.title ?? node.target.target }) : t('embed.noHeading', { heading: sub, title: node.target.title ?? node.target.target });
    content = <p className="embed-message" data-embed-message>{msg}</p>;
  } else if (node.state === 'date-missing') content = <p className="embed-message" data-embed-message>{t('embed.noDay')}</p>;
  else if (node.mode === 'card') content = <CardStrip node={node} onOpen={props.inPreview ? () => {} : props.onOpen} onTag={props.inPreview ? () => {} : props.onTag} />;
  else if (node.note) {
    const editable = props.editable && !node.readOnly && !!props.body;
    content = (
      <div className="embed-body" data-embed-body data-embed-editable={editable ? 'true' : 'false'}>
        {editable ? props.body : <EmbedBody {...props} />}
      </div>
    );
  }
  return (
    <section {...common}>
      <Header props={props} title={title} showIcon />
      {content}
    </section>
  );
}
