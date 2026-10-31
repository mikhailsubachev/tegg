// Slice G3 (docs/contracts/v1-graph.md §16.2, §16.3; R119; AP-924, AP-927…AP-931): the preset control of a graph
// view: the label, the `Preset: <name>` menu button with ` · modified`, `Update` / `Revert`, the `Presets` menu, the
// non-modal Save dialog, the rename field in place of the button, the delete `alertdialog` and the alert. The page holds
// the presets file as read (`state`); this control writes it only through `graph_presets_apply`, one call at a time,
// with the version last read as base (FR-SYN-03 AC-22). No error changes the view's filters. Mounted with
// `view="full"` in the full view's filter column and with `view="panel"` in the right panel's `Depth and filters`
// popover, the label and the button on one row (slice "G3 in the panel", R125, board GraphPanel B).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import { applyPreset, currentPreset, isModified, trimWs, validateName, type NameError } from './presets';
import type { GraphPresetsDto, GraphViewStateDto, PresetOpDto } from './types';

/** What R123's commands run on the visible control. `returnTo`: where the focus goes when the menu closes. */
export type PresetActions = {
  openMenu: (returnTo?: HTMLElement | null) => void;
  save: () => void;
  update: () => void;
  revert: () => void;
  rename: () => void;
  remove: () => void;
};

export type PresetControlProps = {
  view: 'full' | 'panel';
  /** `.tegg/graph.yml` as last read (null: not read yet). */
  state: GraphPresetsDto | null;
  onState: (s: GraphPresetsDto) => void;
  /** This view's stored state (its filters and `preset`). */
  graph: GraphViewStateDto;
  /** Applying, `Revert` or a successful save: this view's next state (one `ui_state_set`, §16.4). */
  onApply: (next: GraphViewStateDto) => void;
  /** After a Tegg rename (`to`) or delete (`null`): `preset` in every view of the vault that named `from` (§16.4). */
  onRenamed: (from: string, to: string | null) => void;
  actionsRef?: React.MutableRefObject<PresetActions | null>;
};

type Failure = { nameError: NameError } | { outside: true } | { failed: true };
/** One `graph_presets_apply` in flight per window (§16.2). */
let queue: Promise<unknown> = Promise.resolve();
const ALERT_MS = 10_000;
/** Board B9: ` · modified` in the orange type token. */
const MODIFIED_TYPE_COLOUR = 'orange';
const nfc = (s: string) => s.normalize('NFC');
const NAME_ERRORS = new Set(['NameEmpty', 'NameTaken', 'NameTooLong', 'NameControl']);

/** R119's message for a name error. */
export function nameMessage(e: NameError): string {
  switch (e.kind) {
    case 'NameEmpty': return t('graph.preset.err.empty');
    case 'NameTaken': return t('graph.preset.err.taken', { name: e.existing === 'Default' ? t('graph.preset.default') : e.existing });
    case 'NameTooLong': return t('graph.preset.err.long');
    case 'NameControl': return t('graph.preset.err.control');
  }
}

type Entry = { key: string; role: 'menuitemradio' | 'menuitem'; label: React.ReactNode; name?: string; checked?: boolean; disabled?: string | null; run: () => void; user?: boolean };

