// The one card of every type (docs/contracts/v1-cards.md §6.1, §7.4, §8.1; cards.md R211…R213; D-2054…D-2065, D-1904,
// D-2092): boards (part one's focus and drag props on the same `article`), Task cards (R43's checkbox and menu), card
// embeds (the frame's head: `Open`, `Display as`) and the example card of type settings (inert). Parts top to bottom:
// strip (Image, PDF), lead and title, tags, text, the pill area (two rows, then `+N more`), the footer. A part with
// nothing to show leaves no element (D-2065).
import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { CardSlotProps } from '../board/Board';
import { t } from '../i18n/catalog';
import { mediaUrl } from '../ipc/media';
import type { CardDataDto, TaskRowDto, TypeDto } from '../ipc/types';
import { cardEnv, type CardEnv } from './env';
import { LucideIcon } from '../icons/LucideIcon';
import { PdfCard } from '../media/PdfCard';
import { startPinDrag } from '../pinned/drag';
import { RefElement } from '../preview/useReference';
import { useTagLook } from '../tags/store';
import { Icon } from '../shell/Icon';
import { Checkbox, SourceChip, type TaskNav } from '../tasks/TaskCard';
import { CardItems, CardLinkChip, type LinkOpts } from './CardPill';
import { cardParts, type CardParts } from './model';
import { useTwoRows } from './overflow';
import './cards.css';

const nfc = (s: string) => s.normalize('NFC');

export { cardEnv, type CardEnv };

export type ObjectCardProps = {
  path: string;
  card: CardDataDto;
  type: TypeDto | null | undefined;
  surface: 'board' | 'embed' | 'example' | 'tasks';
  /** The type's Name for `board.card` (`Výlet: Sněžka z Pece`). */
  typeName?: string;
  task?: TaskRowDto | null;
  nav?: TaskNav;
  onToggle?: (done: boolean) => void;
  hideKey?: string | null;
  groupValues?: unknown;
  /** Embeds: `Open <title>` and `Display as` in place of `⋯` (D-2092). */
  head?: ReactNode;
  /** Embeds: the title's reference props (the frame's header reference). */
  titleRef?: Record<string, unknown>;
  onMenu?: (anchor: HTMLElement) => void;
  /** Boards: part one's focus and drag props. */
  slot?: CardSlotProps;
  readOnly?: boolean;
  onOpen?: (path: string) => void;
  /** Links don't act (a card inside a preview, D-933). */
  inertLinks?: boolean;
  env?: CardEnv;
  className?: string;
  /** The example card of a type with no objects: `No <plural> yet` (R214, AP-1591). */
  note?: ReactNode;
};

function Strip({ parts, card, title, onOpen }: { parts: CardParts; card: CardDataDto; title: string; onOpen?: (p: string) => void }) {
  const [failed, setFailed] = useState<string | null>(null);
  const file = card.file;
  if (!parts.strip) return null;
  const ok = !!file && file.kind === 'media' && !!file.path;
  if (!ok || failed === file?.path) {
    return (
      <div className="card-strip" data-strip={parts.strip} data-missing="">
        <span className="media-missing">{t('media.missing', { name: file?.target ?? '' })}</span>
      </div>
    );
  }
  if (parts.strip === 'image') {
    return (
      <div className="card-strip" data-strip="image">
        <img src={mediaUrl(file!.path!)} alt={title} loading="lazy" draggable={false} onError={() => setFailed(file!.path!)} />
      </div>
    );
  }
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  const meta = { pages: num(card.values.pages), size: num(card.values.size) };
  return (
    <div className="card-strip" data-strip="pdf">
      <PdfCard path={file!.path!} title={title} object={null} meta={meta} onOpen={onOpen} />
    </div>
  );
}

