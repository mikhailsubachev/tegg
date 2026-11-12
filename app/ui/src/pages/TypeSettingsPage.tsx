// Type settings (R12, TypeSettings board; FR-TYP-01…06, -11, -12, AR-07; ms3-shell §14.7.3, §14.7.4). Each committed
// field sends one `type_patch` with the version of the last read (D-235); writes to the type file are serialized; a
// `Conflict` reloads the disk version and says which change wasn't saved (NFR-REL-02); newer-version and invalid
// files are read-only. Nothing here writes a note (FR-TYP-04 AC-5).
import { toggleColumn } from '../types/columns';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { checkFolder, checkTypeName, checkStatusOptions, COLORS, deriveAttrKey, ICONS, checkAttrKey, ATTR_TYPES, widerTypes, type AttrType } from '@tegg/schema';
import { t } from '../i18n/catalog';
import { confirmDelete, expectFolderMove, lastUndoable, planDelete, undoMove } from '../jobs/jobs';
import { listen } from '@tauri-apps/api/event';
import { ipc } from '../ipc/client';
import type { AttributeChangeDto, AttributeDto, AttributeInputDto, JobPlanDto, OptionDto, TypeDto, TypeOpDto, TypeUsageDto } from '../ipc/types';
import { Disabled } from '../shell/Disabled';
import { Icon, typeIconName } from '../shell/Icon';
import { PopupMenu } from '../shell/Menu';
import { CheckboxControl, OptionsPopup, SelectControl } from '../types/controls/ChoiceControls';
import { FieldError, useErrorId, type Value } from '../types/controls/common';
import { DateControl } from '../types/controls/DateControls';
import { TextControl, type TextKind } from '../types/controls/TextControl';
import { attrTypeLabel, colorName, nfc, typeErrorMessage } from '../types/util';

type Save = 'saved' | 'saving' | 'failed';
const BUILT_IN_ROWS = ['title', 'description', 'aliases', 'tags', 'source', 'review', 'created', 'modified'];
const UNIVERSAL_PREVIEW: [string, string][] = [['tags', 'attr.tags'], ['source', 'attr.source'], ['aliases', 'attr.aliases'], ['created', 'attr.created'], ['modified', 'attr.modified']];
const SECTIONS = ['general', 'properties', 'builtIn', 'preview', 'hidden', 'embeds', 'review', 'templates', 'views', 'delete'] as const;
const SECTION_LABEL: Record<(typeof SECTIONS)[number], string> = {
  general: 'ts.general', properties: 'ts.properties', builtIn: 'ts.builtIn', preview: 'preview.properties', hidden: 'ts.hidden', embeds: 'typeSettings.embeds', review: 'ts.review', templates: 'ts.templates', views: 'ts.views', delete: 'ts.delete',
};
const NO_OPTIONS = new Set(['text', 'long-text', 'number', 'checkbox', 'date', 'date-time', 'date-range', 'url', 'email', 'relation']);

/** Splits a catalog message around one user-content variable, so the variable can be marked `data-user-content`. */
function withUser(key: string, name: string, value: string, vars: Record<string, string | number> = {}) {
  const [a, b] = t(key, { ...vars, [name]: '\u0000' }).split('\u0000');
  return <>{a}<span data-user-content>{value}</span>{b}</>;
}

/** A dialog shell: `aria-modal`, Esc = Cancel, the focus returns to the opener (§14.7.3). */
export function Dialog({ label, onCancel, children, className, restore, role = 'dialog' }: {
  label: string; onCancel: () => void; children: React.ReactNode; className?: string; role?: 'dialog' | 'alertdialog';
  /** Set to false before closing when the dialog's action navigates (the new page takes the focus, D-130). */
  restore?: React.MutableRefObject<boolean>;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null);
  useEffect(() => {
    const el = ref.current;
    return () => {
      // A StrictMode re-run of this effect leaves the dialog on the page: only a real close gives the focus back.
      if (el?.isConnected) return;
      const o = opener.current;
      if (restore && !restore.current) return;
      if (o?.isConnected) o.focus();
    };
  }, []);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={ref} role={role} aria-modal="true" aria-label={label} className={`dialog ${className ?? ''}`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
          if (e.key === 'Tab') {
            const els = [...(ref.current?.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]') ?? [])].filter((x) => !(x as HTMLButtonElement).disabled);
            if (!els.length) return;
            const i = els.indexOf(document.activeElement as HTMLElement);
            e.preventDefault();
            els[(i + (e.shiftKey ? -1 : 1) + els.length) % els.length].focus();
          }
        }}>
        {children}
      </div>
    </div>
  );
}

/** A text setting committed with ⏎ or on leaving it; `check` returns a message to refuse it locally. */
function TextSetting({ label, value, disabled, desc, multiline, check, onCommit, error, inputRef, onDraft }: {
  label: string;
  value: string;
  disabled?: boolean;
  desc?: string;
  multiline?: boolean;
  check?: (v: string) => string | null;
  onCommit: (v: string) => void;
  error?: string | null;
  inputRef?: (el: HTMLInputElement | null) => void;
  /** The text while it is being typed (4E-1: the folder field's preview, R99 B1). */
  onDraft?: (v: string) => void;
}) {
  const [v, setV] = useState(value);
  const [local, setLocal] = useState<string | null>(null);
  const editing = useRef(false);
  const errId = useErrorId();
  useEffect(() => { if (!editing.current) setV(value); }, [value]);
  const shown = local ?? error ?? null;
  const commit = () => {
    if (!editing.current) return;
    editing.current = false;
    const text = v.normalize('NFC');
    if (text === value) { setLocal(null); return; }
    const msg = check?.(text) ?? null;
    if (msg) { editing.current = true; setLocal(msg); return; }
    setLocal(null);
    onCommit(text);
  };
  return (
    <label className="ts-field">
      <span className="ts-label">{label}</span>
      <input ref={inputRef} type="text" aria-label={label} aria-description={desc} aria-describedby={shown ? errId : undefined} aria-invalid={shown ? true : undefined}
        disabled={disabled} value={v} spellCheck={false} autoComplete="off" className={multiline ? 'wide' : ''}
        onChange={(e) => { editing.current = true; setV(e.target.value); onDraft?.(e.target.value.normalize('NFC')); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editing.current = false; setLocal(null); setV(value); }
        }} />
      {/* D-1515: the description also as hidden text, for the macOS tree (D-1424's way). */}
      {desc && <span className="sr-only" data-description-text="">{desc}</span>}
      <FieldError id={errId} text={shown} />
    </label>
  );
}

/** Serialized writes to one type file with the version of the last read (§14.7.4). */
function useTypeWriter(key: string, setType: (t: TypeDto) => void, latest: React.MutableRefObject<TypeDto | null>) {
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const [save, setSave] = useState<Save>('saved');
  const [conflict, setConflict] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const send = useCallback((ops: TypeOpDto[], field: string, fieldId: string = field): Promise<boolean> => {
    pending.current++;
    setSave('saving');
    const run = queue.current.then(async () => {
      const cur = latest.current;
      if (!cur) return false;
      try {
        const r = await ipc.typePatch(key, cur.exists ? cur.version : null, ops);
        latest.current = r;
        setType(r);
        setErrors((x) => ({ ...x, [fieldId]: null }));
        setConflict(null);
        return true;
      } catch (e) {
        const x = e as { kind?: string; disk?: TypeDto };
        if (x.kind === 'Conflict' && x.disk) {
          latest.current = x.disk;
          setType(x.disk);
          setConflict(field);
        } else {
          setErrors((er) => ({ ...er, [fieldId]: typeErrorMessage(e) }));
          if (latest.current) setType({ ...latest.current });
        }
        return false;
      } finally {
        pending.current--;
        if (pending.current === 0) setSave('saved');
      }
    });
    queue.current = run.catch(() => false);
    return run;
  }, [key]);
  return { send, save, setSave, conflict, setConflict, errors, setErrors, pending };
}

