// Type settings' `Views` section (docs/contracts/v1-cards.md §7.9, §8.2; types.md FR-TYP-01 AC-25…AC-27; D-2071,
// D-2100, AP-1595): the type's `views:` list as the type page's tabs show it, `All <plural>` first and fixed; drag or
// ⌥↑/⌥↓ reorders (one `type_patch` `views` per move, FR-QRY-07 AC-6's bytes), `Edit` opens the views editor (R189) as
// `Edit view` does, `Remove from <plural> page` drops the name (the query file stays), `Add view` opens the type page's
// menu; on Task, last, `Restore default views` (v1-views §29.10). Read-only on a newer or invalid file and on
// `viewsUnreadable`, with the type page's reasons.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { TypeDto, TypeOpDto } from '../ipc/types';
import { openQueryEditor } from '../queries/editorHost';
import { refreshQueries, useQueries } from '../queries/store';
import { restoreDefaultViews, restoreState } from './defaultViews';
import { nameKey, viewTabs, viewsAfterDrop, viewsAfterMove, viewsAfterRemove } from './model';
import { groupChoices, viewKindText } from './display';
import { sortKeyName } from '../queries/SortPopover';
import './views.css';

const nfc = (s: string) => s.normalize('NFC');

function Glyph({ d }: { d: string }) {
  return (
    <svg className="icon" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const GRIP = 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01';

export function ViewsSection({ type, send, reload, onAddView }: {
  type: TypeDto;
  send: (ops: TypeOpDto[], field: string, fieldId?: string) => Promise<boolean>;
  reload: () => void;
  /** `Add view`: the type page's menu (its `views.new`). */
  onAddView: () => void;
}) {
  const summaries = useQueries();
  useEffect(() => { void refreshQueries(); }, []);
  // The names as last changed here while writes are pending (each move builds on it).
  const [local, setLocal] = useState<string[] | null>(null);
  const pending = useRef(0);
  const names = local ?? type.views ?? [];
  const shown: TypeDto = { ...type, views: names };
  const tabs = viewTabs(shown, summaries ?? []);
  const reason = type.viewsUnreadable ? t('views.unreadableSetting', { file: `.tegg/types/${type.key}.yml` })
    : type.state === 'newer' ? t('ts.newer') : type.state !== 'ok' ? t('typePage.columnsInvalid') : null;
  const off = reason !== null;
  const isTask = nfc(type.key) === 'task';
  const [live, setLive] = useState<{ text: string; seq: number } | null>(null);
  const focusName = useRef<string | null>(null);
  useLayoutEffect(() => {
    const n = focusName.current;
    if (n === null) return;
    focusName.current = null;
    (document.querySelector(`[data-view-handle="${CSS.escape(n)}"]`) as HTMLElement | null)?.focus();
  });

  // D-2194 (b), §41.11: `<Display> · by <attribute>` from each tab's effective display and grouping: the item's own
  // valid values over the query file's (one read per tab's query); an own grouping the type can't use reads the query's.
  const [defs, setDefs] = useState<Record<string, { groupBy: string | null; groupPeriod: boolean } | null>>({});
  const tabNames = tabs.filter((x) => x.summary).map((x) => x.summary!.name);
  const stamp = tabs.map((x) => `${x.summary?.name ?? ''}\u0000${x.summary?.modified ?? ''}`).join('\n');
  useEffect(() => {
    let alive = true;
    for (const n of tabNames) {
      void ipc.queryGet(n).then((q) => { if (alive) setDefs((g) => ({ ...g, [n]: q.def ? { groupBy: q.def.groupBy ?? null, groupPeriod: !!q.def.groupPeriod } : null })); },
        () => { if (alive) setDefs((g) => ({ ...g, [n]: null })); });
    }
    return () => { alive = false; };
  }, [stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  // The list waits for its first reads (a few ms), so a name never shows without its grouping.
  const loaded = summaries !== null && tabNames.every((n) => n in defs);
  const choiceIds = new Set(groupChoices(type, [type.key]).map((c) => c.id));
  const kindText = (tab: (typeof tabs)[number]) => {
    if (!tab.kind) return null;
    const item = (type.viewItems ?? []).find((i) => nameKey(i.name) === tab.key);
    const fileDef = tab.summary ? defs[tab.summary.name] ?? null : null;
    let grouping: { key: string; period: boolean } | null = fileDef?.groupBy ? { key: nfc(fileDef.groupBy), period: fileDef.groupPeriod } : null;
    const own = item?.group ?? null;
    if (own && own.none) grouping = null;
    else if (own && !own.none && choiceIds.has(own.period ? `period:${nfc(own.key)}` : nfc(own.key))) grouping = { key: nfc(own.key), period: own.period };
    if (grouping && !choiceIds.has(grouping.period ? `period:${grouping.key}` : grouping.key)) grouping = null;
    return viewKindText(tab.kind, grouping ? sortKeyName(grouping.key, type).label : null);
  };

  const write = (next: string[] | null, announce?: string) => {
    if (!next || off) return;
    setLocal(next);
    pending.current++;
    void send([{ op: 'views', names: next.map(nfc) }], t('ts.section.views'), 'views')
      .then((ok) => { if (ok && announce) setLive((l) => ({ text: announce, seq: (l?.seq ?? 0) + 1 })); })
      .finally(() => { if (--pending.current === 0) setLocal(null); });
  };
  const move = (name: string, delta: -1 | 1) => {
    const next = viewsAfterMove(names, name, delta);
    if (!next) return;
    focusName.current = nfc(name);
    write(next, t('views.moved', { name }));
  };

  // ---- drag (> 4 px moves)
  const listRef = useRef<HTMLUListElement | null>(null);
  const [drag, setDrag] = useState<{ name: string; before: string | null } | null>(null);
  const startDrag = (name: string) => (e: React.MouseEvent) => {
    if (off || e.button !== 0) return;
    const y0 = e.clientY;
    let started = false;
    let before: string | null = null;
    const beforeAt = (y: number): string | null => {
      const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('li[data-view-row]') ?? [])].filter((r) => r.dataset.viewRow && nameKey(r.dataset.viewRow) !== nameKey(name));
      for (const r of rows) {
        const b = r.getBoundingClientRect();
        if (y < b.top + b.height / 2) return r.dataset.viewRow ?? null;
      }
      return null;
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('keydown', onEsc, true);
      setDrag(null);
      if (commit && started) { focusName.current = nfc(name); write(viewsAfterDrop(names, name, before), t('views.moved', { name })); }
    };
    const onMove = (ev: MouseEvent) => {
      if (!started && Math.abs(ev.clientY - y0) <= 4) return;
      started = true;
      before = beforeAt(ev.clientY);
      setDrag({ name, before });
    };
    const onUp = () => finish(true);
    const onEsc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') finish(false); };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('keydown', onEsc, true);
  };

  const edit = (name: string, btn: HTMLElement) => {
    openQueryEditor({ name, host: null, anchor: btn, returnFocus: btn, fixedType: { key: type.key, plural: type.plural } });
  };
  const restore = restoreState(type, summaries ?? []);
  const restoreOff = !summaries || !restore.enabled;
  const [allA, allB] = t('views.all', { plural: '\u0000' }).split('\u0000');
  return (
    <section id="ts-views" aria-labelledby="ts-views-h" className="ts-section views-section" aria-busy={loaded ? undefined : true}
      style={loaded ? undefined : { visibility: 'hidden' }}>
      <h2 id="ts-views-h">{t('ts.section.views')}</h2>
      <ul ref={listRef} role="list" aria-label={t('typeSettings.viewsList', { plural: type.plural })} className="ts-views-list">
        <li data-view-row="" className="ts-view-row fixed">
          <span className="ts-view-handle placeholder" aria-hidden="true" />
          <span className="ts-view-name">{allA}<span data-user-content>{type.plural}</span>{allB}</span>
          <span className="ts-view-kind hint">{t('typeSettings.viewDefault')}</span>
        </li>
        {tabs.map((x) => {
          const kind = kindText(x);
          const dropBefore = drag && drag.before !== null && nameKey(drag.before) === x.key && nameKey(drag.name) !== x.key;
          return (
            <li key={x.key} data-view-row={nfc(x.name)} className={`ts-view-row${drag && nameKey(drag.name) === x.key ? ' dragging' : ''}${dropBefore ? ' drop-before' : ''}`}
              data-view-state={x.summary ? (x.summary.state !== 'ok' ? 'unreadable' : undefined) : 'missing'}>
              <span role="button" tabIndex={0} className="ts-view-handle" data-view-handle={nfc(x.name)} data-command="views.move" aria-label={t('typeSettings.viewDrag', { name: x.name })}
                aria-disabled={off || undefined} aria-description={reason ?? undefined}
                onMouseDown={startDrag(x.name)}
                onKeyDown={(e) => {
                  if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                  e.preventDefault();
                  e.stopPropagation();
                  if (!off) move(x.name, e.key === 'ArrowUp' ? -1 : 1);
                }}>
                <Glyph d={GRIP} />
              </span>
              <span className="ts-view-name" data-user-content>{x.name}</span>
              <span className="ts-view-kind hint">{kind}</span>
              <span className="spacer" />
              <button type="button" tabIndex={0} className="text-button small" data-command="views.edit" aria-disabled={!x.summary || x.summary.state !== 'ok' ? 'true' : undefined}
                onClick={(e) => { if (x.summary && x.summary.state === 'ok') edit(x.summary.name, e.currentTarget); }}>
                {t('typeSettings.viewEdit')}
              </button>
              <button type="button" tabIndex={0} className="text-button small" data-command="views.remove" aria-disabled={off || undefined} aria-description={reason ?? undefined}
                onClick={() => { if (!off) write(viewsAfterRemove(names, x.name)); }}>
                {t('views.remove', { plural: type.plural })}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="ts-row">
        <button type="button" tabIndex={0} className="text-button" data-command="views.new" aria-disabled={off || undefined} aria-description={reason ?? undefined}
          onClick={() => { if (!off) onAddView(); }}>
          {t('views.add')}
        </button>
      </div>
      {isTask && (
        <div className="ts-row">
          <button type="button" tabIndex={0} className="text-button" data-command="types.restoreDefaultViews"
            aria-disabled={restoreOff ? 'true' : undefined} aria-description={restore.reason ?? t('typeSettings.restoreViewsHint')}
            onClick={() => { if (!restoreOff) void restoreDefaultViews(type, reload); }}>
            {t('typeSettings.restoreViews')}
          </button>
        </div>
      )}
      <div className="sr-live" role="status" aria-live="polite">{live ? <span key={live.seq}>{live.text}</span> : null}</div>
    </section>
  );
}
