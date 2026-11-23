// Slice Q3: the Group button and the `Group by` menu (docs/contracts/v1-views.md §40.1 `GroupMenu.tsx`, §41.2, §41.7,
// §42.1; R223; boards D3, G; D-2173, D-2180, D-2192, D-2194 (c)). The button reads the effective grouping's name (else
// `Group`); the menu holds the scope line, `None`, the groupable attributes, the `Lanes` part on a grouped wall and, on a
// usage with own keys, `Use the query's grouping` / `display`. Choosing writes once (the caller) and closes; the checked
// item writes nothing; Esc writes nothing and gives the focus back to `Group`. Placed inside the window (§20).
import { forwardRef, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n/catalog';
import type { LanesDto } from '../ipc/queries';
import type { TypeDto } from '../ipc/types';
import { Icon } from '../shell/Icon';
import { usePopupPlacement } from '../shell/usePopupPlacement';
import { groupName, type Display, type GroupChoice, type Grouping } from '../views/display';
import { DisplaySwitch } from './DisplaySwitch';

const nfc = (s: string) => s.normalize('NFC');

export type GroupScope = 'tab' | 'block' | 'default' | 'thisMac';

export const GroupButton = forwardRef<HTMLButtonElement, {
  grouping: Grouping; type: TypeDto | null | undefined; open: boolean; disabled: string | null; onClick: () => void;
}>(function GroupButton({ grouping, type, open, disabled, onClick }, ref) {
  const name = grouping ? groupName(grouping, type) : null;
  const userNamed = !!grouping && !grouping.period && !!type?.attributes.some((a) => nfc(a.key) === nfc(grouping.key));
  return (
    <button ref={ref} type="button" tabIndex={0} className="text-button group-button" aria-label={t('group.button')} aria-haspopup="menu" aria-expanded={open}
      data-command="group.open" aria-disabled={disabled ? 'true' : undefined}
      aria-description={disabled ?? (name ? t('group.buttonBy', { grouping: name }) : undefined)}
      onClick={() => { if (!disabled) onClick(); }}>
      <Icon name="board" size={13} />
      <span className="group-text" data-user-content={userNamed ? '' : undefined}>{name ?? t('group.button')}</span>
    </button>
  );
});

export function GroupMenu({ anchor, scope, choices, checked, type, lanes, offerUseQuery, onChoose, onLanes, onUseQuery, onClose }: {
  anchor: HTMLElement | null;
  scope: GroupScope;
  choices: GroupChoice[];
  /** The checked choice's id (`none` when not grouped or broken). */
  checked: string;
  type: TypeDto | null | undefined;
  /** The effective lanes on a grouped wall (the `Lanes` part), else null (not drawn). */
  lanes: LanesDto | null;
  offerUseQuery: { grouping: boolean; display: boolean };
  onChoose: (c: GroupChoice) => void;
  onLanes: (l: LanesDto) => void;
  onUseQuery: (what: 'grouping' | 'display') => void;
  /** `focusBack`: Esc or a choice (the focus goes back to `Group`). */
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const style = usePopupPlacement(ref, anchor, 'menu');
  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]') ?? [])];
  useEffect(() => {
    const list = items();
    (list.find((e) => e.getAttribute('aria-checked') === 'true' && e.hasAttribute('data-group-choice')) ?? list[0])?.focus();
    const outside = (e: MouseEvent) => { const tg = e.target as Node; if (ref.current?.contains(tg) || anchor?.contains(tg)) return; onClose(); };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { onClose(); anchor?.focus(); };
  const act = (f: () => void) => { close(); f(); };
  const userNamed = (c: GroupChoice) => !c.period && c.key !== null && !!type?.attributes.some((a) => nfc(a.key) === nfc(c.key!));
  const item = (key: string, role: 'menuitemradio' | 'menuitem', label: string, run: () => void, attrs: Record<string, string | undefined>, on?: boolean) => (
    <div key={key} role={role} tabIndex={-1} className={`menu-item${on ? ' checked' : ''}`} aria-checked={role === 'menuitemradio' ? !!on : undefined} {...attrs}
      onClick={run} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); } }}>
      <span className="menu-check" aria-hidden="true">{on ? <Icon name="check" size={13} /> : null}</span>
      <span className="menu-title">{label}</span>
    </div>
  );
  return createPortal(
    <div ref={ref} role="menu" aria-label={t('group.menu')} className="popup-menu group-menu" style={style} data-popup="group"
      onKeyDown={(e) => {
        const list = items();
        const i = list.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (list.length) list[e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length]!.focus();
        } else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); list[e.key === 'Home' ? 0 : list.length - 1]?.focus(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        else if (e.key === 'Tab') e.preventDefault();
      }}>
      <div className="menu-scope" role="presentation" data-scope={scope}>{t(`group.scope.${scope}`)}</div>
      {choices.map((c) => item(c.id, 'menuitemradio', c.id === 'none' ? t('group.none') : groupName(c, type),
        () => act(() => { if (checked !== c.id) onChoose(c); }),
        { 'data-group-choice': nfc(c.id), 'data-user-content': userNamed(c) ? '' : undefined }, checked === c.id))}
      {lanes && <div role="separator" className="menu-sep" />}
      {lanes && (
        <div role="group" aria-label={t('group.lanes')}>
          <div className="menu-group-head" aria-hidden="true">{t('group.lanes')}</div>
          {(['columns', 'rows'] as const).map((l) => item(`lanes:${l}`, 'menuitemradio', t(`group.${l}`), () => act(() => { if (lanes !== l) onLanes(l); }),
            { 'data-lanes-choice': l }, lanes === l))}
        </div>
      )}
      {(offerUseQuery.grouping || offerUseQuery.display) && <div role="separator" className="menu-sep" />}
      {offerUseQuery.grouping && item('useGrouping', 'menuitem', t('group.useQuery'), () => act(() => onUseQuery('grouping')), { 'data-command': 'group.useQuery' })}
      {offerUseQuery.display && item('useDisplay', 'menuitem', t('display.useQuery'), () => act(() => onUseQuery('display')), { 'data-command': 'display.useQuery' })}
    </div>,
    document.body,
  );
}