export function TypeSettingsPage({ typeKey, types, refresh, heading, onDeleted, onOpenTrash }: {
  typeKey: string;
  types: TypeDto[];
  refresh: number;
  heading: React.RefObject<HTMLHeadingElement | null>;
  onDeleted: () => void;
  /** R99 F2: the deleted-type route's `Open Trash`. */
  onOpenTrash?: () => void;
}) {
  const [type, setTypeState] = useState<TypeDto | null | undefined>(undefined);
  const [usage, setUsage] = useState<TypeUsageDto | null>(null);
  const latest = useRef<TypeDto | null>(null);
  const setType = useCallback((x: TypeDto) => { latest.current = x; setTypeState(x); }, []);
  const w = useTypeWriter(typeKey, setType, latest);
  const reload = useCallback(() => {
    ipc.typeGet(typeKey).then((x) => { if (w.pending.current) return; latest.current = x; setTypeState(x); }, () => setTypeState(null));
    ipc.typeUsage(typeKey).then(setUsage, () => setUsage(null));
  }, [typeKey]);
  useEffect(() => { reload(); }, [refresh]);
  // R99 F2: the deleted-type view takes the focus (its heading), so Undo and Open Trash are the next Tab stops.
  useEffect(() => { if (type === null && deletedTypes.has(nfc(typeKey))) heading.current?.focus(); }, [type]);

  // No heading until the type is read: the focus goes to the real heading after navigation (D-130).
  if (type === undefined) return <div className="page-column" />;
  if (type === null) {
    // R99 F2 (FR-TYP-05 AC-7): a type this session deleted with its objects offers Undo and Open Trash.
    const del = deletedTypes.get(nfc(typeKey));
    const undoId = del ? lastUndoable('type-delete') : null;
    return (
      <div className="page-column">
        <h1 ref={heading} tabIndex={-1}><span data-user-content>{del?.name ?? typeKey}</span></h1>
        <p role="status" className="empty">{t('typePage.gone')}</p>
        {del && undoId === del.jobId && (
          <>
            <p>{t('deletedType.body', { name: del.name, count: del.count })}</p>
            <div className="form-actions">
              <button data-command="typeSettings.undoDelete" type="button" tabIndex={0} onClick={() => void undoMove(del.jobId, true)}>{t('deletedType.undo')}</button>
              <button data-command="typeSettings.openTrash" type="button" tabIndex={0} onClick={() => onOpenTrash?.()}>{t('deletedType.openTrash')}</button>
            </div>
          </>
        )}
      </div>
    );
  }
  return <Settings type={type} types={types} usage={usage} heading={heading} w={w} setType={setType} onDeleted={onDeleted} />;
}

