// The capture window (docs/acceptance/capture.md R55, R57; docs/contracts/ms5-capture.md §3, §4; FR-CAP-01, -04, -05,
// FR-TSK-10 AC-9…AC-12; D-539…D-546): Type, vault, Discard, the text, Due and Priority for a Task, tags, the drop zone
// (MS6), Save and the status. ⌘↩ saves from any control, ⏎ is a new line (D-69); Esc hides and keeps a draft (D-542).
// The bytes come from `@tegg/doc` `newObject` (D-552); the only write is `capture_create`.
import { listen } from '@tauri-apps/api/event';
import { pastedImageName } from '@tegg/doc';
import type { StagedMediaDto, StagedMediaResultDto } from '../ipc/types';
import { stagedUrl } from '../ipc/media';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { captureParts, newObject, tagKey, type Value } from '@tegg/doc';
import { parseDate as parseRegionDate } from '@tegg/schema';
import { collator, region } from '../i18n/collate';
import { t } from '../i18n/catalog';
import { captureEvents, captureIpc, type CaptureOpen } from '../ipc/capture';
import type { CaptureContextDto, CaptureTypeDto } from '../ipc/types';
import { Icon, typeIconName } from '../shell/Icon';
import { parseQuickAdd } from '../tasks/quickAdd';
import { localDate, localIso } from '../zone';
import { TagField } from './TagField';
import { DueCalendar } from './DueCalendar';
import { insertion, SuggestList, triggerAt, useSuggestions, type Row } from './suggest';
import { dueLabelOf, ulid } from './util';

type Status = { kind: 'nothing' } | { kind: 'failed' } | { kind: 'vaultGone'; vault: string } | null;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic', 'image/svg+xml': 'svg' };

const FIRST = ['page', 'task', 'quick-note'];

/** R55 order: Page, Task, Quick Note, then user types by D-122. */
function ordered(types: CaptureTypeDto[]): CaptureTypeDto[] {
  const first = FIRST.map((k) => types.find((x) => x.key === k)).filter((x): x is CaptureTypeDto => !!x);
  const rest = types.filter((x) => !FIRST.includes(x.key)).sort((a, b) => collator().compare(a.name, b.name));
  return [...first, ...rest];
}

const priorityOptions = (task: CaptureTypeDto | undefined): string[] =>
  ((task?.attributes ?? []).find((a) => a.key === 'priority')?.options ?? []).map((o) => o.label);

/** The mirror's content: the text with its first non-empty line (the title, AP-467) in bold; a final space keeps a
 *  trailing empty line's height, as the textarea has it. */
function mirror(text: string) {
  const m = /^((?:[ \t]*\n)*)([^\n]*)([\s\S]*)$/.exec(text);
  if (!m || !m[2].trim()) return <>{text}{' '}</>;
  return <>{m[1]}<span className="capture-mirror-title">{m[2]}</span>{m[3]}{' '}</>;
}

/** D-604: the type's plural; without one (an older context), its folder's last part. */
const pluralOf = (d: CaptureTypeDto) => d.plural ?? (d.folder.split('/').filter(Boolean).pop() || d.name);

