// The Daily Notes calendar (FR-DLY-03 AC-3…AC-6, daily-notes.md R18, D-329): since D-763 the app's one date picker
// with the days that have a Daily Note marked from `daily_dates`, live on every vault change, and no `No date` (it
// navigates, it doesn't set a value).
import { useEffect, useState } from 'react';
import { t } from '../i18n/catalog';
import { events, ipc } from '../ipc/client';
import { PickDate } from '../dates/PickDate';
import { localDate } from '../zone';

export { longDate } from '../dates/PickDate';

export function Calendar({ selected, anchor, onChoose, onClose }: {
  /** The open date (selected), `YYYY-MM-DD`. */
  selected: string;
  anchor: HTMLElement | null;
  onChoose: (date: string) => void;
  onClose: () => void;
}) {
  const [month, setMonth] = useState<[number, number] | null>(null);
  const [marks, setMarks] = useState<Set<string>>(new Set());
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const un = events.changed(() => setRefresh((n) => n + 1));
    return () => void un.then((f) => f());
  }, []);
  useEffect(() => {
    if (!month) return;
    let live = true;
    ipc.dailyDates(month[0], month[1]).then((d) => { if (live) setMarks(new Set(d)); }, () => {});
    return () => { live = false; };
  }, [month?.[0], month?.[1], refresh]);
  return <PickDate label={t('daily.calendar')} today={localDate(Date.now())} value={selected} anchor={anchor} marks={marks} onMonth={(y, m) => setMonth([y, m])} onPick={onChoose} onClose={onClose} />;
}
