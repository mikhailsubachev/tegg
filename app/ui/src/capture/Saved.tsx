// R55 "After saving" (D-543): the non-activating panel `Saved to Inbox` with `<Type> · <title>` and `Open`.
import { useEffect, useState } from 'react';
import { t } from '../i18n/catalog';
import { captureEvents, captureIpc, type CaptureSaved } from '../ipc/capture';

export function Saved() {
  const [s, setS] = useState<CaptureSaved | null>(null);
  useEffect(() => {
    const off = captureEvents.saved(setS);
    return () => { void off.then((f) => f()); };
  }, []);
  if (!s) return null;
  return (
    <div className="capture-saved" role="status" aria-live="polite">
      <div className="capture-saved-text">
        <strong>{t('capture.saved')}</strong>
        <span>{t('capture.savedLine', { type: s.typeName, title: s.title })}</span>
      </div>
      <button type="button" onClick={() => void captureIpc.openMain(s.path)}>{t('capture.open')}</button>
    </div>
  );
}
