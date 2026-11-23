// The icon picker (docs/contracts/v1-cards.md §5.5, §7.7, §7.8, §8.3, §12; cards.md R215, R216; FR-TYP-01 AC-14…AC-18,
// AC-20, AC-21; D-2066, D-2067, D-2070, D-2101…D-2104). A non-modal dialog anchored to its opener, one at a time. The
// whole Lucide set is loaded on the first open of a window (`loadIconSet`, its own chunk; nothing is fetched,
// NFR-SEC-01). The grid has 6 columns and is virtualised (at most 200 options in the DOM; the selected one always).
import { createElement, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import { iconInUse } from '../shell/Icon';
import { placePopup, POPUP_MARGIN } from '../shell/placement';
import { loadIconSet } from './load';
import { recentIcons, rememberIcon } from './recent';
import type { IconSet } from './resolve';
import { searchIcons, suggestIcons, type IconResult } from './search';
import './picker.css';

export const ICON_COLUMNS = 6;
const ROW_H = 64;
const HEADER_H = 26;
const MAX_OPTIONS = 200;
/** The smallest picker drawn below its opener (search, two rows, None) before it flips above. */
const MIN_BELOW = 220;

export type IconPickerOptions = {
  anchor: HTMLElement;
  /** The property's or type's Name: the dialog's name and the Suggested words. */
  title: string;
  /** The opener's current icon as a canonical Lucide name (null: none or unknown). */
  current: string | null;
  /** Properties only: `None (show the name)` (AP-1599). */
  allowNone: boolean;
  /** The chosen canonical name, or null for None. The caller decides whether a write is needed (D-2101). */
  onChoose: (name: string | null) => void;
  onClose?: () => void;
};

type Group = { key: 'suggested' | 'recent' | 'all' | 'results'; label: string; header: string | null; items: IconResult[] };

const mark = (name: string) => { void ipc.perfMark?.(name)?.catch?.(() => {}); };
const afterPaint = (f: () => void) => requestAnimationFrame(() => requestAnimationFrame(f));

let host: { el: HTMLDivElement; root: Root } | null = null;
let openSeq = 0;

/** Opens the picker (closing any other one). */
export function openIconPicker(o: IconPickerOptions): void {
  mark('icon-picker-open');
  closeIconPicker();
  const el = document.createElement('div');
  el.className = 'icon-picker-host';
  document.body.appendChild(el);
  const root = createRoot(el);
  host = { el, root };
  const seq = ++openSeq;
  root.render(createElement(IconPicker, { key: seq, ...o, onDone: (refocus: boolean) => { if (openSeq === seq) closeIconPicker(); if (refocus && o.anchor.isConnected) o.anchor.focus(); o.onClose?.(); } }));
}

export function closeIconPicker(): void {
  const h = host;
  host = null;
  if (!h) return;
  // Unmounting during a React event of this root isn't allowed synchronously.
  queueMicrotask(() => { h.root.unmount(); h.el.remove(); });
}

export function iconPickerOpen(): boolean {
  return host !== null;
}

/** The node of an icon in the loaded set, drawn as `LucideIcon` does. */
function SetIcon({ set, name }: { set: IconSet | null; name: string }) {
  const n = set?.icons[name]?.n ?? iconInUse(name)?.node ?? [];
  return (
    <svg className="icon lucide" width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {n.map(([tag, a], i) => createElement(tag, { key: i, ...Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'key').map(([k, v]) => [k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase()), v])) }))}
    </svg>
  );
}

function Name({ r }: { r: IconResult }) {
  if (!r.bold) return <span className="icon-name">{r.name}</span>;
  const [a, b] = r.bold;
  return <span className="icon-name">{r.name.slice(0, a)}<b>{r.name.slice(a, b)}</b>{r.name.slice(b)}</span>;
}

