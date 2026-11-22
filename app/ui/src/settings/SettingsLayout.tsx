// The shared settings layout (docs/contracts/v1-cards.md §6.1, §7.10, §8.4; app-shell R219; D-1959, D-1994): a section
// list on the left (`nav.settings-sections`, `Settings sections`) and the content; `SettingsRow` puts one label and its
// control in the two columns, with an optional note under the control. Type settings use it; Settings (slice OC-d)
// takes it over.
import type { ReactNode } from 'react';
import { t } from '../i18n/catalog';
import './layout.css';

export function SettingsLayout({ nav, children, className }: { nav: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`settings-layout${className ? ` ${className}` : ''}`}>
      <nav className="settings-sections" aria-label={t('frame.settingsSections')}>{nav}</nav>
      <div className="settings-content">{children}</div>
    </div>
  );
}

/** One labelled control: `<label for>` (or `id`, read by the control's `aria-labelledby`), the control, the note. */
export function SettingsRow({ label, labelFor, labelId, note, noteId, children, className }: {
  label: ReactNode; labelFor?: string; labelId?: string; note?: ReactNode; noteId?: string; children: ReactNode; className?: string;
}) {
  return (
    <div className={`settings-row${className ? ` ${className}` : ''}`}>
      {labelFor ? <label className="settings-label" htmlFor={labelFor} id={labelId}>{label}</label> : <span className="settings-label" id={labelId}>{label}</span>}
      <div className="settings-control">
        {children}
        {note && <p className="settings-note" id={noteId}>{note}</p>}
      </div>
    </div>
  );
}
