// D-1431, D-1432 (preview v0.120 feedback F1; board `NewObjectPicker` A–E; capture.md FR-VLT-05 AC-8…AC-14): ⌘N, the
// sidebar's `New object` and the palette's `New object…` ask for a type first. The D-550 type list (Page, Task, Quick
// Note, then user types A–Z), the vault's default preselected and marked `Default`; typing filters by the start of any
// word, case and accents aside. ⏎ or a click creates; Esc or a click outside closes and the caller gives the focus back.
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import type { TypeDefDto } from '../ipc/types';
import { Icon, typeIconName } from './Icon';
import { captureTargets } from './TypeMenu';

/** Folded for matching: NFC-independent, without accents, lower case. */
export function foldTypeName(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** AC-11: the query matches the start of any word of the name. */
export function typeMatches(name: string, query: string): boolean {
  const q = foldTypeName(query).trim();
  if (!q) return true;
  const n = foldTypeName(name);
  return n.startsWith(q) || n.split(/[\s\-_/]+/).some((w, i) => i > 0 && w.startsWith(q)) || n.includes(` ${q}`);
}

/** The listed types: the capture targets, with the default first when it isn't one of them (a Daily Note, D-541). */
export function pickerTypes(types: TypeDefDto[], defaultKey: string | null): TypeDefDto[] {
  const list = captureTargets(types);
  if (defaultKey && !list.some((x) => x.key === defaultKey)) {
    const d = types.find((x) => x.key === defaultKey && !x.invalid);
    if (d) return [d, ...list];
  }
  return list;
}

export function NewObjectPicker({ types, defaultKey, at, onChoose, onClose }: {
  types: TypeDefDto[];
  defaultKey: string | null;
  /** Under the sidebar button; without it, the palette's place. */
  at?: { left: number; top: number } | null;
  onChoose: (key: string) => void;
  onClose: () => void;
}) {
  const all = useMemo(() => pickerTypes(types, defaultKey), [types, defaultKey]);
  const [q, setQ] = useState('');
  const shown = useMemo(() => all.filter((x) => typeMatches(x.name, q)), [all, q]);
  const startAt = () => { const i = shown.findIndex((x) => x.key === defaultKey); return q.trim() || i < 0 ? 0 : i; };
  const [sel, setSel] = useState(startAt);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => setSel(startAt()), [q, all]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = shown.length;
  const current = n ? shown[Math.min(sel, n - 1)] : undefined;
  const optionId = (key: string) => `new-object-type-${encodeURIComponent(key)}`;

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (n) setSel((s) => (Math.min(s, n - 1) + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (current) onChoose(current.key);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Tab') {
      e.preventDefault(); // the field is the dialog's only stop (AC-12)
    }
  };

  const style: React.CSSProperties | undefined = at ? { position: 'fixed', left: at.left, top: at.top } : undefined;
  return (
    <div className={`overlay ${at ? 'anchored' : ''}`} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}>
      <div className="dialog new-object-picker" role="dialog" aria-label={t('newPicker.title')} style={style}
        onMouseDown={(e) => e.stopPropagation()} onKeyDown={keys}>
        <div className="nop-field">
          <Icon name="plus" size={14} />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls="new-object-types"
            aria-activedescendant={current ? optionId(current.key) : undefined}
            aria-label={t('newPicker.field')}
            placeholder={t('newPicker.placeholder')}
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <ul id="new-object-types" role="listbox" aria-label={t('newPicker.types')}>
          {shown.map((x, i) => {
            const isDefault = x.key === defaultKey;
            const selected = current?.key === x.key;
            return (
              <li key={x.key} id={optionId(x.key)} role="option" aria-selected={selected}
                aria-description={isDefault ? t('newPicker.default') : undefined}
                className={selected ? 'selected' : ''} onMouseEnter={() => setSel(i)} onClick={() => onChoose(x.key)}>
                <span className="type-icon" style={{ ['--type' as string]: x.color ? `var(--type-${x.color})` : 'var(--muted)' }}>
                  <Icon name={typeIconName(x.key, x.icon)} size={16} />
                </span>
                <span className="nop-name" data-user-content>{x.name}</span>
                {isDefault && <span className="nop-default" aria-hidden="true">{t('newPicker.default')}</span>}
                {selected && <span className="nop-enter" aria-hidden="true">⏎</span>}
              </li>
            );
          })}
        </ul>
        {n === 0 && <p className="nop-empty">{t('newPicker.noMatch', { query: q })}</p>}
        <div className="nop-foot" aria-hidden="true">
          <span><kbd>↑</kbd> <kbd>↓</kbd> {t('newPicker.hintChoose')}</span>
          <span><kbd>⏎</kbd> {t('newPicker.hintCreate')}</span>
          <span><kbd>{t('newPicker.escKey')}</kbd> {t('newPicker.hintCancel')}</span>
        </div>
      </div>
    </div>
  );
}
