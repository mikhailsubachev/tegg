// The route `daily/YYYY-MM-DD` (FR-DLY-01…06, D-318…D-338, ms4-daily §4.1): the date's Daily Note by the D-319 rule,
// or a virtual note on the draft until the first keystroke (FR-DLY-02). A note that arrives for the date while the
// virtual note is untouched replaces it (D-326); a written note follows the winner while it is untouched.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { addDays } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { DailyDraftDto, VersionDto } from '../ipc/types';
import { localIso, ulid } from '../newNote';
import type { NotePageApi } from '../pages/NotePage';
import type { DailyInfo } from './DailyHeader';

/** D-336: the invalid-format message is shown once per session, by the first page that finds the format invalid. */
let warnedBy: object | null = null;

type State = {
  path: string;
  virtual: { text: string; raw: string } | null;
  duplicates: string[];
  messages: string[];
  /** Remounts the note page: a different note (or a new draft) is shown. */
  gen: number;
};

/** The draft's placeholders filled when the virtual note opens (§4, D-324). */
const fill = (d: DailyDraftDto) => d.text.replace('{{id}}', ulid(Date.now())).split('{{now}}').join(localIso(new Date(Date.now())));

export function DailyPage({ date, refresh, apiRef, render, nav }: {
  date: string;
  refresh: number;
  apiRef: RefObject<NotePageApi | null>;
  render: (path: string, daily: DailyInfo, key: string) => ReactNode;
  nav: {
    go: (date: string) => void;
    today: () => void;
    pickDate: (anchor: HTMLElement | null) => void;
    openPath: (path: string) => void;
    duplicateTitles: () => void;
  };
}) {
  const [s, setS] = useState<State | null>(null);
  const sRef = useRef(s);
  sRef.current = s;
  const first = useRef(true);
  const me = useRef({});

  const update = async () => {
    const isFirst = first.current;
    first.current = false;
    const v = await ipc.dailyView(date).catch(() => null);
    if (!v) return;
    const cur = sRef.current;
    const touched = !!cur && (apiRef.current?.touched() ?? false);
    if (isFirst) void ipc.navOpened(v.path, `daily/${date}`).catch(() => {});
    if (v.path) {
      const others = (p: string) => [v.path!, ...v.duplicates].filter((x) => x !== p);
      if (!cur || (cur.path !== v.path && !touched)) {
        setS({ path: v.path, virtual: null, duplicates: v.duplicates, messages: [], gen: (cur?.gen ?? 0) + 1 });
      } else {
        setS({ ...cur, duplicates: others(cur.path) });
      }
      return;
    }
    if (cur && (!cur.virtual || touched)) return; // a written note keeps showing; a touched draft is the user's
    const d = await ipc.dailyDraft(date).catch(() => null);
    if (!d) return;
    const messages: string[] = [];
    if (d.formatFallback && (warnedBy === null || warnedBy === me.current)) { warnedBy = me.current; messages.push(t('daily.formatInvalid')); }
    if (d.templateInvalid) messages.push(t('daily.templateInvalid', { path: d.templateInvalid }));
    if (cur?.virtual && cur.virtual.raw === d.text) {
      if (cur.messages.join() !== messages.join()) setS({ ...cur, messages });
      return;
    }
    setS({ path: d.path, virtual: { text: fill(d), raw: d.text }, duplicates: [], messages, gen: (cur?.gen ?? 0) + 1 });
  };
  const updateRef = useRef(update);
  updateRef.current = update;
  useEffect(() => { void updateRef.current(); }, [refresh]);

  if (!s) return null;
  const info: DailyInfo = {
    date,
    virtual: s.virtual,
    duplicates: s.duplicates,
    messages: s.messages,
    onCreate: async (text: string): Promise<{ path: string; version: VersionDto }> => {
      const r = await ipc.dailyCreate(date, text);
      setS((c) => (c ? { ...c, path: r.path, virtual: null, duplicates: r.duplicates } : c));
      return { path: r.path, version: r.version };
    },
    onDay: (n) => nav.go(addDays(date, n)),
    onToday: nav.today,
    onPickDate: nav.pickDate,
    onOpenPath: nav.openPath,
    onDuplicateTitles: nav.duplicateTitles,
  };
  return <>{render(s.path, info, `${date}#${s.gen}`)}</>;
}
