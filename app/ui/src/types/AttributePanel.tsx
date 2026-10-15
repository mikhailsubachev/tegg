// The editable attribute panel on the note route (FR-EDT-07, FR-TYP-08 AC-7…AC-12; ms3-shell §14.6, §14.7):
// the region `Properties` with the type's attributes in schema order, then Tags, Aliases, Source, Review, Created,
// Modified, then `Other properties (<n>)`. Each control commits a value; the page turns it into the next note text
// with @tegg/doc (setValue / setRange) and hands it to the editor's save path (applyFrontmatter, D-240). The panel
// never adds or removes properties (D-72).
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { parse, setRange, setValue, type Doc } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { LinkTargetDto, TypeDto } from '../ipc/types';
import { formatDate, formatDateTime } from '../read/PropertiesStrip';
import { DISABLED_CONTROLS, showDue } from '../shell/registry';
import { Icon } from '../shell/Icon';
import { CheckboxControl, MultiSelectControl, SelectControl } from './controls/ChoiceControls';
import { joinDesc, WarnIcon, type Value } from './controls/common';
import { DateControl, DateRangeControl, DateTimeControl } from './controls/DateControls';
import { AliasesControl, RelationControl, TagsControl } from './controls/ListControls';
import { TextControl, type TextKind } from './controls/TextControl';
import { linkParts } from './controls/LinkedText';
import { panelRows, type PanelRow } from './panel';
import { attrTypeLabel, nfc, rawText } from './util';

/** `(doc) => next text`: one committed edit; false when it couldn't be applied. */
export type Commit = (edit: (doc: Doc) => string) => boolean;
export type PanelApi = { focusFirst: () => void };

const READ_ONLY_CONTROL: Record<string, string> = { file: 'ctl.rowFile', color: 'ctl.rowColor', recurrence: 'ctl.rowRecurrence' };

function readOnlyReason(row: PanelRow): string {
  const r = row.attr?.readOnlyReason;
  const ctl = r ? READ_ONLY_CONTROL[r] : undefined;
  const def = ctl ? DISABLED_CONTROLS.find((c) => c.label === ctl) : undefined;
  if (def) return t('panel.editingComes', { due: showDue(def.due) });
  return t('panel.unsupported', { type: attrTypeLabel(row.attr?.type ?? '') });
}

/** Relation targets of the note's frontmatter (rows and Other properties), resolved once per change of the head. */
export function useLinks(path: string, text: string): Map<string, LinkTargetDto> {
  const [links, setLinks] = useState<Map<string, LinkTargetDto>>(new Map());
  const targets = useMemo(() => {
    const data = parse(text).frontmatter?.data ?? {};
    const out = new Set<string>();
    // Whole-value relations, and links inside text values (D-249, D-257).
    const scan = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(scan);
      else if (typeof v === 'string') for (const p of linkParts(v)) if ('target' in p) out.add(nfc(p.target));
    };
    Object.values(data).forEach(scan);
    return [...out].sort();
  }, [text]);
  const key = targets.join('\n');
  useEffect(() => {
    let live = true;
    if (!targets.length) { setLinks(new Map()); return; }
    ipc.linkResolve(path, targets).then((r) => { if (live) setLinks(new Map(r.map((x) => [nfc(x.target), x]))); }, () => {});
    return () => { live = false; };
  }, [key, path]);
  return links;
}

