import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { t } from './strings';

type Kind = 'quick-note' | 'task';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('form');
const text = $<HTMLTextAreaElement>('text');
const due = $<HTMLInputElement>('due');
const status = $<HTMLSpanElement>('status');
let kind: Kind = 'quick-note';

// FR-CAP-03: the window is created hidden at startup; opening only resets and focuses it.
// "Ready" = field focused, two frames painted, so the cursor is visible to the user (S3-QA AC-3).
await listen<{ seq: number; kind: Kind }>('capture:open', ({ payload }) => {
  kind = payload.kind;
  $('kind-label').textContent = t(kind === 'task' ? 'kind.task' : 'kind.quick-note');
  $('due-wrap').hidden = kind !== 'task';
  text.value = '';
  due.value = '';
  status.textContent = '';
  text.focus();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (document.activeElement === text) void invoke('capture_ready', { seq: payload.seq });
    }),
  );
});

async function save() {
  if (!text.value.trim()) {
    status.textContent = t('capture.empty');
    return;
  }
  try {
    await invoke<string>('save_capture', { capture: { kind, text: text.value, due: due.value || null } });
    status.textContent = t('capture.saved');
  } catch (e) {
    status.textContent = t('capture.error', String(e));
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  void save();
});
$('cancel').addEventListener('click', () => void invoke('hide_capture'));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') void invoke('hide_capture');
  if (e.key === 'Enter' && e.metaKey) {
    e.preventDefault();
    void save();
  }
});
