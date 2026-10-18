// The editable attribute panel on the note route (FR-EDT-07, FR-TYP-08 AC-7…AC-12; ms3-shell §14.6, §14.7):
// the region `Properties` with the type's attributes in schema order, then Tags, Aliases, Source, Review, Created,
// Modified, then `Other properties (<n>)`. Each control commits a value; the page turns it into the next note text
// with @tegg/doc (setValue / setRange) and hands it to the editor's save path (applyFrontmatter, D-240). The panel
// never adds or removes properties (D-72).
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { applyTaskChange, localDate, parse, parseDate, setRange, setValue, type Doc } from '@tegg/doc';
import { localIso } from '../newNote';
import { taskState } from '@tegg/schema';
import { appZone } from '../zone';
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

export function AttributePanel({ apiRef, text, type, types, path, editable, open = true, onToggle, otherOpen, onToggleOther, onCommit, onOpen, onOpenSource, onTag, onLeaveLast }: {
  /** 5A-1 (FR-TSK-08 AC-3, D-486): the Source chip opens its note at this note's embed. */
  onOpenSource?: (path: string) => void;
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
  const otherCount = model.hidden.length + model.other.length;
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

  const set = (key: string, v: Value) => onCommit((d) => (type.key === 'task' && key === 'status' && typeof v === 'string' ? taskStatus(d, v) : setValue(d, key, v)));
  /** FR-TSK-01 AC-4, D-472: on a task, Status follows the task rules (`completed` set into Done, removed out of it). */
  const taskStatus = (d: Doc, to: string): string => {
    const opts = type.attributes.find((x) => x.key === 'status')?.options ?? [];
    const stateOf = (label: unknown) => { const o = opts.find((x) => x.label === (typeof label === 'string' ? label.normalize('NFC') : null)); return o ? taskState(o) : 'open'; };
    const firstOpen = opts.find((o) => taskState(o) === 'open')?.label ?? to;
    const r = applyTaskChange(d.text, { kind: 'status', to, toState: stateOf(to), fromState: stateOf(d.frontmatter?.data?.status), firstOpen, now: localIso(new Date(Date.now())) });
    return r ? r.text : d.text;
  };
  // FR-TSK-09 AC-2: an open task's Due row shows the overdue highlight (R44).
  const overdue = useMemo(() => {
    if (type.key !== 'task') return false;
    const data = doc.frontmatter?.data ?? {};
    const due = typeof data.due === 'string' ? data.due.trim() : null;
    if (!due || !parseDate(due)) return false;
    const opt = type.attributes.find((x) => x.key === 'status')?.options.find((o) => o.label === (typeof data.status === 'string' ? data.status.normalize('NFC') : null));
    const state = opt ? taskState(opt) : 'open';
    return (state === 'open' || state === 'in-progress') && due < localDate(Date.now(), appZone());
  }, [doc, type]);
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
    // 5A-1: on a Task, `completed` is set by completing (D-472) and `recurrence` is v1.0 (D-381): both read-only.
    if (type.key === 'task' && a && (a.key === 'completed' || a.key === 'recurrence')) {
      const shown = a.key === 'completed' && typeof row.raw === 'string' ? formatDateTime(row.raw) : rawText(row.raw);
      return (
        <button type="button" className="raw-value" tabIndex={0} data-command="panel.editRecurrence" aria-disabled="true" aria-label={a.name} ref={ref}
          aria-description={a.key === 'completed' ? t('task.completedAuto') : t('due.comingIn', { due: 'v1.0' })}>
          <span data-user-content>{shown}</span>
        </button>
      );
    }
    if (row.key === 'created' || row.key === 'modified') {
      return <span className="value-text">{typeof row.raw === 'string' ? formatDateTime(row.raw) : rawText(row.raw)}</span>;
    }
    if (a && (!a.supported || a.readOnlyReason)) {
      return <span className="raw-value" tabIndex={0} aria-description={readOnlyReason(row)} data-user-content>{rawText(row.raw)}</span>;
    }
    if (!editable) return <span className="value-text" data-user-content>{rawText(row.raw)}</span>;
    if (!a) {
      if (row.key === 'tags') return <TagsControl raw={row.raw} disabled={disabled} inputRef={ref} onTag={onTag} onValue={(v) => set('tags', v)} />;
      if (row.key === 'aliases') return <AliasesControl raw={row.raw} desc={desc} disabled={disabled} inputRef={ref} onNext={next} onValue={(v) => set('aliases', v)} />;
      if (row.key === 'source') {
        // D-248, D-256: free text on every type, with links (D-257).
        const toSource = onOpenSource ? { ...linked, onOpen: (p: string) => onOpenSource(p) } : linked;
        return <TextControl name={row.label} desc={desc} raw={row.raw} kind="text" disabled={disabled} inputRef={ref} onNext={next} linked={toSource}
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
        // A Task's Status isn't cleared from the panel (D-471, D-472: it would count as Open with `completed` left).
        return <SelectControl {...common} invalid={invalidWhole} clearable={!(type.key === 'task' && a.key === 'status')} choices={a.options.map((o) => ({ value: nfc(o.label), label: o.label, color: o.color }))} onValue={(v) => set(a.key, v)} />;
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
              <span className="attr-value" data-overdue={row.key === 'due' && overdue ? 'true' : undefined}>
                {rowControl(row, i)}
                {emptyRequired && editable && <span className="required-warning"><WarnIcon />{t('panel.required')}</span>}
              </span>
            </div>
          );
        })}
      </div>
      {otherCount > 0 && ( // D-314: no button when there is nothing under it
        <button type="button" className="other-props" aria-expanded={otherOpen} data-command="panel.otherProperties" onClick={onToggleOther}>
          <Icon name={otherOpen ? 'chevron-down' : 'chevron-right'} size={12} />
          {t('panel.otherButton', { count: otherCount })}
        </button>
      )}
      {otherOpen && otherCount > 0 && (
        <ul className="other-list" aria-label={t('panel.otherList')}>
          {model.hidden.map((row, j) => ( // FR-TYP-17: hidden properties keep their controls (D-316)
            <li key={`h:${row.key}`} className={`attr-row ${row.required ? 'required' : ''}`} data-key={row.key}>
              <span className="attr-label" title={row.attr?.description ?? undefined} data-user-content={row.attr ? '' : undefined}>{row.label}</span>
              <span className="attr-value">{rowControl(row, model.rows.length + j)}</span>
            </li>
          ))}
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
