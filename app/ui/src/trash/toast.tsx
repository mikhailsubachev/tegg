// Slice 6A (ms6-trash-media §6.2; D-616): the status line of Move to trash and Restore (`role="status"`, with `Undo`
// after a move) and the trash alerts (`role="alert"`), shown in the centre pane whatever page follows.
import { useSyncExternalStore } from 'react';
import { t } from '../i18n/catalog';
import { Icon } from '../shell/Icon';

type Toast = { id: number; text: string; undo?: () => void } | null;
type Alert = { id: number; text: string; action?: { label: string; run: () => void } };

let toast: Toast = null;
let alerts: Alert[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
let timer: ReturnType<typeof setTimeout> | null = null;

export function showToast(text: string, undo?: () => void, ms = 8000): void {
  toast = { id: ++seq, text, undo };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { toast = null; emit(); }, ms);
  emit();
}

/** A non-modal alert (`role="alert"`), with an optional action such as `Try again` (6A: trash and media). */
export function showAlert(text: string, action?: { label: string; run: () => void }): void {
  alerts = [...alerts.filter((a) => a.text !== text), { id: ++seq, text, action }];
  emit();
}

function dismiss(id: number): void {
  alerts = alerts.filter((a) => a.id !== id);
  emit();
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export function TrashMessages() {
  const s = useSyncExternalStore(subscribe, () => `${toast?.id ?? 0}:${alerts.map((a) => a.id).join(',')}`);
  void s;
  return (
    <>
      {alerts.map((a) => (
        <div key={a.id} className="banner trash-alert" role="alert">
          <span>{a.text}</span>
          {a.action && <button type="button" tabIndex={0} onClick={() => { dismiss(a.id); a.action!.run(); }}>{a.action.label}</button>}
          <button type="button" tabIndex={0} className="icon-button small" aria-label={t('trash.dismiss')} onClick={() => dismiss(a.id)}><Icon name="x" size={12} /></button>
        </div>
      ))}
      {toast && (
        <div className="job-status trash-toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button type="button" className="link-button" onClick={() => { const u = toast?.undo; toast = null; emit(); u?.(); }}>{t('trash.undo')}</button>
          )}
        </div>
      )}
    </>
  );
}
