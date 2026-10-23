// The Backlinks tab (FR-LNK-01, FR-LNK-02; backlinks.md R15; ms4-links §5.2; D-276…D-285): who links to the open
// note, grouped by type, one chip per source (D-368: no excerpts). Data comes from one index query per note (`index_backlinks`),
// re-asked on every vault change; nothing here writes.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { collator } from '../i18n/collate';
import { ipc } from '../ipc/client';
import type { BacklinkEntryDto, BacklinksPanelDto, OccurrenceDto, TypeDefDto } from '../ipc/types';
import { Icon } from '../shell/Icon';
import { chipParts } from './ChipParts';
import { chipIcon } from './icons';
import { orderBacklinks } from './order';

/** Rows are windowed above this many entries (FR-LNK-01 AC-16: at most 100 entry elements in the DOM). */
const WINDOW_FROM = 60;
const ENTRY_H = 30;
const HEADER_H = 32;
/** Session-only scroll positions per note (Back restores them, FR-LNK-01 AC-6). */
const scrolls = new Map<string, number>();
/** The last `Show backlinks` request whose focus was placed (the panel may mount because of it). */
let focusConsumed = 0;

export type OpenMention = (source: string, occurrence: OccurrenceDto | null, readOnly: boolean) => void;

/** 4B (D-348): a daily route asks by its date, so a virtual note has backlinks too. */
const panelOf = (path: string, date?: string) => (date ? ipc.dailyBacklinks(date) : ipc.backlinks(path));

export function useBacklinkCount(path: string | null, refresh: number, date?: string): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) { setN(0); return; }
    let live = true;
    panelOf(path, date).then((p) => { if (live) setN(p.objects); }, () => {});
    return () => { live = false; };
  }, [path, refresh, date]);
  return n;
}

