// R55 Tags (FR-CAP-01 AC-6): chips `#<tag>` with `Remove #<tag>`, then the combobox `Add tag…` with the listbox `Tags`
// of index tag suggestions. ⏎ adds the highlighted suggestion or the typed tag; a space or a comma adds the typed tag;
// ⌫ in the empty field removes the last chip. Shared by the capture window and the Inbox's `Add tags…` (§4).
import { useId, useRef, useState } from 'react';
import { Icon } from '../shell/Icon';
import { region } from '../i18n/collate';
import { t } from '../i18n/catalog';
import { addChip, tagSuggestions } from './tags';
import { tagChipStyle } from '../theme/tagChip';

/** `colors`: the tag colour per key (D-655), for the chips and the suggestions. */
export function TagField({ chips, onChange, tags, autoFocus, colors }: { chips: string[]; onChange: (chips: string[]) => void; tags: string[]; autoFocus?: boolean; colors?: Record<string, string | null> }) {
  const [typed, setTyped] = useState('');
  const [active, setActive] = useState(0);
  const id = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const key = (s: string) => s.normalize('NFC').toLowerCase();
  const tint = (s: string) => tagChipStyle(colors?.[key(s)]);
  const suggestions = tagSuggestions(typed, tags, region() ?? navigator.language).filter((s) => !chips.some((c) => key(c) === key(s)));
  const open = suggestions.length > 0;
  const add = (tag: string) => {
    onChange(addChip(chips, tag));
    setTyped('');
    setActive(0);
  };
  const onInput = (value: string) => {
    // A space or a comma ends a tag (R55); several may arrive at once (paste).
    const parts = value.split(/[\s,]+/);
    if (parts.length > 1) {
      let next = chips;
      for (const p of parts.slice(0, -1)) next = addChip(next, p);
      onChange(next);
      setTyped(parts[parts.length - 1]);
    } else setTyped(value);
    setActive(0);
  };
  return (
    <div className="tag-field">
      <span className="tag-field-icon"><Icon name="hash" size={13} /></span>
      {chips.map((c) => (
        <span key={c} className="tag-field-chip" style={tint(c)}>
          <span data-user-content>#{c}</span>
          <button type="button" tabIndex={0} className="tag-field-remove" aria-label={t('capture.removeTag', { tag: c })} onClick={() => { onChange(chips.filter((x) => x !== c)); input.current?.focus(); }}>×</button>
        </span>
      ))}
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-label={t('capture.addTag')}
        placeholder={t('capture.addTag')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        value={typed}
        onChange={(e) => onInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            if (open) add(suggestions[Math.min(active, suggestions.length - 1)]);
            else if (typed.trim()) add(typed);
          } else if (e.key === 'Backspace' && typed === '' && chips.length > 0) {
            e.preventDefault();
            onChange(chips.slice(0, -1));
          } else if (e.key === 'ArrowDown' && open) {
            e.preventDefault();
            setActive((a) => (a + 1) % suggestions.length);
          } else if (e.key === 'ArrowUp' && open) {
            e.preventDefault();
            setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
          } else if (e.key === 'Escape' && (open || typed)) {
            e.preventDefault();
            e.stopPropagation();
            setTyped('');
          }
        }}
      />
      {open && (
        <ul role="listbox" id={`${id}-list`} aria-label={t('capture.tags')} className="tag-field-list">
          {suggestions.map((s, i) => (
            <li key={s} id={`${id}-${i}`} role="option" aria-selected={i === active} className={i === active ? 'active' : undefined}
              onMouseDown={(e) => { e.preventDefault(); add(s); }}>
              <span data-user-content style={tint(s)}>#{s}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