export function ObjectCard(p: ObjectCardProps) {
  const { card, type, task } = p;
  const path = nfc(p.path);
  const env = p.env ?? cardEnv();
  const parts = useMemo(
    () => cardParts({ type: type ?? null, card, task: task ?? null, hideKey: p.hideKey ?? null, groupValues: p.groupValues, now: env.now, zone: env.zone, region: env.region, dateSetting: env.dateSetting }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [card, type, task, p.hideKey, p.groupValues, env.region, env.zone, env.dateSetting, Math.floor(env.now / 60_000)],
  );
  const look = useTagLook();
  const pills = useRef<HTMLDivElement | null>(null);
  useTwoRows(pills, [parts]);
  const example = p.surface === 'example';
  const board = !!p.slot;
  const onOpen = p.onOpen ?? (() => {});
  const linkOpts: LinkOpts = { from: path, onOpen, tabIndex: (board && !task) || example ? -1 : 0, inert: example || p.inertLinks, plain: example };
  const title = card.title;
  const done = task?.state === 'done';
  const today = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: env.zone }).format(env.now);
  const overdue = !!task && task.state !== 'done' && task.state !== 'cancelled' && task.due !== null && task.due < today;
  const { dragging, ...slot } = p.slot ?? { dragging: false };
  const typeName = p.typeName ?? type?.name ?? card.type;
  // On a board the card is the roving Tab stop; a Task card's own controls stay Tab stops (FR-UX-03 AC-53).
  const inner = board && !task ? -1 : 0;

  const openCard = (e: React.MouseEvent<HTMLElement>) => {
    if (example || p.surface === 'embed') return;
    if ((e.target as HTMLElement).closest('a, button, [role="checkbox"], [role="menu"], input, textarea')) return;
    onOpen(path);
  };

  const lead = parts.lead.kind === 'checkbox' && task
    ? <Checkbox row={{ ...task, readOnly: task.readOnly || !!p.readOnly }} onToggle={(d) => p.onToggle?.(d)} tabIndex={inner} />
    : parts.lead.kind === 'icon' ? <LucideIcon icon={parts.lead.icon} dataIcon={parts.lead.dataIcon} size={16} /> : null;

  const titleEl = example
    ? <span className="card-title-link" data-card-title="" data-user-content>{title}</span>
    : p.surface === 'embed'
      ? <a href="#" tabIndex={-1} className="card-title-link" data-card-title="" data-embed-title="" data-command="edit.openEmbed" {...(p.titleRef ?? {})} onMouseDown={(e) => e.preventDefault()}><span data-user-content>{title}</span></a>
      : (
        <RefElement as="a" reference={{ target: { path, fragment: null, kind: 'note' }, kind: 'card', open: () => onOpen(path) }}
          href="#" tabIndex={inner} draggable={false} data-card-title="" data-command={task ? 'task.open' : 'card.open'} className="card-title-link"
          // Slice PIN (R135, D-1381): a drag from a task's title can pin it (a drop on Pinned); the press also reaches the card.
          onMouseDown={task ? (e: React.MouseEvent) => { if (e.button === 0) startPinDrag(e.nativeEvent, { request: { kind: 'object', path }, label: title, icon: 'check-square' }); } : undefined}
          onClick={(e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); }}>
          <span data-user-content>{title}</span>
        </RefElement>
      );

  const footerLink = parts.footer.link;
  const sourceChip = task && footerLink?.key === 'source' && p.nav
    ? <SourceChip row={task} nav={p.nav} tabIndex={inner} footer />
    : null;

  return (
    <article
      {...slot}
      className={`object-card${board ? ' board-card' : ''}${task ? ' object-task-card' : ''}${done ? ' done' : ''}${dragging ? ' dragging' : ''}${p.className ? ` ${p.className}` : ''}`}
      aria-label={t('board.card', { type: typeName, title })}
      data-object-card=""
      data-path={path}
      data-type={nfc(card.type)}
      data-surface={p.surface}
      {...(board ? { 'data-board-card': path, 'data-read-only': p.readOnly ? '' : undefined } : {})}
      {...(task ? { 'data-task-card': '', 'data-state': task.state, 'data-overdue': overdue ? 'true' : 'false' } : {})}
      {...(example ? { inert: true, 'data-example': '' } : {})}
      // The Daily Note's Task cards (surface `tasks`) aren't a Tab stop themselves: Tab goes checkbox, title, source chip
      // (FR-DLY-04 AC-14, D-2133).
      tabIndex={p.slot ? p.slot.tabIndex : undefined}
      onClick={openCard}
    >
      <Strip parts={parts} card={card} title={title} onOpen={example ? undefined : onOpen} />
      <span className="card-lead">{lead}</span>
      <div className="card-title">
        {titleEl}
        {p.head ?? (!example && p.onMenu && (
          <button type="button" tabIndex={inner} className="icon-button small card-menu" data-command={task ? 'task.setStatus' : 'card.menu'} aria-label={t('task.more', { title })} aria-haspopup="menu"
            onClick={(e) => { e.stopPropagation(); p.onMenu?.(e.currentTarget); }}>
            <Icon name="more-horizontal" size={14} />
          </button>
        ))}
      </div>
      {(parts.tags.shown.length > 0) && (
        <div className="card-tags">
          {/* FR-TAG-05 AC-6 (D-707): a tag with a colour shows it on every surface. */}
          {parts.tags.shown.map((x) => <span key={x} className="card-tag" data-tag={nfc(x).toLowerCase()} style={look(x).style} data-user-content>#{x}</span>)}
          {parts.tags.more > 0 && <span className="card-tag-more">+{parts.tags.more}</span>}
        </div>
      )}
      {parts.text && <p className="card-text card-excerpt" data-text-from={parts.text.from} data-user-content>{parts.text.text}</p>}
      {parts.items.length > 0 && (
        <div className="card-pills" ref={pills}>
          <CardItems items={parts.items} opts={linkOpts} />
        </div>
      )}
      {(footerLink || parts.footer.date) && (
        <footer className="card-footer">
          {sourceChip ?? (footerLink && <CardLinkChip link={footerLink} opts={linkOpts} footer />)}
          {(parts.footer.more ?? []).map((l, i) => <CardLinkChip key={i} link={l} opts={linkOpts} footer />)}
          {parts.footer.date && <time className="card-date" data-date-key={parts.footer.date.key} dateTime={parts.footer.date.iso}>{parts.footer.date.text}</time>}
        </footer>
      )}
      {p.note && <p className="card-note">{p.note}</p>}
    </article>
  );
}
