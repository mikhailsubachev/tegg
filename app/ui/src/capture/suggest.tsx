// D-603 (AP-526; FR-CAP-01 AC-21): `[[` and `@` in the capture text list objects from `capture_suggest` (link text,
// title, type, alias only; NFR-SEC-03 as amended) and, for `@`, Today, Tomorrow and Yesterday. A choice inserts
// `[[link]]` (`[[link|alias]]` for an alias match). No `Create` rows: the capture window writes only the capture.
import { useEffect, useRef, useState } from 'react';
import { addDays } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { captureIpc } from '../ipc/capture';
import type { CaptureSuggestDto, CaptureTypeDto } from '../ipc/types';
import { Icon, SYSTEM_DEFAULT, typeIconName } from '../shell/Icon';

export type Trigger = { kind: 'link' | 'at'; from: number; query: string };
export type Row = { link: string; title: string; type: string; alias: string | null; date?: boolean };

/** The open trigger before the caret: `[[query` or `@query` on the same line, not closed. */
export function triggerAt(text: string, caret: number): Trigger | null {
  const line = text.slice(text.lastIndexOf('\n', caret - 1) + 1, caret);
  const open = line.lastIndexOf('[[');
  if (open >= 0 && !line.slice(open).includes(']]')) return { kind: 'link', from: caret - line.length + open, query: line.slice(open + 2) };
  const at = /(^|\s)@([^\s@[\]]*)$/.exec(line);
  if (at) return { kind: 'at', from: caret - at[2].length - 1, query: at[2] };
  return null;
}

export function insertion(r: Row): string {
  return r.alias ? `[[${r.link}|${r.alias}]]` : `[[${r.link}]]`;
}

function dateRows(query: string, today: string): Row[] {
  const q = query.trim().toLowerCase();
  return ([['capture.dateToday', today], ['capture.dateTomorrow', addDays(today, 1)], ['capture.dateYesterday', addDays(today, -1)]] as const)
    .map(([k, d]): Row => ({ link: d, title: t(k), type: 'daily-note', alias: null, date: true }))
    .filter((r) => q === '' || r.title.toLowerCase().startsWith(q) || r.link.startsWith(q));
}

/** The rows for a trigger: one `capture_suggest` call per query change (80 ms debounce, stale answers dropped). */
export function useSuggestions(trig: Trigger | null, today: string): Row[] {
  const [rows, setRows] = useState<Row[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    if (!trig) { setRows([]); return; }
    const n = ++seq.current;
    const dates = trig.kind === 'at' ? dateRows(trig.query, today) : [];
    if (trig.query.trim() === '') { setRows(dates); return; }
    const id = setTimeout(() => {
      captureIpc.suggest(trig.query).then((r: CaptureSuggestDto[]) => {
        if (n !== seq.current) return;
        setRows([...dates, ...r.map((x) => ({ link: x.link, title: x.title, type: x.type, alias: x.alias }))]);
      }, () => { if (n === seq.current) setRows(dates); });
    }, 80);
    return () => clearTimeout(id);
  }, [trig?.kind, trig?.query, trig?.from, today]);
  return rows;
}

export function SuggestList({ rows, sel, types, pos, onPick, onHover }: { rows: Row[]; sel: number; types: CaptureTypeDto[]; pos: { left: number; top: number }; onPick: (r: Row) => void; onHover: (i: number) => void }) {
  if (!rows.length) return null;
  return (
    <div role="listbox" aria-label={t('capture.linkSuggestions')} className="capture-menu capture-suggest" style={{ left: pos.left, top: pos.top }}>
      {rows.map((r, i) => {
        const def = types.find((x) => x.key === r.type);
        return (
          <div key={`${r.link}-${i}`} role="option" aria-selected={i === sel} className={`capture-menu-item${i === sel ? ' sel' : ''}`}
            onMouseDown={(e) => { e.preventDefault(); onPick(r); }} onMouseEnter={() => onHover(i)}>
            <span className="capture-type-icon" style={def?.color ? { color: `var(--type-${def.color})` } : undefined}><Icon name={typeIconName(r.type, def?.icon)} dataIcon={def?.icon || SYSTEM_DEFAULT[r.type] || 'file-text'} size={14} /></span>
            <span data-user-content>{r.title}</span>
            {r.alias && <span className="muted" data-user-content>{r.alias}</span>}
          </div>
        );
      })}
    </div>
  );
}
