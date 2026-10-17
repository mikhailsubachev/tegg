// One value of a type page row, as the type page and embed cards show it (FR-TYP-09, D-427; ms4-embeds §6).
import { validate } from '@tegg/schema';
import { chipIcon } from '../links/icons';
import { t } from '../i18n/catalog';
import type { AttributeDto, LinkTargetDto, TypeDto, TypeRowDto } from '../ipc/types';
import { Icon, typeIconName } from '../shell/Icon';
import { attrTypeLabel, dateText, dateTimeText, nfc, rawText, wiki } from './util';

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

export type TypeColumn = { key: string; label: string; attr: AttributeDto | null; userNamed: boolean };
type Column = TypeColumn;

export function TypeCell({ row, col, type, types, onOpen, onTag, typeKey }: {
  row: TypeRowDto; col: Column; type: TypeDto | undefined; types: TypeDto[]; onOpen: (p: string) => void; onTag: (k: string) => void; typeKey: string;
}) {
  if (col.key === 'title') {
    return (
      <span className="cell-title">
        <Icon name={typeIconName(typeKey, type?.icon)} size={14} />
        <span data-user-content>{row.title}</span>
      </span>
    );
  }
  if (col.key === 'modified' || col.key === 'created') return <span data-user-content>{dateTimeText(col.key === 'modified' ? row.modified : row.created)}</span>;
  if (col.key === 'tags') {
    const list = (Array.isArray(row.values.tags) ? row.values.tags : isEmpty(row.values.tags) ? [] : [row.values.tags]).map(rawText);
    return (
      <span className="chips">
        {list.map((x) => (
          <a data-command="typePage.a0" key={x} href="#" className="chip tag-chip" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTag(nfc(x.replace(/^#/, '')).toLowerCase()); }}>
            <span data-user-content>#{x.replace(/^#/, '')}</span>
          </a>
        ))}
      </span>
    );
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
  if (a?.type === 'relation' || col.key === 'source') {
    const list = Array.isArray(v) ? v : [v];
    return (
      <span className="chips">
        {list.map((x, i) => <LinkCell key={i} value={x} links={row.links} types={types} onOpen={onOpen} />)}
      </span>
    );
  }
  return <span data-user-content>{rawText(v)}</span>;
}

function LinkCell({ value, links, types, onOpen }: { value: unknown; links: LinkTargetDto[]; types: TypeDto[]; onOpen: (p: string) => void }) {
  const w = wiki(value);
  if (!w) return <span data-user-content>{rawText(value)}</span>;
  const info = links.find((l) => [nfc(w.target), nfc(w.inner), nfc(String(value))].includes(nfc(l.target)));
  const ok = !!info?.path && (info.kind === 'note' || info.kind === 'daily');
  const shown = w.alias ?? (ok ? info!.title ?? w.target : w.target);
  return (
    <a data-command="typePage.a1" href="#" className={`chip link-chip ${ok ? '' : 'kind-unresolved'}`} aria-description={ok ? undefined : t('link.noNote', { target: w.target })}
      data-link-kind={ok ? info!.kind : 'unresolved'}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (ok) onOpen(info!.path!); }}>
      {ok && <Icon name={typeIconName(info!.type ?? 'page', types.find((x) => nfc(x.key) === nfc(info!.type ?? ''))?.icon)} dataIcon={chipIcon(info!.type ?? 'page').def} size={12} />}
      <span data-user-content>{shown}</span>
    </a>
  );
}
