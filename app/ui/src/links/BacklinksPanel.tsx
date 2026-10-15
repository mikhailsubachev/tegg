// The Backlinks tab (FR-LNK-01, FR-LNK-02; backlinks.md R15; ms4-links §5.2; D-276…D-285): who links to the open
// note, grouped by type, with an excerpt per mention. Data comes from one index query per note (`index_backlinks`),
// re-asked on every vault change; nothing here writes.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { collator } from '../i18n/collate';
import { ipc } from '../ipc/client';
import type { BacklinkEntryDto, BacklinksPanelDto, OccurrenceDto, TypeDefDto } from '../ipc/types';
import { Disabled } from '../shell/Disabled';
import { Icon } from '../shell/Icon';
import { Excerpt } from './Excerpt';
import { chipIcon } from './icons';
import { orderBacklinks } from './order';

const SHOWN = 3;
/** Rows are windowed above this many entries (FR-LNK-01 AC-16: at most 100 entry elements in the DOM). */
const WINDOW_FROM = 60;
const ENTRY_H = 96;
const HEADER_H = 32;
/** Session-only scroll positions per note (Back restores them, FR-LNK-01 AC-6). */
const scrolls = new Map<string, number>();
/** The last `Show backlinks` request whose focus was placed (the panel may mount because of it). */
let focusConsumed = 0;

export type OpenMention = (source: string, occurrence: OccurrenceDto | null, readOnly: boolean) => void;

export function useBacklinkCount(path: string | null, refresh: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) { setN(0); return; }
    let live = true;
    ipc.backlinks(path).then((p) => { if (live) setN(p.objects); }, () => {});
    return () => { live = false; };
  }, [path, refresh]);
  return n;
}

export function BacklinksPanel({ path, types, refresh, onOpen, focusFirst, onCount }: {
  path: string; types: TypeDefDto[]; refresh: number; onOpen: OpenMention;
  /** Changes when `Show backlinks` ran: the focus goes to the first entry's title link (or the heading). */
  focusFirst: number; onCount?: (n: number) => void;
}) {
  const [data, setData] = useState<{ path: string; panel: BacklinksPanelDto } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [scroll, setScroll] = useState(0);
  const box = useRef<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const restored = useRef<string | null>(null);
  const focusExcerpt = useRef<{ source: string; index: number } | null>(null);

  useEffect(() => {
    let live = true;
    ipc.backlinks(path).then((p) => { if (live) setData({ path, panel: p }); }, () => {});
    return () => { live = false; };
  }, [path, refresh]);
  // A new note: groups expanded and excerpts collapsed again (D-278, D-281); the old note's scroll is kept.
  useEffect(() => {
    setCollapsed(new Set());
    setExpanded(new Set());
  }, [path]);

  const panel = useMemo(() => (data && data.path === path ? orderBacklinks(data.panel, types, collator()) : null), [data, path, types]);
  useEffect(() => { if (panel) onCount?.(panel.objects); }, [panel?.objects]);

  useLayoutEffect(() => {
    if (!panel || restored.current === path || !box.current) return;
    restored.current = path;
    const s = scrolls.get(path) ?? 0;
    box.current.scrollTop = s;
    setScroll(s);
  }, [panel, path]);

  useEffect(() => {
    if (!panel || focusFirst <= focusConsumed) return;
    focusConsumed = focusFirst;
    requestAnimationFrame(() => {
      const first = box.current?.querySelector<HTMLElement>('article .entry-title');
      (first ?? heading.current)?.focus();
    });
  }, [panel, focusFirst]);

  useLayoutEffect(() => {
    const f = focusExcerpt.current;
    if (!f) return;
    focusExcerpt.current = null;
    const art = [...(box.current?.querySelectorAll<HTMLElement>('article') ?? [])].find((a) => a.dataset.source === f.source);
    art?.querySelectorAll<HTMLElement>('[data-occurrence]')[f.index]?.focus();
  });

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
    const all = expanded.has(e.source);
    const shown = all ? e.occurrences : e.occurrences.slice(0, SHOWN);
    const icon = chipIcon(e.type);
    return (
      <article key={`e:${e.source}`} aria-label={e.title} data-source={e.source} className="backlink-entry">
        <a href="#" tabIndex={0} className="entry-title" data-command="panel.backlinks.open" onClick={(ev) => { ev.preventDefault(); onOpen(e.source, null, e.readOnly); }}>
          <Icon name={icon.glyph} dataIcon={icon.def} size={14} /><span data-user-content>{e.title}</span>
        </a>
        <ul className="excerpts">
          {shown.map((o, i) => (
            <li key={i}><Excerpt occurrence={o} source={e.source} readOnly={e.readOnly} onOpen={(s, oc, ro) => onOpen(s, oc, ro)} /></li>
          ))}
        </ul>
        {e.occurrences.length > SHOWN && (
          <button type="button" tabIndex={0} className="show-more" data-command="panel.backlinks.more" aria-expanded={all}
            onClick={() => {
              if (!all) focusExcerpt.current = { source: e.source, index: SHOWN };
              setExpanded((s) => { const n = new Set(s); if (n.has(e.source)) n.delete(e.source); else n.add(e.source); return n; });
            }}>
            {t('backlinks.more', { count: e.occurrences.length - SHOWN })}
          </button>
        )}
      </article>
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
      <div className="unlinked">
        <Disabled control="backlinks.unlinked" className="unlinked-header" />
      </div>
    </div>
  );
}
