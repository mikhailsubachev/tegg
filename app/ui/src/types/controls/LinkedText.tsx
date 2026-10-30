// Text with `[[links]]` (D-249, D-257; FR-EDT-07 AC-18, FR-TYP-08 AC-14): out of edit mode each link is a chip that
// opens its note (D-140), with the broken style when it doesn't resolve (D-142); the rest is plain text. `![[…]]`
// in a value is a chip too, never an embed. Drawn over the field's input (whose text is then hidden): the text parts
// are aria-hidden (the input already has the value), the chips are links; a chip takes no focus on mouse down.
import { chipParts, chipReference, RefAnchor } from '../../links/ChipParts';
import { t } from '../../i18n/catalog';
import type { LinkTargetDto, TypeDto } from '../../ipc/types';
import { Icon } from '../../shell/Icon';
import { chipIcon } from '../../links/icons';
import { nfc } from '../util';

/** `path`: the note being edited (link text and resolution are relative to it, D-73). */
export type LinkContext = { links: Map<string, LinkTargetDto>; types: TypeDto[]; onOpen: (path: string) => void; path: string;
  /** Slice P (FR-TSK-08 AC-6, D-939): the `Source` row's preview starts at this task's embed. */
  scrollToEmbedOf?: string };

type Part = { text: string } | { target: string; alias: string | null };

const LINK = /!?\[\[([^[\]\n]+?)\]\]/g;

/** The `[[…]]` parts of a value, in order, with the text between them. */
export function linkParts(text: string): Part[] {
  const out: Part[] = [];
  let at = 0;
  for (const m of text.matchAll(LINK)) {
    if (m.index! > at) out.push({ text: text.slice(at, m.index) });
    const inner = m[1];
    const bar = inner.search(/\\?\|/);
    const head = bar >= 0 ? inner.slice(0, bar) : inner;
    const alias = bar >= 0 ? inner.slice(bar).replace(/^\\?\|/, '').trim() : '';
    out.push({ target: head.split('#')[0].trim(), alias: alias || null });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

export const hasLinks = (text: string) => linkParts(text).some((p) => 'target' in p);

export function LinkedText({ text, ctx }: { text: string; ctx: LinkContext }) {
  return (
    <>
      {linkParts(text).map((p, i) => {
        if ('text' in p) return <span key={i} aria-hidden="true" data-user-content>{p.text}</span>;
        const info = ctx.links.get(nfc(p.target));
        const ok = !!info?.path && (info.kind === 'note' || info.kind === 'daily' || info.kind === 'trashed');
        const dated = info?.kind === 'date-missing'; // never broken (FR-DLY-08 AC-8)
        const shown = p.alias ?? (ok ? info!.title ?? p.target : p.target);
        const icon = chipIcon(info?.type ?? (dated ? 'daily-note' : 'page'));
        const parts = ok ? chipParts(info) : null; // D-600
        return (
          <RefAnchor key={i} reference={chipReference({ info, target: p.target, from: ctx.path, onOpen: ctx.onOpen, scrollToEmbedOf: ctx.scrollToEmbedOf })} data-command="panel.text.link" href="#" tabIndex={-1} className={`chip link-chip ${ok ? '' : dated ? 'kind-date-missing' : 'kind-unresolved'}`}
            aria-description={ok ? parts?.description ?? undefined : dated ? undefined : t('link.noNote', { target: p.target })} {...parts?.attrs} data-link-kind={ok ? info!.kind : dated ? 'date-missing' : 'unresolved'}
            onMouseDown={(e) => e.preventDefault()}>
            {(ok || dated) && (parts?.icon ?? <Icon name={icon.glyph} dataIcon={icon.def} size={13} />)}
            <span data-user-content>{shown}</span>
            {parts?.suffix}
          </RefAnchor>
        );
      })}
    </>
  );
}
