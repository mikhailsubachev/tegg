// The tag dialogs and the colour popover (docs/acceptance/tags.md R84; ms4-tags §3, §4.4): New tag (D-642), Rename
// (D-645, D-660), Delete (D-644, D-678) and the swatches (D-653, D-654, D-669). Writes: one create-exclusive Tag file,
// one colour write with the row's version as base, or a job the dialog's button confirms.
import { useEffect, useRef, useState } from 'react';
import { setTagColor, tagFile, tagName, type TagNameResult } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { errorKind, ipc } from '../ipc/client';
import type { TagRowDto, TagUsageDto } from '../ipc/types';
import { localIso, ulid } from '../newNote';
import { Dialog } from '../pages/TypeSettingsPage';
import { runConfirmed } from '../jobs/jobs';
import { moveToTrash } from '../trash/moveToTrash';
import { showAlert } from '../trash/toast';
import { TAG_COLORS, tagChipStyle } from './chip';
import { refreshTags, tagRows } from './store';

function nameError(r: TagNameResult): string | null {
  if (r.ok) return null;
  if (r.error === 'empty') return t('tag.err.empty');
  if (r.error === 'space') return t('tag.err.space');
  if (r.error === 'digits') return t('tag.err.digits');
  return t('tag.err.chars', { char: r.char ?? '' });
}

/** D-642: a name whose key exists opens that tag; otherwise one create-exclusive Tag file (R86). */
export function NewTagDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (key: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const create = async () => {
    if (busy || !value.trim()) return;
    const r = tagName(value);
    const msg = nameError(r);
    if (msg || !r.ok) { setError(msg); return; }
    if (tagRows().some((x) => x.key === r.key) || (await refreshTags()).some((x) => x.key === r.key)) { onClose(); onOpen(r.key); return; }
    setBusy(true);
    try {
      for (let i = 0; i < 3; i++) {
        const { path } = await ipc.tagNewPath(r.name);
        try {
          await ipc.noteCreateExact(path, tagFile({ id: ulid(Date.now()), title: r.name, now: localIso(new Date(Date.now())) }));
          break;
        } catch (e) {
          if (errorKind(e) !== 'NameTaken') throw e;
          if ((await refreshTags()).some((x) => x.key === r.key)) { setError(t('tag.existsNow', { name: r.name })); break; }
        }
      }
      await refreshTags();
      onClose();
      onOpen(r.key);
    } catch {
      setError(t('error.io'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog label={t('tag.newDialog')} onCancel={onClose} className="tag-dialog">
      <h2>{t('tag.newDialog')}</h2>
      <label className="field">
        <span>{t('tag.name')}</span>
        <input data-command="tagDialog.c10" ref={input} type="text" aria-label={t('tag.name')} aria-description={t('tag.nameHint')} value={value} spellCheck={false} autoComplete="off"
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void create(); } }} />
      </label>
      <p className="hint">{t('tag.nameHint')}</p>
      {error && <p role="alert" className="warning-text">{error}</p>}
      <div className="dialog-buttons">
        <button data-command="tagDialog.c9" tabIndex={0} type="button" className="text-button" onClick={onClose}>{t('ts.cancel')}</button>
        <button data-command="tagDialog.c8" tabIndex={0} type="button" className="text-button primary" aria-disabled={value.trim() ? undefined : 'true'} onClick={() => void create()}>{t('tag.create')}</button>
      </div>
    </Dialog>
  );
}