function Settings({ type, types, usage, heading, w, setType, onDeleted }: {
  type: TypeDto;
  types: TypeDto[];
  usage: TypeUsageDto | null;
  heading: React.RefObject<HTMLHeadingElement | null>;
  w: ReturnType<typeof useTypeWriter>;
  setType: (t: TypeDto) => void;
  onDeleted: () => void;
}) {
  const ro = type.state !== 'ok';
  const others = types.filter((x) => nfc(x.key) !== nfc(type.key));
  const [iconOpen, setIconOpen] = useState(false);
  const iconBtn = useRef<HTMLButtonElement | null>(null);
  const [deleting, setDeleting] = useState(false);
  const objects = usage?.objects ?? 0;
  const color = colorName(type.color);
  // 4E-1 (D-805, R99 B1): typing a new folder shows how many objects saving it moves; the save moves them (a job).
  const [moving, setMoving] = useState<number | null>(null);
  // Test build only (D-831): the core sends `tegg://test-focus-folder` under TEGG_TEST_FOCUS_FOLDER once the page is
  // ready, for the real-app tests that type a new folder without Appium.
  useEffect(() => {
    const un = listen('tegg://test-focus-folder', () => document.querySelector<HTMLInputElement>(`input[aria-label="${t('ts.folder')}"]`)?.focus());
    return () => void un.then((f) => f());
  }, []);
  const previewSeq = useRef(0);
  const previewFolder = (v: string) => {
    const n = ++previewSeq.current;
    if (!v.trim() || v === type.folder) { setMoving(null); return; }
    void ipc.folderMovePreview(type.key, v).then((r) => { if (previewSeq.current === n) setMoving(r.count); }, () => {});
  };
  const folderHelp = moving
    ? t('ts.folderMoveHelp', { n: moving, plural: (moving === 1 ? type.name : type.plural).toLocaleLowerCase(), old: type.folder })
    : t('ts.folderHelp4e');
  const set = (field: 'name' | 'plural' | 'folder' | 'icon' | 'color' | 'description', value: string | null, label: string) =>
    void w.send([{ op: 'set', field, value }], label, field);
  const nameRule = (name: string, plural: string, field: 'name' | 'plural') => {
    const r = checkTypeName(name, plural, others as never, []);
    if (!r) return null;
    if (r.reason === 'folderTaken' || r.reason === 'folderInvalid') return null; // the plural isn't the folder after creation
    if (r.field && r.field !== field) return null;
    return t(`typeRule.${r.reason}`, { key: r.key ?? '' });
  };
  return (
    <div className="page-column type-settings">
      <header className="ts-header">
        <span className="type-badge" aria-hidden="true" style={{ ['--type' as string]: `var(--type-${color})` }}><Icon name={typeIconName(type.key, type.icon)} size={20} /></span>
        <div>
          <h1 ref={heading} tabIndex={-1}>{withUser('ts.heading', 'name', type.name)}</h1>
          <p className="ts-applies">{t('ts.applies', { count: objects, key: type.key })}</p>
        </div>
        <span className="spacer" />
        <span role="status" aria-live="polite" aria-label={t('save.label')} className={`save-state ${w.save}`}>
          {w.save === 'saved' && <Icon name="check" size={14} />}
          <span>{t(`save.${w.save}`)}</span>
        </span>
      </header>
      {type.state === 'newer' && <p role="status" className="ts-notice">{t('ts.newer')}</p>}
      {type.state === 'invalid' && type.error && <p role="status" className="ts-notice">{t('ts.invalidLine', { line: type.error.line, message: type.error.message })}</p>}
      {w.conflict && (
        <div className="ts-notice alert">
          <span role="alert">{t('ts.conflict', { field: w.conflict })}</span>
          <button data-command="typeSettings.button0" type="button" className="text-button" onClick={() => w.setConflict(null)}>{t('ts.dismiss')}</button>
        </div>
      )}
      <div className="ts-layout">
        <nav aria-label={t('frame.settingsSections')} className="settings-sections ts-nav">
          {SECTIONS.map((s) => (
            <a data-command="typeSettings.a1" key={s} href={`#ts-${s}`} onClick={(e) => { e.preventDefault(); document.getElementById(`ts-${s}`)?.scrollIntoView({ block: 'start' }); }}>{t(SECTION_LABEL[s])}</a>
          ))}
        </nav>
        <div className="ts-sections">
          <section id="ts-general" aria-label={t('ts.general')} className="ts-section">
            <h2>{t('ts.general')}</h2>
            <TextSetting label={t('ts.name')} value={type.name} disabled={ro || type.system} desc={type.system ? t('ts.systemName') : undefined}
              error={w.errors.name} check={(v) => nameRule(v, type.plural, 'name')} onCommit={(v) => set('name', v, t('ts.name'))} />
            <TextSetting label={t('ts.plural')} value={type.plural} disabled={ro || type.system} desc={type.system ? t('ts.systemName') : undefined}
              error={w.errors.plural} check={(v) => nameRule(type.name, v, 'plural')} onCommit={(v) => set('plural', v, t('ts.plural'))} />
            <div className="ts-field">
              <span className="ts-label">{t('ts.icon')}</span>
              <button data-command="typeSettings.button2" ref={iconBtn} type="button" className="icon-pick" aria-label={t('ts.changeIcon')} aria-haspopup="listbox" aria-expanded={iconOpen} disabled={ro}
                onClick={() => setIconOpen((o) => !o)}>
                <Icon name={typeIconName(type.key, type.icon)} size={16} />
              </button>
              {iconOpen && (
                <OptionsPopup label={t('ts.icon')} anchor={iconBtn.current} current={type.icon}
                  choices={ICONS.map((i) => ({ value: i, label: t(`icon.${i}`), icon: i }))}
                  onClose={(refocus) => { setIconOpen(false); if (refocus) iconBtn.current?.focus(); }}
                  onChoose={(c) => { setIconOpen(false); iconBtn.current?.focus(); if (c.value !== type.icon) set('icon', c.value, t('ts.icon')); }} />
              )}
            </div>
            <div className="ts-field">
              <span className="ts-label" id="ts-color-label">{t('ts.color')}</span>
              <div role="radiogroup" aria-label={t('ts.color')} className="color-group"
                onKeyDown={(e) => {
                  if (ro || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
                  e.preventDefault();
                  const i = COLORS.indexOf(color);
                  const n = COLORS[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + COLORS.length) % COLORS.length];
                  set('color', n, t('ts.color'));
                  (e.currentTarget.querySelector(`[data-color="${n}"]`) as HTMLElement | null)?.focus();
                }}>
                {COLORS.map((c) => (
                  <button data-command="typeSettings.button3" key={c} type="button" role="radio" aria-checked={c === color} aria-label={t(`color.${c}`)} data-color={c} tabIndex={c === color ? 0 : -1}
                    aria-disabled={ro || undefined} className={`color-swatch ${c === color ? 'on' : ''}`} style={{ ['--type' as string]: `var(--type-${c})` }}
                    onClick={() => { if (!ro && c !== type.color) set('color', c, t('ts.color')); }} />
                ))}
              </div>
            </div>
            <TextSetting label={t('ts.folder')} value={type.folder} disabled={ro} desc={folderHelp} error={w.errors.folder}
              check={(v) => { const r = checkFolder(v, types as never, type.key); return r ? t(`typeRule.${r.reason}`) : null; }}
              onDraft={previewFolder}
              onCommit={(v) => { setMoving(null); expectFolderMove(type.key); set('folder', v, t('ts.folder')); }} />
            <TextSetting label={t('ts.description')} value={type.description ?? ''} disabled={ro} multiline error={w.errors.description}
              onCommit={(v) => set('description', v.trim() === '' ? null : v, t('ts.description'))} />
          </section>

          {/* D-693, D-728: the Tag type has no properties in the MVP; its colour is set on the tag page. */}
          {type.key === 'tag' ? (
            <section id="ts-properties" aria-label={t('ts.properties')} className="ts-section">
              <h2>{t('ts.properties')}</h2>
              <p className="hint">{t('ts.tagNoProperties')}</p>
            </section>
          ) : <PropertiesSection type={type} types={types} usage={usage} ro={ro} w={w} setType={setType} />}

          <section id="ts-builtIn" aria-label={t('ts.builtIn')} className="ts-section">
            <h2>{t('ts.builtIn')}</h2>
            <p className="hint">{t('ts.builtInHelp')}</p>
            <ul className="builtin-list">{BUILT_IN_ROWS.map((k) => <li key={k}><code data-user-content>{k}</code></li>)}</ul>
          </section>

          {type.key !== 'tag' && <PreviewSection type={type} ro={ro} w={w} setType={setType} />}

          {type.key !== 'tag' && <HiddenSection type={type} ro={ro} w={w} setType={setType} />}

          <EmbedsSection type={type} ro={ro} w={w} setType={setType} />

          <section id="ts-review" aria-label={t('ts.review')} className="ts-section">
            <h2>{t('ts.review')}</h2>
            <div className="ts-field row">
              <button data-command="typeSettings.button4" type="button" role="switch" aria-label={t('ts.review')} aria-checked={type.review !== 'off'}
                aria-disabled={ro || type.review === 'locked' || undefined} aria-description={type.review === 'locked' ? t('ts.reviewLocked') : undefined}
                className={`switch ${type.review !== 'off' ? 'on' : ''}`}
                onClick={() => { if (!ro && type.review !== 'locked') void w.send([{ op: 'review', on: type.review === 'off' }], t('ts.review'), 'review'); }}>
                <span className="switch-knob" aria-hidden="true" />
              </button>
              <span className="hint">{type.review === 'locked' ? t('ts.reviewLocked') : t('ts.reviewHelp')}</span>
            </div>
          </section>

          <section id="ts-templates" aria-label={t('ts.templates')} className="ts-section">
            <h2>{t('ts.templates')}</h2>
            <div className="ts-row">
              {type.template ? <><code data-user-content>{type.template}</code><span className="badge">{t('ts.defaultMark')}</span></> : <span className="hint">{t('ts.noTemplate')}</span>}
              <span className="spacer" />
              <Disabled control="ctl.newTemplate" />
              <Disabled control="ctl.editTemplate" />
            </div>
          </section>

          {type.key !== 'tag' && <section id="ts-views" aria-label={t('ts.views')} className="ts-section">
            <h2>{t('ts.views')}</h2>
            <div className="ts-row">
              <span data-user-content>{t('typePage.allView', { plural: type.plural })}</span><span className="badge">{t('ts.defaultMark')}</span>
              <span className="spacer" />
              <Disabled control="ctl.addViewSettings" />
              <Disabled control="ctl.editView" />
            </div>
          </section>}

          <section id="ts-delete" aria-label={t('ts.delete')} className="ts-section">
            <h2>{t('ts.delete')}</h2>
            {type.system ? <p className="hint">{t('ts.systemNoDelete')}</p> : (
              <>
                {objects > 0 && <p className="hint">{t('deleteType.section', { name: type.name, n: objects, plural: typeWord(type, objects) })}</p>}
                <button data-command="typeSettings.button5" type="button" className="text-button danger" disabled={ro} onClick={() => setDeleting(true)}>{withUser('ts.deleteType', 'name', type.name)}</button>
              </>
            )}
          </section>
        </div>
      </div>
      {deleting && <DeleteTypeDialog type={type} objects={objects} onClose={() => setDeleting(false)} onDeleted={onDeleted} />}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ properties

function attrInput(a: AttributeDto, change: Partial<AttributeInputDto> = {}): AttributeInputDto {
  return { key: a.key, name: a.name, type: a.type, default: a.default ?? null, required: a.required, options: a.options, to: a.to, multiple: a.multiple, description: a.description, ...change };
}

function PropertiesSection({ type, types, usage, ro, w, setType }: {
  type: TypeDto; types: TypeDto[]; usage: TypeUsageDto | null; ro: boolean; w: ReturnType<typeof useTypeWriter>; setType: (t: TypeDto) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  // FR-UX-03 AC-18: a property deleted by its job takes its group (and the dialog's opener) away: the focus waits here.
  const addBtn = useRef<HTMLButtonElement | null>(null);
  const focusHandle = useRef<string | null>(null);
  const dragKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    const k = focusHandle.current;
    if (!k) return;
    focusHandle.current = null;
    (document.querySelector(`[data-handle="${CSS.escape(k)}"]`) as HTMLElement | null)?.focus();
  });
  const move = (key: string, to: number) => {
    const attrs = [...type.attributes];
    const from = attrs.findIndex((a) => a.key === key);
    if (from < 0 || to < 0 || to >= attrs.length || to === from) return;
    const [a] = attrs.splice(from, 1);
    attrs.splice(to, 0, a);
    focusHandle.current = key;
    setType({ ...type, attributes: attrs });
    void w.send([{ op: 'moveAttribute', key, to }], a.name, `attr:${key}`);
  };
  return (
    <section id="ts-properties" aria-label={t('ts.properties')} className="ts-section">
      <h2>{t('ts.properties')}</h2>
      <div className="prop-list">
        {type.attributes.map((a, i) => (
          <PropertyGroup key={a.key} attr={a as AttributeDto} index={i} type={type} types={types} usage={usage} ro={ro} w={w} setType={setType} onDeleting={() => addBtn.current?.focus()}
            expanded={open.has(a.key)} onToggle={() => setOpen((s) => { const n = new Set(s); if (n.has(a.key)) n.delete(a.key); else n.add(a.key); return n; })}
            onMove={(to) => move(a.key, to)}
            onDragStart={() => { dragKey.current = a.key; }}
            onDrop={() => { if (dragKey.current) move(dragKey.current, i); dragKey.current = null; }} />
        ))}
      </div>
      {adding ? (
        <NewPropertyForm type={type} types={types} onCancel={() => setAdding(false)}
          onAdd={async (attr) => { const ok = await w.send([{ op: 'addAttribute', attribute: attr }], attr.name, 'new'); if (ok) setAdding(false); return ok ? null : (w.errors.new ?? null); }}
          error={w.errors.new ?? null} />
      ) : (
        <button data-command="typeSettings.button6" ref={addBtn} type="button" className="text-button" disabled={ro} onClick={() => { w.setErrors((e) => ({ ...e, new: null })); setAdding(true); }}>
          <Icon name="plus" size={12} />{t('ts.addProperty')}
        </button>
      )}
    </section>
  );
}

/** The new property row (FR-TYP-03 AC-1, AC-2): Name focused, the key derived until edited by hand, Type at Text. */
function NewPropertyForm({ type, onAdd, onCancel, error }: {
  type: TypeDto;
  types: TypeDto[];
  onAdd: (a: AttributeInputDto) => Promise<string | null>;
  onCancel: () => void;
  error: string | null;
}) {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [manual, setManual] = useState(false);
  const [kind, setKind] = useState('text');
  const [msg, setMsg] = useState<string | null>(null);
  const [typeOpen, setTypeOpen] = useState(false);
  const typeBtn = useRef<HTMLButtonElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const errId = useErrorId();
  useEffect(() => { nameRef.current?.focus(); }, []);
  const shown = msg ?? error;
  const add = async () => {
    const n = name.normalize('NFC').trim();
    const k = key.normalize('NFC').trim();
    if (!n) { setMsg(t('typeRule.empty')); return; }
    const r = checkAttrKey(k, type as never, kind);
    if (r) { setMsg(t(`typeRule.${r.reason}`, { key: r.key ?? k })); return; }
    setMsg(null);
    const err = await onAdd({ key: k, name: n, type: kind, default: null, required: false, options: [], to: null, multiple: false, description: null });
    if (err) setMsg(err);
  };
  return (
    <div role="group" aria-label={t('ts.newProperty')} className="prop-group new-prop"
      onKeyDown={(e) => { if (e.key === 'Escape' && !typeOpen) { e.preventDefault(); e.stopPropagation(); onCancel(); } }}>
      <label className="ts-field"><span className="ts-label">{t('ts.name')}</span>
        <input ref={nameRef} type="text" aria-label={t('ts.name')} value={name} spellCheck={false} autoComplete="off"
          onChange={(e) => { setName(e.target.value); if (!manual) setKey(deriveAttrKey(e.target.value)); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void add(); } }} />
      </label>
      <label className="ts-field"><span className="ts-label">{t('ts.key')}</span>
        <input type="text" aria-label={t('ts.key')} value={key} spellCheck={false} autoComplete="off" aria-describedby={shown ? errId : undefined}
          onChange={(e) => { setKey(e.target.value); setManual(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void add(); } }} />
      </label>
      <div className="ts-field"><span className="ts-label">{t('ts.type')}</span>
        <button data-command="typeSettings.button7" ref={typeBtn} type="button" role="combobox" aria-label={t('ts.type')} aria-haspopup="listbox" aria-expanded={typeOpen} className="pfield select"
          onClick={() => setTypeOpen((o) => !o)}>
          <span>{attrTypeLabel(kind)}</span><Icon name="chevron-down" size={12} />
        </button>
        {typeOpen && (
          <OptionsPopup label={t('ts.type')} anchor={typeBtn.current} current={kind} choices={ATTR_TYPES.map((x) => ({ value: x.type, label: t(x.label) }))}
            onClose={(r) => { setTypeOpen(false); if (r) typeBtn.current?.focus(); }}
            onChoose={(c) => { setTypeOpen(false); typeBtn.current?.focus(); setKind(c.value); }} />
        )}
      </div>
      <FieldError id={errId} text={shown} />
      <div className="form-actions">
        <button data-command="typeSettings.button8" type="button" onClick={onCancel}>{t('ts.cancel')}</button>
        <button data-command="typeSettings.button9" type="button" className="primary" onClick={() => void add()}>{t('ts.add')}</button>
      </div>
    </div>
  );
}

