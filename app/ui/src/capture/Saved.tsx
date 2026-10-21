// R55 "After saving" (D-543; no logo, D-597): the non-activating panel `Saved to Inbox` with `<Type> · <title>` and `Open`.
import { useEffect, useState } from 'react';
import { t } from '../i18n/catalog';
import { captureEvents, captureIpc, type CaptureSaved } from '../ipc/capture';

export function Saved() {
  const [s, setS] = useState<CaptureSaved | null>(null);
  useEffect(() => {
    // D-604: without a heading, a type without the review workflow says where it went (`Saved to <plural>`).
    const off = captureEvents.saved((p) => {
      setS(p);
      if (p.heading) return;
      void captureIpc.context().then((c) => {
        const def = c.types.find((x) => x.name === p.typeName);
        if (def && def.review === 'off') setS((cur) => (cur === p ? { ...p, heading: t('capture.savedTo', { plural: def.plural ?? (def.folder.split('/').filter(Boolean).pop() || def.name) }) } : cur));
      }).catch(() => {});
    });
    return () => { void off.then((f) => f()); };
  }, []);
  if (!s) return null;
  return (
    <div className="capture-saved" role="status" aria-live="polite">
      <div className="capture-saved-text">
        <div className="capture-saved-head"><strong>{s.heading ?? t('capture.saved')}</strong><span className="capture-saved-when">{t('capture.now')}</span></div>
        <span className="capture-saved-line" data-user-content>{t('capture.savedLine', { type: s.typeName, title: s.title })}</span>
        <button type="button" className="capture-saved-open" onClick={() => void captureIpc.openMain(s.path)}>{t('capture.open')}</button>
      </div>
    </div>
  );
}
