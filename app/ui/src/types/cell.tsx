// One value of a type page row, as the type page and embed cards show it (FR-TYP-09, D-427; ms4-embeds §6).
import { RefAnchor, TagRef } from '../links/ChipParts';
import { chipParts } from '../links/ChipParts';
import { validate } from '@tegg/schema';
import { chipIcon } from '../links/icons';
import { t } from '../i18n/catalog';
import type { AttributeDto, LinkTargetDto, TypeDto, TypeRowDto } from '../ipc/types';
import { Icon, typeIconName } from '../shell/Icon';
import { attrTypeLabel, dateText, dateTimeText, nfc, rawText, wiki } from './util';

/** `[[…]]` / `![[…]]` inside a text value; `split` keeps each link at the odd indexes. */
const TEXT_LINK = /(!?\[\[[^[\]\n]+?\]\])/;

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

import { tagChipStyle } from '../theme/tagChip';
import { useTagLook } from '../tags/store';

export type TypeColumn = { key: string; label: string; attr: AttributeDto | null; userNamed: boolean };
type Column = TypeColumn;

export function TypeCell({ row, col, type, types, onOpen, onTag, typeKey, refs }: {
  row: TypeRowDto; col: Column; type: TypeDto | undefined; types: TypeDto[]; onOpen: (p: string) => void; onTag: (k: string) => void; typeKey: string;
  /** A preview's strip (v1-previews §3.4): its relation chips are references like the body's links (D-932, D-1170). */
  refs?: boolean;
}) {
  const look = useTagLook();
  if (col.key === 'title') {
    return (
      <span className="cell-title">
        <Icon name={typeIconName(typeKey, type?.icon)} size={14} />
        {/* D-692: a Tag object's row is a link to its tag page. */}
        {typeKey === 'tag'
          // Slice P (D-930): the click goes to the row, which previews; ⏎ and a double-click on the row open it.
          ? <a href="#" tabIndex={-1} data-user-content onClick={(e) => e.preventDefault()}>{row.title}</a>
          : <span data-user-content>{row.title}</span>}
      </span>
    );
  }
  if (col.key === 'modified' || col.key === 'created') return <span data-user-content>{dateTimeText(col.key === 'modified' ? row.modified : row.created)}</span>;
  if (col.key === 'tags') {
    const list = (Array.isArray(row.values.tags) ? row.values.tags : isEmpty(row.values.tags) ? [] : [row.values.tags]).map(rawText);
    return (
      <span className="chips">
        {list.map((x) => (
          <TagRef data-command="typePage.a0" key={x} tagKey={nfc(x.replace(/^#/, '')).toLowerCase()} className="chip tag-chip" style={look(x).style} onTag={onTag}>
            <span data-user-content>#{look(x).name}</span>
          </TagRef>
        ))}
      </span>
    );
  }
  if (col.key === 'review') {
    // D-1242: the Review column shows the workflow's labels; another value is shown as written with the warning icon.
    const r = row.values.review;
    if (isEmpty(r)) return null;
    if (r === 'unreviewed' || r === 'reviewed') return <span>{t(r === 'reviewed' ? 'review.reviewed' : 'review.unreviewed')}</span>;
    return <span className="raw-value"><span data-user-content>{rawText(r)}</span><span className="warn-icon" title={t('panel.invalid', { type: attrTypeLabel('select') })}><Icon name="warning" size={12} /></span></span>;
  }
  const a = col.attr;
  const v = a?.type === 'date-range' ? null : row.values[col.key];
  const validity = a ? validate(a as never, row.values) : { state: isEmpty(v) ? 'empty' : 'valid' };
  if (validity.state === 'empty') return null;
  const invalid = validity.state === 'invalid' && (validity as { items: number[] }).items.length === 0;
  const warn = invalid ? <span className="warn-icon" title={t('panel.invalid', { type: attrTypeLabel(a?.type ?? 'text') })}><Icon name="warning" size={12} /></span> : null;
  if (invalid) return <span className="raw-value"><span data-user-content>{rawText(v)}</span>{warn}</span>;
  if (a?.type === 'date-range') {
    const s = row.values[`${col.key}-start`], e = row.values[`${col.key}-end`];
    return <span data-user-content>{dateText(s)}{!isEmpty(e) ? ` – ${dateText(e)}` : ''}</span>;
  }
  if (a?.type === 'date') return <span data-user-content>{dateText(v)}</span>;
  if (a?.type === 'date-time') return <span data-user-content>{dateTimeText(v)}</span>;
  if (a?.type === 'checkbox') return <span>{t(v === true ? 'panel.checked' : 'panel.unchecked')}</span>;
  if (typeof v === 'string' && (col.key === 'source' || a?.type === 'text' || a?.type === 'long-text') && TEXT_LINK.test(v)) {
    // Links inside a text value are chips, the rest stays text (D-249, D-257).
    return (
      <span className="linked-text">
        {v.split(TEXT_LINK).map((p, i) => (i % 2
          ? <LinkCell key={i} value={p.replace(/^!/, '')} links={row.links} types={types} onOpen={onOpen} refs={refs} />
          : p && <span key={i} data-user-content>{p}</span>))}
      </span>
    );
  }
  if (a?.type === 'relation' || col.key === 'source') {
    const list = Array.isArray(v) ? v : [v];
    return (
      <span className="chips">
        {list.map((x, i) => <LinkCell key={i} value={x} links={row.links} types={types} onOpen={onOpen} refs={refs} />)}
      </span>
    );
  }
  return <span data-user-content>{rawText(v)}</span>;
}

function LinkCell({ value, links, types, onOpen, refs }: { value: unknown; links: LinkTargetDto[]; types: TypeDto[]; onOpen: (p: string) => void; refs?: boolean }) {
  const w = wiki(value);
  if (!w) return <span data-user-content>{rawText(value)}</span>;
  const info = links.find((l) => [nfc(w.target), nfc(w.inner), nfc(String(value))].includes(nfc(l.target)));
  const ok = !!info?.path && (info.kind === 'note' || info.kind === 'daily' || info.kind === 'trashed');
  const shown = w.alias ?? (ok ? info!.title ?? w.target : w.target);
  const parts = ok ? chipParts(info, 12) : null; // D-600
  const inner = (
    <>
      {ok && (parts?.icon ?? <Icon name={typeIconName(info!.type ?? 'page', types.find((x) => nfc(x.key) === nfc(info!.type ?? ''))?.icon)} dataIcon={chipIcon(info!.type ?? 'page').def} size={12} />)}
      <span data-user-content>{shown}</span>
      {parts?.suffix}
    </>
  );
  if (refs && ok && info!.kind !== 'trashed') {
    // D-1189: in a preview's strip a relation chip is a reference: a click replaces the content in click mode (D-932),
    // resting on it in hover mode does (D-1170), and the preview's click-to-open leaves it alone (R129).
    const target = { path: nfc(info!.path!), fragment: null, kind: 'note' as const };
    return (
      <RefAnchor data-command="typePage.a1" href="#" className="chip link-chip " aria-description={parts?.description ?? undefined} {...parts?.attrs}
        data-link-kind={info!.kind} reference={{ target, kind: 'chip', open: () => onOpen(info!.path!) }}>
        {inner}
      </RefAnchor>
    );
  }
  return (
    <a data-command="typePage.a1" href="#" className={`chip link-chip ${ok ? '' : 'kind-unresolved'}`} aria-description={ok ? parts?.description ?? undefined : t('link.noNote', { target: w.target })} {...parts?.attrs}
      data-link-kind={ok ? info!.kind : 'unresolved'}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (ok) onOpen(info!.path!); }}>
      {inner}
    </a>
  );
}