/** `New property…` in the type page's Columns menu (D-252): the Add property flow; the new property is also appended
 *  to `columns`, seeded when absent, in the same write (D-1240, type-columns AC-24); `preview` is never touched. */
export function NewPropertyDialog({ type, types, fresh, onClose, onDone }: {
  type: TypeDto; types: TypeDto[];
  /** The type once the page's queued column writes are done: the write is based on it (version and columns). */
  fresh?: () => Promise<TypeDto | undefined>;
  onClose: () => void; onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog label={t('ts.addProperty')} onCancel={onClose}>
      <h2>{t('ts.addProperty')}</h2>
      <NewPropertyForm type={type} types={types} error={error} onCancel={onClose}
        onAdd={async (attr) => {
          const on = (await fresh?.()) ?? type;
          const ops: TypeOpDto[] = [{ op: 'addAttribute', attribute: attr }, { op: 'columns', keys: toggleColumn(on, attr.key, true) }];
          try {
            await ipc.typePatch(on.key, on.exists ? on.version : null, ops);
            onDone();
            return null;
          } catch (e) {
            const m = typeErrorMessage(e);
            setError(m);
            return m;
          }
        }} />
    </Dialog>
  );
}

function PropertyGroup({ attr: a, index, type, types, usage, ro, w, setType, expanded, onToggle, onMove, onDragStart, onDrop, onDeleting }: {
  attr: AttributeDto; index: number; type: TypeDto; types: TypeDto[]; usage: TypeUsageDto | null; ro: boolean; w: ReturnType<typeof useTypeWriter>;
  setType: (t: TypeDto) => void; expanded: boolean; onToggle: () => void; onMove: (to: number) => void; onDragStart: () => void; onDrop: () => void;
  /** The delete job is confirmed: the focus leaves the group that will go. */
  onDeleting?: () => void;
}) {
  const fieldId = `attr:${a.key}`;
  const locked = a.builtIn;
  const unsupported = !a.supported;
  const off = ro || locked;
  const lockedDesc = locked ? t('ts.builtInLocked') : undefined;
  const [typeOpen, setTypeOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const typeBtn = useRef<HTMLButtonElement | null>(null);
  const update = (change: AttributeChangeDto, label: string) => {
    setType({ ...type, attributes: type.attributes.map((x) => (x.key === a.key ? { ...x, ...change } as AttributeDto : x)) });
    return w.send([{ op: 'updateAttribute', key: a.key, change }], label, fieldId);
  };
  // D-808 (FR-TYP-03 AC-14): only the current type and the wider ones, in R10 order; a choice writes only the type file.
  const wider = new Set<string>([a.type, ...widerTypes(a.type as AttrType)]);
  const typeChoices = ATTR_TYPES.filter((x) => wider.has(x.type)).map((x) => ({ value: x.type, label: t(x.label) }));
  const chooseType = (to: string) => {
    if (to === a.type) return;
    void update({ type: to }, t('ts.type'));
  };
  const defaultControl = () => {
    if (unsupported || a.type === 'relation' || a.type === 'date-time' || a.type === 'date-range' || a.type === 'multi-select') return null;
    const name = t('ts.default');
    const onValue = (v: Value) => { const d = v && typeof v === 'object' && 'date' in v ? (v as { date: string }).date : v; void update({ default: d === '' ? null : d }, name); };
    switch (a.type) {
      case 'select':
        return <SelectControl name={name} raw={a.default} disabled={off} choices={a.options.map((o) => ({ value: nfc(o.label), label: o.label, color: o.color }))} onValue={onValue} />;
      case 'checkbox':
        return <CheckboxControl name={name} raw={a.default} disabled={off} onValue={onValue} />;
      case 'date':
        return <DateControl name={name} raw={a.default} disabled={off} onValue={onValue} />;
      default:
        return <TextControl kind={a.type as TextKind} name={name} raw={a.default} disabled={off} onValue={onValue} />;
    }
  };
  return (
    <div role="group" aria-label={a.name} className={`prop-group ${expanded ? 'open' : ''}`}
      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onDrop(); }}>
      <div className="prop-head">
        <button data-command="typeSettings.button10" type="button" className="icon-button small handle" aria-label={t('ts.drag', { name: a.name })} data-handle={a.key} disabled={ro}
          draggable={!ro} onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', a.key); onDragStart(); }}
          onKeyDown={(e) => {
            if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
            e.preventDefault();
            e.stopPropagation();
            onMove(index + (e.key === 'ArrowUp' ? -1 : 1));
          }}>
          <Icon name="grip" size={14} />
        </button>
        <span className="prop-name" data-user-content>{a.name}</span>
        <span className="prop-type">{attrTypeLabel(a.type)}</span>
        {locked && <span className="badge">{t('ts.builtInBadge')}</span>}
        <span className="spacer" />
        <button data-command="typeSettings.button11" type="button" className="text-button small" aria-expanded={expanded} disabled={ro}
          aria-label={t(expanded ? 'ts.collapse' : 'ts.edit', { name: a.name })} onClick={onToggle}>
          <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
        </button>
      </div>
      {expanded && (
        <div className="prop-body">
          {unsupported && a.readOnlyReason === 'unsupported' && <p className="warning-text">{t('ts.unsupported', { type: attrTypeLabel(a.type) })}</p>}
          <TextSetting label={t('ts.name')} value={a.name} disabled={off || unsupported} desc={lockedDesc} error={w.errors[fieldId]}
            check={(v) => (v.trim() === '' ? t('typeRule.empty') : null)} onCommit={(v) => void update({ name: v.trim() }, t('ts.name'))} />
          <TextSetting label={t('ts.key')} value={a.key} disabled desc={locked ? t('ts.builtInLocked') : t('ts.renameKeys')} onCommit={() => {}} />
          <div className="ts-field"><span className="ts-label">{t('ts.type')}</span>
            <button data-command="typeSettings.button12" ref={typeBtn} type="button" role="combobox" aria-label={t('ts.type')} aria-haspopup="listbox" aria-expanded={typeOpen} className="pfield select"
              aria-disabled={off || unsupported || undefined} aria-description={lockedDesc} onClick={() => { if (!off && !unsupported) setTypeOpen((o) => !o); }}>
              <span>{attrTypeLabel(a.type)}</span><Icon name="chevron-down" size={12} />
            </button>
            {typeOpen && (
              <OptionsPopup label={t('ts.type')} anchor={typeBtn.current} current={a.type} choices={typeChoices} footer={t('ts.widenFooter')}
                onClose={(r) => { setTypeOpen(false); if (r) typeBtn.current?.focus(); }}
                onChoose={(c) => { setTypeOpen(false); typeBtn.current?.focus(); chooseType(c.value); }} />
            )}
          </div>
          {(a.type === 'select' || a.type === 'multi-select') && (
            <OptionsEditor attr={a} type={type} usage={usage} off={off} locked={locked} w={w} update={update} />
          )}
          {defaultControl() && <div className="ts-field"><span className="ts-label">{t('ts.default')}</span>{defaultControl()}</div>}
          <label className="ts-field row">
            <input type="checkbox" aria-label={t('ts.required')} aria-description={lockedDesc} checked={a.required} disabled={off || unsupported}
              onChange={(e) => void update({ required: e.target.checked }, t('ts.required'))} />
            <span>{t('ts.required')}</span>
          </label>
          {a.type === 'relation' && (
            <>
              <div role="group" aria-label={t('ts.allowed')} className="ts-field allowed">
                <span className="ts-label">{t('ts.allowed')}</span>
                {types.filter((x) => !x.invalid).map((x) => {
                  const on = (a.to ?? []).map(nfc).includes(nfc(x.key));
                  return (
                    <label key={x.key} className="row">
                      <input type="checkbox" aria-label={x.name} checked={on} disabled={off}
                        onChange={() => {
                          const cur = a.to ?? [];
                          const next = on ? cur.filter((k) => nfc(k) !== nfc(x.key)) : [...cur, x.key];
                          void update({ to: next.length ? next : null }, t('ts.allowed'));
                        }} />
                      <span data-user-content>{x.name}</span>
                    </label>
                  );
                })}
              </div>
              <label className="ts-field row">
                <input type="checkbox" aria-label={t('ts.multiple')} checked={a.multiple} disabled={off} onChange={(e) => void update({ multiple: e.target.checked }, t('ts.multiple'))} />
                <span>{t('ts.multiple')}</span>
              </label>
            </>
          )}
          <TextSetting label={t('ts.description')} value={a.description ?? ''} disabled={off || unsupported} desc={lockedDesc}
            onCommit={(v) => void update({ description: v.trim() === '' ? null : v }, t('ts.description'))} />
          <div className="form-actions">
            <button data-command="typeSettings.button13" type="button" className="text-button danger" disabled={ro || locked} aria-description={lockedDesc} onClick={() => setDeleting(true)}>{t('ts.deleteProperty')}</button>
          </div>
        </div>
      )}
      {deleting && (
        <DeletePropertyDialog attr={a} type={type} values={usage?.values?.[a.key] ?? 0} onClose={() => setDeleting(false)} onConfirmed={onDeleting}
          onRemoveDefinition={() => {
            setType({ ...type, attributes: type.attributes.filter((x) => x.key !== a.key), preview: type.preview.filter((k) => nfc(k) !== nfc(a.key)) });
            void w.send([{ op: 'removeAttribute', key: a.key }], a.name, fieldId);
          }} />
      )}
    </div>
  );
}

