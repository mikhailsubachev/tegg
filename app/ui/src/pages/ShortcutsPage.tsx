// D-608 (FR-UX-03 AC-14): Help › Keyboard Shortcuts: every shortcut of the registry by area, the global shortcuts with
// their state, and the editor's typing triggers. Read only; changing shortcuts is FR-SET-04 (v1.0).
import type { RefObject } from 'react';
import { t } from '../i18n/catalog';
import { GROUPS, grouped, INBOX_KEYS, ROUTE_TITLES, TRIGGERS } from '../shell/shortcutGroups';
import { useHotkeys } from './settings5b';

export function ShortcutsPage({ heading, commandTitle }: { heading: RefObject<HTMLHeadingElement | null>; commandTitle: (id: string) => string | null }) {
  const hotkeys = useHotkeys();
  const groups = grouped();
  const table = (caption: string, rows: [string, string, string?][]) => (
    <section key={caption} aria-label={caption} className="shortcuts-group">
    <h2>{caption}</h2>
    {rows.length === 0 ? <p className="muted">{t('help.noShortcuts')}</p> : (
    <table aria-label={caption} className="settings-table shortcuts-table">
      <thead><tr><th>{t('settings.shortcuts.action')}</th><th>{t('settings.shortcuts.shortcut')}</th></tr></thead>
      <tbody>{rows.map(([name, keys, note], i) => <tr key={`${keys}-${i}`}><td>{name}{note && <span className="muted"> · {note}</span>}</td><td><kbd>{t('shortcut.keys', { keys })}</kbd></td></tr>)}</tbody>
    </table>
    )}
    </section>
  );
  const global: [string, string, string?][] = [['quick-capture', 'settings.shortcuts.quickCapture', '⌃⌥Space'], ['new-task', 'settings.shortcuts.newTask', '⌃⌥T']].map(([id, label, keys]) => {
    const st = hotkeys.find((x) => x.id === id)?.state ?? 'active';
    return [t(label), keys, st === 'active' ? t('settings.shortcuts.active') : t('settings.shortcuts.taken')];
  });
  return (
    <div className="page-column shortcuts-page">
      <h1 ref={heading} tabIndex={-1}>{t('help.shortcuts')}</h1>
      {table(t('settings.shortcuts.global'), global)}
      {GROUPS.map((g) => {
        const rows: [string, string][] = (groups.get(g) ?? []).map((s) => [commandTitle(s.command) ?? (ROUTE_TITLES[s.command] ? t(ROUTE_TITLES[s.command]) : s.command), s.keys]);
        if (g === 'inbox') rows.push(...INBOX_KEYS.map(([k, label]): [string, string] => [t(label), k]));
        return table(t(`help.group.${g}`), rows);
      })}
      {table(t('help.group.typing'), TRIGGERS.map(([k, label]) => [t(label), k]))}
    </div>
  );
}
