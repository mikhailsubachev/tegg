// Relation and Source (link chips and the picker, FR-EDT-07 AC-6, FR-TYP-08 AC-10), Tags (FR-TYP-08 AC-8) and Aliases
// (AC-9). Lists keep their style through @tegg/doc setValue (D-230); removing the last item removes the key (AC-9).
import { chipParts } from '../../links/ChipParts';
import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n/catalog';
import { ipc } from '../../ipc/client';
import type { LinkTargetDto, TagRowDto, TypeDto } from '../../ipc/types';
import { Icon } from '../../shell/Icon';
import { chipIcon } from '../../links/icons';
import { requestOffer } from '../../links/offer';
import { openDate } from '../../daily/open';
import { RelationPicker } from '../RelationPicker';
import { nfc, rawText, wiki } from '../util';
import { EmptyMark, WarnIcon, type Value } from './common';
import { TextControl } from './TextControl';
import { useTagLook } from '../../tags/store';

const asList = (raw: unknown): unknown[] => (raw === null || raw === undefined || raw === '' ? [] : Array.isArray(raw) ? raw : [raw]);

export function RelationControl({ name, desc, raw, to, multiple, links, types, path, invalidWhole, invalidItems, disabled, onValue, onOpen, inputRef }: {
  name: string;
  desc?: string;
  raw: unknown;
  to: string[] | null;
  multiple: boolean;
  links: Map<string, LinkTargetDto>;
  types: TypeDto[];
  path: string;
  invalidWhole?: boolean;
  invalidItems: number[];
  disabled?: boolean;
  onValue: (v: Value) => boolean | void;
  onOpen: (path: string) => void;
  inputRef?: (el: HTMLElement | null) => void;
}) {
  const [picking, setPicking] = useState(false);
  const add = useRef<HTMLButtonElement | null>(null);
  const items = asList(raw);
  // Items as they are written back: links as `{ link }`, anything else unchanged (kept as written, D-231).
  const keep = (x: unknown): Value => { const w = wiki(x); return w ? { link: w.inner } : (x as Value); };
  const remove = (i: number) => {
    const rest = items.filter((_, j) => j !== i).map(keep);
    onValue(multiple || items.length > 1 ? rest : rest.length ? rest[0] : null);
  };
  const allowedNames = (to ?? []).map((k) => types.find((x) => nfc(x.key) === nfc(k))?.name ?? k);
  const chosen = items.flatMap((x) => { const w = wiki(x); const p = w ? links.get(nfc(w.target))?.path : null; return p ? [p] : []; });
  return (
    <span role="group" aria-label={name} aria-description={desc} className="field-wrap chips-field">
      {items.map((x, i) => {
        const w = wiki(x);
        if (!w || (invalidWhole && !multiple && typeof x !== 'string')) {
          return (
            <span key={`${i}:raw`} className="raw-value invalid" tabIndex={0} aria-description={t('panel.invalid', { type: t('attrType.relation') })}>
              <span data-user-content>{rawText(x)}</span>
              <WarnIcon />
              {!disabled && (
                <button data-command="panel.list.button0" type="button" tabIndex={-1} className="chip-remove" aria-label={t('panel.remove', { label: rawText(x) })} onClick={() => remove(i)}>
                  <Icon name="x" size={11} />
                </button>
              )}
            </span>
          );
        }
        const info = links.get(nfc(w.target));
        const ok = !!info?.path && (info.kind === 'note' || info.kind === 'daily' || info.kind === 'trashed');
        const dated = info?.kind === 'date-missing'; // never broken (FR-DLY-08 AC-8)
        const shown = w.alias ?? (ok ? info!.title ?? w.target : w.target);
        const wrongType = ok && to && to.length > 0 && !to.map(nfc).includes(nfc(info!.type ?? 'page'));
        const d = dated ? undefined : !ok ? t('link.noNote', { target: w.target }) : wrongType ? t('panel.notType', { type: allowedNames.join(' / ') }) : invalidItems.includes(i) ? t('panel.invalid', { type: t('attrType.relation') }) : undefined;
        const icon = chipIcon(info?.type ?? 'page');
        const parts = ok ? chipParts(info) : null; // D-600
        return (
          <span key={`${i}:${w.inner}`} className={`chip-wrap ${wrongType ? 'warn' : ''}`}>
            <a data-command="panel.list.a1" href="#" aria-description={ok && parts?.description ? [d, parts.description].filter(Boolean).join(', ') : d} data-link-kind={ok ? info!.kind : dated ? 'date-missing' : 'unresolved'} {...parts?.attrs}
              className={`chip link-chip kind-${ok ? info!.kind : dated ? 'date-missing' : 'unresolved'}`}
              onClick={(e) => {
                e.preventDefault();
                if ((dated || info?.kind === 'daily') && openDate(w.target)) return; // FR-DLY-08 AC-6
                if (ok) onOpen(info!.path!);
                else requestOffer({ from: path, target: w.target, relationTo: to && to.length ? to : null, anchor: e.currentTarget }); // FR-LNK-04 AC-4, D-243
              }}
              onKeyDown={(e) => { if (!disabled && (e.key === 'Backspace' || e.key === 'Delete')) { e.preventDefault(); remove(i); } }}>
              {ok && (parts?.icon ?? <Icon name={icon.glyph} dataIcon={icon.def} size={13} />)}
              <span data-user-content>{shown}</span>
              {parts?.suffix}
            </a>
            {wrongType && <WarnIcon />}
            {!disabled && (
              <button data-command="panel.list.button2" type="button" tabIndex={-1} className="chip-remove" aria-label={t('panel.remove', { label: shown })} onClick={() => remove(i)}>
                <Icon name="x" size={11} />
              </button>
            )}
          </span>
        );
      })}
      {items.length === 0 && <EmptyMark onActivate={() => add.current?.focus()} />}
      {!disabled && (
        <button data-command="panel.list.button3" ref={(e) => { add.current = e; inputRef?.(e); }} type="button" className="chip-add" aria-label={t('panel.add', { name })} aria-haspopup="dialog"
          onClick={() => setPicking(true)}>
          <Icon name="plus" size={12} />
        </button>
      )}
      {picking && (
        <RelationPicker name={name} to={to} exclude={[path, ...chosen]} from={path} types={types}
          onClose={() => { setPicking(false); add.current?.focus(); }}
          onPick={(p) => {
            setPicking(false);
            add.current?.focus();
            onValue(multiple ? [...items.map(keep), { link: p.text }] : { link: p.text });
          }} />
      )}
    </span>
  );
}