/** D-645: refused onto another existing key; the rename is a `tag-rename` job the button confirms. */
export function RenameTagDialog({ row, usage, onClose, onRenamed }: { row: TagRowDto; usage: TagUsageDto | null; onClose: () => void; onRenamed: (key: string) => void }) {
  const [value, setValue] = useState(row.name);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const notes = usage?.notes ?? row.count;
  const line = usage && usage.templates > 0 ? t('tag.renameTemplates', { count: notes, templates: usage.templates }) : t('tag.renameLine', { count: notes });
  const rename = async () => {
    const r = tagName(value);
    const msg = nameError(r);
    if (msg || !r.ok) { setError(msg); return; }
    if (r.key !== row.key && tagRows().some((x) => x.key === r.key)) { setError(t('tag.err.exists', { name: r.name })); return; }
    try {
      const from = row.name;
      const id = await runConfirmed(() => ipc.tagRename(row.key, r.name), {
        count: notes,
        running: (count) => t('job.tag.running', { tag: from, count }),
        done: () => t('job.tag.renamed', { from, to: r.name, count: notes }),
        finished: (rep) => { if (rep?.phase === 'done') { void refreshTags().then(() => onRenamed(r.key)); } },
        started: () => onClose(),
      });
      if (id === null) onClose();
    } catch (e) {
      const x = e as { kind?: string; name?: string; char?: string; error?: string };
      if (x.kind === 'TagExists') setError(t('tag.err.exists', { name: r.name }));
      else if (x.kind === 'InvalidName') setError(nameError({ ok: false, error: (x.error ?? 'char') as 'char', char: x.char }));
      else setError(t('error.io'));
    }
  };
  return (
    <Dialog label={t('tag.renameDialog', { tag: row.name })} onCancel={onClose} className="tag-dialog">
      <h2>{t('tag.renameDialog', { tag: row.name })}</h2>
      <label className="field">
        <span>{t('tag.newName')}</span>
        <input data-command="tagDialog.c7" ref={input} type="text" aria-label={t('tag.newName')} value={value} spellCheck={false} autoComplete="off"
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void rename(); } }} />
      </label>
      <p className="hint">{line}</p>
      {usage && usage.losers.length > 0 && <p className="hint">{t('tag.duplicateWarning', { tag: row.name, path: usage.losers[0] })}</p>}
      {error && <p role="alert" className="warning-text">{error}</p>}
      <div className="dialog-buttons">
        <button data-command="tagDialog.c6" tabIndex={0} type="button" className="text-button" onClick={onClose}>{t('ts.cancel')}</button>
        <button data-command="tagDialog.c5" tabIndex={0} type="button" className="text-button primary" onClick={() => void rename()}>{t('tag.renameOk')}</button>
      </div>
    </Dialog>
  );
}

/** D-644: `Remove from <n> objects` (a `tag-delete` job) or, with a Tag file, `Delete only the tag` (one trash move). */
export function DeleteTagDialog({ row, onClose, onRemoved }: { row: TagRowDto; onClose: () => void; onRemoved: () => void }) {
  const cancel = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { cancel.current?.focus(); }, []);
  const n = row.count;
  const remove = async () => {
    onClose();
    const name = row.name;
    await runConfirmed(() => ipc.tagDelete(row.key), {
      count: n,
      running: (count) => t('job.tag.running', { tag: name, count }),
      done: () => t('job.tag.removed', { tag: name, count: n }),
      finished: (rep) => { if (rep?.phase === 'done') { void refreshTags(); onRemoved(); } },
    }).catch(() => showAlert(t('error.io')));
  };
  const only = async () => {
    onClose();
    if (!row.file) return;
    await moveToTrash([{ path: row.file.path, base: row.file.version, title: row.name }], { onUndone: () => void refreshTags() });
    void refreshTags();
  };
  return (
    <Dialog role="alertdialog" label={t('tag.deleteTitle', { tag: row.name })} onCancel={onClose} className="tag-dialog">
      <h2>{t('tag.deleteTitle', { tag: row.name })}</h2>
      <p>{t('tag.deleteUsed', { tag: row.name, count: n })}</p>
      <div className="dialog-buttons stacked">
        <button data-command="tagDialog.c4" tabIndex={0} type="button" className="text-button danger" aria-description={t('tag.removeDesc')} onClick={() => void remove()}>{t('tag.removeFrom', { count: n })}</button>
        {row.file && <button data-command="tagDialog.c3" tabIndex={0} type="button" className="text-button" aria-description={t('tag.deleteOnlyDesc')} onClick={() => void only()}>{t('tag.deleteOnly')}</button>}
        <button data-command="tagDialog.c2" ref={cancel} tabIndex={0} type="button" className="text-button" onClick={onClose}>{t('ts.cancel')}</button>
      </div>
    </Dialog>
  );
}

