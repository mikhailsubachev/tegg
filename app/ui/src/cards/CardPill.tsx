// One item of a card's pill area (docs/contracts/v1-cards.md §6.1, §8.1; cards.md R212): a pill, a link chip, a local
// item, `Unreviewed`, and `+N more`. The preview's `Preview properties` region draws its items with these too (D-2093).
import type { ReactNode } from 'react';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import { chipReference, RefAnchor } from '../links/ChipParts';
import { chipIcon } from '../links/icons';
import { LucideIcon } from '../icons/LucideIcon';
import { Icon } from '../shell/Icon';
import { linkLabel, type CardItem, type CardLink, type PillItem } from './model';

const nfc = (s: string) => s.normalize('NFC');

export type LinkOpts = {
  /** The card's own path (a broken link's Create offer starts there). */
  from: string;
  onOpen: (path: string) => void;
  /** Links aren't Tab stops on a board (the card is, part one's roving focus). */
  tabIndex?: number;
  /** A card inside a preview or the example: links don't act (D-933). */
  inert?: boolean;
  /** The example card of type settings: chips aren't links (no `href`, R214 "no link"). */
  plain?: boolean;
};

export function CardPillView({ item, valueIndex }: { item: PillItem; valueIndex?: number }) {
  const role = item.task?.role;
  if (role) return <TaskChip item={item} valueIndex={valueIndex} />;
  const warn = item.invalid ? <span className="warn-icon" title={item.warn ?? undefined} aria-label={item.warn ?? undefined}><Icon name="warning" size={12} /></span> : null;
  return (
    <span className="card-pill" data-attribute={item.key} data-value-index={valueIndex} aria-label={item.label} title={item.title} data-name-title={item.title} data-invalid={item.invalid ? '' : undefined}>
      {item.icon ? <LucideIcon icon={item.icon} dataIcon={item.dataIcon ?? item.icon.name} size={12} /> : <><span className="card-pill-name" data-user-content>{item.name}</span>{' '}</>}
      {item.dot && <span className="card-dot dot" data-color={item.dot} style={{ background: `var(--type-${item.dot})` }} />}
      <span className="card-pill-value" data-user-content>{item.value}</span>
      {warn}
    </span>
  );
}

/** D-1904: a Task card's status, priority and due pills keep R43's chips (tasks.md R43, R44, FR-TSK-09): the value
 *  alone, the status dot (`Not a status` for an unknown one), the priority flag in its colour, the due label's tone
 *  (`, overdue` in its name). */
function TaskChip({ item, valueIndex }: { item: PillItem; valueIndex?: number }) {
  const task = item.task!;
  const role = task.role;
  const overdue = role === 'due' && task.tone === 'overdue';
  const common = { 'data-attribute': item.key, 'data-value-index': valueIndex, 'data-name-title': item.title, title: item.title };
  if (role === 'status') {
    return (
      <span className="card-pill task-chip status" {...common} data-status={task.raw} aria-description={item.invalid ? t('task.notStatus') : undefined}>
        <span className="card-dot dot" data-color={item.dot ?? ''} style={item.dot ? { background: `var(--type-${item.dot})` } : undefined} />
        <span className="card-pill-value" data-user-content>{item.value}</span>
      </span>
    );
  }
  if (role === 'priority') {
    return (
      <span className="card-pill task-chip priority" {...common} data-priority={task.raw}>
        <span data-flag style={item.dot ? { color: `var(--type-${item.dot})` } : undefined}><Icon name="flag" size={12} /></span>
        <span className="card-pill-value" data-user-content>{item.value}</span>
      </span>
    );
  }
  return (
    <span className={`card-pill task-chip due tone-${task.tone ?? 'plain'}`} {...common} data-due={task.raw} data-tone={task.tone} aria-label={overdue ? `${item.value}, ${t('task.overdueWord')}` : undefined}>
      {/* A date alone is the region's format (Intl), not catalog text (NFR-OTH-02). */}
      <span className="card-pill-value" data-user-content={task.tone === 'plain' ? '' : undefined}>{item.value}</span>
    </span>
  );
}

