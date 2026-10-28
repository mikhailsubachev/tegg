// Checkbox, Select (also Review) and Multi-select (R10, FR-TYP-08 AC-11). A select is a `combobox` with the listbox
// `<Name> options` (the options and `Clear`); a multi-select is a group of chips with `Add <Name>` (FR-EDT-07 AC-10:
// ↑/↓, ⏎, Space, ⌫ work without the pointer). Values that aren't options are shown as written (D-231).
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../../i18n/catalog';
import { Icon } from '../../shell/Icon';
import { rawText } from '../util';
import { EmptyMark, WarnIcon, joinDesc, type Value } from './common';

export type Choice = { value: string; label: string; color?: string | null; icon?: string };

/** A popup listbox anchored to `anchor`; Esc or a click outside closes it and returns focus to the anchor. */
export function OptionsPopup({ label, anchor, choices, current, onChoose, onClose, footer }: {
  label: string;
  anchor: HTMLElement | null;
  choices: (Choice & { clear?: boolean })[];
  current?: string | null;
  onChoose: (c: Choice & { clear?: boolean }) => void;
  onClose: (refocus: boolean) => void;
  /** A line under the options that describes the list (the widen-only Type menu's, D-808). */
  footer?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const base = `opt-${useId().replace(/:/g, '')}`;
  const [sel, setSel] = useState(() => Math.max(0, choices.findIndex((c) => c.value === current)));
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const r = anchor?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: Math.min(r.bottom + 4, window.innerHeight - 40 - 28 * choices.length) });
  }, [anchor]);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    const outside = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose(false); };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  }, []);
  return (
    <div ref={ref} role="listbox" aria-label={label} tabIndex={-1} className="popover options-popup" style={pos}
      aria-activedescendant={choices.length ? `${base}-${sel}` : undefined} aria-describedby={footer ? `${base}-footer` : undefined}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : -1) + choices.length) % Math.max(1, choices.length)); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (choices[sel]) onChoose(choices[sel]); }
        else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); onClose(true); }
      }}>
      {choices.map((c, i) => (
        <div key={`${c.clear ? 'clear' : c.value}`} id={`${base}-${i}`} role="option" aria-selected={i === sel}
          className={`option ${i === sel ? 'selected' : ''} ${c.clear ? 'clear-option' : ''}`}
          onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setSel(i)} onClick={() => onChoose(c)}>
          {c.icon && <Icon name={c.icon} size={16} />}
          {c.color && <span className="option-dot" aria-hidden="true" style={{ background: `var(--type-${c.color})` }} />}
          <span data-user-content={c.clear ? undefined : ''}>{c.label}</span>
        </div>
      ))}
      {footer && <div id={`${base}-footer`} role="none" className="options-footer hint">{footer}</div>}
    </div>
  );
}

export function CheckboxControl({ name, desc, raw, invalid, disabled, onValue, inputRef }: {
  name: string; desc?: string; raw: unknown; invalid?: boolean; disabled?: boolean;
  onValue: (v: Value) => boolean | void; inputRef?: (el: HTMLElement | null) => void;
}) {
  return (
    <span className="field-wrap checkbox-field">
      <input ref={inputRef} type="checkbox" aria-label={name} aria-description={desc} disabled={disabled} checked={raw === true}
        onChange={(e) => onValue(e.target.checked)} />
      {invalid && <><span className="raw-value" data-user-content>{rawText(raw)}</span><WarnIcon /></>}
    </span>
  );
}