const LABEL: Record<string, string> = { none: 'tag.colour.none', gray: 'color.gray', blue: 'color.blue', green: 'color.green', orange: 'color.orange', purple: 'color.purple', red: 'color.red', teal: 'color.teal', yellow: 'color.yellow' };

/** D-654: `None` + the eight colours as a radiogroup; arrows move, ⏎ / Space choose and close, Esc closes. One write. */
export function ColourPopover({ row, anchor, onClose }: { row: TagRowDto; anchor: HTMLElement | null; onClose: () => void }) {
  const [current, setCurrent] = useState<string | null>(row.color);
  const [raw, setRaw] = useState<string | null>(row.colorRaw);
  const ref = useRef<HTMLDivElement | null>(null);
  const options = ['none', ...TAG_COLORS];
  const unknown = raw !== null && !current;
  const checked = unknown ? null : current ?? 'none';
  const [focus, setFocus] = useState(Math.max(0, options.indexOf(checked ?? 'none')));
  useEffect(() => { ref.current?.querySelectorAll<HTMLElement>('[role="radio"]')[focus]?.focus(); }, [focus]);
  const pos = anchor?.getBoundingClientRect();
  const choose = async (opt: string) => {
    const color = opt === 'none' ? null : opt;
    if (!unknown && color === (current ?? null)) { onClose(); return; }
    try {
      const now = localIso(new Date(Date.now()));
      if (!row.file) {
        if (color === null) { onClose(); return; }
        const { path } = await ipc.tagNewPath(row.name);
        await ipc.noteCreateExact(path, tagFile({ id: ulid(Date.now()), title: row.name, color, now }));
      } else {
        const n = await ipc.noteRead(row.file.path);
        const same = n.version.hash === row.file.version.hash && n.version.size === row.file.version.size;
        if (!same) {
          showAlert(t('tag.changedOutside', { title: row.name }));
          const fresh = (await refreshTags()).find((x) => x.key === row.key);
          setCurrent(fresh?.color ?? null);
          setRaw(fresh?.colorRaw ?? null);
          return;
        }
        const next = setTagColor(n.text, color, now);
        if (next !== n.text) await ipc.noteWrite(row.file.path, next, n.version);
      }
      await refreshTags();
      onClose();
    } catch (e) {
      if (errorKind(e) === 'Conflict') {
        showAlert(t('tag.changedOutside', { title: row.name }));
        const fresh = (await refreshTags()).find((x) => x.key === row.key);
        setCurrent(fresh?.color ?? null);
        setRaw(fresh?.colorRaw ?? null);
      } else showAlert(t('error.io'));
    }
  };
  return (
    <div className="popover-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-label={t('tag.colour')} className="popover tag-colour-popover" style={pos ? { left: pos.left, top: pos.bottom + 6 } : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
          else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); setFocus((f) => (f + 1) % options.length); }
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); setFocus((f) => (f - 1 + options.length) % options.length); }
        }}>
        <div role="radiogroup" aria-label={t('tag.colour')} aria-description={unknown ? t('tag.unknownColour', { value: raw ?? '' }) : undefined} className="swatches">
          {options.map((o, i) => (
            <button data-command="tagDialog.c1" key={o} type="button" role="radio" aria-checked={checked === o} aria-label={t(LABEL[o])} tabIndex={i === focus ? 0 : -1}
              className="swatch" data-color={o} style={tagChipStyle(o === 'none' ? null : o)}
              onClick={() => void choose(o)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void choose(o); } }}>
              {o === 'none' ? '∅' : '#'}
            </button>
          ))}
        </div>
        {unknown && <p className="hint">{t('tag.unknownColour', { value: raw ?? '' })}</p>}
      </div>
    </div>
  );
}
