// The note's subtitle and read-only Properties strip (FR-TYP-08 display, D-147, D-154, D-160; ms3-shell §11.3).
// Placed between the title and the body; collapsible, the state is machine-local UI state (D-127).
import { parse } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { region } from '../i18n/collate';
import type { LinkTargetDto } from '../ipc/types';
import { Icon, typeIconName } from '../shell/Icon';
import { attributeRows, type AttrRow } from './properties';

const locale = () => region() ?? (typeof navigator !== 'undefined' ? navigator.language : 'en');

/** `YYYY-MM-DD` in the region locale's medium format, never shifted by a time zone (FR-FMT-11). */
export function formatDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium' }).format(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** A date-time in the machine's zone (D-104): medium date and short time (D-160). */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

type Props = {
  text: string;
  links: Map<string, LinkTargetDto>;
  open: boolean;
  onToggle: () => void;
  onOpen: (path: string) => void;
  onTag: (key: string) => void;
};

function LinkChip({ target, links, onOpen }: { target: string; links: Map<string, LinkTargetDto>; onOpen: (path: string) => void }) {
  const info = links.get(target) ?? links.get(target.normalize('NFC'));
  const ok = info && info.path && (info.kind === 'note' || info.kind === 'daily');
  return (
    <a
      href="#"
      className={`chip link-chip kind-${ok ? info!.kind : 'unresolved'}`}
      data-link-kind={ok ? info!.kind : 'unresolved'}
      aria-description={ok ? undefined : t('link.noNote', { target })}
      onClick={(e) => {
        e.preventDefault();
        if (ok) onOpen(info!.path!);
      }}
    >
      {ok && <Icon name={typeIconName(info!.type ?? 'page')} size={13} />}
      <span data-user-content>{ok ? info!.title ?? target : target}</span>
    </a>
  );
}

function Value({ row, p }: { row: AttrRow; p: Props }) {
  const v = row.value;
  switch (v.kind) {
    case 'text':
    case 'number':
      return <span data-user-content>{v.text}</span>;
    case 'checkbox':
      return <span role="checkbox" aria-checked={v.checked} aria-readonly="true" aria-label={row.label} className={`check ${v.checked ? 'on' : ''}`} tabIndex={0} />;
    case 'date':
      return <span>{formatDate(v.date)}</span>;
    case 'datetime':
      return <span>{formatDateTime(v.datetime)}</span>;
    case 'range':
      return <span>{formatDate(v.start)} – {formatDate(v.end)}</span>;
    case 'tags':
      return (
        <span className="chips">
          {v.tags.map((tag) => {
            const key = tag.normalize('NFC').toLowerCase();
            return (
              <a key={tag} href="#" className="chip tag-chip" data-tag={key} onClick={(e) => { e.preventDefault(); p.onTag(key); }}>
                <span data-user-content>#{tag}</span>
              </a>
            );
          })}
        </span>
      );
    case 'links':
      return (
        <span className="chips">
          {v.targets.map((x) => <LinkChip key={x} target={x} links={p.links} onOpen={p.onOpen} />)}
        </span>
      );
    case 'list':
      return <span data-user-content>{v.items.join(', ')}</span>;
    case 'review':
      return <span>{v.value === 'unreviewed' || v.value === 'reviewed' ? t(`review.${v.value}`) : v.value}</span>;
    case 'yaml':
      return <code className="yaml-source" data-user-content>{v.source}</code>;
  }
}

export function Properties(p: Props) {
  const doc = parse(p.text.replace(/^﻿/, ''));
  if (doc.frontmatter?.error || doc.frontmatterError) return null;
  const { subtitle, rows } = attributeRows(doc);
  return (
    <>
      {subtitle && <p className="note-subtitle" data-user-content>{subtitle}</p>}
      {rows.length > 0 && (
        <section className="properties" aria-label={t('props.title')}>
          <button type="button" className="properties-head" aria-expanded={p.open} data-command="note.toggleProperties" onClick={p.onToggle}>
            <Icon name={p.open ? 'chevron-down' : 'chevron-right'} size={12} />
            {t('props.title')}
          </button>
          {p.open && (
            <dl className="properties-grid">
              {rows.map((r) => (
                <div key={r.key} className="property">
                  <dt data-user-content={r.label === r.key ? '' : undefined}>{r.label}</dt>
                  <dd>
                    <Value row={r} p={p} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      )}
    </>
  );
}
