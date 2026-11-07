// Slice PIN (docs/contracts/v1-pinned.md §3.1, §3.2; R132, R133; boards SidebarPinned A–G): the Pinned section of the
// left sidebar, between the Inbox / Today / Tasks group and Types. Rows open their targets; a hover shows the grip and the
// Unpin button; rows reorder by pointer (drag.ts) or ⌥⌘↑ / ⌥⌘↓ (registered commands, D-1386); things dragged in pin at
// the line. Collapsed is stored per vault in ui-state.json (D-1383). Rows carry data only; labels, icons and colours come
// from the type entries and the tag store (contract §8 11).
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n/catalog';
import { Icon, typeIconName } from '../shell/Icon';
import { PopupMenu } from '../shell/Menu';
import type { Route } from '../shell/routes';
import type { TypeEntry } from '../shell/types';
import { colourOf, useTags } from '../tags/store';
import { tagKey } from '../tags/keys';
import type { PinRowDto, PinsDto } from '../ipc/pins';
import { editReason, moveTarget, rowView, type PinTagLook, type RowView } from './model';
import { move, setPinsAlert, unpin, usePins } from './store';
import { startRowDrag, useDrag, type DragItem } from './drag';

const sameRoute = (a: Route | null, b: Route) => !!a && a.id === b.id && (a.param ?? '').normalize('NFC') === (b.param ?? '').normalize('NFC');

/** The glyph drawn for a row (the view's icon name is what `data-icon` carries). */
function glyph(row: PinRowDto, v: RowView): string {
  if (row.target.kind === 'tag') return 'hash';
  if (row.state === 'missing' || row.state === 'pending') return v.icon;
  if (row.target.kind === 'type') return typeIconName(row.target.key, v.icon);
  return typeIconName(row.type ?? 'page', v.icon);
}

export function useTagLookColour(): PinTagLook {
  const tags = useTags();
  return (key: string) => {
    const k = tagKey(key);
    const r = tags.find((x) => x.key === k);
    return { name: r?.name ?? k, color: r?.color ?? colourOf(k) };
  };
}

