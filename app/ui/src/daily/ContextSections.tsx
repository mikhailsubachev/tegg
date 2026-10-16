// The live context sections of a Daily Note (FR-DLY-04, D-271, D-328, R19): Quick Notes, Tasks due (Coming in MS5),
// Created and Modified of that day, after the body, never saved into it. The day window is the UI's (ms4-daily §1).
import { useEffect, useRef, useState } from 'react';
import { afterNoteReady, noteReadyCount } from '../readiness';
import { localMidnight as zonedMidnight } from '../zone';
import { addDays } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { events, ipc } from '../ipc/client';
import type { ContextRowDto, DailyContextDto } from '../ipc/types';
import { chipIcon } from '../links/icons';
import { Icon } from '../shell/Icon';

const LIMIT = 50;

/** Local midnight of `date` as RFC 3339 with that instant's offset (a DST day is 23 or 25 h). */
export function localMidnight(date: string): string {
  return zonedMidnight(date);
}

export function ContextSections({ date, onOpen }: { date: string; onOpen: (path: string) => void }) {
  const [data, setData] = useState<DailyContextDto | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  // ms4-daily §7: `daily-ready:<date>` once per open, after the body (note-ready) and the sections have painted.
  const openedAt = useRef({ date, since: noteReadyCount() });
  if (openedAt.current.date !== date) openedAt.current = { date, since: noteReadyCount() };
  const marked = useRef<string | null>(null);
  useEffect(() => {
    if (loadedFor !== date || marked.current === date) return;
    let live = true;
    const { since } = openedAt.current;
    requestAnimationFrame(() => {
      void afterNoteReady(since).then(() => {
        if (!live || marked.current === date) return;
        marked.current = date;
        void ipc.perfMark(`daily-ready:${date}`).catch(() => {});
      });
    });
    return () => { live = false; };
  }, [loadedFor, date]);
  const [all, setAll] = useState<Set<number>>(new Set());
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const un = events.changed(() => setRefresh((n) => n + 1));
    return () => void un.then((f) => f());
  }, []);
  useEffect(() => {
    let live = true;
    const limit = all.size ? 100_000 : LIMIT;
    ipc.dailyContext(date, localMidnight(date), localMidnight(addDays(date, 1)), limit).then((d) => { if (live) { setData(d); setLoadedFor(date); } }, () => {});
    return () => { live = false; };
  }, [date, refresh, all.size]);

  const section = (i: number, name: string, rows: ContextRowDto[], total: number) => {
    const shown = all.has(i) ? rows : rows.slice(0, LIMIT);
    return (
      <section key={name} role="region" aria-label={name} className="daily-section">
        <h2 className="daily-section-title">{name}</h2>
        {shown.length === 0 ? <p className="daily-empty">{t('daily.section.empty')}</p> : (
          <ul className="daily-rows">
            {shown.map((r) => {
              const icon = chipIcon(r.type);
              return (
                <li key={r.path}>
                  <a href="#" tabIndex={0} className="daily-row" data-command="daily.openRow" onClick={(e) => { e.preventDefault(); onOpen(r.path); }}>
                    <Icon name={icon.glyph} dataIcon={icon.def} size={14} /><span data-user-content>{r.title}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
        {!all.has(i) && total > shown.length && (
          <button type="button" tabIndex={0} className="show-more" onClick={() => setAll((s) => new Set(s).add(i))}>
            {t('daily.section.more', { count: total - shown.length })}
          </button>
        )}
      </section>
    );
  };
  return (
    <div className="daily-sections">
      {section(0, t('daily.section.quickNotes'), data?.quickNotes ?? [], data?.totals[0] ?? 0)}
      <section role="region" aria-label={t('daily.section.tasks')} className="daily-section">
        <h2 className="daily-section-title">{t('daily.section.tasks')}</h2>
        <p className="daily-empty" data-placeholder="daily-tasks">{t('due.comingIn', { due: 'MS5' })}</p>
      </section>
      {section(1, t('daily.section.created'), data?.created ?? [], data?.totals[1] ?? 0)}
      {section(2, t('daily.section.modified'), data?.modified ?? [], data?.totals[2] ?? 0)}
    </div>
  );
}
