// The note header's type chip, the `More` menu and the `Change type` menu (FR-TYP-07 AC-4, D-224): targets are Page, Task, Quick Note
// and the user types (D-122 order) without the current type; Daily Note, Tag, Image and PDF are neither targets nor
// changeable, and files the panel can't edit have a disabled chip. Choosing writes only `type:` (and `modified`).
import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { t } from '../i18n/catalog';
import { trashRequest } from '../trash/moveToTrash';
import type { TypeDto } from '../ipc/types';
import { PopupMenu } from '../shell/Menu';
import { Icon, typeIconName } from '../shell/Icon';
import { typeEntries } from '../shell/types';
import { colorName, nfc } from './util';

const FIXED = new Set(['daily-note', 'tag', 'image', 'pdf']);

export type TypeChipApi = { open: () => void };

/** D-369: the chip is a link to `type/<key>` (FR-TYP-07 AC-11); `Change type…` lives in the `More` menu and the
 *  palette (AC-12), with AC-4's targets and disabled cases. */
export function TypeChip({ apiRef, type, typeKey, types, readOnly, onChange, onOpenType }: {
  apiRef?: Ref<TypeChipApi>;
  /** The note's type definition (null: a `type` value without a definition). */
  type: TypeDto | null;
  typeKey: string;
  types: TypeDto[];
  readOnly: boolean;
  onChange: (key: string) => void;
  onOpenType: (key: string) => void;
}) {
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState(false);
  const moreBtn = useRef<HTMLButtonElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const name = type?.name ?? typeKey;
  const fixed = FIXED.has(nfc(typeKey));
  const disabledWhy = fixed ? t('panel.chipLocked', { name }) : readOnly ? t('panel.chipReadOnly') : null;
  const show = (from: HTMLElement | null) => { if (!disabledWhy) { opener.current = from; setOpen(true); } };
  // From the palette the focus may have gone back to <body>; Esc then returns it to More (FR-TYP-07 AC-12).
  const opened = () => { const a = document.activeElement as HTMLElement | null; return a && a !== document.body ? a : moreBtn.current; };
  useImperativeHandle(apiRef, () => ({ open: () => show(opened()) }));
  const targets = typeEntries(types, {}).filter((e) => e.defined && !e.invalid && !FIXED.has(e.key) && nfc(e.key) !== nfc(typeKey));
  const back = () => { const el = opener.current; if (el?.isConnected) el.focus(); };
  return (
    <>
      <a href="#" className="type-chip" aria-label={t('panel.typeChip', { name })} data-command="note.openType"
        style={{ ['--type' as string]: `var(--type-${colorName(type?.color)})` }}
        onClick={(e) => { e.preventDefault(); onOpenType(typeKey); }}>
        <Icon name={typeIconName(typeKey, type?.icon)} size={13} />
        <span data-user-content>{name}</span>
      </a>
      <button ref={moreBtn} type="button" tabIndex={0} className="icon-button small note-more" aria-label={t('note.more')} aria-haspopup="menu" aria-expanded={more}
        data-command="note.more" onClick={() => setMore((m) => !m)}>
        <Icon name="more-horizontal" size={14} />
      </button>
      {more && (
        <PopupMenu label={t('note.more')} anchor={moreBtn.current} onClose={() => { setMore(false); moreBtn.current?.focus(); }}
          entries={[{
            kind: 'item' as const, key: 'changeType', label: t('note.more.changeType'), disabled: !!disabledWhy, description: disabledWhy ?? undefined,
            content: <span className="menu-title">{t('note.more.changeType')}</span>,
            onChoose: () => { setMore(false); show(moreBtn.current); },
          }, {
            // 6A (FR-HIS-01 AC-1, Main board's More menu): Move to trash, ⌘⌫.
            kind: 'item' as const, key: 'trash', label: t('cmd.trash'),
            content: <><span className="menu-title">{t('cmd.trash')}</span><span className="menu-kbd" aria-hidden="true">⌘⌫</span></>,
            onChoose: () => { setMore(false); trashRequest.current?.(); },
          }]} />
      )}
      {open && (
        <PopupMenu label={t('panel.changeTypeMenu')} anchor={opener.current ?? moreBtn.current} onClose={() => { setOpen(false); back(); }}
          entries={targets.map((e) => ({
            kind: 'item' as const, key: e.key, label: e.name,
            content: (<><Icon name={typeIconName(e.key, e.icon)} size={14} /><span className="menu-title" data-user-content>{e.name}</span></>),
            onChoose: () => { setOpen(false); back(); onChange(e.key); },
          }))} />
      )}
    </>
  );
}
