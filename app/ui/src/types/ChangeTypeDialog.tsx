// The `Change type?` mapping dialog (board TypeJobs A; FR-TYP-07, FR-STO-04; D-804, D-808, D-813, D-821), built from
// `type_move_plan`: the core computes R101 (defaults, offered targets, fixed rows); the UI only lets the user pick among
// what the plan offers. A target taken by one row is not offered in another; an empty row is greyed and maps to
// Content (nothing is written for it). Confirm sends one entry per schema property.
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n/catalog';

export type MapRowDto = {
  from: string;
  name: string;
  kind: string;
  value: string | null;
  default: string | 'content';
  /** Target property keys (or `{ key, name }`, D-821) of the same or a wider value type. */
  offered: (string | { key: string; name: string })[];
  fixed: boolean;
};
export type TypeMovePlanDto = { rows: MapRowDto[]; needsDialog: boolean };

/** The dialog shell of type settings (`aria-modal`, Esc = Cancel, Tab stays inside, the focus returns to the opener),
 *  kept here so this module loads without the editor. */
function Shell({ label, onCancel, children }: { label: string; onCancel: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('select:not([disabled]), button')?.focus();
    return () => { if (opener.current?.isConnected) opener.current.focus(); };
  }, []);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={label} className="dialog change-type-dialog"
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
          if (e.key === 'Tab') {
            const els = [...(ref.current?.querySelectorAll<HTMLElement>('button, select') ?? [])].filter((x) => !(x as HTMLButtonElement).disabled);
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

const keyOf = (o: string | { key: string }) => (typeof o === 'string' ? o : o.key);

export function ChangeTypeDialog({ plan, fromName, toName, targetNames, onConfirm, onCancel }: {
  plan: TypeMovePlanDto;
  fromName: string;
  toName: string;
  /** Target property key → its display name in the new type (the menu labels). */
  targetNames: Record<string, string>;
  onConfirm: (mapping: { from: string; to: string }[]) => void;
  onCancel: () => void;
}) {
  const [map, setMap] = useState<Record<string, string>>(() => Object.fromEntries(plan.rows.map((r) => [r.from, r.value === null && !r.fixed ? 'content' : r.default])));
  const names = useMemo(() => {
    const out: Record<string, string> = { ...targetNames };
    for (const r of plan.rows) for (const o of r.offered) if (typeof o !== 'string') out[o.key] = o.name;
    return out;
  }, [plan, targetNames]);
  const taken = (except: string) => new Set(Object.entries(map).filter(([f, to]) => f !== except && to !== 'content').map(([, to]) => to));
  return (
    <Shell label={t('typeMove.title')} onCancel={onCancel}>
      <h2>{t('typeMove.title')}</h2>
      <fieldset aria-label={t('typeMove.mapping', { from: fromName, to: toName })}>
        <legend>{t('typeMove.mapping', { from: fromName, to: toName })}</legend>
        <ul className="type-map">
          <li className="type-map-row" data-fixed="true"><span>{t('typeMove.title.fixed')}</span><span>{t('typeMove.title.fixed')}</span></li>
          <li className="type-map-row" data-fixed="true"><span>{t('typeMove.tags.fixed')}</span><span>{t('typeMove.tags.fixed')}</span></li>
          {plan.rows.map((r) => {
            const empty = r.value === null && !r.fixed;
            const busy = taken(r.from);
            const offered = r.offered.map(keyOf).filter((k) => !busy.has(k) || map[r.from] === k);
            const label = t('typeMove.mapsTo', { name: r.name });
            return (
              <li key={r.from} className="type-map-row" data-empty={empty ? 'true' : undefined} aria-disabled={empty ? 'true' : undefined}>
                <span data-user-content>{r.name}</span>
                <select aria-label={label} disabled={r.fixed || empty} value={map[r.from]}
                  onChange={(e) => setMap((m) => ({ ...m, [r.from]: e.target.value }))}
                  onKeyDown={(e) => {
                    // The menu works without opening the native popup: ↑/↓ change the choice, ⏎ keeps it (FR-UX-03 AC-18).
                    const keys = ['content', ...offered];
                    const at = keys.indexOf(map[r.from]);
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      const next = keys[Math.min(keys.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))];
                      setMap((m) => ({ ...m, [r.from]: next }));
                    } else if (e.key === 'Enter') e.preventDefault();
                  }}>
                  {r.fixed
                    ? <option value={r.default}>{names[r.default] ?? r.default}</option>
                    : <>
                      <option value="content">{t('typeMove.content')}</option>
                      {offered.map((k) => <option key={k} value={k}>{names[k] ?? k}</option>)}
                    </>}
                </select>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <p className="help">{t('typeMove.help')}</p>
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>{t('typeMove.cancel')}</button>
        <button type="button" className="primary" onClick={() => onConfirm(plan.rows.map((r) => ({ from: r.from, to: map[r.from] })))}>{t('typeMove.confirm')}</button>
      </div>
    </Shell>
  );
}
