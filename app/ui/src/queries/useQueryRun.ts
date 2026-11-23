// Slice Q (docs/contracts/v1-queries.md §4.2 `useQueryRun.ts`, §2.3 live results, FR-QRY-09): one result list. It runs
// `query_run` once on mount and again, debounced 300 ms and coalesced, when (a) `vault:changed` holds its query file (or
// any query file while the query is missing / trashed / unreadable, or a type file); (b) `query:stale` names one of its
// types, or a path in its targets, rows or host (a query over all types: only when the change can reach its result);
// (c) the local date changes (checked every 30 s, D-327) and it uses relative dates. Never while a note body is being
// typed in (FR-QRY-09 AC-5): a re-run waits until the typing pauses. An answer equal to the drawn one redraws nothing.
import { useEffect, useRef, useState } from 'react';
import { events, ipc } from '../ipc/client';
import type { QueryEnvDto, QueryResultDto, QuerySourceDto, QueryStaleDto } from '../ipc/queries';
import { localDate } from '../zone';
import { queryEnv } from './env';

const nfc = (s: string) => s.normalize('NFC');
const nameKey = (s: string) => nfc(s.trim()).toLowerCase();
const stemOf = (p: string) => nfc((p.split('/').pop() ?? p).replace(/\.yml$/i, ''));
const QUERIES = '.tegg/queries/';
const TRASHED = '.trash/.tegg/queries/';

// Typing in a note body (a ProseMirror editor, FR-QRY-09 AC-5) postpones re-runs until it pauses. Other editable fields
// (the Title field, whose ⏎ is a new note's first write, D-522) don't. The pause is a timer, not a difference of
// wall-clock times: a clock that stands still or is set back must never hold the re-runs for good (§2.3).
const TYPING_PAUSE = 1200;
let typing: ReturnType<typeof setTimeout> | null = null;
let typingWatch = false;
function watchTyping() {
  if (typingWatch || typeof document === 'undefined') return;
  typingWatch = true;
  document.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement | null;
    if (!el?.isContentEditable || !el.closest('.ProseMirror') || e.metaKey || e.ctrlKey) return;
    if (typing) clearTimeout(typing);
    typing = setTimeout(() => { typing = null; }, TYPING_PAUSE);
  }, true);
}

/** `env`: the environment the shown result was run with (Q2-T §29.3: a period board's drops and tiles use its bounds). */
export type RunState = { result: QueryResultDto | null; loading: boolean; error: boolean; env?: QueryEnvDto | null };

/** The run of a list that was just unmounted: React's StrictMode mounts every effect twice in development, and a
 *  remount with the same source right away reuses the answer in flight instead of asking the core again. */
let disposed: { key: string; answer: Promise<QueryResultDto>; env: QueryEnvDto } | null = null;

