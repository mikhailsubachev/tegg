// The `New <type>` dialog of the slash menu (docs/acceptance/new-object-menu.md R236; D-2490, D-2511; board
// `ObjectMenu` E): an empty, focused `Title`, the hint `Creates <folder>/<stem>.md and links it here.` with the
// planned free stem (hidden while the title is empty), `Cancel` and `Create` (default, `aria-disabled` while the title
// is empty or spaces). ⏎ creates, Esc / Cancel / a click outside cancel; Tab cycles Title → Cancel → Create. Anchored
// below the trigger like R50; the caller creates the object and inserts the link.
import { useEffect, useRef, useState } from 'react';
import { sanitizeStem } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { TypeDefDto } from '../ipc/types';
import { setNewObjectDialog } from './newObjectCommands';

const dirOf = (folder: string) => (folder ? `${folder.replace(/\/+$/, '')}/` : '');
/** The planned path (FR-FMT-08): the type's folder and the sanitized title as the stem (D-51, D-52). */
const basePath = (folder: string, title: string) => `${dirOf(folder)}${sanitizeStem(title)}.md`;

/** The first free stem, ` (2)` and on, once the folder was read; the core decides at create (FR-CNV-03 AC-5's rule). */
async function freePath(folder: string, title: string): Promise<string> {
  const stem = sanitizeStem(title);
  for (let n = 1; n < 100; n++) {
    const path = `${dirOf(folder)}${n === 1 ? stem : `${stem} (${n})`}.md`;
    const found = await ipc.noteRead(path).then((x) => !!x, () => false);
    if (!found) return path;
  }
  return basePath(folder, title);
}

export function NewObjectDialog({ type, at, onCreate, onCancel, fixed = false }: {
  type: TypeDefDto;
  at: { left: number; top: number };
  /** Positioned in the viewport (a nested editor's dialog) instead of in the editor's frame. */
  fixed?: boolean;
  /** Creates the object and links it; the dialog is closed by the caller. */
  onCreate: (title: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [hint, setHint] = useState<{ title: string; path: string } | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const done = useRef(false);
  const clean = title.normalize('NFC').trim();
  const ok = clean !== '';
  const live = useRef({ ok, clean, onCreate, onCancel });
  live.current = { ok, clean, onCreate, onCancel };

  /** Once: a second ⏎ (or a click) while the first create runs does nothing (FR-EDT-03 AC-17). */
  const create = () => {
    const L = live.current;
    if (!L.ok || done.current) return;
    done.current = true;
    L.onCreate(L.clean);
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    live.current.onCancel();
  };

  useEffect(() => {
    input.current?.focus();
    const h = { create: () => create(), cancel: () => cancel() };
    setNewObjectDialog(h);
    // A click outside the dialog cancels it, as Esc (D-2511).
    const outside = (ev: PointerEvent) => { if (box.current && !box.current.contains(ev.target as Node)) cancel(); };
    document.addEventListener('pointerdown', outside, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      setNewObjectDialog(null);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!clean) { setHint(null); return; }
    let live = true;
    const h = setTimeout(() => {
      void freePath(type.folder, clean).then((path) => { if (live) setHint({ title: clean, path }); });
    }, 60);
    return () => { live = false; clearTimeout(h); };
  }, [clean, type.folder]);
  // The sanitized stem at once, the free one when the folder was read.
  const shownPath = hint && hint.title === clean ? hint.path : basePath(type.folder, clean);

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }
    const button = (e.target as HTMLElement).closest('button');
    // A button runs on its key here, so the keyboard never produces a click (FR-UX-03 AC-61: no pointer events).
    if (button && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (button.dataset.command === 'newObject.cancel') cancel(); else create(); return; }
    if (e.key === 'Enter') { e.preventDefault(); create(); return; }
    if (e.key === 'Tab') {
      // Title → Cancel → Create, inside the dialog.
      const stops = [...(box.current?.querySelectorAll<HTMLElement>('input, button') ?? [])];
      const i = stops.indexOf(document.activeElement as HTMLElement);
      if (!stops.length) return;
      e.preventDefault();
      stops[(i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
    }
  };

  return (
    <div ref={box} role="dialog" aria-label={t('newObject.dialog', { type: type.name })} className="popover new-object-dialog" style={fixed ? { ...at, position: 'fixed' } : at}
      onKeyDown={onKey} onKeyUp={(e) => { if (e.key === ' ' && (e.target as HTMLElement).closest('button')) e.preventDefault(); }}
      onMouseDown={(e) => e.stopPropagation()}>
      <label className="convert-field">
        <span>{t('newObject.title')}</span>
        <input ref={input} type="text" aria-label={t('newObject.title')} value={title} spellCheck={false} autoComplete="off" data-user-content
          onChange={(e) => setTitle(e.target.value)} />
      </label>
      {ok && <p className="new-object-hint">{t('newObject.hint', { path: shownPath })}</p>}
      <div className="convert-buttons">
        <button type="button" tabIndex={0} data-command="newObject.cancel" onClick={cancel}>{t('newObject.cancel')}</button>
        <button type="button" tabIndex={0} data-command="newObject.create" className="primary" aria-disabled={!ok || undefined}
          aria-description={ok ? undefined : t('newObject.needTitle')} title={ok ? undefined : t('newObject.needTitle')} onClick={create}>{t('newObject.create')}</button>
      </div>
    </div>
  );
}
