// The Inbox (docs/acceptance/inbox.md R60, R61; docs/contracts/ms5-capture.md §7; FR-INB-01…04, D-554…D-563): every
// object waiting for review, newest first in Today / Yesterday / Earlier this week / Older, filterable by type, with
// keyboard-first actions per card (mark reviewed, convert, append, link, tags, open) and on a selection (an `inbox`
// job). A card marked reviewed stays dimmed in place until the user leaves the page or changes the filter (D-556).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { CardText } from './CardText';
import { TagField } from '../capture/TagField';
import { firstDay } from '../i18n/dates';
import { collator, region as regionOf } from '../i18n/collate';
import { moveToTrash } from '../trash/moveToTrash';
import { t } from '../i18n/catalog';
import { events, ipc } from '../ipc/client';
import type { DateTimeUiDto, InboxRowDto, TypeDefDto } from '../ipc/types';
import { Icon, typeIconName } from '../shell/Icon';
import { useToday } from '../tasks/useTasks';
import { appZone, localIso } from '../zone';
import { appendItem, changeItem, linkTextFrom, type AppendTarget } from './actions';
import { DEFAULT_METRICS, cardTop, columns, windowOf, type Metrics } from './virtual';
import { inboxGroups, inboxOrder, type InboxGroup } from './bucket';
import { cardFooter, cardTags } from './card';
import { useTagLook } from '../tags/store';
import { moveNotes } from '../jobs/jobs';
import { ChangeTypeDialog, type TypeMovePlanDto } from '../types/ChangeTypeDialog';

const ORDER = ['page', 'task', 'quick-note', 'daily-note'];
const GROUPS: [InboxGroup, string][] = [['today', 'inbox.group.today'], ['yesterday', 'inbox.group.yesterday'], ['week', 'inbox.group.week'], ['older', 'inbox.group.older']];
const nfc = (s: string) => s.normalize('NFC');

/** The card to focus when the user comes back from an opened item (D-457 rule). */
let returnTo: string | null = null;
/** The rows last shown, so coming back draws the cards (and focuses one) before the fresh query returns. */
let lastRows: InboxRowDto[] | null = null;

type Alert = { id: number; text: string; retry?: () => void };
type Menu = { path: string; convert: boolean } | null;
type Picker = { verb: 'append' | 'link'; paths: string[] } | null;
type Job = { id: number; phase: string; count: number; label: string } | null;

export type InboxProps = {
  refresh: number;
  heading: RefObject<HTMLHeadingElement | null>;
  types: TypeDefDto[];
  filter: string;
  onFilter: (f: string) => void;
  dateTime?: DateTimeUiDto;
  nav: { openNote: (path: string) => void; openDay: (date: string) => void; capture: (kind: 'default' | 'task') => void; today: () => void };
  commandRef: MutableRefObject<((id: string) => void) | null>;
};