export function AttributePanel({ apiRef, text, type, types, path, editable, open = true, onToggle, otherOpen, onToggleOther, onCommit, onOpen, onTag, onLeaveLast }: {
  apiRef?: Ref<PanelApi>;
  /** The note text whose frontmatter is in effect (saved or committed, not yet saved). */
  text: string;
  type: TypeDto;
  types: TypeDto[];
  path: string;
  editable: boolean;
  /** D-127: the `Properties` header collapses the panel, as in the read view; the state is per machine. */
  open?: boolean;
  onToggle?: () => void;
  otherOpen: boolean;
  onToggleOther: () => void;
  onCommit: Commit;
  onOpen: (path: string) => void;
  onTag: (key: string) => void;
  /** ⏎ in the last row: the body gets the focus. */
  onLeaveLast?: () => void;
}) {
  const doc = useMemo(() => parse(text.replace(/^﻿/, '')), [text]);
  const model = useMemo(() => panelRows(doc, type), [doc, type]);
  const links = useLinks(path, text);
  const linked = { links, types, onOpen, path };
  const firstRefs = useRef<(HTMLElement | null)[]>([]);
  const focusRow = (i: number) => {
    for (let j = i; j < firstRefs.current.length; j++) {
      const el = firstRefs.current[j];
      if (el && el.isConnected) { el.focus(); return; }
    }
    onLeaveLast?.();
  };
  useImperativeHandle(apiRef, () => ({ focusFirst: () => focusRow(0) }));

  const set = (key: string, v: Value) => onCommit((d) => setValue(d, key, v));
  const rowControl = (row: PanelRow, i: number) => {
    const ref = (el: HTMLElement | null) => { firstRefs.current[i] = el; };
    const next = () => focusRow(i + 1);
    const a = row.attr;
    const invalidWhole = row.validity.state === 'invalid' && row.validity.items.length === 0;
    const invalidItems = row.validity.state === 'invalid' ? row.validity.items : [];
    const label = a ? attrTypeLabel(a.type) : row.key === 'source' ? attrTypeLabel('text') : row.key === 'review' ? attrTypeLabel('select') : '';
    const validityMsg = invalidWhole ? (a?.type === 'select' || row.key === 'review' ? t('panel.notOption') : t('panel.invalid', { type: label })) : null;
    const desc = joinDesc(a?.description, row.required ? t('panel.required') : null, validityMsg);
    const disabled = !editable || !row.editable;
    if (row.key === 'created' || row.key === 'modified') {
      return <span className="value-text">{typeof row.raw === 'string' ? formatDateTime(row.raw) : rawText(row.raw)}</span>;
    }
    if (a && (!a.supported || a.readOnlyReason)) {
      return <span className="raw-value" tabIndex={0} aria-description={readOnlyReason(row)} data-user-content>{rawText(row.raw)}</span>;
    }
    if (!editable) return <span className="value-text" data-user-content>{rawText(row.raw)}</span>;
    if (!a) {
      if (row.key === 'tags') return <TagsControl raw={row.raw} disabled={disabled} inputRef={ref} onTag={onTag} onValue={(v) => set('tags', v)} />;
      if (row.key === 'aliases') return <AliasesControl raw={row.raw} disabled={disabled} inputRef={ref} onValue={(v) => set('aliases', v)} />;
      if (row.key === 'source') {
        // D-248, D-256: free text on every type, with links (D-257).
        return <TextControl name={row.label} desc={desc} raw={row.raw} kind="text" disabled={disabled} inputRef={ref} onNext={next} linked={linked}
          onValue={(v) => set('source', v)} />;
      }
      if (row.key === 'review') {
        return <SelectControl name={row.label} desc={desc} raw={row.raw} invalid={invalidWhole} disabled={disabled} inputRef={ref}
          choices={[{ value: 'unreviewed', label: t('review.unreviewed') }, { value: 'reviewed', label: t('review.reviewed') }]} onValue={(v) => set('review', v)} />;
      }
      return <span className="value-text">{rawText(row.raw)}</span>;
    }
    const common = { name: a.name, desc, raw: row.raw, disabled, inputRef: ref };
    switch (a.type) {
      case 'text': case 'long-text':
        return <TextControl {...common} kind={a.type as TextKind} invalid={invalidWhole} onNext={next} linked={linked} onValue={(v) => set(a.key, v)} />;
      case 'number': case 'url': case 'email':
        return <TextControl {...common} kind={a.type as TextKind} invalid={invalidWhole} onNext={next} onValue={(v) => set(a.key, v)} />;
      case 'checkbox':
        return <CheckboxControl {...common} invalid={invalidWhole} onValue={(v) => set(a.key, v)} />;
      case 'date':
        return <DateControl {...common} invalid={invalidWhole} onNext={next} onValue={(v) => set(a.key, v)} />;
      case 'date-time':
        return <DateTimeControl {...common} invalid={invalidWhole} onNext={next} onValue={(v) => set(a.key, v)} />;
      case 'date-range':
        return <DateRangeControl {...common} invalid={invalidWhole} onNext={next} onRange={(s, e) => onCommit((d) => setRange(d, a.key, s, e))} />;
      case 'select':
        return <SelectControl {...common} invalid={invalidWhole} choices={a.options.map((o) => ({ value: nfc(o.label), label: o.label, color: o.color }))} onValue={(v) => set(a.key, v)} />;
      case 'multi-select':
        return <MultiSelectControl {...common} invalidItems={invalidWhole ? [] : invalidItems} choices={a.options.map((o) => ({ value: nfc(o.label), label: o.label, color: o.color }))}
          onValue={(v) => set(a.key, v)} />;
      case 'relation':
        return <RelationControl {...common} to={a.to} multiple={a.multiple} links={links} types={types} path={path} invalidWhole={invalidWhole} invalidItems={invalidItems}
          onOpen={onOpen} onValue={(v) => set(a.key, v)} />;
    }
    return <span className="value-text" data-user-content>{rawText(row.raw)}</span>;
  };

  return (
    <section className="attr-panel" aria-label={t('props.title')}>
      {onToggle && (
        <button type="button" className="properties-head" aria-expanded={open} data-command="note.toggleProperties" onClick={onToggle}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
          {t('props.title')}
        </button>
      )}
      {open && (<>
      <div className="attr-grid">
        {model.rows.map((row, i) => {
          const userNamed = !!row.attr;
          const emptyRequired = row.required && row.validity.state === 'empty';
          return (
            <div key={row.key} className={`attr-row ${row.required ? 'required' : ''}`} data-key={row.key}>
              <span className="attr-label" title={row.attr?.description ?? undefined} data-user-content={userNamed ? '' : undefined}>{row.label}</span>
              <span className="attr-value">
                {rowControl(row, i)}
                {emptyRequired && editable && <span className="required-warning"><WarnIcon />{t('panel.required')}</span>}
              </span>
            </div>
          );
        })}
      </div>
      <button type="button" className="other-props" aria-expanded={otherOpen} data-command="panel.otherProperties" onClick={onToggleOther}>
        <Icon name={otherOpen ? 'chevron-down' : 'chevron-right'} size={12} />
        {t('panel.otherButton', { count: model.other.length })}
      </button>
      {otherOpen && (
        <ul className="other-list" aria-label={t('panel.otherList')}>
          {model.other.map((o) => (
            <li key={o.key} className="attr-row">
              <span className="attr-label" data-user-content>{o.key}</span>
              <span className="attr-value value-text" data-user-content>{otherText(o.value)}</span>
            </li>
          ))}
        </ul>
      )}
      </>)}
    </section>
  );
}

/** Other properties as read-view FR-TYP-08 AC-3 shows them: dates in the region format, lists joined. */
function otherText(v: unknown): string {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDate(v);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return formatDateTime(v);
  if (typeof v === 'boolean') return t(v ? 'panel.checked' : 'panel.unchecked');
  if (Array.isArray(v)) return v.map(otherText).join(', ');
  return rawText(v);
}