export function PresetControl(p: PresetControlProps) {
  const [menu, setMenu] = useState<{ returnTo: HTMLElement | null } | null>(null);
  const [active, setActive] = useState(0);
  const [save, setSave] = useState<{ name: string; tried: boolean; error: NameError | null } | null>(null);
  const [rename, setRename] = useState<{ text: string; error: NameError | null } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLDivElement | null)[]>([]);
  const nameInput = useRef<HTMLInputElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const committing = useRef(false);
  const focusButton = useRef(false);
  const stateRef = useRef(p.state);
  stateRef.current = p.state;
  const graphRef = useRef(p.graph);
  graphRef.current = p.graph;
  const uid = useRef(`preset-${Math.random().toString(36).slice(2, 8)}`).current;

  const file = p.state?.state ?? 'missing';
  const presets = file === 'unreadable' ? [] : p.state?.presets ?? [];
  const current = currentPreset(p.graph, presets);
  const modified = isModified(p.graph, current);
  const readOnly = file === 'unreadable' ? t('graph.preset.fixFile') : file === 'newer' ? t('graph.preset.newer') : null;
  const updateReason = readOnly ?? (modified ? null : t('graph.preset.notModified'));
  const shownName = current ? current.name : t('graph.preset.default');

  // ------------------------------------------------------------------ the alert (AP-924): until the next action or 10 s
  useEffect(() => {
    if (!alert) return;
    const timer = window.setTimeout(() => setAlert(null), ALERT_MS);
    return () => window.clearTimeout(timer);
  }, [alert]);
  useEffect(() => {
    if (focusButton.current && button.current) { focusButton.current = false; button.current.focus(); }
  });
  // The alert is a layer too (R125): Esc with only the alert shown dismisses it, one layer at a time (FR-GRP-02 AC-33).
  const otherLayer = !!menu || !!save || !!rename || confirm;
  useEffect(() => {
    if (!alert || otherLayer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      setAlert(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [alert, otherLayer]);
  const backToButton = () => { focusButton.current = true; setTimeout(() => { if (focusButton.current && button.current) { focusButton.current = false; button.current.focus(); } }, 0); };

  // ------------------------------------------------------------------ writes (§16.2)
  const run = (op: PresetOpDto): Promise<Failure | null> => {
    setAlert(null);
    const task = queue.then(async (): Promise<Failure | null> => {
      try {
        p.onState(await ipc.graphPresetsApply(stateRef.current?.version ?? null, op));
        return null;
      } catch (e) {
        const err = e as { kind?: string; existing?: string; disk?: unknown };
        if (err?.kind && NAME_ERRORS.has(err.kind)) return { nameError: (err.kind === 'NameTaken' ? { kind: 'NameTaken', existing: err.existing ?? '' } : { kind: err.kind }) as NameError };
        if (err?.kind === 'Conflict' || err?.kind === 'Gone' || err?.kind === 'NoSuchPreset' || err?.kind === 'NewerVersion' || err?.kind === 'Unreadable') {
          // The disk's version: shown, never applied to the filters (AP-924, AP-929).
          const disk = err.disk as GraphPresetsDto | undefined;
          if (disk && typeof disk === 'object' && 'presets' in disk) p.onState(disk);
          else await ipc.graphPresetsGet().then(p.onState, () => {});
          setAlert(t('graph.preset.changedOutside'));
          return { outside: true };
        }
        setAlert(t('graph.preset.saveFailed'));
        return { failed: true };
      }
    });
    queue = task.catch(() => undefined);
    return task;
  };

  // ------------------------------------------------------------------ actions
  const closeMenu = (focus: boolean) => {
    const back = menu?.returnTo ?? null;
    setMenu(null);
    if (!focus) return;
    // Over the open Save dialog the menu gives the focus back to its field (FR-SYN-03 AC-22).
    if (save && nameInput.current) nameInput.current.focus();
    else if (back && back !== button.current && back.isConnected) back.focus();
    else backToButton();
  };
  const choose = (preset: typeof current) => { closeMenu(true); setAlert(null); p.onApply(applyPreset(graphRef.current, preset)); };
  const openSave = () => { if (readOnly) return; setMenu(null); setConfirm(false); setAlert(null); setSave({ name: '', tried: false, error: null }); };
  const doUpdate = () => {
    if (!current || updateReason) return;
    setMenu(null);
    void run({ op: 'update', name: current.name, hiddenTypes: p.graph.hiddenTypes ?? [], hiddenKinds: (p.graph.hiddenKinds ?? []) as string[] });
  };
  const doRevert = () => { if (!modified) return; setAlert(null); p.onApply(applyPreset(graphRef.current, current)); };
  const startRename = () => { if (!current || readOnly) return; setMenu(null); setAlert(null); setRename({ text: current.name, error: null }); };
  const openDelete = () => { if (!current || readOnly) return; setMenu(null); setAlert(null); setConfirm(true); };
  const openMenu = (returnTo?: HTMLElement | null) => {
    setActive(-1);
    setMenu({ returnTo: returnTo ?? button.current });
  };
  if (p.actionsRef) p.actionsRef.current = { openMenu, save: openSave, update: doUpdate, revert: doRevert, rename: startRename, remove: openDelete };

  const submitSave = async () => {
    if (!save) return;
    const error = validateName(save.name, presets);
    if (error) { setSave({ ...save, tried: true, error }); return; }
    const name = nfc(trimWs(save.name));
    const r = await run({ op: 'save', name, hiddenTypes: graphRef.current.hiddenTypes ?? [], hiddenKinds: (graphRef.current.hiddenKinds ?? []) as string[] });
    if (r && 'nameError' in r) { setSave((s) => (s ? { ...s, tried: true, error: r.nameError } : s)); return; }
    if (r) return; // the dialog stays open with the typed name (AP-924)
    setSave(null);
    p.onApply({ ...graphRef.current, preset: name });
    backToButton();
  };
  const cancelRename = () => { setRename(null); backToButton(); };
  const submitRename = async () => {
    if (!rename || !current) return;
    const error = validateName(rename.text, presets, current.name);
    if (error) { setRename({ ...rename, error }); return; }
    const to = nfc(trimWs(rename.text));
    if (to === current.name) { cancelRename(); return; } // the same name writes nothing
    committing.current = true;
    const r = await run({ op: 'rename', from: current.name, to });
    committing.current = false;
    if (r && 'nameError' in r) { setRename((x) => (x ? { ...x, error: r.nameError } : x)); return; }
    if (r) { if ('outside' in r) { setRename(null); backToButton(); } else renameInput.current?.focus(); return; }
    p.onRenamed(current.name, to);
    setRename(null);
    backToButton();
  };
  const submitDelete = async () => {
    if (!current) return;
    const r = await run({ op: 'delete', name: current.name });
    setConfirm(false);
    if (!r) p.onRenamed(current.name, null);
    backToButton();
  };

  // ------------------------------------------------------------------ the menu's entries (R119)
  const entries: (Entry | 'separator')[] = [
    { key: 'default', role: 'menuitemradio', label: <>{t('graph.preset.default')} <span className="muted">{t('graph.preset.builtIn')}</span></>, checked: !current, run: () => choose(null) },
    ...presets.map((x): Entry => ({ key: `p:${x.name}`, role: 'menuitemradio', label: x.name, user: true, checked: current?.name === x.name, run: () => choose(x) })),
    'separator',
    { key: 'save', role: 'menuitem', label: t('graph.preset.saveAs'), disabled: readOnly, run: openSave },
    ...(current ? [
      { key: 'update', role: 'menuitem', label: t('graph.preset.updateNamed', { name: current.name }), disabled: updateReason, run: doUpdate } as Entry,
      { key: 'rename', role: 'menuitem', label: t('graph.preset.renameNamed', { name: current.name }), disabled: readOnly, run: startRename } as Entry,
      { key: 'delete', role: 'menuitem', label: t('graph.preset.deleteNamed', { name: current.name }), disabled: readOnly, run: openDelete } as Entry,
    ] : []),
  ];
  const focusable = entries.filter((e): e is Entry => e !== 'separator');
  // The menu opens with the focus on the checked item.
  useEffect(() => {
    if (!menu) return;
    if (active < 0) { setActive(Math.max(0, focusable.findIndex((e) => e.checked))); return; }
    items.current[active]?.focus();
  }, [menu, active]);
  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.min(focusable.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : focusable.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const x = focusable[active];
      if (x && !x.disabled) x.run();
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      closeMenu(true);
    } else if (e.key === 'Tab') {
      closeMenu(false);
    }
  };
  // A pointer press outside the menu (and its button) closes it.
  useEffect(() => {
    if (!menu) return;
    const outside = (e: PointerEvent) => {
      const tg = e.target as Node;
      if (layer.current?.contains(tg) || button.current?.contains(tg)) return;
      setMenu(null);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [menu]);

  // ------------------------------------------------------------------ layers above everything (AC-24), anchored to the control
  const layerOpen = !!menu || !!save || confirm;
  useLayoutEffect(() => {
    if (!layerOpen) { setPlace(null); return; }
    const measure = () => {
      const r = (button.current ?? root.current)?.getBoundingClientRect();
      if (!r) return;
      const h = layer.current?.offsetHeight ?? 0;
      const w = layer.current?.offsetWidth ?? 0;
      const top = Math.max(8, Math.min(r.bottom + 4, window.innerHeight - h - 8));
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      setPlace((pl) => (pl && pl.top === top && pl.left === left ? pl : { top, left }));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [layerOpen, menu, save, confirm, entries.length]);
  useEffect(() => { if (save) nameInput.current?.focus(); }, [!!save]);
  useEffect(() => { if (rename) { renameInput.current?.focus(); renameInput.current?.select(); } }, [!!rename]);

  const style: React.CSSProperties = { top: place?.top ?? -9999, left: place?.left ?? -9999 };
  const saveMsg = save ? (save.error && (save.error.kind !== 'NameEmpty' || save.tried) ? save.error : (() => { const e = validateName(save.name, presets); return e && (e.kind !== 'NameEmpty' || save.tried) ? e : null; })()) : null;
  const saveValid = !!save && !validateName(save.name, presets);
  let index = -1;

  return (
    <div ref={root} className={`graph-preset${p.view === 'panel' ? ' panel' : ''}`} data-preset-control="">
      <div className="graph-preset-label">{t('graph.preset.label')}</div>
      {rename ? (
        <div className="graph-preset-rename">
          <input ref={renameInput} type="text" data-preset-layer="" aria-label={t('graph.preset.renameField')} value={rename.text} data-user-content=""
            aria-describedby={rename.error ? `${uid}-rename-msg` : undefined}
            onChange={(e) => setRename({ text: e.currentTarget.value, error: null })}
            onBlur={() => { if (!committing.current) setTimeout(() => { if (!committing.current && document.activeElement !== renameInput.current) setRename(null); }, 0); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void submitRename(); }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelRename(); }
            }} />
          <span className="graph-preset-hint" aria-hidden="true">{t('graph.preset.renameHint')}</span>
          {rename.error && <div id={`${uid}-rename-msg`} className="graph-preset-msg" aria-live="polite">{nameMessage(rename.error)}</div>}
        </div>
      ) : (
        <button ref={button} type="button" tabIndex={0} className="graph-preset-button" data-command="graph.preset.apply" aria-haspopup="menu" aria-expanded={!!menu}
          aria-label={t('graph.preset.button', { name: shownName })} aria-description={modified ? t('graph.preset.modifiedA11y') : undefined}
          onClick={(e) => { e.currentTarget.focus(); if (menu) closeMenu(false); else openMenu(save ? (document.activeElement as HTMLElement | null) : null); }}>
          {current ? <span data-user-content="">{current.name}</span> : <span>{t('graph.preset.default')}</span>}
          {modified && <span className="graph-preset-modified" style={{ color: `var(--type-${MODIFIED_TYPE_COLOUR})` }}>{' '}{t('graph.preset.modified')}</span>}
        </button>
      )}
      {modified && !rename && (
        <div className="graph-preset-row">
          {current && <button type="button" className="graph-preset-small" data-command="graph.preset.update" aria-disabled={updateReason ? 'true' : undefined}
            aria-description={updateReason ?? undefined} onClick={doUpdate}>{t('graph.preset.update')}</button>}
          <button type="button" className="graph-preset-small" data-command="graph.preset.revert" onClick={doRevert}>{t('graph.preset.revert')}</button>
        </div>
      )}
      {alert && <div role="alert" className="graph-preset-alert" data-preset-layer="">{alert}</div>}

      {menu && createPortal(
        <div ref={layer} role="menu" aria-label={t('graph.preset.menu')} className="graph-preset-menu graph-preset-layer" data-preset-layer="" style={style} onKeyDown={onMenuKey}>
          {entries.map((x, i) => {
            if (x === 'separator') return <div key={`sep${i}`} role="separator" className="graph-preset-sep" />;
            const at = ++index;
            const note = x.key === 'default' && file === 'unreadable'
              ? <div className="graph-preset-note" role="presentation">{p.state?.error?.line != null ? t('graph.preset.unreadableLine', { line: p.state.error.line }) : t('graph.preset.unreadable')}</div>
              : null;
            return (
              <div key={x.key} style={{ display: 'contents' }}>
                <div ref={(el) => { items.current[at] = el; }} role={x.role} tabIndex={-1} className={`graph-preset-item${at === active ? ' active' : ''}`}
                  aria-checked={x.role === 'menuitemradio' ? !!x.checked : undefined} aria-disabled={x.disabled ? 'true' : undefined} aria-description={x.disabled ?? undefined}
                  data-user-content={x.user ? '' : undefined}
                  onPointerMove={() => { if (active !== at) setActive(at); }}
                  onClick={() => { if (!x.disabled) x.run(); }}>
                  <span className={`graph-preset-check${x.checked ? ' on' : ''}`} aria-hidden="true" />{x.label}
                </div>
                {note}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
      {save && createPortal(
        <div ref={menu ? undefined : layer} role="dialog" aria-modal="false" aria-label={t('graph.preset.saveTitle')} className="graph-preset-dialog graph-preset-layer" data-preset-layer="" style={style}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSave(null); setAlert(null); backToButton(); } }}>
          <h2>{t('graph.preset.saveTitle')}</h2>
          <label className="graph-preset-field">
            <span>{t('graph.preset.name')}</span>
            <input ref={nameInput} type="text" aria-label={t('graph.preset.name')} value={save.name} data-user-content=""
              aria-describedby={saveMsg ? `${uid}-save-msg` : undefined}
              onChange={(e) => setSave({ name: e.currentTarget.value, tried: save.tried, error: null })}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submitSave(); } }} />
          </label>
          <div id={`${uid}-save-msg`} className="graph-preset-msg" aria-live="polite">{saveMsg ? nameMessage(saveMsg) : ''}</div>
          <p className="graph-preset-note">{t('graph.preset.saveNote')}</p>
          <div className="graph-preset-buttons">
            <button type="button" className="graph-preset-small" onClick={() => { setSave(null); setAlert(null); backToButton(); }}>{t('graph.preset.cancel')}</button>
            <button type="button" className="graph-preset-small primary" aria-disabled={saveValid ? undefined : 'true'} onClick={() => void submitSave()}>{t('graph.preset.save')}</button>
          </div>
        </div>,
        document.body,
      )}
      {confirm && current && createPortal(
        <div ref={layer} role="alertdialog" aria-modal="false" aria-label={t('graph.preset.deleteTitle', { name: current.name })} aria-describedby={`${uid}-del-note`}
          className="graph-preset-dialog graph-preset-layer" data-preset-layer="" style={style}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setConfirm(false); backToButton(); return; }
            // Tab stays between Cancel and Delete while the confirm is open.
            if (e.key === 'Tab') {
              const bs = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
              const i = bs.indexOf(document.activeElement as HTMLButtonElement);
              e.preventDefault();
              bs[(i + (e.shiftKey ? bs.length - 1 : 1)) % bs.length]?.focus();
            }
          }}>
          <h2>{t('graph.preset.deleteTitle', { name: current.name })}</h2>
          <p id={`${uid}-del-note`}>{t('graph.preset.deleteNote')}</p>
          <div className="graph-preset-buttons">
            <button type="button" className="graph-preset-small" autoFocus onClick={() => { setConfirm(false); backToButton(); }}>{t('graph.preset.cancel')}</button>
            <button type="button" className="graph-preset-small danger" onClick={() => void submitDelete()}>{t('graph.preset.delete')}</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
