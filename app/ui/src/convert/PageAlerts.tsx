// 5A-2: the page's alerts from the conversion flow and Task cards (FR-CNV-03 AC-6, FR-CNV-06 AC-3, FR-CNV-05 AC-7),
// shown by the note page; slice AND-3 (android-edit §2.4 row 4) shows them on the phone's type page too, where a task
// checkbox's write can be refused (FR-SYN-03 AC-42).
import { t } from '../i18n/catalog';
import { Icon } from '../shell/Icon';
import { dismissAlert, usePageAlerts } from './alerts';

export function PageAlerts() {
  const alerts = usePageAlerts();
  return (
    <>
      {alerts.map((a) => (
        <div key={a.id} role="alert" className="save-alert">
          <span>{a.text}</span>
          {a.retry && <button type="button" tabIndex={0} data-command="task.tryAgain" onClick={() => { dismissAlert(a.id); a.retry!(); }}>{t('task.tryAgain')}</button>}
          <button type="button" tabIndex={0} className="icon-button" data-command="task.dismissAlert" aria-label={t('dialog.close')} onClick={() => dismissAlert(a.id)}><Icon name="x" size={14} /></button>
        </div>
      ))}
    </>
  );
}
