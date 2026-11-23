// Slice AND-1 (docs/contracts/android-shell.md §9.2; FR-VLT-01 AC-19…AC-21, RA3, RA5): the screens before a vault is
// open on the phone: "All files access" and the vault being opened.
import { useState } from 'react';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';

/** The permission screen (D-2016). `rechecks` counts the start answers that were still `needsAccess` after the page came
 *  back to the foreground; one after `Open settings` shows `android.access.stillOff`. */
export function AccessScreen({ path, rechecks }: { path?: string; rechecks: number }) {
  const [askedAt, setAskedAt] = useState<number | null>(null);
  return (
    <main className="chooser android-access" aria-label={t('android.access.title')}>
      <div className="chooser-card">
        <h1>{t('android.access.title')}</h1>
        <p className="hint">{t('android.access.body')}</p>
        {path && <p className="path" data-user-content>{t('android.access.vault', { path })}</p>}
        {askedAt !== null && rechecks > askedAt && <p className="message" role="status">{t('android.access.stillOff')}</p>}
        <div className="chooser-actions">
          <button tabIndex={0} type="button" className="primary" data-command="android.openSettings"
            onClick={() => { setAskedAt(rechecks); void ipc.storageAccessSettings().catch(() => {}); }}>
            {t('android.access.openSettings')}
          </button>
        </div>
      </div>
    </main>
  );
}

/** The vault being opened (RA3 `opening`): no sidebar, no chooser. */
export function OpeningScreen({ name }: { name: string }) {
  return (
    <main className="chooser android-opening" aria-label={t('vault.opening', { name })}>
      <p role="status" className="hint">{t('vault.opening', { name })}</p>
    </main>
  );
}