/** What the palette drives on a surface's controls (`group.open`). */
export type DisplayControlsApi = { openGroup: () => void };

/** The display switch, the Group button and its menu of one surface (a tab's toolbar, a block's header, the query page,
 *  `All <plural>`), with the values that surface shows and the writes it routes (§33.2). */
export function DisplayControls({ display, grouping, groupedWall, lanes, choices, type, scope, disabled, offerUseQuery, apiRef, onDisplay, onGroup, onLanes, onUseQuery }: {
  display: Display;
  grouping: Grouping;
  /** The `Lanes` part is drawn (a grouped wall). */
  groupedWall: boolean;
  lanes: LanesDto;
  choices: GroupChoice[];
  type: TypeDto | null | undefined;
  scope: GroupScope;
  disabled: string | null;
  offerUseQuery: { grouping: boolean; display: boolean };
  apiRef?: MutableRefObject<DisplayControlsApi | null>;
  onDisplay: (d: Display) => void;
  onGroup: (c: GroupChoice) => void;
  onLanes: (l: LanesDto) => void;
  onUseQuery: (what: 'grouping' | 'display') => void;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  if (apiRef) apiRef.current = { openGroup: () => { if (!disabled) setOpen(true); } };
  const checked = !grouping ? 'none' : grouping.period ? `period:${nfc(grouping.key)}` : nfc(grouping.key);
  return (
    <>
      <DisplaySwitch value={display} disabled={disabled} onChoose={(d) => { if (d !== display) onDisplay(d); }} />
      <GroupButton ref={btn} grouping={grouping} type={type} open={open} disabled={disabled} onClick={() => setOpen((o) => !o)} />
      {open && (
        <GroupMenu anchor={btn.current} scope={scope} choices={choices} checked={checked} type={type} lanes={groupedWall ? lanes : null}
          offerUseQuery={offerUseQuery} onChoose={onGroup} onLanes={onLanes} onUseQuery={onUseQuery} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
