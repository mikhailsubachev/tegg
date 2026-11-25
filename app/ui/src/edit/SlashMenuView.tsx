// The slash menu (FR-EDT-03; docs/acceptance/new-object-menu.md R234…R236; contract docs/contracts/new-object-menu.md
// §4): the `Insert block` listbox with a `group` per group named by its header (shown while filtering too, D-2627),
// R234's rows, `H1`…`H3` icons, `⇧⌘O` on `Turn into object…`, each New row's type icon (D-2628), 420 px high and
// scrolling inside, the selected row always in view.
import { useLayoutEffect, useRef } from 'react';
import { t } from '../i18n/catalog';
import { Icon, typeIconName } from '../shell/Icon';
import { SHORTCUTS, showDue, type SlashDef } from '../shell/registry';
import type { MenuRow } from './slashMenu';

/** The open slash menu: `from` is the trigger's position, `trigger` the `/` or `+` typed (new-object-menu.md R235). */
export type Slash = { from: number; query: string; sel: number; trigger: '/' | '+' };

/** R94: the second line of a slash row (board Main). */
const SLASH_DESC: Record<string, string> = { mindmap: 'slash.mindmap.description', query: 'slash.query.description' };

function Due({ due }: { due: SlashDef['due'] }) {
  return due ? <span className="due">{t('due.coming', { milestone: showDue(due) })}</span> : null;
}

/** R234 (D-2628): the heading rows' icons. */
const HEADING_ICON: Record<string, string> = { heading1: 'slash.heading1.icon', heading2: 'slash.heading2.icon', heading3: 'slash.heading3.icon' };
/** R234 (D-2611, D-126): the shortcut shown at a row's end. */
const ROW_SHORTCUT: Record<string, string> = { turnIntoObject: 'edit.turnIntoObject' };
const GROUP_LABEL: Record<MenuRow['group'], string> = {
  blocks: 'slash.group.blocks', objects: 'slash.group.objects', media: 'slash.group.media', advanced: 'slash.group.advanced', newObject: 'slash.group.newObject',
};

export function SlashMenu({ slash, rows, pos, unavailable, onPick, onSel, fixed = false }: {
  slash: Slash;
  rows: MenuRow[];
  pos: { left: number; top: number };
  /** Why a row can't run here now (5A-2: conversion, D-494; a nested editor, D-2626), or null. */
  unavailable: (r: MenuRow) => string | null;
  onPick: (r: MenuRow) => void;
  onSel: (i: number) => void;
  /** Positioned in the viewport (a nested editor's menu) instead of in the editor's frame. */
  fixed?: boolean;
}) {
  const list = useRef<HTMLDivElement | null>(null);
  /** The pointer's last position: a row is hovered only when the pointer moves, not when the list scrolls under it. */
  const pointer = useRef<string | null>(null);
  // The selected row is always scrolled into view inside the listbox, never the page (AP-2126); `+` without a query
  // opens scrolled so every New object row is visible.
  useLayoutEffect(() => {
    const box = list.current;
    if (!box) return;
    if (slash.trigger === '+' && !slash.query) box.scrollTop = box.scrollHeight;
    const o = box.querySelectorAll<HTMLElement>('[role="option"]')[slash.sel];
    if (!o) return;
    const top = o.offsetTop - box.offsetTop;
    const head = o.parentElement?.firstElementChild !== o ? (o.parentElement?.querySelector<HTMLElement>('.group-header')?.offsetHeight ?? 0) : 0;
    if (top < box.scrollTop) box.scrollTop = Math.max(0, top - (o === o.parentElement?.querySelector('[role="option"]') ? head : 0));
    else if (top + o.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + o.offsetHeight - box.clientHeight;
  }, [slash.sel, slash.query, slash.trigger, rows.length]);
  const groups: { group: MenuRow['group']; rows: [MenuRow, number][] }[] = [];
  rows.forEach((r, i) => {
    const g = groups[groups.length - 1];
    if (g && g.group === r.group) g.rows.push([r, i]);
    else groups.push({ group: r.group, rows: [[r, i]] });
  });
  const desc = (r: MenuRow) => (r.def && SLASH_DESC[r.def.id] ? t(SLASH_DESC[r.def.id]) : null);
  const sel = rows[slash.sel];
  return (
    <div className="popover slash-menu" style={fixed ? { ...pos, position: 'fixed' } : pos}>
      <div ref={list} role="listbox" aria-label={t('slash.label')} className="slash-list" tabIndex={0}>
        {rows.length === 0 && <div className="empty" role="presentation">{t('slash.empty')}</div>}
        {groups.map(({ group, rows: gr }) => (
          <div key={group} role="group" aria-label={t(GROUP_LABEL[group])}>
            <div className="group-header" aria-hidden="true">{t(GROUP_LABEL[group])}</div>
            {gr.map(([it, i]) => {
              const why = unavailable(it);
              const disabled = it.disabled || !!why;
              const d = !disabled ? desc(it) : null;
              const keys = ROW_SHORTCUT[it.id] ? SHORTCUTS.find((x) => x.command === ROW_SHORTCUT[it.id])?.keys : undefined;
              return (
                <div key={it.id} role="option" aria-selected={i === slash.sel} aria-disabled={disabled || undefined}
                  aria-description={why ?? (disabled && it.def?.due ? t('due.coming', { milestone: showDue(it.def.due) }) : d ?? undefined)}
                  data-icon={it.icon} className={`option ${i === slash.sel ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={(e) => {
                    const at = `${e.screenX},${e.screenY}`;
                    if (pointer.current === at) return;
                    const first = pointer.current === null;
                    pointer.current = at;
                    if (!first && !disabled && i !== slash.sel) onSel(i);
                  }}
                  onClick={() => !disabled && onPick(it)}>
                  {it.group === 'newObject' && it.type && (
                    <span className="slash-icon" data-icon={it.icon} aria-hidden="true"><Icon name={typeIconName(it.type, it.icon)} dataIcon={it.icon} size={16} /></span>
                  )}
                  {d ? (
                    <span className="slash-two-lines"><span>{it.label}</span><span className="slash-desc" aria-hidden="true">{d}</span></span>
                  ) : <span data-user-content={it.group === 'newObject' || undefined}>{it.label}</span>}
                  {/* After the label in the text, before it on screen: a row's text starts with its label. */}
                  {HEADING_ICON[it.id] && <span className="slash-icon slash-heading-icon" aria-hidden="true">{t(HEADING_ICON[it.id])}</span>}
                  {keys && !disabled && <kbd className="slash-kbd" aria-hidden="true">{t('shortcut.keys', { keys })}</kbd>}
                  {/* The option's name is its label; the reason and the milestone are its description. */}
                  {why ? <span className="due" aria-hidden="true">{why}</span> : disabled && <span aria-hidden="true" className="due-wrap"><Due due={it.def?.due} /></span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {/* D-1515: the selected item's description also as hidden text, for the macOS tree (D-1424's way). */}
      {sel && !sel.disabled && desc(sel) ? <span className="sr-only" data-description-text="">{desc(sel)}</span> : null}
    </div>
  );
}