function IconPicker({ anchor, title, current, allowNone, onChoose, onDone }: IconPickerOptions & { onDone: (refocus: boolean) => void }) {
  const [set, setSet] = useState<IconSet | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const [scroll, setScroll] = useState({ top: 0, height: 300 });
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number | null } | null>(null);
  const [live, setLive] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const grid = useRef<HTMLDivElement | null>(null);
  const none = useRef<HTMLButtonElement | null>(null);
  const typed = useRef(false);
  const naturalH = useRef<number | null>(null);
  const pendingResults = useRef(false);
  /** ⏎ pressed before the set has loaded (the first open of a window): chosen once the results are there. */
  const pendingEnter = useRef(false);
  const base = useMemo(() => `iconpick-${openSeq}`, []);
  const recent = useMemo(() => recentIcons(), []);

  useEffect(() => {
    let live = true;
    loadIconSet().then((s) => { if (live) setSet(s); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  useEffect(() => { input.current?.focus(); }, []);

  const groups: Group[] = useMemo(() => {
    // Before the set has loaded, Recent is shown from the UI state at once (its drawings follow with the set).
    if (!set) return !query.trim() && recent.length ? [{ key: 'recent', label: t('iconPicker.recent'), header: t('iconPicker.recent'), items: recent.map((name) => ({ name, bold: null })) }] : [];
    const q = query.trim();
    if (q) {
      const items = searchIcons(set, q);
      return items.length ? [{ key: 'results', label: t('iconPicker.resultsGroup'), header: null, items }] : [];
    }
    const out: Group[] = [];
    const sug = suggestIcons(set, title);
    if (sug.length) out.push({ key: 'suggested', label: t('iconPicker.suggested', { name: title }), header: t('iconPicker.suggested', { name: title }), items: sug.map((name) => ({ name, bold: null })) });
    const rec = recent.filter((n) => Object.hasOwn(set.icons, n));
    if (rec.length) out.push({ key: 'recent', label: t('iconPicker.recent'), header: t('iconPicker.recent'), items: rec.map((name) => ({ name, bold: null })) });
    out.push({ key: 'all', label: t('iconPicker.all'), header: t('iconPicker.all'), items: set.names.map((name) => ({ name, bold: null })) });
    return out;
  }, [set, query, title, recent]);

  const flat = useMemo(() => groups.flatMap((g) => g.items.map((r) => ({ g: g.key, r }))), [groups]);
  // The layout: each group's top, its header and rows.
  const layout = useMemo(() => {
    let y = 0;
    let first = 0;
    return groups.map((g) => {
      const header = g.header ? HEADER_H : 0;
      const rows = Math.ceil(g.items.length / ICON_COLUMNS);
      const l = { top: y, header, rows, first };
      y += header + rows * ROW_H;
      first += g.items.length;
      return l;
    });
  }, [groups]);

  // The selection after each keystroke: the first option; with nothing typed the current icon's option when shown.
  useLayoutEffect(() => {
    let i = 0;
    if (!query.trim() && current) {
      const j = flat.findIndex((x) => x.r.name === current);
      if (j >= 0) i = j;
    }
    setSel(i);
    scrollTo(i, true);
    // §7.7: ⏎ chooses the selected option; one pressed while the set was loading chooses it now.
    if (set && pendingEnter.current) {
      pendingEnter.current = false;
      const x = flat[i];
      if (x) choose(x.r.name);
    }
  }, [set, query]);

  // Placement (v1-views §20's rule), after the first layout.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = anchor.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    // The natural height, also while a `maxHeight` of an earlier placement holds the picker smaller.
    // (the grid has a fixed height, so the first measure, before any `maxHeight`, is the natural one).
    naturalH.current ??= box.height;
    const natural = naturalH.current;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    let p = placePopup({ opener: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, size: { width: box.width, height: natural }, viewport, kind: 'menu' });
    // Below its opener while the grid can shrink to MIN_BELOW there (the grid scrolls); flipped only when it can't.
    const below = viewport.height - POPUP_MARGIN - (r.bottom + 4);
    if (p.placement.startsWith('above') && below >= MIN_BELOW) {
      const q = placePopup({ opener: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, size: { width: box.width, height: below }, viewport, kind: 'menu' });
      p = { ...q, maxHeight: below };
    }
    setPos((old) => (old && old.left === p.left && old.top === p.top && old.maxHeight === p.maxHeight ? old : { left: p.left, top: p.top, maxHeight: p.maxHeight }));
  }, [set !== null]);

  // Marks (§12): ready once the groups have painted; results once a typed input's results have painted.
  useEffect(() => {
    if (!set) return;
    afterPaint(() => mark('icon-picker-ready'));
  }, [set]);
  useEffect(() => {
    if (!pendingResults.current) return;
    pendingResults.current = false;
    afterPaint(() => mark('icon-picker-results'));
  }, [groups]);
  // The polite result count once typing pauses 500 ms.
  useEffect(() => {
    if (!set || !query.trim()) { setLive(''); return; }
    const n = groups[0]?.items.length ?? 0;
    const id = setTimeout(() => setLive(n ? t('iconPicker.results', { count: n }) : ''), 500);
    return () => clearTimeout(id);
  }, [groups]);

  // Outside clicks close the picker without writing.
  useEffect(() => {
    const outside = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onDone(false); };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  }, []);

  function rowTop(i: number): number {
    let gi = 0;
    while (gi + 1 < layout.length && layout[gi + 1].first <= i) gi++;
    const l = layout[gi];
    if (!l) return 0;
    return l.top + l.header + Math.floor((i - l.first) / ICON_COLUMNS) * ROW_H;
  }
  function scrollTo(i: number, start = false) {
    const g = grid.current;
    if (!g) return;
    const top = rowTop(i);
    if (start) {
      if (i === 0) g.scrollTop = 0;
      else if (top < g.scrollTop || top + ROW_H > g.scrollTop + g.clientHeight) g.scrollTop = Math.max(0, top - HEADER_H);
    } else if (top < g.scrollTop) g.scrollTop = Math.max(0, top - (i < ICON_COLUMNS ? HEADER_H : 0));
    else if (top + ROW_H > g.scrollTop + g.clientHeight) g.scrollTop = top + ROW_H - g.clientHeight;
    setScroll({ top: g.scrollTop, height: g.clientHeight || 300 });
  }
  const move = (d: number) => {
    if (!flat.length) return;
    const i = Math.min(Math.max(sel + d, 0), flat.length - 1);
    setSel(i);
    scrollTo(i);
  };
  const choose = (name: string | null) => {
    onDone(true);
    onChoose(name);
    if (name) rememberIcon(name);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone(true); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      const stops = [input.current, none.current].filter((x): x is HTMLInputElement | HTMLButtonElement => !!x);
      const i = stops.indexOf(document.activeElement as HTMLInputElement);
      stops[(i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
    }
  };
  const onInputKey = (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? ICON_COLUMNS : e.key === 'ArrowUp' ? -ICON_COLUMNS : 0;
    if (d) { e.preventDefault(); e.stopPropagation(); move(d); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (!set) { if (!failed) pendingEnter.current = true; return; }
      const x = flat[sel];
      if (x) choose(x.r.name);
    }
  };

  // Which rows are rendered: the window around the scroll position, plus the selected option's row.
  const rendered = useMemo(() => {
    const out = new Set<number>(); // global row ids: group index * 1e6 + row
    // One viewport of rows on each side, so a scroll of a page never shows a gap before the next render.
    const buffer = (Math.ceil(scroll.height / ROW_H) + 1) * ROW_H;
    const lo = scroll.top - buffer;
    const hi = scroll.top + scroll.height + buffer;
    let count = 0;
    layout.forEach((l, gi) => {
      for (let r = 0; r < l.rows; r++) {
        const y = l.top + l.header + r * ROW_H;
        if (y + ROW_H < lo || y > hi) continue;
        if (count + ICON_COLUMNS > MAX_OPTIONS - ICON_COLUMNS) return;
        out.add(gi * 1e6 + r);
        count += ICON_COLUMNS;
      }
    });
    if (flat[sel]) {
      let gi = 0;
      while (gi + 1 < layout.length && layout[gi + 1].first <= sel) gi++;
      out.add(gi * 1e6 + Math.floor((sel - layout[gi].first) / ICON_COLUMNS));
    }
    return out;
  }, [layout, scroll, sel, flat]);

  const selId = flat[sel] ? `${base}-${flat[sel].g}-${flat[sel].r.name}` : undefined;
  const q = query.trim();
  return (
    <div ref={ref} role="dialog" aria-modal="false" aria-label={t('iconPicker.title', { name: title })} data-icon-picker="" className="popover icon-picker"
      style={pos ? { position: 'fixed', left: pos.left, top: pos.top, maxHeight: pos.maxHeight ?? undefined } : { position: 'fixed', left: -9999, top: 0 }}
      onKeyDown={onKey}>
      <input ref={input} type="text" role="combobox" className="icon-picker-search" aria-label={t('iconPicker.search')} placeholder={t('iconPicker.search')}
        aria-controls={`${base}-grid`} aria-expanded="true" aria-autocomplete="list" aria-activedescendant={selId} value={query} spellCheck={false} autoComplete="off"
        onChange={(e) => { typed.current = true; pendingEnter.current = false; pendingResults.current = true; mark('icon-picker-input'); setQuery(e.target.value); }}
        onKeyDown={onInputKey} />
      <div ref={grid} id={`${base}-grid`} role="listbox" aria-label={t('iconPicker.title', { name: title })} data-columns={String(ICON_COLUMNS)} className="icon-picker-grid" tabIndex={-1}
        onScroll={(e) => { const g = e.currentTarget; setScroll({ top: g.scrollTop, height: g.clientHeight }); }}>
        {groups.map((g, gi) => {
          const l = layout[gi];
          const rows: React.ReactNode[] = [];
          let gap = 0;
          for (let r = 0; r < l.rows; r++) {
            if (!rendered.has(gi * 1e6 + r)) { gap++; continue; }
            if (gap) rows.push(<div key={`s${r}`} role="none" style={{ height: gap * ROW_H }} />);
            gap = 0;
            rows.push(
              <div key={r} role="none" className="icon-picker-row">
                {g.items.slice(r * ICON_COLUMNS, r * ICON_COLUMNS + ICON_COLUMNS).map((it, c) => {
                  const i = l.first + r * ICON_COLUMNS + c;
                  const id = `${base}-${g.key}-${it.name}`;
                  return (
                    <div key={it.name} id={id} role="option" data-icon={it.name} aria-selected={i === sel} aria-description={it.name === current ? t('iconPicker.current') : undefined}
                      className={`icon-option${i === sel ? ' selected' : ''}${it.name === current ? ' current' : ''}`}
                      onMouseDown={(e) => e.preventDefault()} onClick={() => choose(it.name)}>
                      <SetIcon set={set} name={it.name} />
                      <Name r={it} />
                    </div>
                  );
                })}
              </div>,
            );
          }
          if (gap) rows.push(<div key="end" role="none" style={{ height: gap * ROW_H }} />);
          return (
            <div key={g.key} role="group" aria-label={g.label} data-group={g.key} className="icon-picker-group">
              {g.header && <div role="presentation" className="group-header" aria-hidden="true">{g.header}</div>}
              {rows}
            </div>
          );
        })}
      </div>
      {failed && <p role="status" className="icon-picker-status">{t('iconPicker.loadFailed')}</p>}
      {set && q && !flat.length && <p role="status" className="icon-picker-status">{t('iconPicker.noMatch', { query: q })}</p>}
      {allowNone && (
        <div className="icon-picker-foot">
          <button ref={none} type="button" tabIndex={0} data-icon-none="" data-command="iconPicker.none" className="text-button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(null)}>
            {t('iconPicker.none')}
          </button>
        </div>
      )}
      <div className="sr-live" role="status" aria-live="polite">{live ? <Fragment>{live}</Fragment> : null}</div>
    </div>
  );
}