/** Tags of the frontmatter (inline body tags stay in the body, D-229), with the editor's tag suggestions. */
export function TagsControl({ raw, disabled, onValue, onTag, inputRef }: {
  raw: unknown;
  disabled?: boolean;
  onValue: (v: Value) => boolean | void;
  onTag: (key: string) => void;
  inputRef?: (el: HTMLElement | null) => void;
}) {
  const look = useTagLook();
  const list = asList(raw).map((x) => rawText(x));
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [all, setAll] = useState<TagRowDto[]>([]);
  const [sel, setSel] = useState(-1);
  const add = useRef<HTMLButtonElement | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!adding) return;
    field.current?.focus();
    ipc.tags().then(setAll, () => setAll([]));
  }, [adding]);
  const has = (name: string) => list.some((x) => nfc(x.replace(/^#/, '')).toLowerCase() === nfc(name).toLowerCase());
  const query = nfc(q.trim().replace(/^#+/, ''));
  const fold = (s: string) => nfc(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const sugg = all.filter((x) => !has(x.name) && (!query || fold(x.name).includes(fold(query)))).slice(0, 8);
  const commit = (name: string) => {
    const n = nfc(name.trim().replace(/^#+/, ''));
    setAdding(false);
    setQ('');
    setSel(-1);
    add.current?.focus();
    if (!n || has(n)) return;
    onValue([...list, n]);
  };
  return (
    <span role="group" aria-label={t('attr.tags')} className="field-wrap chips-field">
      {list.map((x, i) => {
        const name = x.replace(/^#/, '');
        return (
          <span key={`${i}:${x}`} className="chip tag-chip" style={look(name).style}>
            <a data-command="panel.list.a4" href="#" data-tag={nfc(name).toLowerCase()} style={look(name).style} onClick={(e) => { e.preventDefault(); onTag(nfc(name).toLowerCase()); }}
              onKeyDown={(e) => { if (!disabled && (e.key === 'Backspace' || e.key === 'Delete')) { e.preventDefault(); onValue(list.filter((_, j) => j !== i)); } }}>
              <span data-user-content>#{look(name).name}</span>
            </a>
            {!disabled && (
              <button data-command="panel.list.button5" type="button" tabIndex={-1} className="chip-remove" aria-label={t('panel.removeTag', { name })} onClick={() => onValue(list.filter((_, j) => j !== i))}>
                <Icon name="x" size={11} />
              </button>
            )}
          </span>
        );
      })}
      {list.length === 0 && !adding && <EmptyMark onActivate={() => add.current?.focus()} />}
      {!disabled && !adding && (
        <button data-command="panel.list.button6" ref={(e) => { add.current = e; inputRef?.(e); }} type="button" className="chip-add" aria-label={t('panel.addTag')} onClick={() => setAdding(true)}>
          <Icon name="plus" size={12} />
        </button>
      )}
      {adding && (
        <span className="tag-add">
          <input ref={(e) => { field.current = e; inputRef?.(e); }} type="text" role="combobox" aria-label={t('panel.tagField')} aria-expanded="true" aria-autocomplete="list"
            value={q} spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off" className="pfield"
            onChange={(e) => { setQ(e.target.value); setSel(-1); }}
            onBlur={() => { setAdding(false); setQ(''); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAdding(false); setQ(''); add.current?.focus(); }
              else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(-1, Math.min(sugg.length, s + (e.key === 'ArrowDown' ? 1 : -1)))); }
              else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(sel >= 0 && sel < sugg.length ? sugg[sel].name : q); }
            }} />
          <div role="listbox" aria-label={t('suggest.tags')} className="popover suggestions tag-suggestions">
            {sugg.map((x, i) => (
              <div key={x.key} role="option" aria-selected={i === sel} className={`option ${i === sel ? 'selected' : ''}`}
                onMouseDown={(e) => e.preventDefault()} onClick={() => commit(x.name)}>
                <span data-user-content style={look(x.name).style}>#{x.name}</span>
              </div>
            ))}
            {query && !has(query) && !sugg.some((x) => nfc(x.name).toLowerCase() === query.toLowerCase()) && (
              <div role="option" aria-selected={sel === sugg.length} className={`option ${sel === sugg.length ? 'selected' : ''}`}
                onMouseDown={(e) => e.preventDefault()} onClick={() => commit(query)}>
                {t('suggest.createTag', { query })}
              </div>
            )}
          </div>
        </span>
      )}
    </span>
  );
}

/** The aliases typed in the Aliases field (D-312): comma-separated, trimmed, NFC, without empty parts and without
 *  case-insensitive duplicates. */
export function parseAliases(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(',')) {
    const a = nfc(part.trim());
    if (a && !out.some((x) => x.toLowerCase() === a.toLowerCase())) out.push(a);
  }
  return out;
}

/** Aliases as one single-line text field (D-312, FR-TYP-08 AC-15); written as a YAML list, cleared = key removed. */
export function AliasesControl({ raw, desc, disabled, onValue, onNext, inputRef }: {
  raw: unknown;
  desc?: string;
  disabled?: boolean;
  onValue: (v: Value) => boolean | void;
  onNext?: () => void;
  inputRef?: (el: HTMLElement | null) => void;
}) {
  const list = asList(raw).map((x) => rawText(x));
  return (
    <TextControl kind="text" name={t('attr.aliases')} desc={desc} raw={list.join(', ')} disabled={disabled} inputRef={inputRef} onNext={onNext}
      onValue={(v) => {
        const next = parseAliases(typeof v === 'string' ? v : '');
        if (next.length === list.length && next.every((a, i) => a === nfc(list[i]))) return true; // same aliases: no write
        return onValue(next.length ? next : null);
      }} />
  );
}
