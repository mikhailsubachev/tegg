// Slice 6A (ms6-trash-media §6.2; D-616): the status line of Move to trash and Restore (`role="status"`, with `Undo`
// after a move) and the trash alerts (`role="alert"`), shown in the centre pane whatever page follows.
import { useSyncExternalStore } from 'react';
import { t } from '../i18n/catalog';
import { Icon } from '../shell/Icon';

type Toast = { id: number; text: string; undo?: () => void } | null;
type Alert = { id: number; text: string } | null;

let toast: Toast = null;
let alert: Alert = null;
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

export function showAlert(text: string): void {
  alert = { id: ++seq, text };
  emit();
}

export function clearTrashAlert(): void {
  if (alert) { alert = null; emit(); }
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export function TrashMessages() {
  const s = useSyncExternalStore(subscribe, () => `${toast?.id ?? 0}:${alert?.id ?? 0}`);
  void s;
  return (
    <>
      {alert && (
        <div className="banner trash-alert" role="alert">
          <span>{alert.text}</span>
          <button type="button" className="icon-button small" aria-label={t('trash.dismiss')} onClick={clearTrashAlert}><Icon name="x" size={12} /></button>
        </div>
      )}
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
