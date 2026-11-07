// Slice PIN (docs/contracts/v1-pinned.md §3.1 `PinMenu.tsx`; R134, D-1385): the one `Pin to sidebar` / `Unpin from sidebar`
// entry every pinnable surface uses (only one of the two, by whether the target is pinned), and the `Open` + entry
// context menu of the Types entries, All tags rows, Search result rows and type-page rows (right-click or ⇧F10).
import { t } from '../i18n/catalog';
import { PopupMenu, type MenuEntry } from '../shell/Menu';
import type { PinRequestDto, PinsDto } from '../ipc/pins';
import { editReason, findPin } from './model';
import { pinTarget, unpin, usePins } from './store';

/** A target and the label its announcement names; `unsaved`: `new/<type>` or a virtual daily note (D-1382). */
export type PinTargetOf = { request: PinRequestDto | 'unsaved'; label: string };

/** The menu entry for `target` against `pins`; `done` runs after choosing (closing the menu). */
export function pinMenuEntry(target: PinTargetOf, pins: PinsDto | null, done: () => void): MenuEntry {
  if (target.request === 'unsaved') {
    return { kind: 'item', key: 'pin', label: t('cmd.pin'), content: <span className="menu-title">{t('cmd.pin')}</span>, disabled: true, description: t('pinned.notSaved'), onChoose: () => {} };
  }
  const request = target.request;
  const index = findPin(pins, request);
  const lock = editReason(pins);
  const title = index === null ? t('cmd.pin') : t('cmd.unpin');
  return {
    kind: 'item', key: 'pin', label: title, content: <span className="menu-title">{title}</span>, disabled: !!lock, description: lock ? t(lock) : undefined,
    onChoose: () => {
      done();
      if (lock) return;
      if (index === null) void pinTarget(request, null, () => target.label);
      else void unpin(index, target.label);
    },
  };
}

/** `pinMenuEntry` bound to the live pins (re-renders when they change). */
export function usePinMenuEntry(): (target: PinTargetOf | null, done: () => void) => MenuEntry | null {
  const { pins } = usePins();
  return (target, done) => (target ? pinMenuEntry(target, pins, done) : null);
}

/** R134: `Open`, then `Pin to sidebar` / `Unpin from sidebar`, then `extra` after a separator. */
export function PinContextMenu({ label, anchor, target, onOpen, onClose, extra = [] }: {
  label: string; anchor: HTMLElement | null; target: PinTargetOf; onOpen: () => void; onClose: () => void; extra?: MenuEntry[];
}) {
  const { pins } = usePins();
  const entries: MenuEntry[] = [
    { kind: 'item', key: 'open', label: t('pinned.open'), content: <span className="menu-title">{t('pinned.open')}</span>, onChoose: () => { onClose(); onOpen(); } },
    pinMenuEntry(target, pins, onClose),
    ...(extra.length ? [{ kind: 'separator' } as MenuEntry, ...extra] : []),
  ];
  return <PopupMenu label={label} anchor={anchor} onClose={onClose} disabledFocusable entries={entries} />;
}
