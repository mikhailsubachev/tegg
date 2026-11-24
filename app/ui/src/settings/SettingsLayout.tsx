// The shared settings layout (docs/contracts/v1-cards.md §6.1, §7.10, §8.4; app-shell R219; D-2071, D-2106): a section
// list on the left (`nav.settings-sections`, `Settings sections`) and the content; `SettingsRow` puts one label and its
// control in the two columns, with an optional note under the control. Type settings use it; Settings (slice OC-d)
// takes it over.
import type { ReactNode } from 'react';
import { t } from '../i18n/catalog';
import './layout.css';

export function SettingsLayout({ nav, children, className }: { /** null: no section list (the phone, AND-2). */ nav: ReactNode | null; children: ReactNode; className?: string }) {
  return (
    <div className={`settings-layout${className ? ` ${className}` : ''}`}>
      {nav !== null && <nav className="settings-sections" aria-label={t('frame.settingsSections')}>{nav}</nav>}
      <div className="settings-content">{children}</div>
    </div>
  );
}

/** One labelled control: `<label for>` (or `id`, read by the control's `aria-labelledby`), the control, the note. Without
 *  a `label` the row has only the control column (a group such as Shortcuts' tables, R219 "Groups"); `labelHidden`
 *  keeps a visible label out of the accessibility tree where the control carries the same name (one element per name). */
export function SettingsRow({ label, labelFor, labelId, labelHidden, note, noteId, children, className }: {
  label?: ReactNode; labelFor?: string; labelId?: string; labelHidden?: boolean; note?: ReactNode; noteId?: string; children: ReactNode; className?: string;
}) {
  const hide = labelHidden ? true : undefined;
  return (
    <div className={`settings-row${className ? ` ${className}` : ''}`}>
      {label === undefined ? null : labelFor
        ? <label className="settings-label" htmlFor={labelFor} id={labelId} aria-hidden={hide}>{label}</label>
        : <span className="settings-label" id={labelId} aria-hidden={hide}>{label}</span>}
      <div className="settings-control">{children}</div>
      {/* The note in the control column, under the control (a sibling, so the control's box ends above it). */}
      {note && <p className="settings-note" id={noteId}>{note}</p>}
    </div>
  );
}
