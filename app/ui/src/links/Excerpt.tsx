// One backlinks excerpt (backlinks.md R15; ms4-links §5.2; D-277, D-280, D-282): the whole excerpt is one link that
// opens the source at the mention; chips inside are styled like every link chip but aren't links of their own.
import type { ReactNode } from 'react';
import { t } from '../i18n/catalog';
import type { ExcerptSegDto, OccurrenceDto } from '../ipc/types';
import { Icon } from '../shell/Icon';
import { chipIcon } from './icons';

/** Universal attributes with a catalog label (FR-TYP-08). */
const UNIVERSAL = new Set(['description', 'source', 'aliases', 'tags']);

export function attributeLabel(o: Pick<OccurrenceDto, 'attribute' | 'attributeName'>): string | null {
  if (!o.attribute) return null;
  if (o.attributeName) return o.attributeName;
  if (UNIVERSAL.has(o.attribute)) return t(`attr.${o.attribute}`);
  return o.attribute;
}

export function ExcerptChip({ seg }: { seg: Extract<ExcerptSegDto, { kind: 'link' }> }) {
  const ok = seg.target.kind === 'note' || seg.target.kind === 'daily';
  const kind = ok ? seg.target.kind : 'unresolved';
  const icon = ok ? chipIcon(seg.target.type) : null;
  return (
    <span className={`chip link-chip kind-${kind}`} data-link-kind={kind} {...(seg.here ? { 'data-link-here': '' } : {})}
      aria-description={ok ? undefined : t('link.noNote', { target: seg.target.target })}>
      {icon && <Icon name={icon.glyph} dataIcon={icon.def} size={13} />}
      <span data-user-content>{seg.text}</span>
    </span>
  );
}

function marked(node: ReactNode, marks: string[]): ReactNode {
  return marks.reduceRight<ReactNode>((n, m) => {
    switch (m) {
      case 'strong': return <strong>{n}</strong>;
      case 'em': return <em>{n}</em>;
      case 'code': return <code>{n}</code>;
      case 'strike': return <s>{n}</s>;
      case 'highlight': return <mark>{n}</mark>;
      default: return n;
    }
  }, node);
}

export function ExcerptBody({ segments }: { segments: ExcerptSegDto[] }) {
  return (
    <>
      {segments.map((g, i) => (
        <span key={i}>{g.kind === 'link' ? marked(<ExcerptChip seg={g} />, g.marks) : marked(<span data-user-content>{g.text}</span>, g.marks)}</span>
      ))}
    </>
  );
}

export function Excerpt({ occurrence, source, readOnly, onOpen, command = 'panel.backlinks.openMention' }: {
  occurrence: OccurrenceDto; source: string; readOnly: boolean;
  onOpen?: (source: string, occurrence: OccurrenceDto, readOnly: boolean) => void; command?: string;
}) {
  const label = attributeLabel(occurrence);
  const e = occurrence.excerpt;
  return (
    <a href="#" tabIndex={0} className="excerpt" data-occurrence={occurrence.kind} data-command={command}
      onClick={(ev) => { ev.preventDefault(); onOpen?.(source, occurrence, readOnly); }}>
      {label !== null && <span className="excerpt-label">{t('excerpt.label', { label })}</span>}
      {occurrence.kind === 'embed' && <span className="excerpt-embed">{t('backlinks.embed')} </span>}
      {e.cutStart && <span className="excerpt-cut">{t('excerpt.cut')}</span>}
      <ExcerptBody segments={e.segments} />
      {e.cutEnd && <span className="excerpt-cut">{t('excerpt.cut')}</span>}
    </a>
  );
}
