// The note header's type chip and its `Change type` menu (FR-TYP-07 AC-4, D-224): targets are Page, Task, Quick Note
// and the user types (D-122 order) without the current type; Daily Note, Tag, Image and PDF are neither targets nor
// changeable, and files the panel can't edit have a disabled chip. Choosing writes only `type:` (and `modified`).
import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { t } from '../i18n/catalog';
import type { TypeDto } from '../ipc/types';
import { PopupMenu } from '../shell/Menu';
import { Icon, typeIconName } from '../shell/Icon';
import { typeEntries } from '../shell/types';
import { colorName, nfc } from './util';

const FIXED = new Set(['daily-note', 'tag', 'image', 'pdf']);

export type TypeChipApi = { open: () => void };

export function TypeChip({ apiRef, type, typeKey, types, readOnly, onChange }: {
  apiRef?: Ref<TypeChipApi>;
  /** The note's type definition (null: a `type` value without a definition). */
  type: TypeDto | null;
  typeKey: string;
  types: TypeDto[];
  readOnly: boolean;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  const name = type?.name ?? typeKey;
  const fixed = FIXED.has(nfc(typeKey));
  const disabledWhy = fixed ? t('panel.chipLocked', { name }) : readOnly ? t('panel.chipReadOnly') : null;
  const show = () => { if (!disabledWhy) { setOpen(true); } };
  useImperativeHandle(apiRef, () => ({ open: () => { btn.current?.focus(); show(); } }));
  const targets = typeEntries(types, {}).filter((e) => e.defined && !e.invalid && !FIXED.has(e.key) && nfc(e.key) !== nfc(typeKey));
  return (
    <>
      <button ref={btn} type="button" className="type-chip" aria-haspopup="menu" aria-expanded={open} aria-disabled={disabledWhy ? true : undefined}
        aria-label={t('panel.typeChip', { name })} aria-description={disabledWhy ?? undefined} data-command="note.changeType"
        style={{ ['--type' as string]: `var(--type-${colorName(type?.color)})` }}
        onClick={() => (open ? setOpen(false) : show())}>
        <Icon name={typeIconName(typeKey, type?.icon)} size={13} />
        <span data-user-content>{name}</span>
      </button>
      {open && (
        <PopupMenu label={t('panel.changeTypeMenu')} anchor={btn.current} onClose={() => setOpen(false)}
          entries={targets.map((e) => ({
            kind: 'item' as const, key: e.key, label: e.name,
            content: (<><Icon name={typeIconName(e.key, e.icon)} size={14} /><span className="menu-title" data-user-content>{e.name}</span></>),
            onChoose: () => { setOpen(false); btn.current?.focus(); onChange(e.key); },
          }))} />
      )}
    </>
  );
}
