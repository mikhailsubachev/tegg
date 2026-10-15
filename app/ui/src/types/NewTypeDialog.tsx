// The New type dialog (FR-TYP-01 AC-1…AC-3, D-222): Name (focused) and Plural name; `Create` checks the rules first
// (@tegg/schema, the core checks them again) and writes exactly one type file (`type_create`); Cancel, Esc and closing
// write nothing. A file that appeared meanwhile is never overwritten (`A type with this name already exists`).
// `fromValue` (D-251, D-259): define a `type:` value that has no definition: Name = the value with its first letter
// upper-cased, read-only (the key stays the value's); Plural prefilled and focused; Folder follows Plural until edited.
import { useEffect, useRef, useState } from 'react';
import { checkFolder, checkTypeName } from '@tegg/schema';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { TypeDto } from '../ipc/types';
import { FieldError, useErrorId } from './controls/common';
import { typeErrorMessage } from './util';

export const upperFirst = (v: string) => { const n = v.normalize('NFC').trim(); return n.charAt(0).toLocaleUpperCase() + n.slice(1); };

export function NewTypeDialog({ types, undefinedKeys, fromValue, onCreated, onClose }: {
  types: TypeDto[];
  /** `type` values used by objects without a definition (D-121): allowed, their objects become this type's. */
  undefinedKeys: string[];
  fromValue?: string;
  onCreated: (t: TypeDto) => void;
  onClose: () => void;
}) {
  const initial = fromValue === undefined ? '' : upperFirst(fromValue);
  const [name, setName] = useState(initial);
  const [plural, setPluralRaw] = useState(initial);
  const [folder, setFolder] = useState<string | null>(null); // null: follows Plural
  const setPlural = (v: string) => setPluralRaw(v);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement | null>(null);
  const pluralRef = useRef<HTMLInputElement | null>(null);
  const errId = useErrorId();
  useEffect(() => { (fromValue === undefined ? first : pluralRef).current?.focus(); }, []);
  const create = async () => {
    if (busy) return;
    const n = name.normalize('NFC'), p = plural.normalize('NFC');
    const r = checkTypeName(n, p, types as never, undefinedKeys);
    const f = fromValue === undefined ? undefined : (folder ?? p).normalize('NFC').trim();
    const rf = r ?? (f !== undefined ? checkFolder(f, types as never) : null);
    if (rf) { setError(t(`typeRule.${rf.reason}`, { key: rf.key ?? '' })); return; }
    setBusy(true);
    try {
      const created = await ipc.typeCreate(n.trim(), p.trim(), f);
      onCreated(created);
    } catch (e) {
      setError(typeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const field = (label: string, value: string, set: (v: string) => void, ref?: React.Ref<HTMLInputElement>, readOnly = false) => (
    <label className="ts-field">
      <span className="ts-label">{label}</span>
      <input ref={ref} type="text" aria-label={label} value={value} readOnly={readOnly} spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off"
        aria-describedby={error ? errId : undefined}
        onChange={(e) => { set(e.target.value); setError(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void create(); } }} />
    </label>
  );
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={t('newType.title')} className="dialog new-type"
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
        <h2>{t('newType.title')}</h2>
        {field(t('ts.name'), name, setName, first, fromValue !== undefined)}
        {field(t('ts.plural'), plural, setPlural, pluralRef)}
        {fromValue !== undefined && field(t('ts.folder'), folder ?? plural, setFolder)}
        <FieldError id={errId} text={error} />
        <div className="form-actions">
          <button data-command="newType.button0" type="button" onClick={onClose}>{t('newType.cancel')}</button>
          <button data-command="newType.button1" type="button" className="primary" disabled={busy} onClick={() => void create()}>{t('newType.create')}</button>
        </div>
      </div>
    </div>
  );
}
