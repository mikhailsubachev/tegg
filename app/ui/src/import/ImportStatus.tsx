// Slice I2 (docs/contracts/v1-import-window.md §6.1): the import's status element in the title bar (and over the
// chooser) while the window is hidden: `Importing <done> of <total>`, then `Import finished` / `Import stopped` with
// `Dismiss`. A click or ⏎ shows the window (step 6, or 7 at the end). It follows the run whatever vault is open.
import { t } from '../i18n/catalog';
import { Icon } from '../shell/Icon';
import { dismissStatus, showRun, statusText, useImport } from './store';

export function ImportStatus() {
  const s = useImport();
  const text = statusText(s);
  if (!text || !s.run) return null;
  const ended = !!s.run.result || !!s.run.failure;
  return (
    <span className="import-status" role="status">
      <button type="button" tabIndex={0} className="link-button" data-command="import.open" onClick={(e) => showRun(e.currentTarget)}>{text}</button>
      {ended && (
        <button type="button" tabIndex={0} className="icon-button small" aria-label={t('banner.dismiss')} onClick={dismissStatus}>
          <Icon name="x" size={12} />
        </button>
      )}
    </span>
  );
}
