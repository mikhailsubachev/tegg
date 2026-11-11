// What a link chip shows beyond its icon and title (D-600, D-601, D-599; design board `LinkChips`; ms3-shell §16.1):
// the Unreviewed mark of an Inbox member and, for a Task, the due or completion date and the status. The editor's
// chips (DOM) and the read view's (React) draw the same suffix from `chipState`.
import { localDate, parseInstant } from '@tegg/doc';
import { t } from '../i18n/catalog';
import type { TypeDto } from '../ipc/types';
import { currentRegion } from '../tasks/useTasks';
import { shortDate } from '../tasks/views';
import { appZone } from '../zone';
import { chipTypes } from './icons';

export type ChipTarget = { kind: string; type?: string | null; review?: string | null; status?: string | null; due?: string | null; completed?: string | null };
export type TaskState = 'open' | 'in-progress' | 'done' | 'cancelled';
export type ChipState = {
  /** 6A (R74): `data-link-state`: a live target, none, or one only in the trash. */
  link: 'ok' | 'broken' | 'trashed';
  unreviewed: boolean;
  task: null | { state: TaskState; status: string; color: string | null; date: string | null; tone: 'none' | 'today' | 'overdue' | 'done' };
};

const nfc = (s: string) => s.normalize('NFC');
const STATES: Record<string, TaskState> = { open: 'open', 'in progress': 'in-progress', 'in-progress': 'in-progress', done: 'done', cancelled: 'cancelled', canceled: 'cancelled' };
/** FR-TSK-02 defaults for a status option without a `state`. */
const DEFAULT_STATE: Record<string, TaskState> = { 'to do': 'open', 'in progress': 'in-progress', waiting: 'open', done: 'done', cancelled: 'cancelled' };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function statusOf(label: string, types: TypeDto[]): { state: TaskState; color: string | null } {
  const task = types.find((x) => nfc(x.key) === 'task');
  const opt = task?.attributes.find((a) => a.key === 'status')?.options.find((o) => nfc(o.label) === nfc(label));
  const raw = opt?.state?.trim().toLowerCase();
  return { state: (raw && STATES[raw]) || DEFAULT_STATE[label.trim().toLowerCase()] || 'open', color: opt?.color ?? null };
}

/** FR-INB-01 membership: `review: unreviewed`, or a Quick Note or Daily Note that isn't `reviewed`. */
export function isUnreviewed(info: ChipTarget): boolean {
  if (info.kind !== 'note' && info.kind !== 'daily') return false;
  const r = info.review?.trim().toLowerCase() ?? null;
  if (r === 'unreviewed') return true;
  return (info.type === 'quick-note' || info.type === 'daily-note') && r !== 'reviewed';
}

export function chipState(info: ChipTarget | undefined | null, types: TypeDto[] = chipTypes() as TypeDto[], now = Date.now()): ChipState {
  if (!info) return { link: 'broken', unreviewed: false, task: null };
  const link = info.kind === 'trashed' ? 'trashed' : ['note', 'daily', 'media'].includes(info.kind) ? 'ok' : 'broken';
  if (link === 'trashed') return { link, unreviewed: false, task: null };
  const unreviewed = isUnreviewed(info);
  if (info.kind !== 'note' || info.type !== 'task' || !info.status) return { link, unreviewed, task: null };
  const zone = appZone();
  const today = localDate(now, zone);
  const region = currentRegion();
  const { state, color } = statusOf(info.status, types);
  if (state === 'done' || state === 'cancelled') {
    // D-599: the completion date in the vault zone, else nothing.
    const ms = info.completed ? parseInstant(info.completed, zone) : null;
    const day = ms !== null ? localDate(ms, zone) : null;
    return { link, unreviewed, task: { state, status: info.status, color, date: day ? shortDate(day, region) : null, tone: 'done' } };
  }
  const due = info.due && DATE.test(info.due) ? info.due : null;
  if (!due) return { link, unreviewed, task: { state, status: info.status, color, date: null, tone: 'none' } };
  if (due === today) return { link, unreviewed, task: { state, status: info.status, color, date: t('task.due.today'), tone: 'today' } };
  return { link, unreviewed, task: { state, status: info.status, color, date: shortDate(due, region), tone: due < today ? 'overdue' : 'none' } };
}

/** The chip's data attributes (ms3-shell §16.1). */
export function chipAttrs(s: ChipState): Record<string, string> {
  const a: Record<string, string> = { 'data-link-state': s.link };
  if (s.unreviewed) a['data-review'] = 'unreviewed';
  if (s.task) a['data-task-state'] = s.task.state;
  return a;
}

/** The box a task chip shows by state (D-600): empty while open, ticked when done, crossed when cancelled. */
export function taskGlyph(s: ChipState): string | null {
  if (!s.task) return null;
  return s.task.state === 'done' ? 'task' : s.task.state === 'cancelled' ? 'task-cancelled' : 'task-open';
}

/** The suffix after the title: the Unreviewed dot, or the task's ` | date · ● status`. */
export function chipSuffix(s: ChipState): HTMLElement | null {
  if (!s.unreviewed && !s.task) return null;
  const el = document.createElement('span');
  el.className = 'chip-suffix';
  if (s.task) {
    const div = document.createElement('span');
    div.className = 'chip-div';
    div.setAttribute('aria-hidden', 'true');
    el.appendChild(div);
    if (s.task.date) {
      const d = document.createElement('span');
      d.className = 'chip-date';
      d.dataset.tone = s.task.tone;
      // A date is the region's text, not a catalog string (NFR-OTH-02); `Today` (tone `today`) is the catalog's.
      if (s.task.tone !== 'today') d.setAttribute('data-user-content', '');
      d.textContent = s.task.date;
      el.appendChild(d);
      const dot = document.createElement('span');
      dot.className = 'chip-sep';
      dot.setAttribute('aria-hidden', 'true');
      dot.textContent = '·';
      el.appendChild(dot);
    }
    const st = document.createElement('span');
    st.className = 'chip-status';
    const sd = document.createElement('span');
    sd.className = 'chip-status-dot';
    sd.setAttribute('aria-hidden', 'true');
    if (s.task.color) sd.style.background = `var(--type-${s.task.color})`;
    else if (s.task.state === 'done') sd.style.background = 'var(--accent)';
    else if (s.task.state === 'in-progress') sd.style.background = 'var(--link)';
    st.appendChild(sd);
    const label = document.createElement('span');
    label.setAttribute('data-user-content', '');
    label.textContent = s.task.status;
    st.appendChild(label);
    el.appendChild(st);
  }
  if (s.unreviewed) {
    const u = document.createElement('span');
    u.className = 'chip-unrev';
    u.setAttribute('aria-hidden', 'true');
    el.appendChild(u);
  }
  return el;
}

/** `data-icon` of the state box: the board's names (an empty, a ticked and a crossed square). */
export function taskIconDef(s: ChipState): string {
  return s.task?.state === 'done' ? 'check-square' : s.task?.state === 'cancelled' ? 'x-square' : 'square';
}

/** 6A (R74): the description of a chip whose target is only in the trash. */
export function trashedText(): string {
  return t('trash.inTrash');
}

/** The accessible description an Unreviewed chip adds (joined to any other). */
export function unreviewedText(): string {
  return t('link.unreviewed');
}