/** Select and Multi-select options (FR-TYP-03 AC-5, D-227): add, reorder (drag, ⌥↑/⌥↓), rename unused, remove.
 *  5A-1 (FR-TSK-02, FR-TSK-03, D-473): the Task type's built-in `status` and `priority` options are editable too, each
 *  action one option op (one line of the file); `status` options have a State, and one Open and one Done must stay. */
const STATES = ['open', 'in-progress', 'done', 'cancelled'] as const;

/** A layer for popups at the start of the document, ahead of the page in reading order (its choices are found first). */
function popupLayer(): HTMLElement {
  let el = document.getElementById('popup-layer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'popup-layer';
    document.body.insertBefore(el, document.body.firstChild);
  }
  return el;
}
const STATE_LABEL: Record<string, string> = { open: 'state.open', 'in-progress': 'state.inProgress', done: 'state.done', cancelled: 'state.cancelled' };

function OptionsEditor({ attr: a, type, usage, off: offAttr, locked, w, update }: {
  attr: AttributeDto; type: TypeDto; usage: TypeUsageDto | null; off: boolean; locked: boolean; w: ReturnType<typeof useTypeWriter>;
  update: (c: AttributeChangeDto, label: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<{ state: string; color: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ label: string; count: number } | null>(null);
  const [colorFor, setColorFor] = useState<{ label: string | null; anchor: HTMLElement } | null>(null);
  const [stateFor, setStateFor] = useState<{ label: string | null; anchor: HTMLElement } | null>(null);
  const focusLabel = useRef<string | null>(null);
  const errId = useErrorId();
  const used = (label: string) => usage?.options?.[a.key]?.[nfc(label)] ?? usage?.options?.[a.key]?.[label] ?? 0;
  const taskOpts = locked && type.key === 'task' && (a.key === 'status' || a.key === 'priority');
  const isStatus = taskOpts && a.key === 'status';
  const off = taskOpts ? offAttr && !locked : offAttr;
  const lockDesc = taskOpts ? undefined : locked ? t('ts.builtInLocked') : undefined;
  const renameUsed = taskOpts ? t('typeSettings.renameUsed') : t('ts.renameUsed');
  useLayoutEffect(() => {
    const k = focusLabel.current;
    if (!k) return;
    focusLabel.current = null;
    (document.querySelector(`[data-option-handle="${CSS.escape(`${a.key}:${k}`)}"]`) as HTMLElement | null)?.focus();
  });
  const send = (op: TypeOpDto) => w.send([op], t('ts.options'));
  /** D-473: refuse what would leave no Open or no Done status. */
  const statesOk = (options: OptionDto[]): boolean => {
    if (!isStatus) return true;
    const r = checkStatusOptions(options);
    if (r) { setError(t(r.reason === 'needOpen' ? 'typeSettings.needOpen' : 'typeSettings.needDone')); return false; }
    setError(null);
    return true;
  };
  const dup = (label: string, except: string | null) => a.options.some((o) => o.label !== except && nfc(o.label).toLowerCase() === nfc(label).toLowerCase());
  const commitLabel = (old: string | null, label: string): boolean => {
    const l = label.normalize('NFC').trim();
    if (old !== null && l === old) { setError(null); return true; }
    if (!l) { setError(t('typeRule.optionEmpty')); return false; }
    if (dup(l, old)) { setError(t('typeRule.optionDuplicate')); return false; }
    setError(null);
    if (taskOpts) {
      if (old === null) void send({ op: 'addOption', attr: a.key, option: { label: l, color: draft?.color ?? null, state: isStatus ? (draft?.state ?? 'open') : null } });
      else void send({ op: 'renameOption', attr: a.key, from: old, to: l });
      return true;
    }
    const options: OptionDto[] = old === null ? [...a.options, { label: l, color: draft?.color ?? null, state: null }] : a.options.map((o) => (o.label === old ? { ...o, label: l } : o));
    void update({ options }, t('ts.optionLabel'));
    return true;
  };
  const moveOpt = (label: string, d: number) => {
    const opts = [...a.options];
    const i = opts.findIndex((o) => o.label === label);
    const j = i + d;
    if (i < 0 || j < 0 || j >= opts.length) return;
    focusLabel.current = label;
    if (taskOpts) { void send({ op: 'moveOption', attr: a.key, label, to: j }); return; }
    [opts[i], opts[j]] = [opts[j], opts[i]];
    void update({ options: opts }, t('ts.options'));
  };
  const remove = (label: string) => {
    const rest = a.options.filter((x) => x.label !== label);
    if (!statesOk(rest)) return;
    if (taskOpts) void send({ op: 'removeOption', attr: a.key, label });
    else void update({ options: rest }, t('ts.options'));
  };
  const setColor = (label: string, color: string) => {
    if (taskOpts) void send({ op: 'setOptionColor', attr: a.key, label, color });
    else void update({ options: a.options.map((o) => (o.label === label ? { ...o, color } : o)) }, t('ts.options'));
  };
  const setState = (label: string, state: string) => {
    const next = a.options.map((o) => (o.label === label ? { ...o, state } : o));
    if (!statesOk(next)) return;
    void send({ op: 'setOptionState', attr: a.key, label, state });
  };
  const stateOf = (o: OptionDto) => (STATES as readonly string[]).includes(o.state ?? '') ? (o.state as string) : 'open';
  const stateButton = (label: string | null, value: string) => (
    <button type="button" role="combobox" tabIndex={0} className="option-state" aria-haspopup="listbox" aria-expanded={!!stateFor && stateFor.label === label}
      aria-label={`${t('typeSettings.state')} ${t(STATE_LABEL[value])}`} disabled={off}
      onClick={(e) => setStateFor({ label, anchor: e.currentTarget })}>
      {t(STATE_LABEL[value])}
    </button>
  );
  const colorButton = (label: string | null, color: string | null, name: string) => (
    <button data-command="typeSettings.button19" type="button" tabIndex={0} className="option-color" aria-label={t('ts.optionColor', { label: name })} disabled={off}
      style={{ ['--type' as string]: `var(--type-${colorName(color)})` }}
      onClick={(e) => setColorFor({ label, anchor: e.currentTarget })} />
  );
  return (
    <div className="ts-field options-editor">
      <span className="ts-label">{t('ts.options')}</span>
      <ul aria-label={t('ts.options')} className="option-list">
        {a.options.map((o) => {
          const n = used(o.label);
          const unknown = isStatus && !(STATES as readonly string[]).includes(o.state ?? '') ;
          return (
            <li key={o.label} className="option-row">
              <button data-command="typeSettings.button18" type="button" tabIndex={0} className="icon-button small handle" aria-label={t('ts.dragOption', { label: o.label })} data-option-handle={`${a.key}:${o.label}`} disabled={off}
                onKeyDown={(e) => { if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); e.stopPropagation(); moveOpt(o.label, e.key === 'ArrowUp' ? -1 : 1); } }}>
                <Icon name="grip" size={12} />
                <span className="sr-only" data-user-content>{o.label}</span>
              </button>
              {colorButton(o.label, o.color, o.label)}
              <OptionLabel label={o.label} disabled={off || n > 0} desc={lockDesc ?? (n > 0 ? renameUsed : undefined)} onCommit={(v) => commitLabel(o.label, v)} />
              {isStatus && stateButton(o.label, stateOf(o))}
              {unknown && o.state && <span role="status" className="hint warn">{t('typeSettings.unknownState', { value: o.state })}</span>}
              <span className="hint">{t('ts.usedBy', { count: n })}</span>
              <button data-command="typeSettings.button20" type="button" tabIndex={0} className="icon-button small" aria-label={t('ts.removeOption', { label: o.label })} disabled={off}
                onClick={() => {
                  if (n > 0) { setRemoving({ label: o.label, count: n }); return; }
                  remove(o.label);
                }}>
                <Icon name="x" size={12} />
              </button>
            </li>
          );
        })}
        {draft && (
          <li className="option-row">
            {colorButton(null, draft.color, '')}
            <OptionLabel label="" autoFocus onCancel={() => setDraft(null)} onCommit={(v) => { if (v.trim() === '') { setDraft(null); return true; } const ok = commitLabel(null, v); if (ok) setDraft(null); return ok; }} />
            {isStatus && stateButton(null, draft.state)}
          </li>
        )}
      </ul>
      <FieldError id={errId} text={error} />
      <button data-command="typeSettings.button21" type="button" className="text-button small" disabled={off} onClick={() => setDraft({ state: 'open', color: null })}><Icon name="plus" size={12} />{t('ts.addOption')}</button>
      {colorFor && createPortal(
        <PopupMenu label={t('ts.optionColors', { label: colorFor.label ?? '' })} anchor={colorFor.anchor}
          entries={COLORS.map((c) => ({
            kind: 'radio' as const, key: c, label: t(`color.${c}`), checked: colorName(colorFor.label === null ? draft?.color : a.options.find((o) => o.label === colorFor.label)?.color) === c,
            content: <><span className="option-dot" aria-hidden="true" style={{ background: `var(--type-${c})` }} />{t(`color.${c}`)}</>,
            onChoose: () => {
              const l = colorFor.label;
              colorFor.anchor.focus();
              setColorFor(null);
              if (l === null) setDraft((d) => (d ? { ...d, color: c } : d));
              else setColor(l, c);
            },
          }))}
          onClose={() => setColorFor(null)} />,
        popupLayer(),
      )}
      {stateFor && (
        <OptionsPopup label={t('typeSettings.state')} anchor={stateFor.anchor}
          choices={STATES.map((s) => ({ value: s, label: t(STATE_LABEL[s]) }))}
          current={stateFor.label === null ? draft?.state : stateOf(a.options.find((o) => o.label === stateFor.label) ?? { label: '', color: null, state: null })}
          onClose={(r) => { if (r) stateFor.anchor.focus(); setStateFor(null); }}
          onChoose={(c) => {
            const l = stateFor.label;
            stateFor.anchor.focus();
            setStateFor(null);
            if (l === null) setDraft((d) => (d ? { ...d, state: c.value } : d));
            else setState(l, c.value);
          }} />
      )}
      {removing && (
        <Dialog label={t('removeOption.title', { label: removing.label })} onCancel={() => setRemoving(null)}>
          <h2>{withUser('removeOption.title', 'label', removing.label)}</h2>
          <p>{t(taskOpts ? 'task.removeOption.body' : 'removeOption.body', { count: removing.count, label: removing.label })}</p>
          <div className="dialog-buttons">
            <button data-command="typeSettings.button22" type="button" autoFocus onClick={() => setRemoving(null)}>{t('removeOption.cancel')}</button>
            <button data-command="typeSettings.button23" type="button" className="primary" onClick={() => { const l = removing.label; setRemoving(null); remove(l); }}>{t('removeOption.ok')}</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function OptionLabel({ label, disabled, desc, autoFocus, onCommit, onCancel }: {
  label: string; disabled?: boolean; desc?: string; autoFocus?: boolean; onCommit: (v: string) => boolean; onCancel?: () => void;
}) {
  const [v, setV] = useState(label);
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setV(label); }, [label]);
  const commit = () => {
    if (!editing.current) return;
    if (onCommit(v)) editing.current = false;
  };
  return (
    <input type="text" aria-label={t('ts.optionLabel')} aria-description={desc} disabled={disabled} value={v} autoFocus={autoFocus} spellCheck={false} autoComplete="off"
      data-user-content className="option-label"
      onChange={(e) => { editing.current = true; setV(e.target.value); }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editing.current = false; setV(label); onCancel?.(); }
      }} />
  );
}

