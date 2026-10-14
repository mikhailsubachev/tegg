// The New type dialog (FR-TYP-01 AC-1…AC-3, D-222): Name (focused) and Plural name; `Create` checks the rules first
// (@tegg/schema, the core checks them again) and writes exactly one type file (`type_create`); Cancel, Esc and closing
// write nothing. A file that appeared meanwhile is never overwritten (`A type with this name already exists`).
import { useEffect, useRef, useState } from 'react';
import { checkTypeName } from '@tegg/schema';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { TypeDto } from '../ipc/types';
import { FieldError, useErrorId } from './controls/common';
import { typeErrorMessage } from './util';

export function NewTypeDialog({ types, undefinedKeys, onCreated, onClose }: {
  types: TypeDto[];
  /** `type` values used by objects without a definition (D-121): allowed, their objects become this type's. */
  undefinedKeys: string[];
  onCreated: (t: TypeDto) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [plural, setPlural] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement | null>(null);
  const errId = useErrorId();
  useEffect(() => { first.current?.focus(); }, []);
  const create = async () => {
    if (busy) return;
    const n = name.normalize('NFC'), p = plural.normalize('NFC');
    const r = checkTypeName(n, p, types as never, undefinedKeys);
    if (r) { setError(t(`typeRule.${r.reason}`, { key: r.key ?? '' })); return; }
    setBusy(true);
    try {
      const created = await ipc.typeCreate(n.trim(), p.trim());
      onCreated(created);
    } catch (e) {
      setError(typeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const field = (label: string, value: string, set: (v: string) => void, ref?: React.Ref<HTMLInputElement>) => (
    <label className="ts-field">
      <span className="ts-label">{label}</span>
      <input ref={ref} type="text" aria-label={label} value={value} spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off"
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
        {field(t('ts.name'), name, setName, first)}
        {field(t('ts.plural'), plural, setPlural)}
        <FieldError id={errId} text={error} />
        <div className="form-actions">
          <button data-command="newType.button0" type="button" onClick={onClose}>{t('newType.cancel')}</button>
          <button data-command="newType.button1" type="button" className="primary" disabled={busy} onClick={() => void create()}>{t('newType.create')}</button>
        </div>
      </div>
    </div>
  );
}