export function InboxPage({ refresh, heading, types, filter, onFilter, dateTime, nav, commandRef }: InboxProps) {
  const look = useTagLook();
  const [rows, setRows] = useState<InboxRowDto[] | null>(() => (returnTo ? lastRows : null));
  const [kept, setKept] = useState<Map<string, InboxRowDto>>(new Map());
  const [selection, setSelection] = useState<string[]>([]);
  const [menu, setMenu] = useState<Menu>(null);
  const [picker, setPicker] = useState<Picker>(null);
  const [tagging, setTagging] = useState<string[] | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [bulkConvert, setBulkConvert] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [live, setLive] = useState('');
  const [job, setJob] = useState<Job>(null);
  const focused = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const alertSeq = useRef(0);
  const { today, zone } = useToday();
  const regionTag = regionOf() ?? navigator.language;
  const z = zone ?? appZone();

  const load = useCallback(async () => {
    const r = await ipc.inboxList().catch(() => null);
    if (r) { lastRows = r; setRows(r); }
  }, []);
  useEffect(() => { void load(); }, [refresh, load]);

  const typeOf = (key: string) => types.find((x) => nfc(x.key) === nfc(key));
  const typeName = (key: string) => typeOf(key)?.name ?? key;
  const say = (text: string) => { setLive(''); requestAnimationFrame(() => setLive(text)); };
  const alert = (text: string, retry?: () => void) => setAlerts((a) => [...a, { id: ++alertSeq.current, text, retry }]);
  const dismiss = (id: number) => setAlerts((a) => a.filter((x) => x.id !== id));

  // Members, plus the cards marked reviewed on this page (dimmed in place, D-556).
  const members = rows ?? [];
  const memberPaths = new Set(members.map((r) => nfc(r.path)));
  const all = [...members, ...[...kept.values()].filter((r) => !memberPaths.has(nfc(r.path)))];
  const reviewedHere = (p: string) => kept.has(nfc(p)) && !memberPaths.has(nfc(p));
  const counts = new Map<string, number>();
  for (const r of members) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
  const filterKeys = useMemo(() => {
    const keys = [...counts.keys()];
    const head = ORDER.filter((k) => keys.includes(k));
    const rest = keys.filter((k) => !ORDER.includes(k)).sort((a, b) => collator().compare(typeOf(a)?.plural ?? a, typeOf(b)?.plural ?? b));
    return [...head, ...rest];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, types]);
  const active = filter;
  const shown = active === 'all' ? all : all.filter((r) => r.type === active);
  const ordered = inboxOrder(shown, z, collator());
  const groups = inboxGroups(ordered, today, firstDay(dateTime, regionTag), z);
  const flat = GROUPS.flatMap(([g]) => groups[g]);
  const shownMembers = shown.filter((r) => memberPaths.has(nfc(r.path)));

  const setFilter = (f: string) => {
    setKept(new Map());
    setSelection([]);
    onFilter(f);
  };

  // ------------------------------------------------------------------------------------------------ the card window
  // D-586 (FR-INB-01 AC-12): only the cards around the viewport are in the page (virtual.ts); cards have a fixed height,
  // so a card outside the window is brought in by scrolling to its exact place before it is focused.
  const sizes = GROUPS.map(([g]) => groups[g].length);
  const [metrics, setMetrics] = useState<Metrics>(DEFAULT_METRICS);
  const [view, setView] = useState({ top: 0, height: 900, width: 1000 });
  const pendingFocus = useRef<string | null>(null);
  const scroller = () => (listRef.current?.closest('main') as HTMLElement | null) ?? null;
  const listTop = (list: HTMLElement, main: HTMLElement) => list.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
  const measureView = useCallback(() => {
    const list = listRef.current;
    const main = scroller();
    if (!list || !main) return;
    const next = { top: Math.round(main.scrollTop - listTop(list, main)), height: main.clientHeight, width: list.clientWidth };
    setView((v) => (v.top === next.top && v.height === next.height && v.width === next.width ? v : next));
  }, []);
  useEffect(() => {
    const main = scroller();
    if (!main) return;
    let frame = 0;
    const on = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measureView(); }); };
    main.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(on);
    if (listRef.current) ro?.observe(listRef.current);
    measureView();
    return () => { main.removeEventListener('scroll', on); window.removeEventListener('resize', on); ro?.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [rows !== null, measureView]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    // The real sizes of a rendered card, the gap and a group heading (fixed by styles.css).
    const list = listRef.current;
    const art = list?.querySelector<HTMLElement>('article.inbox-card');
    const sec = art?.closest<HTMLElement>('.inbox-group');
    const grid = art?.parentElement;
    if (art && sec && grid) {
      const gap = parseFloat(getComputedStyle(grid).rowGap) || DEFAULT_METRICS.gap;
      const next = { card: art.offsetHeight, gap, head: sec.offsetHeight - grid.offsetHeight, minCol: DEFAULT_METRICS.minCol };
      if (next.card > 0 && (Math.abs(next.card - metrics.card) > 0.5 || Math.abs(next.gap - metrics.gap) > 0.5 || Math.abs(next.head - metrics.head) > 0.5)) setMetrics(next);
    }
    const p = pendingFocus.current;
    if (p) {
      const el = cardEl(p);
      if (el) { pendingFocus.current = null; el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }); }
    }
  });
  const cols = columns(view.width, metrics);
  const slices = windowOf(sizes, cols, metrics, view.top, view.height);

  const cardEl = (p: string) => listRef.current?.querySelector<HTMLElement>(`article[data-path="${CSS.escape(nfc(p))}"]`) ?? null;
  /** Focuses the card of `p`, first scrolling it into the window when it isn't rendered (D-586). */
  const focusPath = (p: string) => {
    const el = cardEl(p);
    if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }); return; }
    const i = flat.findIndex((x) => nfc(x.path) === nfc(p));
    const list = listRef.current;
    const main = scroller();
    if (i < 0 || !list || !main) return;
    pendingFocus.current = nfc(p);
    main.scrollTop = Math.max(0, listTop(list, main) + cardTop(sizes, cols, metrics, i) - Math.max(0, (main.clientHeight - metrics.card) / 2));
    measureView();
  };
  const focusCard = (p: string | null) => { if (p) requestAnimationFrame(() => focusPath(p)); };

  // Focus the card the user came back to (FR-INB-01 AC-6).
  useLayoutEffect(() => {
    if (!rows || !returnTo) return;
    const p = returnTo;
    returnTo = null;
    focusPath(p);
    // Again after the app's own post-navigation focus (the heading) has run.
    requestAnimationFrame(() => { if (!document.activeElement?.closest('[data-path]')) focusPath(p); setTimeout(() => { if (!document.activeElement?.closest('[data-path]')) focusPath(p); }, 120); });
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (r: InboxRowDto) => {
    returnTo = nfc(r.path);
    if (r.type === 'daily-note' && /^\d{4}-\d{2}-\d{2}$/.test(r.title)) nav.openDay(r.title);
    else nav.openNote(r.path);
  };

  // ------------------------------------------------------------------------------------------------ writes

  const outcomeAlert = (r: InboxRowDto, reason: string, retry: () => void) => {
    if (reason === 'conflict') {
      alert(t('inbox.changedOutside', { title: r.title }));
      void load();
    } else if (reason === 'readOnly') alert(t('inbox.readOnly'));
    else alert(t('inbox.saveFailed', { title: r.title }), retry);
  };

  const setReviewed = async (r: InboxRowDto, value: 'reviewed' | 'unreviewed', base: 'row' | 'current' = 'row') => {
    if (r.readOnly) return;
    const now = localIso(Date.now());
    const res = await changeItem(r.path, base === 'row' ? r.version : 'current', { op: 'set-review', value, now });
    if (!res.ok) return outcomeAlert(r, res.reason, () => void setReviewed(r, value, 'current'));
    const next = { ...r, reviewRaw: value, ...('version' in res ? { version: res.version } : {}) };
    setKept((m) => new Map(m).set(nfc(r.path), next));
    setRows((rs) => (rs ?? []).map((x) => (nfc(x.path) === nfc(r.path) ? next : x)).filter((x) => nfc(x.path) !== nfc(r.path) || value === 'unreviewed' || !isMember(x)));
    say(t(value === 'reviewed' ? 'inbox.done.reviewed' : 'inbox.done.unreviewed', { title: r.title }));
    void load();
  };
  const isMember = (r: InboxRowDto) => r.reviewRaw === 'unreviewed' || ((r.type === 'quick-note' || r.type === 'daily-note') && r.reviewRaw !== 'reviewed');

  // 4E-1 (D-803, D-804, D-813): a convert is a `type-move` job with `review: reviewed`; the mapping dialog first when a
  // property needs an answer; a bulk convert asks once for the type pair.
  const [mapping, setMapping] = useState<{ plan: TypeMovePlanDto; names: Record<string, string>; key: string; fromName: string; go: (m: { from: string; to: string }[]) => void } | null>(null);
  const withMapping = async (paths: string[], key: string, fromKey: string, go: (m: { from: string; to: string }[]) => void) => {
    const plan = await ipc.typeMovePlan(paths, key).catch(() => null);
    if (plan?.needsDialog) setMapping({ plan: { rows: plan.rows, needsDialog: true }, names: plan.targetNames, key, fromName: typeName(fromKey), go });
    else go([]);
  };
  const convert = async (r: InboxRowDto, key: string) => {
    setMenu(null);
    if (r.readOnly || r.type === 'daily-note') return;
    await withMapping([r.path], key, r.type, (m) => {
      void moveNotes([r.path], key, typeName(key), m, true, (rep) => {
        if (!rep || rep.phase !== 'done' || rep.skipped.length) { alert(t('inbox.saveFailed', { title: r.title })); void load(); return; }
        setKept((x) => new Map(x).set(nfc(rep.renamed?.to ?? r.path), { ...r, path: rep.renamed?.to ?? r.path, type: key, reviewRaw: 'reviewed' }));
        say(t('inbox.done.converted', { title: r.title, type: typeName(key) }));
        void load();
      }).catch(() => alert(t('inbox.saveFailed', { title: r.title })));
    });
  };
  const convertMany = async (paths: string[], key: string, label: string) => {
    const editable = paths.filter((p) => !rowOf(p)?.readOnly);
    if (editable.length === 0) return;
    await withMapping(editable, key, rowOf(editable[0])?.type ?? 'page', (m) => {
      setSelection([]);
      void moveNotes(editable, key, label, m, true, (rep) => {
        if (rep && rep.written.length > 0) say(t('inbox.done.many', { count: rep.moved?.length || rep.written.length }));
        void load();
      }).catch(() => alert(t('inbox.saveFailed', { title: label })));
    });
  };

  const rowOf = (p: string) => all.find((r) => nfc(r.path) === nfc(p));

  const runBulk = async (paths: string[], change: Record<string, unknown>, label: string) => {
    const editable = paths.filter((p) => !rowOf(p)?.readOnly);
    const ro = paths.length - editable.length;
    if (editable.length === 0) return;
    try {
      const { jobId } = await ipc.inboxBulk(editable, change);
      setSelection([]);
      setJob({ id: jobId, phase: 'queued', count: editable.length, label });
      if (ro > 0) alert(t('inbox.skipped', { count: ro }));
    } catch {
      alert(t('inbox.saveFailed', { title: label }));
    }
  };

  // The `inbox` job: its status, and its result when it ends (FR-INB-02 AC-12).
  useEffect(() => {
    if (!job) return;
    const off = events.jobProgress((p) => {
      if (p.jobId !== job.id) return;
      setJob((j) => (j && j.id === p.jobId ? { ...j, phase: p.phase } : j));
      if (p.phase === 'done' || p.phase === 'failed' || p.phase === 'cancelled') {
        void ipc.jobReport(p.jobId).then((rep) => {
          setJob(null);
          if (!rep) return;
          if (rep.written.length > 0) say(t('inbox.done.many', { count: rep.written.length }));
          const changed = rep.skipped.filter((s) => s.reason === 'changed' || s.reason === 'readOnly').length;
          if (changed > 0) alert(t('inbox.skipped', { count: changed }));
          void load();
        });
      }
    });
    return () => { void off.then((f) => f()); };
  }, [job?.id, load]); // eslint-disable-line react-hooks/exhaustive-deps

  // `keep` false (Mark all reviewed, FR-INB-02 AC-13): the confirmed items and the cards already dimmed on this page
  // leave when the job ends, so the empty state shows; D-556's dimmed-in-place card is for actions on chosen cards.
  const bulkReview = (paths: string[], value: 'reviewed' | 'unreviewed', keep = true) => {
    const now = localIso(Date.now());
    if (keep) for (const p of paths) { const r = rowOf(p); if (r && !r.readOnly) setKept((m) => new Map(m).set(nfc(p), { ...r, reviewRaw: value })); }
    else setKept(new Map());
    void runBulk(paths, { op: 'set-review', value, now }, String(paths.length));
  };

  const append = async (paths: string[], target: AppendTarget) => {
    setPicker(null);
    for (const p of paths) {
      const r = rowOf(p);
      if (!r || r.readOnly) continue;
      const res = await appendItem(r, target, localIso(Date.now()));
      if (!res.ok) {
        if (res.reason === 'targetConflict') { alert(t('inbox.changedOutside', { title: res.target })); break; }
        if (res.reason === 'itemConflict') { alert(t('inbox.changedOutside', { title: r.title })); continue; }
        if (res.reason === 'itemFailed') { alert(t('inbox.saveFailed', { title: r.title }), () => void setReviewed(r, 'reviewed', 'current')); continue; }
        alert(t('inbox.saveFailed', { title: res.target }));
        break;
      }
      setKept((m) => new Map(m).set(nfc(r.path), { ...r, reviewRaw: 'reviewed' }));
      say(t('inbox.done.appended', { title: r.title, target: res.target }));
    }
    focusCard(paths[0]);
    void load();
  };

  const link = async (paths: string[], target: { path: string; title: string }) => {
    setPicker(null);
    const now = localIso(Date.now());
    // D-573: several items are one `inbox` job; each file gets the D-184 text of the target from its own folder.
    if (paths.length > 1) return void runBulk(paths, { op: 'append-link-to', path: target.path, title: target.title, now }, target.title);
    const texts = await Promise.all(paths.map((p) => linkTextFrom(p, target)));
    for (let i = 0; i < paths.length; i++) {
      const r = rowOf(paths[i]);
      if (!r || r.readOnly) continue;
      const res = await changeItem(r.path, r.version, { op: 'append-link', target: texts[i], now });
      if (!res.ok) { outcomeAlert(r, res.reason, () => void link([r.path], target)); continue; }
      say(t('inbox.done.linked', { title: r.title, target: target.title }));
    }
    focusCard(paths[0]);
    void load();
  };

  const addTags = async (paths: string[], tags: string[]) => {
    setTagging(null);
    if (tags.length === 0) return;
    const now = localIso(Date.now());
    if (paths.length > 1) return void runBulk(paths, { op: 'add-tags', tags, now }, String(paths.length));
    const r = rowOf(paths[0]);
    if (!r || r.readOnly) return;
    const res = await changeItem(r.path, r.version, { op: 'add-tags', tags, now });
    if (!res.ok) return outcomeAlert(r, res.reason, () => void addTags(paths, tags));
    focusCard(r.path);
    void load();
  };

  // ------------------------------------------------------------------------------------------------ commands

  const targets = (current: string | null) => {
    const first = ['page', 'task', 'quick-note'].map(typeOf).filter((x): x is TypeDefDto => !!x && !x.invalid);
    const user = types.filter((x) => !x.system && !x.invalid).sort((a, b) => collator().compare(a.name, b.name));
    return [...first, ...user].filter((x) => x.key !== current);
  };
  const subject = () => (selection.length > 0 ? selection : focused.current ? [focused.current] : []);

  commandRef.current = (id: string) => {
    const paths = subject();
    if (id === 'inbox.showAll') return setFilter('all');
    if (id === 'inbox.markAll') return setConfirmAll(true);
    if (id === 'inbox.selectAll') return setSelection(flat.map((r) => nfc(r.path)));
    if (id === 'inbox.clearSelection') return setSelection([]);
    if (paths.length === 0) return;
    if (id === 'inbox.markReviewed' || id === 'inbox.markUnreviewed') {
      const v = id === 'inbox.markReviewed' ? 'reviewed' : 'unreviewed';
      if (paths.length > 1) bulkReview(paths, v);
      else { const r = rowOf(paths[0]); if (r) void setReviewed(r, v); }
    } else if (id === 'inbox.convert') {
      if (paths.length > 1) setBulkConvert(true);
      else setMenu({ path: paths[0], convert: true });
    } else if (id === 'inbox.append') setPicker({ verb: 'append', paths });
    else if (id === 'inbox.link') setPicker({ verb: 'link', paths });
    else if (id === 'inbox.tags') setTagging(paths);
    else if (id === 'inbox.trash') void trash(paths);
  };

  /** 6A (FR-INB-02 AC-10, FR-HIS-01 AC-3; D-620): one rename per item, the toast with Undo; read-only items are left. */
  const trash = async (paths: string[]) => {
    const rows = paths.map(rowOf).filter((r): r is InboxRowDto => !!r && !r.readOnly);
    if (!rows.length) return;
    setSelection([]);
    await moveToTrash(rows.map((r) => ({ path: r.path, base: r.version, title: r.title })), { onUndone: () => void load() });
    void load();
  };

  const onCardKey = (e: React.KeyboardEvent<HTMLElement>, r: InboxRowDto) => {
    if (e.target !== e.currentTarget) return;
    const p = nfc(r.path);
    const i = flat.findIndex((x) => nfc(x.path) === p);
    const move = (d: number) => {
      const next = flat[i + d];
      if (!next) return;
      if (e.shiftKey) setSelection((s) => [...new Set([...s, p, nfc(next.path)])]);
      focusPath(next.path);
    };
    const key = e.key;
    if (key === 'ArrowDown' || key === 'ArrowRight') { e.preventDefault(); move(1); }
    else if (key === 'ArrowUp' || key === 'ArrowLeft') { e.preventDefault(); move(-1); }
    else if (key === 'Enter') { e.preventDefault(); open(r); }
    else if (key === ' ') { e.preventDefault(); setSelection((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p])); }
    else if (key === 'Escape') { if (selection.length) { e.preventDefault(); setSelection([]); } }
    else if (key === 'a' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setSelection(flat.map((x) => nfc(x.path))); }
    else if (e.metaKey || e.ctrlKey || e.altKey) return;
    else if (key === 'r' || key === 'R') {
      e.preventDefault();
      if (selection.length > 1) bulkReview(selection, 'reviewed');
      else void setReviewed(r, isReviewed(r) ? 'unreviewed' : 'reviewed');
    } else if (key === 'c' || key === 'C') { e.preventDefault(); commandRef.current?.('inbox.convert'); }
    else if (key === 'a' || key === 'A') { e.preventDefault(); setPicker({ verb: 'append', paths: subject() }); }
    else if (key === 'l' || key === 'L') { e.preventDefault(); setPicker({ verb: 'link', paths: subject() }); }
    else if (key === '#') { e.preventDefault(); setTagging(subject()); }
    else if (key === 'Backspace' || key === 'Delete') { e.preventDefault(); void trash(subject()); } // 6A (FR-INB-02 AC-10)
  };
  const isReviewed = (r: InboxRowDto) => reviewedHere(r.path) || r.reviewRaw === 'reviewed';

  // ------------------------------------------------------------------------------------------------ render

  const summary = active === 'all' ? t('inbox.summary', { count: members.length }) : t('inbox.summaryFiltered', { shown: shownMembers.length, count: members.length });
  const filtered = active !== 'all' && shown.length === 0;

  const card = (r: InboxRowDto, index: number) => {
    const p = nfc(r.path);
    const reviewed = isReviewed(r);
    const selected = selection.includes(p);
    const tags = cardTags(r.tags);
    const footer = cardFooter(r, z, dateTime);
    return (
      <article key={p} tabIndex={0} aria-label={t('inbox.card', { type: typeName(r.type), title: r.title })} data-path={p}
        aria-setsize={flat.length} aria-posinset={index + 1}
        data-review={reviewed ? 'reviewed' : 'unreviewed'} data-selected={selected || undefined}
        className={`inbox-card${reviewed ? ' reviewed' : ''}${selected ? ' selected' : ''}`}
        onFocus={(e) => { if (e.target === e.currentTarget) focused.current = p; }} onKeyDown={(e) => onCardKey(e, r)}>
        <div className="inbox-card-head">
          {selection.length > 0 && (
            <input type="checkbox" data-command="inbox.select" aria-label={t('inbox.select', { title: r.title })} checked={selected}
              onChange={() => setSelection((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]))} />
          )}
          <Icon name={typeIconName(r.type, typeOf(r.type)?.icon)} size={14} />
          <span className="inbox-card-type" aria-hidden="true" data-user-content>{typeName(r.type)}</span>
          <button type="button" tabIndex={0} className="icon-button inbox-triage" aria-haspopup="menu" data-command="inbox.triage" aria-label={t('inbox.triage', { title: r.title })}
            onClick={() => setMenu({ path: p, convert: false })}><Icon name="more-horizontal" size={14} /></button>
        </div>
        <a href="#" className="inbox-card-title" data-command="inbox.open" onClick={(e) => { e.preventDefault(); open(r); }} data-user-content>{r.title}</a>
        {(tags.shown.length > 0 || tags.more > 0) && (
          <div className="inbox-card-tags">
            {tags.shown.map((x) => <span key={x} className="tag-chip" style={look(x).style} data-user-content>#{look(x).name}</span>)}
            {tags.more > 0 && <span className="muted">+{tags.more}</span>}
          </div>
        )}
        <CardText path={r.path} version={r.version} excerpt={r.excerpt} />
        <div className="inbox-card-foot">
          {footer && <span className="muted">{footer}</span>}
          <label className="inbox-reviewed">
            <input type="checkbox" checked={reviewed} data-command="inbox.markReviewed" aria-label={t('inbox.reviewed')}
              aria-disabled={r.readOnly || undefined} aria-description={r.readOnly ? t('inbox.readOnly') : undefined}
              onChange={() => { if (!r.readOnly) void setReviewed(r, reviewed ? 'unreviewed' : 'reviewed'); }} />
            <span>{t('inbox.reviewed')}</span>
          </label>
        </div>
      </article>
    );
  };

  return (
    <div className="page-column inbox-page">
      {mapping && (
        <ChangeTypeDialog plan={mapping.plan} fromName={mapping.fromName} toName={typeName(mapping.key)} targetNames={mapping.names}
          onCancel={() => setMapping(null)} onConfirm={(m) => { const x = mapping; setMapping(null); x.go(m); }} />
      )}
      <div className="inbox-header">
        <h1 ref={heading} tabIndex={-1}>{t('inbox.title')}</h1>
        {rows && members.length + kept.size > 0 && (
          <>
            <p className="inbox-summary">{summary}</p>
            <button type="button" tabIndex={0} className="inbox-mark-all" data-command="inbox.markAll" onClick={() => setConfirmAll(true)}>{t('inbox.markAll')}</button>
          </>
        )}
      </div>
      {rows && all.length === 0 ? (
        <section role="region" aria-label={t('inbox.zero')} className="inbox-zero">
          <h2>{t('inbox.zero')}</h2>
          <p>{t('inbox.zeroText')}</p>
          <div className="inbox-zero-actions">
            <button type="button" tabIndex={0} data-command="capture.quick" aria-label={t('inbox.zeroCapture')} aria-keyshortcuts="Control+Alt+Space" onClick={() => nav.capture('default')}>{t('inbox.zeroCapture')} <kbd aria-hidden="true">{t('shortcut.keys', { keys: '⌃⌥Space' })}</kbd></button>
            <button type="button" tabIndex={0} data-command="daily.today" aria-label={t('inbox.zeroToday')} aria-keyshortcuts="Meta+D" onClick={nav.today}>{t('inbox.zeroToday')} <kbd aria-hidden="true">{t('shortcut.keys', { keys: '⌘D' })}</kbd></button>
          </div>
        </section>
      ) : rows && (
        <>
          <div className="inbox-toolbar">
            <div role="group" aria-label={t('inbox.filter')} className="inbox-filter">
              {['all', ...filterKeys].map((k) => (
                <button key={k} type="button" tabIndex={0} data-type={k} aria-pressed={active === k} data-command="inbox.filter" className={`toggle${active === k ? ' on' : ''}`}
                  aria-label={k === 'all' ? t('inbox.filter.all') : typeOf(k)?.plural ?? k}
                  aria-description={String(k === 'all' ? members.length : counts.get(k) ?? 0)} onClick={() => setFilter(k)}>
                  {k === 'all' ? t('inbox.filter.all') : <span data-user-content>{typeOf(k)?.plural ?? k}</span>} <span className="count">{k === 'all' ? members.length : counts.get(k) ?? 0}</span>
                </button>
              ))}
            </div>
            <span className="muted inbox-order">{t('inbox.order')}</span>
          </div>
          {alerts.length > 0 && (
            <div className="task-alerts">
              {alerts.map((a) => (
                <div key={a.id} role="alert" className="task-alert">
                  <span>{a.text}</span>
                  {a.retry && <button type="button" tabIndex={0} data-command="inbox.tryAgain" onClick={() => { dismiss(a.id); a.retry!(); }}>{t('capture.tryAgain')}</button>}
                  <button type="button" tabIndex={0} className="icon-button" data-command="inbox.dismissAlert" aria-label={t('dialog.close')} onClick={() => dismiss(a.id)}>×</button>
                </div>
              ))}
            </div>
          )}
          {selection.length > 0 && (
            <div role="toolbar" aria-label={t('inbox.selected', { count: selection.length })} className="inbox-selection">
              <button type="button" tabIndex={0} data-command="inbox.markReviewed" onClick={() => bulkReview(selection, 'reviewed')}>{t('inbox.markReviewed')}</button>
              <button type="button" tabIndex={0} data-command="inbox.markUnreviewed" onClick={() => bulkReview(selection, 'unreviewed')}>{t('inbox.markUnreviewed')}</button>
              <span className="inbox-bulk-convert">
                <button type="button" tabIndex={0} aria-haspopup="menu" data-command="inbox.convert" onClick={() => setBulkConvert((v) => !v)}>{t('cmd.inbox.convert')}</button>
                {bulkConvert && (
                  <div role="menu" aria-label={t('inbox.convertTo')} className="capture-menu">
                    {targets(null).map((x) => (
                      <button key={x.key} type="button" role="menuitem" tabIndex={-1} className="capture-menu-item" onClick={() => {
                        setBulkConvert(false);
                        void convertMany(selection.filter((p) => rowOf(p)?.type !== 'daily-note'), x.key, x.name);
                      }}><span data-user-content>{x.name}</span></button>
                    ))}
                  </div>
                )}
              </span>
              <button type="button" tabIndex={0} data-command="inbox.append" onClick={() => setPicker({ verb: 'append', paths: selection })}>{t('inbox.append')}</button>
              <button type="button" tabIndex={0} data-command="inbox.link" onClick={() => setPicker({ verb: 'link', paths: selection })}>{t('inbox.link')}</button>
              <button type="button" tabIndex={0} data-command="inbox.tags" onClick={() => setTagging(selection)}>{t('inbox.addTags')}</button>
              <button type="button" tabIndex={0} data-command="inbox.trash" onClick={() => void trash(selection)}>{t('inbox.trash')}</button>
              <button type="button" tabIndex={0} data-command="inbox.clearSelection" onClick={() => setSelection([])}>{t('inbox.clearSelection')}</button>
            </div>
          )}
          {filtered ? (
            <p className="inbox-filtered-empty">
              <span>{t('inbox.filteredEmpty', { plural: typeOf(active)?.plural ?? active })}</span>
              <button type="button" tabIndex={0} data-command="inbox.showAll" onClick={() => setFilter('all')}>{t('inbox.showAll')}</button>
            </p>
          ) : (
            <div ref={listRef} className="inbox-groups">
              {GROUPS.map(([g, label], gi) => {
                const items = groups[g];
                if (items.length === 0) return null;
                const sl = slices[gi];
                if (sl.toRow <= sl.fromRow) return <div key={g} aria-hidden="true" className="inbox-group-spacer" style={{ height: sl.height }} />;
                const offset = sizes.slice(0, gi).reduce((a, b) => a + b, 0);
                const from = sl.fromRow * cols;
                return (
                  <section key={g} role="region" aria-labelledby={`inbox-group-${g}`} data-group={g} className="inbox-group">
                    <h2 id={`inbox-group-${g}`}>{t(label)}</h2>
                    <div className="inbox-cards" style={{ paddingTop: sl.top, paddingBottom: sl.bottom }}>
                      {items.slice(from, sl.toRow * cols).map((r, k) => card(r, offset + from + k))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
          <p className="muted inbox-keys">{t('inbox.keys')}</p>
        </>
      )}
      <div role="status" className="sr-live" aria-live="polite">{live}</div>
      {job && (
        <div role="status" className="job-status inbox-job">
          <span>{t('inbox.job.running', { count: job.count })}</span>
          {(job.phase === 'queued' || job.phase === 'planning' || job.phase === 'backup') && (
            <button type="button" tabIndex={0} data-command="job.cancel" onClick={() => void ipc.jobCancel(job.id)}>{t('job.rename.cancel')}</button>
          )}
        </div>
      )}
      {menu && rowOf(menu.path) && (
        <TriageMenu row={rowOf(menu.path)!} convertFirst={menu.convert} targets={targets(rowOf(menu.path)!.type)}
          onClose={() => { const p = menu.path; cardEl(p)?.focus(); setMenu(null); }}
          onConvert={(k) => void convert(rowOf(menu.path)!, k)}
          onAppend={() => { const p = menu.path; setMenu(null); setPicker({ verb: 'append', paths: [p] }); }}
          onLink={() => { const p = menu.path; setMenu(null); setPicker({ verb: 'link', paths: [p] }); }}
          onTags={() => { const p = menu.path; setMenu(null); setTagging([p]); }}
          onTrash={() => { const p = menu.path; setMenu(null); void trash([p]); }}
          onOpen={() => { const r = rowOf(menu.path)!; setMenu(null); open(r); }} />
      )}
      {picker && (
        <ObjectPicker verb={picker.verb} title={picker.paths.length === 1 ? rowOf(picker.paths[0])?.title ?? '' : t('inbox.selected', { count: picker.paths.length })}
          exclude={picker.paths} today={today} typeLabel={typeName}
          onClose={() => { const p = picker.paths[0]; cardEl(p)?.focus(); setPicker(null); }}
          onPick={(target) => (picker.verb === 'append' ? void append(picker.paths, target) : target.kind === 'note' ? void link(picker.paths, target) : undefined)} />
      )}
      {tagging && <TagDialog onApply={(tags) => void addTags(tagging, tags)} onClose={() => { const p = tagging[0]; cardEl(p)?.focus(); setTagging(null); }} />}
      {confirmAll && (
        <div className="modal-backdrop">
          <div role="alertdialog" aria-modal="true" aria-label={t('inbox.markAllConfirm', { count: shownMembers.length })} className="dialog"
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setConfirmAll(false); } }}>
            <p>{t('inbox.markAllConfirm', { count: shownMembers.length })}</p>
            <div className="dialog-buttons">
              <button type="button" tabIndex={0} className="primary" autoFocus data-command="inbox.markAll" onClick={() => { setConfirmAll(false); bulkReview(shownMembers.map((r) => nfc(r.path)), 'reviewed', false); }}>{t('inbox.markAllOk')}</button>
              <button type="button" tabIndex={0} data-command="inbox.cancel" onClick={() => setConfirmAll(false)}>{t('conflicts.cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ triage menu (R60)

function TriageMenu({ row, convertFirst, targets, onClose, onConvert, onAppend, onLink, onTags, onTrash, onOpen }: {
  row: InboxRowDto; convertFirst: boolean; targets: TypeDefDto[]; onClose: () => void; onConvert: (key: string) => void;
  onAppend: () => void; onLink: () => void; onTags: () => void; onTrash: () => void; onOpen: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const daily = row.type === 'daily-note';
  const off = row.readOnly;
  useEffect(() => {
    const items = ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    (items?.[0])?.focus();
  }, [convertFirst]);
  const keys = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (/^[1-9]$/.test(e.key) && !daily && !off) {
      const x = targets[Number(e.key) - 1];
      if (x) { e.preventDefault(); onConvert(x.key); }
    }
  };
  const item = (label: string, run: () => void, disabled?: string) => (
    <button type="button" role="menuitem" tabIndex={-1} className="capture-menu-item" aria-disabled={disabled ? true : undefined} aria-description={disabled}
      onClick={() => { if (!disabled) run(); }}>{label}</button>
  );
  return (
    <div className="modal-backdrop transparent" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="menu" aria-label={t('inbox.triageMenu')} className="capture-menu inbox-menu" onKeyDown={keys}>
        <div role="group" aria-label={t('inbox.convertTo')}>
          {targets.map((x, i) => (
            <button key={x.key} type="button" role="menuitem" tabIndex={-1} className="capture-menu-item" aria-keyshortcuts={String(i + 1)}
              aria-disabled={daily || off ? true : undefined} aria-description={daily ? t('inbox.dailyNoType') : off ? t('inbox.readOnly') : undefined}
              onClick={() => { if (!daily && !off) onConvert(x.key); }}>
              <span data-user-content>{x.name}</span><kbd aria-hidden="true">{i + 1}</kbd>
            </button>
          ))}
        </div>
        {item(t('inbox.append'), onAppend, off ? t('inbox.readOnly') : undefined)}
        {item(t('inbox.link'), onLink, off ? t('inbox.readOnly') : undefined)}
        {item(t('inbox.addTags'), onTags, off ? t('inbox.readOnly') : undefined)}
        {item(t('inbox.trash'), onTrash, row.readOnly ? t('inbox.readOnly') : undefined)}
        {item(t('inbox.open'), onOpen)}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ pickers (R60)

function ObjectPicker({ verb, title, exclude, today, typeLabel, onClose, onPick }: {
  verb: 'append' | 'link'; title: string; exclude: string[]; today: string; typeLabel: (key: string) => string; onClose: () => void; onPick: (t: AppendTarget) => void;
}) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<{ path: string; title: string; type: string }[]>([]);
  const [active, setActive] = useState(0);
  /** The query the shown options belong to; ↩ before the current query's results arrive waits for them, so it never
   *  picks a row of an older query (an Append can't be undone, AC-15). */
  const [shownFor, setShownFor] = useState<string | null>(null);
  const enterPending = useRef(false);
  type Option = { kind: 'today' } | { kind: 'note'; path: string; title: string; type: string };
  const optionsOf = (found: { path: string; title: string; type: string }[]): Option[] => [
    ...(verb === 'append' ? [{ kind: 'today' as const }] : []),
    ...found.map((x) => ({ kind: 'note' as const, ...x })),
  ];
  const choose = (o: Option) => onPick(o.kind === 'today' ? { kind: 'today', date: today } : { kind: 'note', path: o.path, title: o.title });
  useEffect(() => {
    let live = true;
    void ipc.switcher(q, 30).then((rs) => {
      if (!live) return;
      const ex = new Set(exclude.map(nfc));
      const found = rs.filter((r) => r.kind === 'object' && r.path && !ex.has(nfc(r.path)) && !r.path.startsWith('_templates/') && !r.path.startsWith('.trash/'))
        .map((r) => ({ path: r.path!, title: r.title, type: r.type }));
      setItems(found);
      setShownFor(q);
      // Append lists Today's note first (R60); with a query, ↩ takes the best match, so the highlight starts on it.
      const first = verb === 'append' && q.trim() !== '' && found.length > 0 ? 1 : 0;
      setActive(first);
      if (enterPending.current) {
        enterPending.current = false;
        const o = optionsOf(found)[first];
        if (o) choose(o);
      }
    }, () => {});
    return () => { live = false; };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const options = optionsOf(items);
  const name = t(verb === 'append' ? 'inbox.appendTitle' : 'inbox.linkTitle', { title });
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={name} className="dialog inbox-picker"
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter') {
            e.preventDefault();
            if (shownFor !== q) enterPending.current = true;
            else if (options[active]) choose(options[active]);
          }
        }}>
        <h2>{name}</h2>
        <input type="text" role="combobox" aria-label={t('inbox.find')} aria-expanded="true" aria-controls="inbox-picker-list" autoFocus
          value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" spellCheck={false} />
        <ul role="listbox" id="inbox-picker-list" aria-label={t('inbox.find')} className="inbox-picker-list">
          {options.map((o, i) => (
            <li key={o.kind === 'today' ? 'today' : o.path} role="option" aria-selected={i === active} className={i === active ? 'active' : undefined}
              onMouseDown={(e) => { e.preventDefault(); choose(o); }}>
              {o.kind === 'today' ? t('inbox.todaysNote') : (
                <>
                  <span data-user-content>{o.title}</span> <span className="muted" data-user-content>{typeLabel(o.type)}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function TagDialog({ onApply, onClose }: { onApply: (tags: string[]) => void; onClose: () => void }) {
  const [chips, setChips] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const chipsRef = useRef(chips);
  chipsRef.current = chips;
  useEffect(() => { void ipc.tags().then((ts) => setTags(ts.map((x) => x.name)), () => {}); }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={t('inbox.addTags')} className="dialog inbox-tags"
        onKeyDown={(e) => {
          const input = e.target as HTMLInputElement;
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
          else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onApply(chipsRef.current); }
          else if (e.key === 'Enter' && input.value === '' && chipsRef.current.length > 0) { e.preventDefault(); onApply(chipsRef.current); }
        }}>
        <h2>{t('inbox.addTags')}</h2>
        <TagField chips={chips} onChange={setChips} tags={tags} autoFocus />
      </div>
    </div>
  );
}