// ------------------------------------------------------------------------------------------------ embeds

const EMBED_MODES = ['full', 'card', 'link'] as const;

/** 4F (FR-EMB-02 AC-6, AC-7, D-417; R12): the type's default embed mode. An unknown value in the file is shown with a
 *  warning and never rewritten until the user chooses; choosing the checked mode writes nothing. */
function EmbedsSection({ type, ro, w, setType }: { type: TypeDto; ro: boolean; w: ReturnType<typeof useTypeWriter>; setType: (t: TypeDto) => void }) {
  const mode = (EMBED_MODES as readonly string[]).includes(type.embed) ? (type.embed as (typeof EMBED_MODES)[number]) : 'card';
  const raw = type.embedRaw;
  const unknown = raw !== null && !(EMBED_MODES as readonly string[]).includes(raw.trim().toLowerCase());
  const refs = useRef<(HTMLElement | null)[]>([]);
  const choose = (m: (typeof EMBED_MODES)[number], focus = false) => {
    if (focus) refs.current[EMBED_MODES.indexOf(m)]?.focus();
    if (ro || (m === mode && !unknown && (raw ?? '').toLowerCase() === m) || (m === mode && raw === null)) return;
    if (m === mode && unknown) { /* choosing the shown default replaces the unknown value */ }
    setType({ ...type, embed: m, embedRaw: m });
    void w.send([{ op: 'embed', mode: m }], t('typeSettings.embeds'), 'embed');
  };
  const onKey = (e: React.KeyboardEvent) => {
    const i = EMBED_MODES.indexOf(mode);
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    choose(EMBED_MODES[(i + step + EMBED_MODES.length) % EMBED_MODES.length], true);
  };
  return (
    <section id="ts-embeds" aria-label={t('typeSettings.embeds')} className="ts-section">
      <h2>{t('typeSettings.embeds')}</h2>
      <div role="radiogroup" aria-label={t('typeSettings.embedMode')} className="ts-field row segmented ts-embed-modes" onKeyDown={onKey}>
        {EMBED_MODES.map((m, i) => (
          <span key={m} ref={(el) => { refs.current[i] = el; }} role="radio" aria-checked={m === mode} tabIndex={m === mode ? 0 : -1}
            aria-disabled={ro || undefined} className={`ts-radio ${m === mode ? 'on' : ''}`} data-command="typeSettings.embedMode"
            onClick={() => choose(m)}>
            {t(`embed.mode.${m}`)}
          </span>
        ))}
      </div>
      <p className="hint">{t('typeSettings.embedHint', { plural: type.plural })}</p>
      {unknown && <p role="status" className="hint warn">{t('typeSettings.embedUnknown', { value: raw!, mode: t(`embed.mode.${mode}`) })}</p>}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ hidden

/** The universal properties a type can hide, in panel order (FR-TYP-17, D-316). */
const UNIVERSAL_HIDDEN: [string, string][] = [['tags', 'attr.tags'], ['aliases', 'attr.aliases'], ['source', 'attr.source'], ['review', 'attr.review'], ['created', 'attr.created'], ['modified', 'attr.modified']];

/** Hidden properties (FR-TYP-17 AC-1, D-316): one checkbox per property; a checked one leaves the attribute panel's
 *  rows for its Other properties group. Keys in `hidden` that aren't properties are kept as they are (AC-3). */
function HiddenSection({ type, ro, w, setType }: { type: TypeDto; ro: boolean; w: ReturnType<typeof useTypeWriter>; setType: (t: TypeDto) => void }) {
  const hidden = (type.hidden ?? []).map(nfc);
  const rows: [string, string, boolean][] = [
    ...type.attributes.map((a): [string, string, boolean] => [nfc(a.key), a.name, true]),
    ...UNIVERSAL_HIDDEN.map(([k, l]): [string, string, boolean] => [k, t(l), false]),
  ];
  const toggle = (key: string, on: boolean) => {
    const next = on ? [...hidden.filter((k) => k !== key), key] : hidden.filter((k) => k !== key);
    setType({ ...type, hidden: next });
    void w.send([{ op: 'hidden', keys: next }], t('ts.hidden'), 'hidden');
  };
  return (
    <section id="ts-hidden" aria-label={t('ts.hidden')} className="ts-section">
      <h2>{t('ts.hidden')}</h2>
      <p className="hint">{t('ts.hiddenHelp')}</p>
      <ul className="hidden-list">
        {rows.map(([key, name, user]) => (
          <li key={key}>
            <label className="ts-check">
              <input type="checkbox" data-command="typeSettings.hidden" checked={hidden.includes(key)} disabled={ro} onChange={(e) => toggle(key, e.target.checked)} />
              <span data-user-content={user ? '' : undefined}>{name}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ preview

function PreviewSection({ type, ro, w, setType }: { type: TypeDto; ro: boolean; w: ReturnType<typeof useTypeWriter>; setType: (t: TypeDto) => void }) {
  const [menu, setMenu] = useState(false);
  const addBtn = useRef<HTMLButtonElement | null>(null);
  const focusKey = useRef<string | null>(null);
  const label = (k: string) => type.attributes.find((a) => nfc(a.key) === nfc(k))?.name ?? (UNIVERSAL_PREVIEW.find(([u]) => u === k) ? t(UNIVERSAL_PREVIEW.find(([u]) => u === k)![1]) : k);
  const keys = type.preview.filter((k) => !type.previewIgnored.includes(k));
  const avail: [string, string][] = [
    ...type.attributes.map((a): [string, string] => [a.key, a.name]),
    ...UNIVERSAL_PREVIEW.map(([k, l]): [string, string] => [k, t(l)]),
  ].filter(([k]) => !type.preview.map(nfc).includes(nfc(k)));
  const full = keys.length >= 4;
  useLayoutEffect(() => {
    const k = focusKey.current;
    if (!k) return;
    focusKey.current = null;
    (document.querySelector(`[data-preview="${CSS.escape(k)}"]`) as HTMLElement | null)?.focus();
  });
  const write = (next: string[], focus?: string) => {
    const all = [...next, ...type.preview.filter((k) => type.previewIgnored.includes(k))];
    if (focus) focusKey.current = focus;
    setType({ ...type, preview: all });
    void w.send([{ op: 'preview', keys: all }], t('preview.properties'), 'preview');
  };
  return (
    <section id="ts-preview" aria-label={t('preview.properties')} className="ts-section">
      <h2>{t('preview.properties')}</h2>
      <ul aria-label={t('preview.properties')} className="preview-chips">
        {keys.map((k, i) => (
          <li key={k} tabIndex={0} className="chip preview-chip" data-preview={k}
            onKeyDown={(e) => {
              if (ro || !e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
              e.preventDefault();
              const j = i + (e.key === 'ArrowLeft' ? -1 : 1);
              if (j < 0 || j >= keys.length) return;
              const n = [...keys];
              [n[i], n[j]] = [n[j], n[i]];
              write(n, k);
            }}>
            <span data-user-content>{label(k)}</span>
            <button data-command="typeSettings.button24" type="button" tabIndex={-1} className="chip-remove" aria-label={t('ts.removePreview', { name: label(k) })} disabled={ro}
              onClick={() => write(keys.filter((x) => x !== k))}>
              <Icon name="x" size={11} />
            </button>
          </li>
        ))}
      </ul>
      {full ? (
        <button data-command="typeSettings.button25" ref={addBtn} type="button" className="text-button" aria-disabled="true" aria-description={t('ts.previewFull')}>{t('ts.addPreview', { count: 0 })}</button>
      ) : (
        <button data-command="typeSettings.button26" ref={addBtn} type="button" className="text-button" aria-haspopup="menu" aria-expanded={menu} disabled={ro} onClick={() => setMenu((m) => !m)}>
          {t('ts.addPreview', { count: 4 - keys.length })}
        </button>
      )}
      {menu && (
        <PopupMenu label={t('ts.addPreviewMenu')} anchor={addBtn.current} onClose={() => setMenu(false)}
          entries={avail.map(([k, l]) => ({ kind: 'item' as const, key: k, label: l, content: <span className="menu-title" data-user-content>{l}</span>,
            onChoose: () => { setMenu(false); addBtn.current?.focus(); write([...keys, k]); } }))} />
      )}
      {type.previewIgnored.length > 0 && <p className="warning-text">{t('ts.previewIgnored', { keys: type.previewIgnored.join(', ') })}</p>}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ delete type

/** R99: the type's Name for a count of 1, its plural otherwise, in lower case. */
const typeWord = (type: { name: string; plural: string }, n: number) => (n === 1 ? type.name : type.plural).toLocaleLowerCase();

/** Types this session deleted with their objects (the deleted-type route, R99 F2): key → the job and its count. */
const deletedTypes = new Map<string, { jobId: number; name: string; count: number }>();

/** R99 D (D-807, FR-TYP-04 AC-6…AC-9): with values the core's `value-remove` plan gives the counts and the button runs
 *  the job; without values the definition alone changes (no job, no zip). */
function DeletePropertyDialog({ attr, type, values, onClose, onRemoveDefinition, onConfirmed }: { attr: AttributeDto; type: TypeDto; values: number; onClose: () => void; onRemoveDefinition: () => void; onConfirmed?: () => void }) {
  const restore = useRef(true);
  const [plan, setPlan] = useState<{ jobId: number; plan: JobPlanDto } | null | undefined>(values > 0 ? undefined : null);
  const [msg, setMsg] = useState<string | null>(null);
  const job = useRef<number | null>(null);
  const confirmed = useRef(false);
  const started = useRef(false);
  const mounted = useRef(false);
  // Cancel is the default (R99); focused after the dialog's own mount effects (it restores its opener on cleanup).
  const cancelBtn = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { cancelBtn.current?.focus(); }, [plan]);
  useEffect(() => {
    if (values === 0) return;
    // One job per dialog, also when React runs this effect twice (StrictMode); a dialog closed before the plan came
    // cancels the job it started.
    mounted.current = true;
    if (!started.current) {
      started.current = true;
      planDelete(() => ipc.valueRemoveStart(type.key, attr.key)).then((p) => {
        job.current = p?.jobId ?? null;
        if (mounted.current) setPlan(p);
        else if (p) void ipc.jobCancel(p.jobId).catch(() => {});
      }, (e) => { if (mounted.current) { setPlan(null); setMsg(typeErrorMessage(e)); } });
    }
    return () => {
      mounted.current = false;
      // A real close (not React's StrictMode re-run, which mounts again at once) cancels an unconfirmed job, so it never
      // waits in confirm and holds the job queue (QA 4E-2 m5).
      setTimeout(() => { if (!mounted.current && !confirmed.current && job.current !== null) void ipc.jobCancel(job.current).catch(() => {}); }, 0);
    };
  }, []);
  const cancel = () => {
    if (job.current !== null && !confirmed.current) void ipc.jobCancel(job.current).catch(() => {});
    onClose();
  };
  if (plan === undefined) return null; // the plan arrives in a moment; the dialog shows the core's counts
  const n = plan?.plan.files ?? 0;
  const m = plan?.plan.empty ?? 0;
  const run = () => {
    if (!plan) return;
    confirmed.current = true;
    restore.current = false;
    onClose();
    onConfirmed?.();
    void confirmDelete(plan.jobId, 'value-remove', {
      name: attr.name, count: n,
      running: (total, done) => t('job.valueRemove.running', { name: attr.name, done, n: total }),
      done: (r) => {
        const notes = r.written.filter((p) => !p.startsWith('.tegg/')).length;
        const kept = r.skipped.filter((s) => s.reason === 'readOnly').length; // D-858: anchored entries, left as written
        const changed = r.skipped.length - kept;
        return [t('job.valueRemove.done', { name: attr.name, count: notes }), changed ? t('job.valueRemove.skipped', { count: changed }) : null, kept ? t('job.valueRemove.leftAsWritten', { count: kept }) : null].filter(Boolean).join(' ');
      },
    });
  };
  return (
    <Dialog label={t('delProp.title', { name: attr.name })} onCancel={cancel} restore={restore}>
      <h2>{withUser('delProp.title', 'name', attr.name)}</h2>
      {msg ? null : plan && n > 0 ? (
        <>
          <p>{m > 0 ? t('delProp.removesEmpty', { key: attr.key, n, plural: typeWord(type, n), m }) : t('delProp.removes', { key: attr.key, n, plural: typeWord(type, n) })}</p>
          <p>{t('delProp.backup')}</p>
        </>
      ) : <p>{t('delProp.none', { singular: type.name.toLocaleLowerCase() })}</p>}
      {msg && <p role="alert" className="field-error">{msg}</p>}
      <div className="dialog-buttons">
        <button data-command="typeSettings.button17" ref={cancelBtn} type="button" onClick={cancel}>{t('delProp.cancel')}</button>
        {msg ? null : plan && n > 0
          ? <button data-command="typeSettings.button16" type="button" className="danger" onClick={run}>{t('delProp.okCount', { count: n })}</button>
          : <button data-command="typeSettings.button16" type="button" className="danger" onClick={() => { if (plan) void ipc.jobCancel(plan.jobId).catch(() => {}); onClose(); onRemoveDefinition(); }}>{t('delProp.ok')}</button>}
      </div>
    </Dialog>
  );
}

function DeleteTypeDialog({ type, objects: count, onClose, onDeleted }: { type: TypeDto; objects: number; onClose: () => void; onDeleted: () => void }) {
  // The count when the dialog opened decides which dialog it is (an object added meanwhile is AC-5's re-check).
  const [withObjects] = useState(count > 0);
  if (withObjects) return <DeleteTypeWithObjects type={type} onClose={onClose} />;
  return <DeleteEmptyType type={type} objects={count} onClose={onClose} onDeleted={onDeleted} />;
}

/** R99 F1 (D-809, D-842, FR-TYP-05 AC-6…AC-9): the core's `type-delete` plan gives the counts; the button runs the job. */
function DeleteTypeWithObjects({ type, onClose }: { type: TypeDto; onClose: () => void }) {
  const [plan, setPlan] = useState<{ jobId: number; plan: JobPlanDto } | null | undefined>(undefined);
  const [msg, setMsg] = useState<string | null>(null);
  const job = useRef<number | null>(null);
  const confirmed = useRef(false);
  const started = useRef(false);
  const mounted = useRef(false);
  // Cancel is the default (R99); focused after the dialog's own mount effects (it restores its opener on cleanup).
  const cancelBtn = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { cancelBtn.current?.focus(); }, [plan]);
  useEffect(() => {
    // One job per dialog, also when React runs this effect twice (StrictMode); a dialog closed before the plan came
    // cancels the job it started.
    mounted.current = true;
    if (!started.current) {
      started.current = true;
      planDelete(() => ipc.typeDeleteStart(type.key)).then((p) => {
        job.current = p?.jobId ?? null;
        if (mounted.current) setPlan(p);
        else if (p) void ipc.jobCancel(p.jobId).catch(() => {});
      }, (e) => { if (mounted.current) { setPlan(null); setMsg(typeErrorMessage(e)); } });
    }
    return () => {
      mounted.current = false;
      // A real close (not React's StrictMode re-run, which mounts again at once) cancels an unconfirmed job, so it never
      // waits in confirm and holds the job queue (QA 4E-2 m5).
      setTimeout(() => { if (!mounted.current && !confirmed.current && job.current !== null) void ipc.jobCancel(job.current).catch(() => {}); }, 0);
    };
  }, []);
  const cancel = () => {
    if (job.current !== null && !confirmed.current) void ipc.jobCancel(job.current).catch(() => {});
    onClose();
  };
  if (plan === undefined) return null;
  const n = plan?.plan.files ?? 0;
  const k = plan?.plan.templates ?? 0;
  const plural = typeWord(type, n);
  const run = () => {
    if (!plan) return;
    confirmed.current = true;
    onClose();
    const key = nfc(type.key);
    deletedTypes.set(key, { jobId: plan.jobId, name: type.name, count: n }); // the route's view once the type is gone
    void confirmDelete(plan.jobId, 'type-delete', {
      name: type.name, count: n,
      running: (total, done) => t('job.typeDelete.running', { name: type.name, done, n: total }),
      done: (r) => (r.keptType ? t('job.typeDelete.keptType', { count: r.skipped.length }) : t('job.typeDelete.done', { name: type.name, n, plural })),
      finished: (r) => { if (!r || r.phase !== 'done' || r.keptType) deletedTypes.delete(key); },
    });
  };
  return (
    <Dialog label={t('deleteType.title', { name: type.name })} onCancel={cancel}>
      <h2>{withUser('deleteType.title', 'name', type.name)}</h2>
      {plan && <p>{k > 0 ? t('deleteType.bodyTemplates', { n, plural, name: type.name, count: k }) : t('deleteType.body', { n, plural })}</p>}
      {plan && <p>{t('deleteType.backup', { plural: typeWord(type, 2) })}</p>}
      {msg && <p role="alert" className="field-error">{msg}</p>}
      <div className="dialog-buttons">
        <button data-command="typeSettings.button27" ref={cancelBtn} type="button" onClick={cancel}>{t('deleteType.cancel')}</button>
        {plan && <button data-command="typeSettings.button28" type="button" className="danger" onClick={run}>{t('deleteType.okCount', { n, plural })}</button>}
      </div>
    </Dialog>
  );
}

function DeleteEmptyType({ type, objects: count, onClose, onDeleted }: { type: TypeDto; objects: number; onClose: () => void; onDeleted: () => void }) {
  // The count when the dialog opened; `Delete type` re-checks in the core (FR-TYP-05 AC-5).
  const [objects] = useState(count);
  const [msg, setMsg] = useState<string | null>(null);
  const cancel = useRef<HTMLButtonElement | null>(null);
  const restore = useRef(true);
  useEffect(() => { cancel.current?.focus(); }, []);
  const del = async () => {
    if (!type.version) return;
    try {
      await ipc.typeDelete(type.key, type.version);
      restore.current = false;
      onClose();
      onDeleted();
    } catch (e) {
      const x = e as { kind?: string; count?: number };
      setMsg(x.kind === 'HasObjects' ? t('deleteType.recheck', { name: type.name, count: x.count ?? 1 }) : typeErrorMessage(e));
    }
  };
  return (
    <Dialog label={t('deleteType.title', { name: type.name })} onCancel={onClose} restore={restore}>
      <h2>{withUser('deleteType.title', 'name', type.name)}</h2>
      <p>{objects === 0 ? t('deleteType.none') : t('deleteType.some', { count: objects })}</p>
      {msg && <p role="alert" className="field-error">{msg}</p>}
      <div className="dialog-buttons">
        <button data-command="typeSettings.button27" ref={cancel} type="button" onClick={onClose}>{t('deleteType.cancel')}</button>
        <button data-command="typeSettings.button28" type="button" className="danger" disabled={objects > 0} onClick={() => void del()}>{t('deleteType.ok')}</button>
      </div>
    </Dialog>
  );
}
