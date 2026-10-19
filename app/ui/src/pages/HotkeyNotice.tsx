// D-71, D-548 (FR-CAP-05 AC-5): once per launch, a non-modal notice in the main window when a global shortcut couldn't
// be set up, with a link to Settings: Shortcuts.
import { useEffect, useState } from 'react';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';

let shown = false;

export function HotkeyNotice({ onSettings }: { onSettings: () => void }) {
  const [keys, setKeys] = useState<string | null>(null);
  useEffect(() => {
    if (shown) return;
    void ipc.hotkeys().then((h) => {
      const taken = h.find((x) => x.state === 'taken');
      if (taken && !shown) { shown = true; setKeys(taken.keys); }
    }, () => {});
  }, []);
  if (!keys) return null;
  return (
    <div className="banner hotkeys-notice" role="status">
      <span>{t('hotkeys.notice', { shortcut: keys })}</span>{' '}
      <a href="#" tabIndex={0} data-command="goto.settings/shortcuts" onClick={(e) => { e.preventDefault(); setKeys(null); onSettings(); }}>{t('hotkeys.noticeLink')}</a>
      <button type="button" tabIndex={0} className="icon-button" data-command="app.dismissNotice" aria-label={t('dialog.close')} onClick={() => setKeys(null)}>×</button>
    </div>
  );
}
