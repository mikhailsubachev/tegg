// Slice 5A-1: the task list for a page (docs/contracts/ms5-tasks.md §1, §6.2): `task_list` on open and on every
// `vault:changed` (NFR-PERF-08), and "today" re-derived every 30 s from the clock and the current zone (D-327 timer),
// so midnight and a zone change recompute the views without a restart (FR-TSK-04 AC-8).
import { firstWeekday, localDate } from '@tegg/doc';
import { useCallback, useEffect, useRef, useState } from 'react';
import { region as regionOf } from '../i18n/collate';
import { ipc } from '../ipc/client';
import type { TaskDefsDto, TaskRowDto } from '../ipc/types';
import { appZone } from '../zone';

export type TaskData = { tasks: TaskRowDto[]; defs: TaskDefsDto };
const EMPTY: TaskData = { tasks: [], defs: { statuses: [], priorities: [], unknownStates: [] } };

export function currentRegion(): string {
  return regionOf() ?? (typeof navigator !== 'undefined' ? navigator.language : 'en');
}

/** Today in the current zone, re-checked every 30 s. */
export function useToday(): { today: string; zone: string | undefined } {
  const read = () => ({ today: localDate(Date.now(), appZone()), zone: appZone() });
  const [v, setV] = useState(read);
  useEffect(() => {
    const id = setInterval(() => setV((cur) => { const n = read(); return n.today === cur.today && n.zone === cur.zone ? cur : n; }), 30_000);
    return () => clearInterval(id);
  }, []);
  return v;
}

export function useTasks(refresh: number): TaskData & { loaded: boolean; reload: () => Promise<void>; today: string; zone: string | undefined; region: string; firstWeekday: number } {
  const [data, setData] = useState<TaskData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    try {
      const d = await ipc.taskList();
      if (n === seq.current) { setData({ tasks: d.tasks, defs: d.defs }); setLoaded(true); }
    } catch {
      if (n === seq.current) setLoaded(true);
    }
  }, []);
  useEffect(() => { void reload(); }, [refresh, reload]);
  const { today, zone } = useToday();
  const region = currentRegion();
  return { ...data, loaded, reload, today, zone, region, firstWeekday: firstWeekday(region) };
}

/** The sidebar's Tasks count (R45 R1, D-481): open tasks overdue or due today. */
export function useTaskBadge(refresh: number, on: boolean): number {
  const [n, setN] = useState(0);
  const { today } = useToday();
  useEffect(() => {
    if (!on) { setN(0); return; }
    let live = true;
    ipc.taskList().then((d) => {
      if (live) setN(d.tasks.filter((r) => (r.state === 'open' || r.state === 'in-progress') && r.due !== null && r.due <= today).length);
    }, () => {});
    return () => { live = false; };
  }, [refresh, on, today]);
  return n;
}