/** `source` null: nothing runs (a draft). `key` re-runs at once when it changes (the fence's text, the host). */
export function useQueryRun(source: QuerySourceDto | null, host: string | null): RunState & { rerun: () => void } {
  // No core to ask (a view rendered outside the app shell): the run fails at once, so the block shows its source.
  const noCore = typeof window === 'undefined' || !(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  const [state, setState] = useState<RunState>({ result: null, loading: !!source, error: noCore });
  const key = source ? JSON.stringify([source, host]) : '';
  const live = useRef({ source, host, result: null as QueryResultDto | null });
  live.current.source = source;
  live.current.host = host;
  const run = useRef<() => void>(() => {});
  useEffect(() => {
    watchTyping();
    if (!source) { setState({ result: null, loading: false, error: false }); return; }
    let alive = true;
    let seq = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last: Promise<QueryResultDto> | null = null;
    let lastEnv: QueryEnvDto | null = null;
    const go = (reuse: { answer: Promise<QueryResultDto>; env: QueryEnvDto } | null = null) => {
      const s = live.current.source;
      if (!s) return;
      const n = ++seq;
      const env = reuse?.env ?? queryEnv();
      const answer = reuse?.answer ?? ipc.queryRun(s, live.current.host, env);
      last = answer;
      lastEnv = env;
      answer.then((r) => {
        if (!alive || n !== seq) return;
        const same = live.current.result && JSON.stringify(live.current.result) === JSON.stringify(r);
        live.current.result = r;
        if (!same) setState({ result: r, loading: false, error: false, env });
        else setState((x) => (x.loading || JSON.stringify(x.env) !== JSON.stringify(env) ? { ...x, loading: false, env } : x));
      }, () => { if (alive && n === seq) setState((x) => ({ ...x, loading: false, error: true })); });
    };
    const later = (ms = 300) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (typing) { later(TYPING_PAUSE / 4); return; }
        go();
      }, ms);
    };
    run.current = () => later(0);
    live.current.result = null;
    setState((x) => ({ ...x, loading: true, error: noCore }));
    const again = disposed && disposed.key === key ? { answer: disposed.answer, env: disposed.env } : null;
    disposed = null;
    go(again);
    const r = () => live.current.result;
    // (a) the query file, the queries folder while it can't be found or read, the trash's queries, the type files.
    const unChanged = events.changed((c) => {
      const res = r();
      const paths = (c.paths ?? []).map(nfc);
      const name = res?.name ?? (live.current.source?.kind === 'saved' ? live.current.source.name : null);
      const lookup = res?.lookup ?? null;
      // Slice OC (cards.md FR-TYP-11 AC-15, v1-cards §8.1): an Image or PDF card's file removed, changed or back draws
      // its strip again from the core's answer (R77's missing-file state when it is gone).
      const files = new Set<string>();
      for (const row of res?.rows ?? []) {
        const f = row.card?.file;
        if (!f) continue;
        if (f.path) files.add(nfc(f.path));
        else if (f.target) files.add(`*/${nfc(f.target).split('/').pop()}`);
      }
      const hit = paths.some((p) => {
        if (files.has(p) || files.has(`*/${p.split('/').pop()}`)) return true;
        if (p.startsWith('.tegg/types/')) return true;
        if (p.startsWith(QUERIES) && !p.slice(QUERIES.length).includes('/')) {
          if (lookup === 'missing' || lookup === 'trashed' || lookup === 'unreadable') return true;
          return !!name && nameKey(stemOf(p)) === nameKey(name);
        }
        if (p.startsWith(TRASHED)) return lookup === 'trashed' || lookup === 'missing';
        // A host note changed outside: links to it may have changed (only through vault:changed of `.md` files the
        // core reports `query:stale` too; the host itself is handled there).
        return false;
      });
      if (hit) later();
    });
    // (b) objects changed: their types, or a path the result depends on.
    const unStale = events.queryStale((s: QueryStaleDto) => {
      const res = r();
      if (!res) { later(); return; }
      const paths = s.paths.map(nfc);
      const near = new Set([...res.targets.map(nfc), ...res.rows.map((x) => nfc(x.path)), ...(live.current.host ? [nfc(live.current.host)] : [])]);
      if (paths.some((p) => near.has(p))) { later(); return; }
      const types = res.def?.types ?? [];
      if (types.length) {
        if (s.types.some((t) => types.some((x) => nfc(x) === nfc(t)))) later();
        return;
      }
      // All types: a new or changed object can only enter the result through what its filters ask. A top-level link
      // filter (`links to …`) narrows it to objects linking that target: ask the index whether any changed path does.
      const def = res.def;
      const linkTargets = def && def.match === 'all'
        ? def.filters.flatMap((f) => (f.kind === 'filter' && nfc(f.key) === 'links_to' ? [f.value] : []))
        : [];
      const target = linkTargets.length ? (linkTargets[0] === 'this' ? live.current.host : res.targets[0] ?? null) : null;
      if (!target) { later(); return; }
      void ipc.backlinks(target).then((b) => {
        const sources = new Set(b.groups.flatMap((g) => g.entries.map((e) => nfc(e.source))));
        if (paths.some((p) => sources.has(p))) later();
      }, () => later());
    });
    // (c) the local date (D-327) and the zone (Q2-T §27.6, R203 Live), for relative date filters and period boards.
    const zoneNow = () => queryEnv().zone;
    let day = `${localDate(Date.now())}\n${zoneNow()}`;
    const tick = setInterval(() => {
      const d = `${localDate(Date.now())}\n${zoneNow()}`;
      if (d === day) return;
      day = d;
      if (r()?.usesRelative) later(0);
    }, 30_000);
    // The first index build ending (the loading state, FR-QRY-06 AC-11).
    const unProgress = events.progress((p) => { if (p.state === 'done' && r() && !r()!.indexReady) later(0); });
    return () => {
      alive = false;
      if (last) {
        // StrictMode's remount comes in the same task; a later mount asks again.
        const d = { key, answer: last, env: lastEnv ?? queryEnv() };
        disposed = d;
        queueMicrotask(() => { if (disposed === d) disposed = null; });
      }
      if (timer) clearTimeout(timer);
      clearInterval(tick);
      void unChanged.then((f) => f()).catch(() => {});
      void unStale.then((f) => f()).catch(() => {});
      void unProgress.then((f) => f()).catch(() => {});
    };
  }, [key]);
  return { ...state, rerun: () => run.current() };
}
