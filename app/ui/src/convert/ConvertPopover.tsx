// Slice 5A-2: the conversion popover (conversion.md R50; D-493, D-525, D-538): the title (editable, selected), the
// type to create (Page, Task, Quick Note, then the user's types; D-224's targets), a summary, Convert and Cancel.
// Keyboard only works throughout (FR-UX-03): ⏎ converts, Esc cancels, ↑/↓ and a type's first letter pick a type.
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import type { TypeDefDto } from '../ipc/types';
import { Icon, typeIconName } from '../shell/Icon';
import { region } from '../i18n/collate';

const FIRST = ['page', 'task', 'quick-note'];
const NEVER = new Set(['daily-note', 'tag', 'image', 'pdf']);

/** R50's targets in order: Page, Task, Quick Note, then the user's types by name (D-122). */
export function conversionTypes(types: TypeDefDto[]): TypeDefDto[] {
  const collator = new Intl.Collator(region() ?? navigator.language);
  const first = FIRST.map((k) => types.find((x) => x.key === k)).filter((x): x is TypeDefDto => !!x && !x.invalid);
  const rest = types.filter((x) => !FIRST.includes(x.key) && !NEVER.has(x.key) && !x.system && !x.invalid).sort((a, b) => collator.compare(a.name, b.name));
  return [...first, ...rest];
}

export type ConvertChoice = { title: string; type: TypeDefDto };

export function ConvertPopover({ at, types, title: initial, type: preselect, count, onConvert, onCancel }: {
  at: { left: number; top: number };
  types: TypeDefDto[];
  title: string;
  type: string;
  count: number;
  onConvert: (c: ConvertChoice) => void;
  onCancel: () => void;
}) {
  const list = conversionTypes(types);
  const [title, setTitle] = useState(initial);
  const [type, setType] = useState(list.find((x) => x.key === preselect)?.key ?? list.find((x) => x.key === 'task')?.key ?? list[0]?.key ?? 'page');
  const input = useRef<HTMLInputElement | null>(null);
  const group = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const chosen = list.find((x) => x.key === type) ?? list[0];
  const ok = title.trim() !== '' && !!chosen;
  const convert = () => { if (ok) onConvert({ title: title.normalize('NFC').trim(), type: chosen! }); };
  const pick = (key: string) => {
    setType(key);
    // #63: the focus follows the choice only while it is still in the group; the user may have moved on before the frame.
    requestAnimationFrame(() => {
      if (group.current?.contains(document.activeElement)) group.current.querySelector<HTMLElement>(`[data-type="${CSS.escape(key)}"]`)?.focus();
    });
  };
  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
    if (e.key === 'Enter' && !(e.target as HTMLElement).closest('button')) { e.preventDefault(); convert(); }
  };
  const onGroupKey = (e: React.KeyboardEvent) => {
    const i = list.findIndex((x) => x.key === type);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); pick(list[(i + 1) % list.length].key); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); pick(list[(i - 1 + list.length) % list.length].key); }
    else if (e.key.length === 1 && /\p{L}/u.test(e.key) && !e.metaKey && !e.ctrlKey) {
      // The next type whose name starts with the letter, after the current one.
      const k = e.key.toLowerCase();
      for (let n = 1; n <= list.length; n++) {
        const x = list[(i + n) % list.length];
        if (x.name.toLowerCase().startsWith(k)) { e.preventDefault(); pick(x.key); break; }
      }
    }
  };
  return (
    <div role="dialog" aria-label={t('convert.title')} className="popover convert-popover" style={at} onKeyDown={onKey} onMouseDown={(e) => e.stopPropagation()}>
      <label className="convert-field">
        <span>{t('convert.titleField')}</span>
        <input ref={input} type="text" aria-label={t('convert.titleField')} value={title} spellCheck={false} autoComplete="off" data-user-content
          onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div ref={group} role="radiogroup" aria-label={t('convert.type')} className="convert-types" onKeyDown={onGroupKey}>
        {list.map((x) => (
          <button key={x.key} type="button" role="radio" data-type={x.key} data-command="convert.chooseType" aria-checked={x.key === type} tabIndex={x.key === type ? 0 : -1}
            aria-label={x.name} className={`convert-type${x.key === type ? ' selected' : ''}`} onClick={() => pick(x.key)}>
            <Icon name={typeIconName(x.key, x.icon)} size={14} />
            <span data-user-content>{x.name}</span>
          </button>
        ))}
      </div>
      {chosen && <p className="convert-summary">{t('convert.summary', { count, type: chosen.name })}</p>}
      <div className="convert-buttons">
        <button type="button" tabIndex={0} data-command="convert.confirm" className="primary" aria-disabled={!ok || undefined} aria-description={ok ? undefined : t('convert.needTitle')}
          title={ok ? undefined : t('convert.needTitle')} onClick={convert}>{t('convert.convert')}</button>
        <button type="button" tabIndex={0} data-command="convert.cancel" onClick={onCancel}>{t('convert.cancel')}</button>
      </div>
    </div>
  );
}

/** FR-CNV-08 (D-496): `Remove the embed?` for one or several converted objects' embeds. */
export function RemoveEmbedDialog({ items, onAnswer }: {
  items: { title: string; plural: string }[];
  onAnswer: (remove: boolean, dontAsk: boolean) => void;
}) {
  const [dontAsk, setDontAsk] = useState(false);
  const remove = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { remove.current?.focus(); }, []);
  const one = items.length === 1;
  return (
    <div className="modal-backdrop">
      <div role="alertdialog" aria-modal="true" aria-label={one ? t('convert.removeEmbed.title') : t('convert.removeEmbed.many', { count: items.length })}
        aria-describedby="remove-embed-text" className="dialog remove-embed"
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); onAnswer(false, false); } }}>
        <h2>{one ? t('convert.removeEmbed.title') : t('convert.removeEmbed.many', { count: items.length })}</h2>
        {one && <p id="remove-embed-text">{t('convert.removeEmbed.text', { title: items[0].title, plural: items[0].plural })}</p>}
        <label className="remove-embed-check">
          <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
          <span>{t('convert.removeEmbed.dontAsk')}</span>
        </label>
        <div className="dialog-buttons">
          <button ref={remove} type="button" tabIndex={0} className="primary" data-command="convert.removeEmbed" onClick={() => onAnswer(true, dontAsk)}>{t('convert.removeEmbed.remove')}</button>
          <button type="button" tabIndex={0} data-command="convert.keepEmbed" onClick={() => onAnswer(false, false)}>{t('convert.cancel')}</button>
        </div>
      </div>
    </div>
  );
}
