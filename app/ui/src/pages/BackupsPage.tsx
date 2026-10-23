// Settings › Backups (docs/acceptance/tags.md R85; D-396, D-651, D-670, D-671): the open vault's zips newest first
// with their operation labels, `Restore "<label>"…` (a `restore` job after a confirmation) and `Show in Finder`.
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { BackupDto } from '../ipc/types';
import { runConfirmed } from '../jobs/jobs';
import { showAlert } from '../trash/toast';
import { dateTimeText } from '../types/util';
import { Dialog } from './TypeSettingsPage';

/** The label of a zip (AP-600): catalog key and arguments; a `restore` zip's time is shown in the D-160 format. */
export function backupLabel(b: BackupDto): string {
  const args = { ...(b.label?.args ?? {}) } as Record<string, string | number>;
  if (b.label?.key === 'backups.label.restore' && typeof args.time === 'string') args.time = dateTimeText(args.time);
  return t(b.label?.key ?? 'backups.label.unknown', { kind: b.kind, ...args });
}

export function BackupsSection() {
  const [list, setList] = useState<BackupDto[] | null>(null);
  const [ask, setAsk] = useState<BackupDto | null>(null);
  const cancel = useRef<HTMLButtonElement | null>(null);
  const load = () => { void ipc.backupsList().then(setList, () => setList([])); };
  useEffect(load, []);
  useEffect(() => { if (ask) setTimeout(() => cancel.current?.focus(), 0); }, [ask]);
  const restore = async (b: BackupDto) => {
    setAsk(null);
    await runConfirmed(() => ipc.backupRestore(b.name), {
      confirm: false,
      running: () => t('backups.restoring'),
      done: (r) => t('backups.restored', { count: r.written.length }),
      finished: () => load(),
    }).catch(() => showAlert(t('error.io')));
  };
  return (
    <div className="settings-body backups">
      <p className="hint">{t('backups.intro')}</p>
      {list && list.length === 0 && <p className="empty">{t('backups.empty')}</p>}
      <ul aria-label={t('backups.list')} className="backup-list">
        {(list ?? []).map((b) => {
          const label = backupLabel(b);
          return (
            <li key={b.name} className="backup-row">
              <span className="backup-label" data-user-content>{label}</span>
              <span className="backup-time">{dateTimeText(b.time)}</span>
              <span className="spacer" />
              <button data-command="backups.c4" tabIndex={0} type="button" className="text-button" onClick={() => setAsk(b)}>{t('backups.restore', { label })}</button>
              <button data-command="backups.c3" tabIndex={0} type="button" className="text-button" onClick={() => void ipc.backupReveal(b.name).catch(() => {})}>{t('backups.show')}</button>
            </li>
          );
        })}
      </ul>
      {ask && (
        <Dialog role="alertdialog" label={t('backups.confirmTitle')} onCancel={() => setAsk(null)} className="tag-dialog">
          <h2>{t('backups.confirmTitle')}</h2>
          <p>{t('backups.confirm')}</p>
          <div className="dialog-buttons">
            <button data-command="backups.c2" ref={cancel} autoFocus tabIndex={0} type="button" className="text-button" onClick={() => setAsk(null)}>{t('ts.cancel')}</button>
            <button data-command="backups.c1" tabIndex={0} type="button" className="text-button primary" onClick={() => void restore(ask)}>{t('backups.ok')}</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