export function BacklinksPanel({ path, date, types, refresh, onOpen, focusFirst, onCount }: {
  path: string; date?: string; types: TypeDefDto[]; refresh: number; onOpen: OpenMention;
  /** Changes when `Show backlinks` ran: the focus goes to the first entry's title link (or the heading). */
  focusFirst: number; onCount?: (n: number) => void;
}) {
  const [data, setData] = useState<{ path: string; panel: BacklinksPanelDto } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [scroll, setScroll] = useState(0);
  const box = useRef<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const restored = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    panelOf(path, date).then((p) => { if (live) setData({ path, panel: p }); }, () => {});
    return () => { live = false; };
  }, [path, refresh, date]);
  // A new note: groups expanded again (D-281); the old note's scroll is kept.
  useEffect(() => { setCollapsed(new Set()); }, [path]);

  const panel = useMemo(() => (data && data.path === path ? orderBacklinks(data.panel, types, collator()) : null), [data, path, types]);
  useEffect(() => { if (panel) onCount?.(panel.objects); }, [panel?.objects]);

  useLayoutEffect(() => {
    if (!panel || restored.current === path || !box.current) return;
    restored.current = path;
    const s = scrolls.get(path) ?? 0;
    box.current.scrollTop = s;
    setScroll(s);
  }, [panel, path]);

  // ms4-links §5 (FR-LNK-01 AC-16 benchmark, D-749): `backlinks-painted:<path>` once the first group has painted.
  const painted = useRef<string | null>(null);
  useEffect(() => {
    if (!panel || painted.current === path) return;
    painted.current = path;
    requestAnimationFrame(() => requestAnimationFrame(() => void ipc.perfMark(`backlinks-painted:${path}`).catch(() => {})));
  }, [panel, path]);

  useEffect(() => {
    if (!panel || focusFirst <= focusConsumed) return;
    focusConsumed = focusFirst;
    requestAnimationFrame(() => {
      const first = box.current?.querySelector<HTMLElement>('.backlink-entry .link-chip');
      (first ?? heading.current)?.focus();
    });
  }, [panel, focusFirst]);



  if (!panel) return <div role="tabpanel" aria-label={t('tab.backlinks')} className="panel-body backlinks" ref={box} />;

  const count = panel.objects;
  const label = (g: BacklinksPanelDto['groups'][number]) => (g.defined ? types.find((x) => x.key === g.type)?.plural ?? g.raw : g.raw);
  type Row = { kind: 'header'; g: BacklinksPanelDto['groups'][number] } | { kind: 'entry'; g: BacklinksPanelDto['groups'][number]; e: BacklinkEntryDto };
  const rows: Row[] = [];
  for (const g of panel.groups) {
    rows.push({ kind: 'header', g });
    if (!collapsed.has(g.type)) for (const e of g.entries) rows.push({ kind: 'entry', g, e });
  }
  const windowed = rows.filter((r) => r.kind === 'entry').length > WINDOW_FROM;
  const h = (r: Row) => (r.kind === 'header' ? HEADER_H : ENTRY_H);
  let from = 0, to = rows.length, top = 0, bottom = 0;
  if (windowed) {
    const view = box.current?.clientHeight ?? 800;
    let y = 0;
    from = rows.length;
    for (let i = 0; i < rows.length; i++) {
      if (y + h(rows[i]) >= scroll - 400 && from === rows.length) { from = i; top = y; }
      if (y > scroll + view + 400) { to = i; break; }
      y += h(rows[i]);
    }
    let rest = 0;
    for (let i = to; i < rows.length; i++) rest += h(rows[i]);
    bottom = rest;
  }

  const entryEl = (g: Row & { kind: 'entry' }) => {
    const e = g.e;
    // FR-LNK-01 AC-17: the source type's icon; a type without a definition shows the generic type icon (D-121).
    const icon = g.g.defined ? chipIcon(e.type) : { glyph: 'type', def: 'type' };
    // D-633: the D-600 states of a note's chip (Unreviewed, the task box and suffix); the name stays the title.
    const parts = chipParts({ kind: 'note', type: e.type, review: e.review, status: e.status, due: e.due, completed: e.completed });
    return (
      <div key={`e:${e.source}`} data-source={e.source} className="backlink-entry">
        <a href="#" tabIndex={0} className="chip link-chip kind-note" data-link-kind="note" data-icon={icon.def} data-command="panel.backlinks.open"
          aria-label={e.title} aria-description={parts.description ?? undefined} title={e.title} {...parts.attrs}
          onClick={(ev) => { ev.preventDefault(); onOpen(e.source, null, e.readOnly); }}>
          {parts.icon ?? <Icon name={icon.glyph} dataIcon={icon.def} size={13} />}<span data-user-content>{e.title}</span>{parts.suffix}
        </a>
      </div>
    );
  };

  // Rows rendered, grouped back under their group element.
  const visible = rows.slice(from, to);
  const byGroup: { g: BacklinksPanelDto['groups'][number]; header: boolean; entries: (Row & { kind: 'entry' })[] }[] = [];
  for (const r of visible) {
    const last = byGroup[byGroup.length - 1];
    if (r.kind === 'header') byGroup.push({ g: r.g, header: true, entries: [] });
    else if (last && last.g === r.g) last.entries.push(r);
    else byGroup.push({ g: r.g, header: false, entries: [r] });
  }

  return (
    <div role="tabpanel" aria-label={t('tab.backlinks')} className="panel-body backlinks" ref={box}
      onScroll={(ev) => { const s = (ev.target as HTMLElement).scrollTop; scrolls.set(path, s); if (windowed) setScroll(s); }}>
      <h2 ref={heading} tabIndex={-1} className="backlinks-heading">{count > 0 ? t('backlinks.count', { count }) : t('backlinks.empty')}</h2>
      {count === 0 && <p className="backlinks-hint">{t('backlinks.emptyHint')}</p>}
      {top > 0 && <div style={{ height: top }} aria-hidden="true" />}
      {byGroup.map(({ g, header, entries }) => {
        const open = !collapsed.has(g.type);
        const name = label(g);
        return (
          <div key={`g:${g.type}`} role="group" aria-label={name} className="backlink-group">
            {header && (
              <button type="button" tabIndex={0} className="group-header" aria-expanded={open} aria-label={t('backlinks.group', { name, count: g.entries.length })}
                data-command="panel.backlinks.toggleGroup"
                onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(g.type)) n.delete(g.type); else n.add(g.type); return n; })}>
                <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
                <span data-user-content>{name}</span> <span className="group-count">{t('backlinks.badge', { count: g.entries.length })}</span>
                {!g.defined && <span className="no-def">{t('backlinks.noTypeDefinition')}</span>}
              </button>
            )}
            {open && entries.map(entryEl)}
          </div>
        );
      })}
      {bottom > 0 && <div style={{ height: bottom }} aria-hidden="true" />}
    </div>
  );
}
