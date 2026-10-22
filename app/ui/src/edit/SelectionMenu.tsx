// D-605 (AP-527; FR-EDT-05 AC-7): the menu a right-click on a text selection opens in an editor: Cut, Copy, Paste,
// then the formatting toolbar's actions with their disabled states. The system menu stays everywhere else.
import { useState } from 'react';
import { t } from '../i18n/catalog';
import { PopupMenu, type MenuEntry } from '../shell/Menu';

export type SelectionAction = 'cut' | 'copy' | 'paste' | 'bold' | 'italic' | 'strike' | 'code' | 'highlight' | 'link' | 'turnIntoObject';

const MARKS: [SelectionAction, string][] = [['bold', 'toolbar.bold'], ['italic', 'toolbar.italic'], ['strike', 'toolbar.strike'], ['code', 'menu.code'], ['highlight', 'toolbar.highlight']];

export function SelectionMenu({ x, y, disabled, onAction, onClose }: {
  x: number;
  y: number;
  /** Why an action can't run here (e.g. `Turn into object` in a nested editor), or nothing. */
  disabled: Partial<Record<SelectionAction, string>>;
  onAction: (a: SelectionAction) => void;
  onClose: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const item = (a: SelectionAction, label: string): MenuEntry => ({
    kind: 'item', key: a, content: t(label), label: t(label), disabled: !!disabled[a], description: disabled[a],
    onChoose: () => { onClose(); onAction(a); },
  });
  const entries: MenuEntry[] = [
    item('cut', 'menu.cut'), item('copy', 'menu.copy'), item('paste', 'menu.paste'),
    { kind: 'separator' },
    ...MARKS.map(([a, l]) => item(a, l)),
    item('link', 'menu.link'),
    item('turnIntoObject', 'ctl.turnIntoObject'),
  ];
  const above = y + 340 > window.innerHeight;
  return (
    <>
      <span ref={setAnchor} aria-hidden="true" style={{ position: 'fixed', left: x, top: y, width: 0, height: 0 }} />
      {anchor && <PopupMenu label={t('menu.selection')} anchor={anchor} entries={entries} onClose={onClose} placement={above ? 'above' : 'below'} />}
    </>
  );
}
