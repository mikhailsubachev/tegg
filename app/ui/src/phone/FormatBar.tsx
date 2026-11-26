// Slice AND-3 (docs/contracts/android-edit.md §8; RA15, FR-UX-04 AC-8…AC-10, FR-EDT-02 AC-27, D-2504): the formatting
// bar above the keyboard while the note body has the focus. Its buttons never take the focus, so the caret, the
// selection and the keyboard stay (mousedown is prevented). State comes from `formatState`.
import { useEffect, useReducer, useState } from 'react';
import type { TeggEditor } from '@tegg/editor';
import { t } from '../i18n/catalog';
import { Icon } from '../shell/Icon';
import { formatStateOf, type FormatState } from './format';

type Choice = 'text' | 'heading1' | 'heading2' | 'heading3';
const CHOICES: Choice[] = ['text', 'heading1', 'heading2', 'heading3'];

/** When the last press on the bar started: a long press (≥ 500 ms) is the system's, never a tap (Android sends no click
 *  after one; a touch emulation may). */
let downAt = 0;
// Only `mousedown` is prevented (that is what moves the focus): an engine that sees `pointerdown` prevented sends no
// click after a touch (WebKit), and Android's WebView sends `mousedown` before its click anyway.
const keep = (e: React.SyntheticEvent) => { if (e.type === 'pointerdown') downAt = performance.now(); else e.preventDefault(); };
const longPress = () => { const held = downAt > 0 && performance.now() - downAt >= 500; downAt = 0; return held; };

/** The `Block type` choices run when the row is open; `edit.blockType` toggles it. */
export function FormatBar({ ed, onLink, onChanged }: { ed: TeggEditor; onLink: () => void; onChanged: () => void }) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const [row, setRow] = useState(false);
  useEffect(() => {
    const f = () => tick();
    ed.editor.on('transaction', f);
    return () => { ed.editor.off('transaction', f); };
  }, [ed]);
  const s: FormatState = formatStateOf(ed);
  // A touch tap can still take the focus from the body (no element gets it): give it back, the selection kept.
  const refocus = () => { if (!ed.view.hasFocus()) (ed.view.dom as HTMLElement).focus({ preventScroll: true }); };
  const act = (f: () => boolean) => { refocus(); if (f()) onChanged(); refocus(); };
  const button = (o: { name: string; icon: string; command: string; pressed?: boolean; disabled?: boolean; run: () => void }) => (
    <button key={o.command} type="button" tabIndex={-1} aria-label={o.name} data-command={o.command}
      aria-pressed={o.pressed === undefined ? undefined : o.pressed} aria-disabled={o.disabled ? 'true' : undefined}
      onPointerDown={keep} onMouseDown={keep} onClick={() => { if (longPress()) return; if (!o.disabled) o.run(); refocus(); }}>
      <Icon name={o.icon} />
    </button>
  );
  const choose = (c: Choice) => {
    act(() => (c === 'text' ? ed.commands.setBlock('paragraph') : ed.commands.setBlock('heading', Number(c.slice(-1)) as 1 | 2 | 3)));
    setRow(false);
  };
  if (row) {
    return (
      <div role="toolbar" aria-label={t('toolbar.label')} className="phone-format-bar">
        <div role="radiogroup" aria-label={t('phone.edit.blockType')} className="phone-block-type">
          {CHOICES.map((c) => {
            const checked = c === 'text' ? s?.block === 'paragraph' : s?.block === 'heading' && s.level === Number(c.slice(-1));
            return (
              <button key={c} type="button" role="radio" tabIndex={-1} aria-checked={!!checked} data-command={`edit.blockType:${c}`}
                onPointerDown={keep} onMouseDown={keep} onClick={() => { if (!longPress()) choose(c); }}>
                {t(`slash.${c}`)}
              </button>
            );
          })}
          <button type="button" tabIndex={-1} aria-label={t('phone.close')} data-command="edit.blockType:close"
            onPointerDown={keep} onMouseDown={keep} onClick={() => { setRow(false); refocus(); }}>
            <Icon name="x" />
          </button>
        </div>
      </div>
    );
  }
  const hasSel = !ed.view.state.selection.empty;
  // FR-EDT-05 AC-9 (android-edit §10.2): with the caret in a link, Link opens the link panel with `Remove link`.
  const $c = ed.view.state.selection.$from;
  const inLink = ed.editor.isActive('link') || $c.nodeBefore?.type.name === 'wikiLink' || $c.nodeAfter?.type.name === 'wikiLink';
  return (
    <div role="toolbar" aria-label={t('toolbar.label')} className="phone-format-bar">
      {button({ name: t('phone.edit.heading'), icon: 'heading', command: 'edit.blockType', pressed: s?.block === 'heading', run: () => setRow(true) })}
      {button({ name: t('toolbar.bold'), icon: 'mark-bold', command: 'edit.bold', pressed: !!s?.bold, run: () => act(() => ed.commands.toggleMark('bold')) })}
      {button({ name: t('toolbar.italic'), icon: 'mark-italic', command: 'edit.italic', pressed: !!s?.italic, run: () => act(() => ed.commands.toggleMark('italic')) })}
      {button({ name: t('toolbar.link'), icon: 'link', command: 'edit.link', run: () => { if (hasSel || inLink) onLink(); else act(() => ed.commands.insertTrigger('[[')); } })}
      {button({ name: t('phone.edit.tag'), icon: 'tag', command: 'edit.tag', run: () => act(() => ed.commands.insertTrigger('#')) })}
      {button({ name: t('slash.bulletList'), icon: 'list', command: 'edit.bulletList', pressed: s?.block === 'bulletList', run: () => act(() => ed.commands.toggleBulletList()) })}
      {button({ name: t('slash.checklist'), icon: 'checklist', command: 'edit.checklist', pressed: s?.block === 'checklist', run: () => act(() => ed.commands.toggleChecklistBlock()) })}
      {button({ name: t('phone.edit.indent'), icon: 'indent', command: 'edit.indent', disabled: !s?.canIndent, run: () => act(() => ed.commands.indent()) })}
      {button({ name: t('phone.edit.outdent'), icon: 'outdent', command: 'edit.outdent', disabled: !s?.canOutdent, run: () => act(() => ed.commands.outdent()) })}
      {button({ name: t('phone.edit.undo'), icon: 'undo', command: 'edit.undo', disabled: !s?.canUndo, run: () => act(() => ed.commands.undo()) })}
      {button({ name: t('phone.edit.redo'), icon: 'redo', command: 'edit.redo', disabled: !s?.canRedo, run: () => act(() => ed.commands.redo()) })}
    </div>
  );
}