export function PinnedSection({ route, types, onGo, collapsed, onCollapse }: {
  route: Route; types: TypeEntry[]; onGo: (r: Route) => void; collapsed: boolean; onCollapse: (c: boolean) => void;
}) {
  const { pins, alert, live } = usePins();
  const tagLook = useTagLookColour();
  const drag = useDrag();
  // The pins version a menu was opened on: its Unpin and moves send it as the base (no other row by a stale index).
  const [menu, setMenu] = useState<{ index: number; anchor: HTMLElement; base: PinsDto['version'] } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<{ index: number | 'header'; base: unknown } | null>(null);
  const rows = pins?.rows ?? [];
  const n = rows.length;
  const views = rows.map((r) => rowView(r, types, tagLook));
  const locked = editReason(pins);

  // Focus after a move (⌥⌘↑/↓, Move up/down) or an unpin (the next row, else the previous, else the header; AC-8).
  useLayoutEffect(() => {
    const f = focusAfter.current;
    // Only once the pins the action changed have arrived.
    if (!f || f.base === pins) return;
    focusAfter.current = null;
    const s = sectionRef.current;
    if (!s) return;
    const el = f.index === 'header' ? s.querySelector<HTMLElement>('[data-command="sidebar.pinned.toggle"]') : s.querySelector<HTMLElement>(`[data-pinned-row="${f.index}"]`);
    el?.focus();
  });

  const doUnpin = (i: number, at?: { base: PinsDto['version'] }) => {
    const label = views[i]?.label;
    focusAfter.current = { index: n - 1 > 0 ? Math.min(i, n - 2) : 'header', base: pins };
    void unpin(i, label, at);
  };
  const doMove = (i: number, dir: -1 | 1, at?: { base: PinsDto['version'] }) => {
    const j = moveTarget(i, dir, n);
    if (j === null) return;
    focusAfter.current = { index: j, base: pins };
    void move(i, j, at);
  };
  const open = (i: number) => {
    const v = views[i];
    if (!v) return;
    if (v.opens === 'alert') setPinsAlert({ text: t('pinned.missingAlert', { label: v.label }), unpin: i, base: pins?.version ?? null });
    else if ((v.opens === 'route' || v.opens === 'trash') && v.route) onGo(v.route);
  };

  // R135's drop line: where a drop would land, drawn between rows.
  const [lineTop, setLineTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!drag?.over || drag.at === null || !sectionRef.current) { setLineTop(null); return; }
    const s = sectionRef.current.getBoundingClientRect();
    const lis = [...sectionRef.current.querySelectorAll('[data-pin-li]')].map((li) => li.getBoundingClientRect());
    if (lis.length === 0) { setLineTop(null); return; }
    const gap = drag.from !== null && drag.at >= drag.from ? drag.at + 1 : drag.at;
    setLineTop((gap < lis.length ? lis[gap].top : lis[lis.length - 1].bottom) - s.top);
  }, [drag?.over, drag?.at, drag?.from, n]);

  useEffect(() => { if (menu && !rows[menu.index]) setMenu(null); }, [rows.length]);

  const over = !!drag?.over;
  const listed = !collapsed && n > 0;
  const empty = !collapsed && n === 0 && pins?.state !== 'unreadable';
  const fileNotice = pins?.state === 'unreadable'
    ? (pins.error?.line ? t('pinned.unreadableLine', { line: pins.error.line }) : t('pinned.unreadable')) : null;
  const itemOf = (i: number): DragItem => ({ request: { kind: 'tag', key: '' }, label: views[i].label, icon: glyph(rows[i], views[i]), color: views[i].color });

  return (
    <div className="sidebar-pinned" ref={sectionRef} data-pinned-drop="" {...(over ? { 'data-drop-over': '' } : {})}>
      <button tabIndex={0} type="button" className="section-head pinned-head" aria-label={t('pinned.section')} aria-expanded={!collapsed}
        aria-controls="pinned-list" {...(n > 0 ? { 'aria-description': t('pinned.countA11y', { count: n }) } : {})} data-command="sidebar.pinned.toggle"
        onClick={() => onCollapse(!collapsed)}>
        <span className="pinned-title">{t('pinned.section')}</span>
        <span className={`pinned-chevron ${collapsed ? 'closed' : ''}`} aria-hidden="true"><Icon name="chevron-down" size={12} /></span>
        {n > 0 && <span className="pinned-count">{n}</span>}
      </button>
      {fileNotice && !collapsed && <p className="pinned-notice">{fileNotice}</p>}
      {listed && (
        <ul className="pinned-list" id="pinned-list" ref={listRef} aria-label={t('pinned.section')}>
          {rows.map((r, i) => {
            const v = views[i];
            if (drag?.kind === 'row' && drag.from === i) return <li key={`p${i}`} className="pinned-placeholder" data-pin-li="" data-pin-placeholder="" aria-hidden="true" />;
            const current = v.route && v.opens === 'route' ? sameRoute(route, v.route) : false;
            const desc = v.description;
            return (
              <li key={`${i}:${v.label}`} className="pinned-li" data-pin-li="">
                <span className="pin-grip" aria-hidden="true" title={t('pinned.grip')}>⋮⋮</span>
                <a href="#" tabIndex={0} className={`entry pinned-row ${current ? 'current' : ''} ${v.muted ? 'muted' : ''}`} data-pinned-row={i} data-pin-state={r.state}
                  data-command="sidebar.pinned.open" aria-current={current ? 'page' : undefined} title={v.tooltip} aria-description={desc || undefined}
                  draggable={false}
                  onDragStart={(e) => e.preventDefault()}
                  onMouseDown={(e) => { if (!locked) startRowDrag(e, i, itemOf(i)); }}
                  onClick={(e) => { e.preventDefault(); open(i); }}
                  onContextMenu={(e) => { e.preventDefault(); setMenu({ index: i, anchor: e.currentTarget, base: pins?.version ?? null }); }}
                  onKeyDown={(e) => { if (e.key === 'F10' && e.shiftKey) { e.preventDefault(); setMenu({ index: i, anchor: e.currentTarget, base: pins?.version ?? null }); } }}>
                  <span className="type-icon" style={{ ['--type' as string]: v.muted ? 'var(--muted)' : v.color ? `var(--type-${v.color})` : r.target.kind === 'tag' ? 'var(--tag-default, var(--muted))' : 'var(--muted)' }}>
                    <Icon name={glyph(r, v)} dataIcon={v.icon} />
                  </span>
                  <span className="entry-label" data-label="" data-user-content>{v.label}</span>
                  {desc && <span className="sr-only">{desc}</span>}
                </a>
                <button type="button" tabIndex={0} className="icon-button small pin-unpin" aria-label={t('pinned.unpinNamed', { label: v.label })} title={t('pinned.unpin')}
                  data-command="sidebar.unpin" aria-disabled={locked ? true : undefined} onClick={() => { if (!locked) doUnpin(i); }}>
                  <Icon name="x" size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {empty && (
        <div className="pinned-empty">
          {(() => {
            // The path part in --text, weight 600: the sentence is split around the translated path (pseudo-locale safe).
            const path = t('pinned.emptyPath');
            const full = t('pinned.empty', { path });
            const at = full.indexOf(path);
            return at < 0 ? full : <>{full.slice(0, at)}<span className="pinned-empty-path">{path}</span>{full.slice(at + path.length)}</>;
          })()}
        </div>
      )}
      {lineTop !== null && <div className="pin-drop-line" data-pin-drop-line={drag?.at ?? 0} aria-hidden="true" style={{ top: lineTop }} />}
      {alert && !collapsed && (
        <div role="alert" className="pinned-alert">
          <span>{alert.text}</span>
          {alert.unpin !== null && rows[alert.unpin] && (
            <button type="button" className="text-button" onClick={() => { const i = alert.unpin!; const base = alert.base ?? null; setPinsAlert(null); doUnpin(i, { base }); }}>{t('pinned.unpin')}</button>
          )}
        </div>
      )}
      <div className="sr-live" role="status" aria-live="polite">{live ? <Fragment key={live.seq}>{live.text}</Fragment> : null}</div>
      {menu && rows[menu.index] && (
        <PopupMenu label={t('pinned.menu')} anchor={menu.anchor} onClose={() => { const a = menu.anchor; setMenu(null); a.focus(); }} disabledFocusable entries={[
          { kind: 'item', key: 'open', content: <span className="menu-title">{t('pinned.open')}</span>, onChoose: () => { const i = menu.index; setMenu(null); open(i); } },
          { kind: 'item', key: 'unpin', content: <span className="menu-title">{t('cmd.unpin')}</span>, disabled: !!locked, description: locked ? t(locked) : undefined,
            onChoose: () => { const i = menu.index; const base = menu.base; setMenu(null); doUnpin(i, { base }); } },
          { kind: 'separator' },
          { kind: 'item', key: 'up', content: <span className="menu-title">{t('pinned.moveUp')}</span>, disabled: menu.index === 0 || !!locked,
            onChoose: () => { const i = menu.index; const base = menu.base; setMenu(null); doMove(i, -1, { base }); } },
          { kind: 'item', key: 'down', content: <span className="menu-title">{t('pinned.moveDown')}</span>, disabled: menu.index === n - 1 || !!locked,
            onChoose: () => { const i = menu.index; const base = menu.base; setMenu(null); doMove(i, 1, { base }); } },
        ]} />
      )}
      <DragLayer />
    </div>
  );
}

const rowOf = (el: Element | null): number | null => {
  const link = el?.closest('.sidebar-pinned li.pinned-li')?.querySelector('[data-pinned-row]');
  return link ? Number(link.getAttribute('data-pinned-row')) : null;
};
// The row the palette was opened from: the palette takes the focus, and ⌥⌘↑/↓ stay listed there (R136, §3.4).
let opener: number | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (e) => {
    const el = e.target as Element | null;
    if (el?.closest('[role="dialog"]')) return;
    opener = rowOf(el);
  }, true);
}

/** The focused pinned row's index (its link or Unpin button, or the palette's opener), or null (R136). */
export function focusedPinnedRow(): number | null {
  const a = document.activeElement as HTMLElement | null;
  const own = rowOf(a);
  if (own !== null) return own;
  return a?.closest('[role="dialog"]') ? opener : null;
}

/** ⌥⌘↑ / ⌥⌘↓ on the focused row (registered commands, D-1386). */
export function moveFocusedPinned(dir: -1 | 1) {
  const i = focusedPinnedRow();
  if (i === null) return;
  const n = document.querySelectorAll('.sidebar-pinned [data-pin-li]').length;
  const j = moveTarget(i, dir, n);
  if (j === null) return;
  void move(i, j).then((ok) => {
    if (ok) requestAnimationFrame(() => document.querySelector<HTMLElement>(`.sidebar-pinned [data-pinned-row="${j}"]`)?.focus());
  });
}

/** R135: the lifted row or the drag-in chip, following the pointer (portal, aria-hidden). */
function DragLayer() {
  const d = useDrag();
  if (!d) return null;
  const style = { left: d.x + 8, top: d.y - 12 };
  const body = d.kind === 'row'
    ? (
      <div className="pin-lifted entry" data-pin-lifted="" aria-hidden="true" style={style}>
        <span className="type-icon" style={{ ['--type' as string]: d.item.color ? `var(--type-${d.item.color})` : 'var(--muted)' }}><Icon name={d.item.icon} /></span>
        <span className="entry-label">{d.item.label}</span>
      </div>
    ) : (
      <div className="pin-drag-chip" data-pin-drag-chip="" aria-hidden="true" style={style}>
        <span className="type-icon" style={{ ['--type' as string]: d.item.color ? `var(--type-${d.item.color})` : 'var(--muted)' }}><Icon name={d.item.icon} size={13} /></span>
        <span className="pin-drag-label">{d.item.label}</span>
        <span className="pin-badge">{t('pinned.badge')}</span>
      </div>
    );
  return body ? createPortal(body, document.body) : null;
}