export function SelectControl({ name, desc, raw, choices, invalid, disabled, onValue, inputRef, clearable = true }: {
  name: string; desc?: string; raw: unknown; choices: Choice[]; invalid?: boolean; disabled?: boolean;
  onValue: (v: Value) => boolean | void; inputRef?: (el: HTMLElement | null) => void; clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  const cur = typeof raw === 'string' ? raw : raw === null || raw === undefined ? null : rawText(raw);
  const shown = cur === null || cur === '' ? null : choices.find((c) => c.value === cur.normalize('NFC'))?.label ?? cur;
  const choice = choices.find((c) => c.value === cur);
  const all = [...choices, ...(clearable ? [{ value: '', label: t('panel.clear'), clear: true }] : [])];
  return (
    <span className="field-wrap select-field">
      <button data-command="panel.choice.button0" ref={(e) => { btn.current = e; inputRef?.(e); }} type="button" role="combobox" aria-label={name} aria-description={desc}
        aria-haspopup="listbox" aria-expanded={open} aria-disabled={disabled || undefined} className={`pfield select ${invalid ? 'invalid' : ''}`}
        onClick={() => { if (!disabled) setOpen((o) => !o); }}
        onKeyDown={(e) => { if (!disabled && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setOpen(true); } }}>
        {choice?.color && <span className="option-dot" aria-hidden="true" style={{ background: `var(--type-${choice.color})` }} />}
        {shown === null ? <span className="muted">{t('panel.empty')}</span> : <span data-user-content>{shown}</span>}
        <Icon name="chevron-down" size={12} />
      </button>
      {invalid && <WarnIcon />}
      {open && (
        <OptionsPopup label={t('panel.options', { name })} anchor={btn.current} choices={all} current={cur}
          onClose={(refocus) => { setOpen(false); if (refocus) btn.current?.focus(); }}
          onChoose={(c) => { setOpen(false); btn.current?.focus(); onValue(c.clear ? null : c.value); }} />
      )}
    </span>
  );
}

export function MultiSelectControl({ name, desc, raw, choices, invalidItems, disabled, onValue, inputRef }: {
  name: string; desc?: string; raw: unknown; choices: Choice[]; invalidItems: number[]; disabled?: boolean;
  onValue: (v: Value) => boolean | void; inputRef?: (el: HTMLElement | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const add = useRef<HTMLButtonElement | null>(null);
  const items: unknown[] = raw === null || raw === undefined || raw === '' ? [] : Array.isArray(raw) ? raw : [raw];
  const list = items.map((x) => (typeof x === 'string' ? x : rawText(x)));
  const remove = (i: number) => onValue(list.filter((_, j) => j !== i));
  const left = choices.filter((c) => !list.some((x) => x.normalize('NFC') === c.value));
  return (
    <span role="group" aria-label={name} aria-description={desc} className="field-wrap chips-field">
      {list.map((x, i) => {
        const bad = invalidItems.includes(i);
        const c = choices.find((o) => o.value === x.normalize('NFC'));
        return (
          <span key={`${i}:${x}`} className={`chip option-chip ${bad ? 'invalid' : ''}`} tabIndex={0} aria-description={bad ? t('panel.notOption') : ''}
            onKeyDown={(e) => { if (!disabled && (e.key === 'Backspace' || e.key === 'Delete')) { e.preventDefault(); remove(i); } }}>
            {c?.color && <span className="option-dot" aria-hidden="true" style={{ background: `var(--type-${c.color})` }} />}
            <span data-user-content>{x}</span>
            {bad && <WarnIcon />}
            {!disabled && (
              <button data-command="panel.choice.button1" type="button" tabIndex={-1} className="chip-remove" aria-label={t('panel.remove', { label: x })} onClick={() => remove(i)}>
                <Icon name="x" size={11} />
              </button>
            )}
          </span>
        );
      })}
      {list.length === 0 && <EmptyMark onActivate={() => add.current?.focus()} />}
      {!disabled && (
        <button data-command="panel.choice.button2" ref={(e) => { add.current = e; inputRef?.(e); }} type="button" className="chip-add" aria-label={t('panel.add', { name })} aria-haspopup="listbox" aria-expanded={open}
          onClick={() => setOpen((o) => !o)}>
          <Icon name="plus" size={12} />
        </button>
      )}
      {open && (
        <OptionsPopup label={t('panel.options', { name })} anchor={add.current} choices={left}
          onClose={(refocus) => { setOpen(false); if (refocus) add.current?.focus(); }}
          onChoose={(c) => { setOpen(false); add.current?.focus(); onValue([...list, c.value]); }} />
      )}
    </span>
  );
}

export { joinDesc };