export function CardLinkChip({ link, opts, footer, extra }: { link: CardLink; opts: LinkOpts; footer?: boolean; extra?: ReactNode }) {
  // D-2139: the chip is named `<Property>: <target title>` as a pill is (`card.pill`); its visible text is the target's.
  const common = { 'data-attribute': link.key, 'data-footer-link': footer ? '' : undefined, tabIndex: opts.tabIndex ?? 0, 'aria-label': link.name ? linkLabel(link) : undefined } as const;
  const more = link.more.length > 0
    ? <span className="card-link-more" title={listText(link.more)}>+{link.more.length}</span>
    : null;
  if (link.kind === 'external') {
    return (
      <a href={opts.plain ? undefined : '#'} className="chip link-chip kind-external" data-link-kind="external" data-command="card.openLink" {...common}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!opts.inert) void ipc.openExternal(link.url).catch(() => {}); }}>
        <span data-user-content>{link.text}</span>{more}{extra}
      </a>
    );
  }
  if (link.kind === 'local') {
    return <span className="card-local" data-attribute={link.key} data-footer-link={footer ? '' : undefined} title={link.path} data-user-content>{link.text}</span>;
  }
  const info = link.info;
  const ok = link.kind === 'note';
  const icon = ok ? chipIcon(info?.kind === 'daily' ? 'daily-note' : info?.type ?? 'page') : null;
  const reference = chipReference({ info: info ?? null, target: link.target, from: opts.from, onOpen: opts.onOpen });
  return (
    <RefAnchor href={opts.plain ? undefined : '#'} className={`chip link-chip kind-${ok ? info!.kind : 'unresolved'}`} data-link-kind={ok ? info!.kind : 'broken'} data-command="card.openLink"
      reference={opts.inert ? { ...reference, target: null, open: () => {}, createOffer: undefined } : reference}
      aria-description={ok ? undefined : t('link.noNote', { target: link.target })}
      {...common}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      {icon && <Icon name={icon.glyph} dataIcon={icon.def} size={12} />}
      <span data-user-content>{link.text}</span>
      {more}{extra}
    </RefAnchor>
  );
}

const listText = (xs: string[]) => {
  try { return new Intl.ListFormat(undefined, { type: 'unit', style: 'short' }).format(xs); } catch { return xs.join(', '); }
};

/** One item of the pill area. `valueIndex`: its place among the values of a multi-value key. */
export function CardItemView({ item, opts, valueIndex }: { item: CardItem; opts: LinkOpts; valueIndex?: number }) {
  if (item.kind === 'unreviewed') {
    return <span className="card-unreviewed" data-review="unreviewed"><span className="chip-unrev" aria-hidden="true" />{t('link.unreviewed')}</span>;
  }
  if (item.kind === 'pill') return <CardPillView item={item} valueIndex={valueIndex} />;
  if (item.kind === 'local') return <span className="card-local" data-attribute={item.key} title={item.path} data-user-content>{item.text}</span>;
  return <CardLinkChip link={item.link} opts={opts} footer={item.footer} />;
}

/** The items of a pill area with their per-key value indexes (multi-value keys, §8.1). */
export function CardItems({ items, opts }: { items: CardItem[]; opts: LinkOpts }) {
  const seen = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const i of items) if (i.kind !== 'unreviewed') counts.set(nfc(i.key), (counts.get(nfc(i.key)) ?? 0) + 1);
  return (
    <>
      {items.map((i, n) => {
        if (i.kind === 'unreviewed') return <CardItemView key="unreviewed" item={i} opts={opts} />;
        const k = nfc(i.key);
        const at = seen.get(k) ?? 0;
        seen.set(k, at + 1);
        return <CardItemView key={`${k}:${at}:${n}`} item={i} opts={opts} valueIndex={(counts.get(k) ?? 0) > 1 ? at : undefined} />;
      })}
    </>
  );
}
