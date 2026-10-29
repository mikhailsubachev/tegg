// The React side of links/chip.ts (D-600): a chip's data attributes, its description, the task box in place of the
// type icon, and the suffix after the title, for the read view, embeds and relation values.
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { requestOffer } from './offer';
import { openDate } from '../daily/open';
import { useReference, type ReferenceOpts } from '../preview/useReference';
import type { PreviewTarget } from '../preview/types';
import type { LinkTargetDto } from '../ipc/types';
import { Icon } from '../shell/Icon';
import { chipAttrs, chipState, taskGlyph, taskIconDef, trashedText, unreviewedText, type ChipState, type ChipTarget } from './chip';

export type ChipParts = { state: ChipState; attrs: Record<string, string>; description: string | null; icon: ReactNode | null; suffix: ReactNode | null };

export function chipParts(info: ChipTarget | null | undefined, size = 13): ChipParts {
  const state = chipState(info);
  const glyph = taskGlyph(state);
  return {
    state,
    attrs: chipAttrs(state),
    description: state.link === 'trashed' ? trashedText() : state.unreviewed ? unreviewedText() : null,
    icon: glyph ? <Icon name={glyph} dataIcon={taskIconDef(state)} size={size} /> : null,
    suffix: <ChipSuffix state={state} />,
  };
}

/** Joins descriptions (a broken chip's, an embed's, `Unreviewed`). */
export function joinDescriptions(...d: (string | null | undefined)[]): string | undefined {
  const s = d.filter((x): x is string => !!x).join(', ');
  return s || undefined;
}

export function ChipSuffix({ state }: { state: ChipState }) {
  if (!state.unreviewed && !state.task) return null;
  const task = state.task;
  const dot = task ? (task.color ? `var(--type-${task.color})` : task.state === 'done' ? 'var(--accent)' : task.state === 'in-progress' ? 'var(--link)' : undefined) : undefined;
  return (
    <span className="chip-suffix">
      {task && <span className="chip-div" aria-hidden="true" />}
      {task?.date && <><span className="chip-date" data-tone={task.tone}>{task.date}</span><span className="chip-sep" aria-hidden="true">·</span></>}
      {task && <span className="chip-status"><span className="chip-status-dot" aria-hidden="true" style={dot ? { background: dot } : undefined} /><span data-user-content>{task.status}</span></span>}
      {state.unreviewed && <span className="chip-unrev" aria-hidden="true" />}
    </span>
  );
}

/** Slice P (R104 rows 2, 4, 5): what a resolved link chip previews; null when it doesn't resolve or is only in the
 *  trash (D-939). A date link without a note previews the virtual day (FR-LNK-10 AC-9). */
export function chipPreviewTarget(info: { kind: string; path?: string | null; object?: string | null } | null | undefined, target: string, fragment: string | null = null): PreviewTarget | null {
  if (info?.kind === 'date-missing') return { path: '', fragment: null, kind: 'day', key: target.trim() };
  // A link to a file (`[[graf.png]]`) previews its Image or PDF object (FR-ATT-07 AC-2, D-938).
  if (info?.kind === 'media') return info.object ? { path: info.object.normalize('NFC'), fragment: null, kind: 'note' } : null;
  if (!info?.path || (info.kind !== 'note' && info.kind !== 'daily')) return null;
  return { path: info.path.normalize('NFC'), fragment, kind: 'note' };
}

/** The open and Create-offer of a link chip (D-140, FR-DLY-08 AC-6, FR-LNK-04 AC-4), as a reference (R103). */
export function chipReference(o: {
  info: LinkTargetDto | null | undefined; target: string; from: string; onOpen: (path: string) => void; relationTo?: string[] | null; fragment?: string | null;
  scrollToEmbedOf?: string;
}): ReferenceOpts {
  const { info, target } = o;
  const ok = !!info?.path && (info.kind === 'note' || info.kind === 'daily' || info.kind === 'trashed');
  const open = () => {
    if ((info?.kind === 'date-missing' || info?.kind === 'daily') && openDate(target)) return;
    if (ok) o.onOpen(info!.path!);
  };
  const pt = chipPreviewTarget(info, target, o.fragment ?? null);
  return {
    target: pt && o.scrollToEmbedOf && pt.kind === 'note' ? { ...pt, scrollToEmbedOf: o.scrollToEmbedOf.normalize('NFC') } : pt,
    kind: 'chip',
    open,
    // A chip only in the trash keeps its open (the Trash, D-615); a broken one offers Create.
    createOffer: (el) => { if (info?.kind === 'trashed') open(); else requestOffer({ from: o.from, target, relationTo: o.relationTo ?? null, anchor: el }); },
  };
}

/** An `<a>` chip that is a reference: the hook's handlers, then the element's own key handler for other keys. */
export function RefAnchor({ reference, onKeyDown, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { reference: ReferenceOpts; 'aria-description'?: string }) {
  const { props } = useReference(reference, { description: rest['aria-description'] });
  return (
    <a {...rest} {...props}
      onKeyDown={(e) => { props.onKeyDown?.(e); if (!e.defaultPrevented) onKeyDown?.(e); }}>
      {children}
    </a>
  );
}

/** A `#tag` chip that is a reference (R104 row 12, D-937): a click previews the Tag, a double-click opens its page. */
export function TagRef({ tagKey, onTag, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { tagKey: string; onTag: (key: string) => void; 'data-command'?: string }) {
  return (
    <RefAnchor {...rest} href="#" data-tag={tagKey} reference={{ target: { path: '', fragment: null, kind: 'tag', key: tagKey }, kind: 'chip', open: () => onTag(tagKey) }}>
      {children}
    </RefAnchor>
  );
}