export function CaptureApp() {
  const [, setUiTick] = useState(0);
  const [ctx, setCtx] = useState<CaptureContextDto | null>(null);
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [sugSel, setSugSel] = useState(0);
  /** Esc closed the list at this caret and length; typing on reopens it. */
  const [sugClosed, setSugClosed] = useState<string | null>(null);
  const [scroll, setScroll] = useState(0);
  const [type, setType] = useState('quick-note');
  const [chips, setChips] = useState<string[]>([]);
  const [due, setDue] = useState<string | null>(null);
  const [priority, setPriority] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [menu, setMenu] = useState<'type' | 'priority' | 'due' | null>(null);
  const [dueText, setDueText] = useState('');
  /** Quick-add words moved out of the text (D-544), put back by `Clear`. */
  const [moved, setMoved] = useState<{ due?: string; priority?: string }>({});
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const typeRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const saving = useRef(false);
  const lastDefault = useRef<string | null>(null);
  /** The vault the window showed when it opened (D-546). */
  const shownVault = useRef<{ id: string; name: string } | null>(null);
  const state = useRef({ text, type, chips, due, priority });
  state.current = { text, type, chips, due, priority };

  const types = ordered(ctx?.types ?? []);
  const typeDef = types.find((x) => x.key === type);
  const isTask = type === 'task';
  const vault = ctx?.vault ?? null;

  const loadContext = useCallback(async () => {
    const c = await captureIpc.context().catch(() => null);
    if (!c) return null;
    const before = lastDefault.current;
    lastDefault.current = c.defaultType;
    setCtx(c);
    // A type deleted outside Tegg falls back to the default type (FR-CAP-04 AC-8); an untouched window follows a new
    // default at once (FR-VLT-05 AC-5).
    const untouched = state.current.text === '' && state.current.chips.length === 0;
    setType((cur) => (untouched && before !== null && cur === before ? c.defaultType : c.types.length === 0 || c.types.some((x) => x.key === cur) ? cur : c.defaultType));
    return c;
  }, []);

  // D-585 (FR-CAP-01 AC-15): the draft is stored 500 ms after the last change while the window is open, so a quit, a
  // crash or a relaunch keeps what was typed. Armed once the window has opened (a fresh page never stores over a draft
  // it hasn't restored yet); a save or Discard disarms it and drops a pending store.
  const draftArmed = useRef(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Shown: from `capture:open` to the next hide (D-596 ignores a blur outside that span, e.g. the hide's own).
  const shown = useRef(false);
  const cancelDraftStore = () => { if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null; } };

  const [staged, setStaged] = useState<StagedMediaDto[]>([]);
  const stagedRef = useRef<StagedMediaDto[]>([]);
  stagedRef.current = staged;
  const [refused, setRefused] = useState<string[]>([]);
  const reset = (c: CaptureContextDto | null) => {
    setRefused([]);
    draftArmed.current = false;
    cancelDraftStore();
    setText('');
    setChips([]);
    setDue(null);
    setPriority(null);
    setMoved({});
    setStatus(null);
    setMenu(null);
    setType(c?.defaultType ?? 'quick-note');
  };

  const focusText = () => {
    const el = textRef.current;
    if (!el) return;
    el.focus();
    const n = el.value.length;
    el.setSelectionRange(n, n);
  };

  const onOpen = useCallback(async (o: CaptureOpen) => {
    shown.current = true;
    // ⌃⌥T sets Task at once, also on an open window or a restored draft (D-542).
    if (o.kind === 'task') setType('task');
    const c = (await loadContext()) ?? ctx;
    const empty = state.current.text === '' && state.current.chips.length === 0;
    if (empty) {
      const d = await captureIpc.draftGet().catch(() => null);
      if (d) {
        setText(d.text);
        setChips(d.tags);
        setDue(d.due);
        setPriority(d.priority);
        if (o.kind !== 'task') setType(c && c.types.some((x) => x.key === d.type) ? d.type : (c?.defaultType ?? 'quick-note'));
      } else if (o.kind !== 'task') setType(c?.defaultType ?? 'quick-note');
    }
    setStatus(null);
    shownVault.current = c?.vault ? { id: c.vault.id, name: c.vault.name } : null;
    draftArmed.current = true;
    requestAnimationFrame(() => {
      focusText();
      requestAnimationFrame(() => requestAnimationFrame(() => void captureIpc.ready(o.seq)));
    });
  }, [ctx, loadContext]);

  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  useEffect(() => {
    void loadContext();
    const offs = [captureEvents.open((o) => void openRef.current(o)), captureEvents.contextChanged(() => void loadContext()),
      // §4: a new Date & time choice re-renders the due label (main.tsx stores it first).
      captureEvents.uiState(() => setUiTick((n) => n + 1))];
    return () => { for (const off of offs) void off.then((f) => f()); };
  }, [loadContext]);

  // The window's height follows its content (§2.2 capture_resize).
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => void captureIpc.resize(Math.ceil(el.getBoundingClientRect().height)).catch(() => {}));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 6A (D-624): files dropped from Finder come through Tauri's window drag-drop event and are staged.
  useEffect(() => {
    const un = listen<{ paths: string[] }>('tauri://drag-drop', (e) => { if (e.payload?.paths?.length) void stagePaths(e.payload.paths); });
    return () => void un.then((f) => f());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // The webview's own file drop is prevented (the event above carries the paths).
  useEffect(() => {
    const stop = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files') || (e.dataTransfer?.files.length ?? 0) > 0) e.preventDefault(); };
    const drop = (e: DragEvent) => e.preventDefault();
    document.addEventListener('dragover', stop);
    document.addEventListener('drop', drop);
    return () => { document.removeEventListener('dragover', stop); document.removeEventListener('drop', drop); };
  }, []);

  /** D-544: with type Task, quick-add tokens at the end of the first line move into Due, Priority and chips. */
  const onText = (value: string) => {
    if (state.current.type !== 'task') return setText(value);
    const nl = value.indexOf('\n');
    const first = nl < 0 ? value : value.slice(0, nl);
    const q = parseQuickAdd(first, { today: localDate(Date.now()), priorities: priorityOptions(types.find((x) => x.key === 'task')) });
    if (q.tokens.length === 0) return setText(value);
    // Remove the token words from the end of the first line.
    let line = first.trimEnd();
    for (let i = q.tokens.length - 1; i >= 0; i--) line = line.slice(0, line.length - q.tokens[i].word.length).trimEnd();
    setText(line + (nl < 0 ? '' : value.slice(nl)));
    const m = { ...moved };
    for (const tok of q.tokens) {
      if (tok.kind === 'due') m.due = tok.word;
      if (tok.kind === 'priority') m.priority = tok.word;
    }
    setMoved(m);
    if (q.due) setDue(q.due);
    if (q.priority) setPriority(q.priority);
    if (q.tags.length) setChips((cs) => q.tags.reduce((acc, tag) => (acc.some((c) => c.normalize('NFC').toLowerCase() === tag.normalize('NFC').toLowerCase()) ? acc : [...acc, tag.normalize('NFC')]), cs));
  };

  const putBack = (word: string | undefined) => {
    if (!word) return;
    setText((v) => {
      const nl = v.indexOf('\n');
      const first = nl < 0 ? v : v.slice(0, nl);
      return `${first.trimEnd()} ${word}` + (nl < 0 ? '' : v.slice(nl));
    });
  };

  const hide = () => { shown.current = false; void captureIpc.hide(); };

  const keepDraft = async () => {
    const s = state.current;
    if (s.text.trim() === '' && s.chips.length === 0) {
      await captureIpc.draftSet(null).catch(() => {});
      return;
    }
    await captureIpc.draftSet({ text: s.text, type: s.type, tags: s.chips, due: s.type === 'task' ? s.due : null, priority: s.type === 'task' ? s.priority : null, savedAt: localIso(Date.now()) }).catch(() => {});
  };

  useEffect(() => {
    if (!draftArmed.current) return;
    cancelDraftStore();
    draftTimer.current = setTimeout(() => { draftTimer.current = null; if (draftArmed.current) void keepDraft(); }, 500);
  }, [text, type, chips, due, priority]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => cancelDraftStore, []);

  const escape = async () => {
    if (menu) { setMenu(null); typeRef.current?.focus(); return; }
    cancelDraftStore();
    await keepDraft();
    hide();
  };

  // D-596: focus loss (a click into another app or Tegg window) hides the window as Esc does, also with a menu open;
  // with text the draft is kept, empty it just hides. Its own menus and pickers are DOM, so they never blur the window.
  const lostFocus = async () => {
    if (!shown.current || saving.current) return;
    setMenu(null);
    const s = state.current;
    const pending = draftTimer.current !== null;
    cancelDraftStore();
    if (s.text.trim() !== '' || s.chips.length > 0 || pending) await keepDraft();
    hide();
  };
  const lostFocusRef = useRef(lostFocus);
  lostFocusRef.current = lostFocus;
  useEffect(() => {
    const h = () => void lostFocusRef.current();
    window.addEventListener('blur', h);
    return () => window.removeEventListener('blur', h);
  }, []);

  const discard = async () => {
    draftArmed.current = false;
    cancelDraftStore();
    await captureIpc.draftSet(null).catch(() => {});
    reset(ctx);
    // ms6-trash-media §5: Discard cancels the capture, so its staged files go too (the shell expires the tokens).
    setStaged([]);
    hide();
  };

  const save = async () => {
    if (saving.current || !vault) return;
    const s = state.current;
    if (s.text.trim() === '' && stagedRef.current.length === 0) { setStatus({ kind: 'nothing' }); return; }
    const def = types.find((x) => x.key === s.type);
    if (!def) return;
    saving.current = true;
    cancelDraftStore(); // no debounced draft write while the save is in flight (D-596)
    try {
      const parts = captureParts(s.text, () => null);
      const title = parts.title === '' ? 'Untitled' : parts.title;
      const seen = new Set<string>();
      const tags: string[] = [];
      for (const tag of [...s.chips, ...parts.tags]) {
        const k = tagKey(tag.normalize('NFC'));
        if (!seen.has(k)) { seen.add(k); tags.push(tag.normalize('NFC')); }
      }
      const values: [string, Value][] = [];
      if (s.type === 'task' && s.priority) values.push(['priority', s.priority]);
      if (s.type === 'task' && s.due) values.push(['due', { date: s.due }]);
      if (tags.length) values.push(['tags', tags]);
      const now = localIso(Date.now());
      const bytes = newObject({
        type: { key: def.key, attributes: def.attributes.map((a) => ({ key: a.key, type: a.type, default: a.default ?? undefined, options: a.options })), review: def.review as 'off' | 'on' | 'locked' },
        title,
        template: def.templateHead,
        now,
        capture: true,
        newId: () => ulid(Date.now()),
        values,
        body: parts.body,
      });
      const vaultId = shownVault.current?.id ?? vault.id;
      // 6A (D-624): the staged files are written first by the shell; `''` tells it the capture has no title.
      const made = await captureIpc.create(vaultId, def.key, parts.title === '' && stagedRef.current.length ? '' : title, bytes, stagedRef.current.map((m) => m.token));
      setStaged([]);
      draftArmed.current = false;
      cancelDraftStore();
      await captureIpc.draftSet(null).catch(() => {});
      reset(ctx);
      // D-604: only review types land in the Inbox.
      void captureIpc.savedShow(made.typeName, made.title, made.path, def.review === 'off' ? t('capture.savedTo', { plural: pluralOf(def) }) : undefined).catch(() => {});
      hide();
    } catch (e) {
      const kind = (e as { kind?: string } | null)?.kind;
      if (kind === 'VaultChanged') setStatus({ kind: 'vaultGone', vault: shownVault.current?.name ?? '' });
      else setStatus({ kind: 'failed' });
    } finally {
      saving.current = false;
    }
  };

  // ⌘↩ and Esc work wherever the focus is in the window (FR-CAP-01 AC-4), also after a menu closed.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      void escape();
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // 6A (FR-CAP-01 AC-12, D-624): a pasted image or PDF is staged (a pasted image is `Pasted image <local time>`).
  const onPaste = (e: React.ClipboardEvent) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) {
      e.preventDefault();
      void (async () => {
        for (const f of files) {
          const bytes = new Uint8Array(await f.arrayBuffer());
          const name = f.type.startsWith('image/') ? pastedImageName(localIso(Date.now()).slice(0, 19), EXT[f.type] ?? 'png') : f.name;
          took(await captureIpc.mediaBytes(bytes, name).catch(() => [{ error: 'Io', name: f.name }] as StagedMediaResultDto[]));
        }
      })();
    }
  };
  const took = (r: StagedMediaResultDto[]) => {
    const ok = r.flatMap((x) => ('ok' in x ? [x.ok] : []));
    const bad = r.flatMap((x) => ('error' in x ? [x.name] : []));
    if (ok.length) setStaged((l) => [...l, ...ok]);
    setRefused(bad);
  };
  const stagePaths = async (paths: string[]) => took(await captureIpc.mediaPaths(paths).catch(() => paths.map((p) => ({ error: 'Io', name: p.split('/').pop() ?? p }))));
  const pickFiles = async () => took(await captureIpc.mediaPick().catch(() => [] as StagedMediaResultDto[]));

  const statusText = status?.kind === 'nothing' ? t('capture.nothing') : status?.kind === 'failed' ? t('capture.failed')
    : status?.kind === 'vaultGone' ? t('capture.vaultGone', { vault: status.vault }) : '';

  /** After a menu closes, the next frame returns focus to `to`, unless the user has already focused something else
   *  (the closed menu leaves focus on the body). */
  const refocus = (to: () => void) => requestAnimationFrame(() => {
    const a = document.activeElement;
    if (!a || a === document.body) to();
  });

  const pickType = (key: string) => {
    setType(key);
    if (key !== 'task') { setDue(null); setPriority(null); }
    setMenu(null);
    refocus(() => typeRef.current?.focus());
  };

  const typeMenuKeys = (e: React.KeyboardEvent) => {
    const items = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(null); typeRef.current?.focus(); }
  };

  const today = localDate(Date.now());
  // D-603: `[[` / `@` suggestions at the caret.
  const trig = sugClosed === `${caret}:${text.length}` ? null : triggerAt(text, caret);
  const rows = useSuggestions(trig, today);
  const sugPos = (() => {
    const el = textRef.current;
    if (!el || !trig) return { left: 16, top: 40 };
    const probe = document.createElement('div');
    probe.className = 'capture-mirror';
    probe.style.visibility = 'hidden';
    probe.textContent = text.slice(0, trig.from);
    const mark = document.createElement('span');
    mark.textContent = '[';
    probe.appendChild(mark);
    el.parentElement!.appendChild(probe);
    const r = mark.getBoundingClientRect(), w = el.parentElement!.getBoundingClientRect();
    probe.remove();
    return { left: Math.max(8, Math.min(r.left - w.left, w.width - 280)), top: r.bottom - w.top - scroll + 4 };
  })();
  const pickSuggestion = (r: Row) => {
    if (!trig) return;
    const ins = insertion(r);
    const next = text.slice(0, trig.from) + ins + text.slice(caret);
    const at = trig.from + ins.length;
    setText(next);
    setCaret(at);
    setSugSel(0);
    requestAnimationFrame(() => { const el = textRef.current; if (el) { el.focus(); el.setSelectionRange(at, at); } });
  };
  const onSuggestKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!trig || rows.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSugSel((i) => (i + 1) % rows.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSugSel((i) => (i - 1 + rows.length) % rows.length); }
    else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); pickSuggestion(rows[Math.min(sugSel, rows.length - 1)]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSugClosed(`${caret}:${text.length}`); }
  };
  const dueText0 = due ? dueLabelOf(due, today, region() ?? navigator.language) : t('capture.noDate');
  const commitDue = () => {
    const p = parseRegionDate(dueText, region() ?? navigator.language);
    const v = p.ok ? p.value : null;
    if (v && typeof v === 'object' && 'date' in v) {
      setDue(v.date);
      setMoved((m) => ({ ...m, due: undefined }));
      setMenu(null);
      refocus(focusText);
    }
  };

  return (
    <div ref={rootRef} className="capture">
      <div className="capture-head" data-tauri-drag-region>
        <div className="capture-type">
          <button ref={typeRef} type="button" tabIndex={0} className="capture-type-btn" aria-haspopup="menu" aria-expanded={menu === 'type'}
            aria-label={t('capture.type', { name: typeDef?.name ?? '' })} onClick={() => setMenu(menu === 'type' ? null : 'type')}>
            <span className="capture-type-icon" style={typeDef?.color ? { color: `var(--type-${typeDef.color})` } : undefined}><Icon name={typeIconName(type, typeDef?.icon)} size={14} /></span>
            <span data-user-content>{typeDef?.name ?? ''}</span>
            <Icon name="chevron-down" size={11} />
          </button>
          {menu === 'type' && (
            <div role="menu" aria-label={t('capture.typeMenu')} className="capture-menu" onKeyDown={typeMenuKeys}
              ref={(el) => { if (el && !el.contains(document.activeElement)) el.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(); }}>
              {types.map((x) => {
                const desc = x.key === ctx?.defaultType ? t('capture.vaultDefault') : x.key === 'task' ? '⌃⌥T' : undefined;
                return (
                  <button key={x.key} type="button" role="menuitemradio" aria-checked={x.key === type} aria-label={x.name} aria-description={desc}
                    tabIndex={-1} className="capture-menu-item" onClick={() => pickType(x.key)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.metaKey) { e.preventDefault(); e.stopPropagation(); pickType(x.key); } }}>
                    <Icon name={typeIconName(x.key, x.icon)} size={14} />
                    <span data-user-content>{x.name}</span>
                    {desc && <span className="muted capture-menu-desc">{desc}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <span className="capture-spacer" />
        {vault && (
          <span className="capture-vault" title={t('capture.saves', { vault: vault.name })}>
            <span className="capture-vault-dot" aria-hidden="true" /><span className="sr-only">{t('capture.saves', { vault: vault.name })}</span><span aria-hidden="true" data-user-content>{vault.name}</span>
          </span>
        )}
        <button type="button" tabIndex={0} className="icon-button capture-discard" aria-label={t('capture.discard')} aria-description={t('capture.discardHint')} title={t('capture.discardHint')} onClick={() => void discard()}>
          <Icon name="x" size={13} />
        </button>
      </div>
      {/* D-592: the first non-empty line (the title, AP-467) is drawn bold by a mirror behind the transparent textarea,
          which stays the plain-text field (selection, IME, undo, accessibility). */}
      {/* The window fits its content (capture_resize): room for the suggestion list while it is open (D-603). */}
      <div className="capture-text-wrap" style={trig && rows.length ? { paddingBottom: Math.min(260, rows.length * 32 + 12) } : undefined}>
        <div className="capture-mirror" aria-hidden="true" data-user-content>
          <div style={{ transform: `translateY(${-scroll}px)` }}>{mirror(text)}</div>
        </div>
        <textarea ref={textRef} className="capture-text" aria-label={t('capture.text')} placeholder={t('capture.placeholder')} value={text}
          spellCheck rows={4} onChange={(e) => { onText(e.target.value); setCaret(e.target.selectionStart); }} onPaste={onPaste} onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)} onKeyDown={onSuggestKey}
          aria-autocomplete="list" aria-expanded={rows.length > 0} data-user-content />
        {trig && <SuggestList rows={rows} sel={Math.min(sugSel, rows.length - 1)} types={types} pos={sugPos} onPick={pickSuggestion} onHover={setSugSel} />}
      </div>
      {isTask && (
        <div className="capture-fields">
          <div className="capture-field">
            <button type="button" tabIndex={0} className={`capture-chip${menu === 'due' ? ' open' : ''}`} aria-haspopup="dialog" aria-expanded={menu === 'due'} aria-label={t('capture.due', { label: dueText0 })} onClick={() => { setDueText(due ?? ''); setMenu(menu === 'due' ? null : 'due'); }}>
              <span className={`capture-chip-icon due${due ? '' : ' none'}`}><Icon name="calendar" size={13} /></span><span className="muted">{t('capture.dueLabel')}</span> <span data-user-content className={due ? undefined : 'faint'}>{dueText0}</span>
            </button>
            {menu === 'due' && (
              // D-602: the calendar with quick picks; the typed field stays (D-537).
              <DueCalendar today={today} due={due} region={region() ?? navigator.language}
                field={<input type="text" aria-label={t('task.dueTitle')} value={dueText} autoFocus onChange={(e) => setDueText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.metaKey) { e.preventDefault(); e.stopPropagation(); commitDue(); } }} />}
                onPick={(d) => {
                  if (d === null) putBack(moved.due);
                  setMoved((m) => ({ ...m, due: undefined }));
                  setDue(d);
                  setMenu(null);
                  refocus(focusText);
                }}
                onClose={() => { setMenu(null); refocus(focusText); }} />
            )}
          </div>
          <div className="capture-field">
            <button type="button" tabIndex={0} className="capture-chip" aria-haspopup="menu" aria-label={t('capture.priority', { label: priority ?? t('capture.none') })} onClick={() => setMenu(menu === 'priority' ? null : 'priority')}>
              <span className="capture-chip-icon priority"><Icon name="flag" size={13} /></span><span className="muted">{t('capture.priorityLabel')}</span> <span data-user-content>{priority ?? t('capture.none')}</span>
            </button>
            {menu === 'priority' && (
              <div role="menu" aria-label={t('task.priority')} className="capture-menu">
                {[...priorityOptions(types.find((x) => x.key === 'task')), null].map((p) => (
                  <button key={p ?? '-'} type="button" role="menuitemradio" aria-checked={p === priority} className="capture-menu-item"
                    onClick={() => { if (p === null) putBack(moved.priority); setMoved((m) => ({ ...m, priority: undefined })); setPriority(p); setMenu(null); refocus(focusText); }}>
                    {p === null ? t('capture.noPriority') : <span data-user-content>{p}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      <TagField chips={chips} onChange={setChips} tags={(ctx?.tags ?? []).map((x) => x.name)} colors={Object.fromEntries((ctx?.tags ?? []).map((x) => [x.name.normalize('NFC').toLowerCase(), x.color]))} />
      <div className="capture-drop-row">
        {staged.map((m) => (
          <span key={m.token} className="capture-thumb" data-user-content>
            {m.mediaType.startsWith('image/') ? <img src={stagedUrl(m.token)} alt={m.name} /> : <Icon name="pdf" size={16} />}
            <span className="capture-thumb-name">{m.name}</span>
            <button type="button" tabIndex={0} className="icon-button small" aria-label={t('capture.removeMedia', { name: m.name })}
              onClick={() => setStaged((l) => l.filter((x) => x.token !== m.token))}><Icon name="x" size={10} /></button>
          </span>
        ))}
        <button type="button" tabIndex={0} className="capture-drop" aria-label={t('capture.drop')} onClick={() => void pickFiles()}>
          <Icon name="upload" size={14} /><span>{t('capture.drop')}</span>
        </button>
      </div>
      {refused.map((n) => <p key={n} className="capture-refused" role="status">{t('media.refused', { name: n })}</p>)}
      <div className="capture-foot">
        <span className="muted capture-hint">{typeDef && typeDef.review === 'off' ? t('capture.hintSaves', { plural: pluralOf(typeDef) }) : t('capture.hint')}</span>
        <span className="muted">{t('capture.newLine')}</span>
        <button type="button" tabIndex={0} className="primary capture-save" aria-label={t('capture.save')} aria-disabled={!vault || undefined}
          onClick={() => void save()}>{t('capture.saveShort')} <kbd aria-hidden="true">⌘↩</kbd></button>
      </div>
      <div role="status" aria-live="polite" aria-label={t('capture.status')} className="capture-status">
        {!vault ? (
          <>
            <span>{t('capture.noVault')}</span>
            <button type="button" tabIndex={0} onClick={() => void captureIpc.openMain(null)}>{t('capture.openTegg')}</button>
          </>
        ) : (
          <>
            {statusText && <span>{statusText}</span>}
            {status?.kind === 'failed' && <button type="button" tabIndex={0} onClick={() => void save()}>{t('capture.tryAgain')}</button>}
          </>
        )}
      </div>
    </div>
  );
}
