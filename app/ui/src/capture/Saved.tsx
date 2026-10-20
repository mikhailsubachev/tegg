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
      {/* The app mark (D-164), as on the board's notification. */}
      <svg className="capture-saved-logo" viewBox="0 0 100 100" aria-hidden="true">
        <path d="M22 0 H78 C92 0 100 8 100 22 V78 C100 92 92 100 78 100 H22 C8 100 0 92 0 78 V22 C0 8 8 0 22 0 Z" fill="var(--logo-tile)" stroke="var(--logo-edge)" strokeWidth="3" />
        <path d="M24 28 H76 M50 28 V60" fill="none" stroke="var(--logo-mark)" strokeWidth="15" />
        <path d="M39 72 a11 11 0 1 0 22 0 a11 11 0 1 0 -22 0 Z" fill="var(--logo-mark)" />
      </svg>
      <div className="capture-saved-text">
        <div className="capture-saved-head"><strong>{t('capture.saved')}</strong><span className="capture-saved-when">{t('capture.now')}</span></div>
        <span className="capture-saved-line" data-user-content>{t('capture.savedLine', { type: s.typeName, title: s.title })}</span>
        <button type="button" className="capture-saved-open" onClick={() => void captureIpc.openMain(s.path)}>{t('capture.open')}</button>
      </div>
    </div>
  );
}
