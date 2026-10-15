// Add starter types (FR-VLT-02 AC-9, D-244): lists the starter types that will be added and those skipped with the
// reason (same name or same folder, data-safety FR-VLT-02 AC-4) and the templates that exist and are kept; `Add`
// writes only new files (`starter_add`). Opening the dialog writes nothing.
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { StarterPlanDto } from '../ipc/types';
import { typeErrorMessage } from './util';

/** `reading-note` → `Reading Note` (the starter types' names, R11). */
const nameOf = (key: string) => key.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export function StarterTypesDialog({ onAdded, onClose }: { onAdded: () => void; onClose: () => void }) {
  const [plan, setPlan] = useState<StarterPlanDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => { ipc.starterPlan().then(setPlan, (e) => setError(typeErrorMessage(e))); }, []);
  useEffect(() => { if (plan) ref.current?.querySelector<HTMLElement>('.dialog-buttons button:last-child')?.focus(); }, [plan]);
  const add = async () => {
    try {
      await ipc.starterAdd();
      onAdded();
    } catch (e) {
      setError(typeErrorMessage(e));
    }
  };
  const none = plan !== null && plan.add.length === 0;
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={t('starter.title')} className="dialog starter-dialog"
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
        <h2>{t('starter.title')}</h2>
        {none && <p role="status">{t('starter.allPresent')}</p>}
        {plan && !none && (
          <>
            <h3>{t('starter.willAdd')}</h3>
            <ul aria-label={t('starter.willAdd')}>{plan.add.map((k) => <li key={k}>{nameOf(k)}</li>)}</ul>
          </>
        )}
        {plan && plan.skip.length > 0 && (
          <>
            <h3>{t('starter.skipped')}</h3>
            <ul aria-label={t('starter.skipped')}>
              {plan.skip.map((s) => (
                <li key={s.key}>{nameOf(s.key)}: {s.reason === 'folderUsed' ? t('starter.folderUsed', { folder: s.folder ?? '' }) : t('starter.nameExists')}</li>
              ))}
            </ul>
          </>
        )}
        {plan && plan.skipTemplates.length > 0 && !none && (
          <p>{t('starter.keptTemplates')} {plan.skipTemplates.map((p) => <code key={p} data-user-content>{p} </code>)}</p>
        )}
        {error && <p role="alert" className="field-error">{error}</p>}
        <div className="dialog-buttons">
          {none ? <button data-command="starter.button0" type="button" onClick={onClose}>{t('starter.close')}</button> : (
            <>
              <button data-command="starter.button1" type="button" onClick={onClose}>{t('starter.cancel')}</button>
              <button data-command="starter.button2" type="button" className="primary" disabled={!plan} onClick={() => void add()}>{t('starter.add')}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
