// The Tasks tag filter (D-518; tasks.md R40, FR-TSK-04 AC-5): a combobox `Filter by tag` with the selected tags as
// chips and a listbox `Tags` of the tags of open tasks within the date filter, most tasks first (views.ts `counts`).
// Typing filters the options (folded case and diacritics, NFC/NFD, as the switcher); ↑/↓ move, ⏎ adds the highlighted
// option (the first match while typing), ⌫ in the empty field removes the last chip, Esc closes. Selected tags must
// all match (views.ts `hasTag`). Choosing writes nothing; the selection is the page's remembered state (D-481).
import { useId, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { Icon } from '../shell/Icon';

type Tag = { key: string; label: string; count: number };

const MAX_OPTIONS = 12;
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function TagFilter({ tags, selected, onChange }: {
  /** `counts(...).tags`: every listed tag with the number of tasks it would leave. */
  tags: Tag[];
  /** The selected tag keys, in the order they were added. */
  selected: string[];
  onChange: (keys: string[]) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const q = fold(query.trim());
  const matches = q ? tags.filter((x) => fold(x.label).includes(q) || fold(x.key).includes(q)) : tags;
  const options = matches.slice(0, MAX_OPTIONS);
  const at = Math.min(active, Math.max(0, options.length - 1));
  const labelOf = (key: string) => tags.find((x) => x.key === key)?.label ?? key;

  const show = (i = 0) => { setOpen(true); setActive(i); };
  const close = () => { setOpen(false); setQuery(''); setActive(0); };
  const toggle = (key: string) => {
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
    close();
    input.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { show(); return; }
      if (options.length) setActive((at + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
    } else if (e.key === 'Enter') {
      if (!open || !options.length) return;
      e.preventDefault();
      toggle(options[at].key);
    } else if (e.key === 'Escape') {
      if (!open) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Backspace' && query === '' && selected.length) {
      e.preventDefault();
      onChange(selected.slice(0, -1));
    }
  };

  const listId = `${id}-tags`;
  const optionId = (i: number) => `${id}-o${i}`;
  return (
    <div className="tag-filter" ref={wrap} onBlur={(e) => { if (!wrap.current?.contains(e.relatedTarget as Node | null)) close(); }}>
      <span className="label">{t('tasks.tags')}</span>
      <div className={`tf-box ${open ? 'open' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); input.current?.focus(); if (open) close(); else show(); } }}>
        <Icon name="search" size={13} />
        {selected.map((k) => (
          <span key={k} className="tf-chip" data-tag={k}>
            <span data-user-content>#{labelOf(k)}</span>
            <button type="button" className="tf-chip-remove" data-command="tasks.tagFilter" aria-label={t('tasks.tagRemove', { tag: labelOf(k) })}
              onClick={() => { onChange(selected.filter((x) => x !== k)); input.current?.focus(); }}>×</button>
          </span>
        ))}
        <input ref={input} type="text" role="combobox" className="tf-input" aria-label={t('tasks.tagFilter')} aria-haspopup="listbox" aria-expanded={open}
          aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open && options.length ? optionId(at) : undefined}
          placeholder={selected.length ? t('tasks.tagAdd') : t('tasks.tagSearch', { count: tags.length })}
          spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off" value={query}
          onChange={(e) => { setQuery(e.target.value); show(); }} onClick={() => { if (!open) show(); }} onKeyDown={onKey} />
        {selected.length > 0 && (
          <button type="button" className="tf-clear" data-command="tasks.tagClear" aria-label={t('tasks.tagClear')} title={t('tasks.tagClear')}
            onClick={() => { onChange([]); close(); input.current?.focus(); }}>×</button>
        )}
      </div>
      {open && (
        <div className="tf-menu">
          <div className="tf-menu-hint">
            {q ? t('tasks.tagMatches', { matches: matches.length, count: tags.length, text: query.trim() }) : t('tasks.tagListHint', { count: tags.length })}
          </div>
          <div role="listbox" id={listId} aria-label={t('tasks.tags')} aria-multiselectable="true" className="tf-options">
            {options.map((x, i) => {
              const on = selected.includes(x.key);
              return (
                <div key={x.key} id={optionId(i)} role="option" aria-selected={on} aria-label={`#${x.label}`} aria-describedby={`${optionId(i)}-n`} data-tag={x.key}
                  className={`tf-option ${i === at ? 'active' : ''}`} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => toggle(x.key)}>
                  <span className="tick" aria-hidden="true">{on ? '✓' : ''}</span>
                  <span className="tf-name" data-user-content>#{x.label}</span>
                  <span id={`${optionId(i)}-n`} className="count">{x.count}</span>
                </div>
              );
            })}
          </div>
          <div className="tf-menu-keys">{t('tasks.tagKeys')}</div>
        </div>
      )}
      {selected.length > 1 && <span className="hint">{t('tasks.tagAll')}</span>}
    </div>
  );
}
