// Settings (FR-SET-02 theme part, D-128): a section list; Appearance has the Theme control; 5B builds Vault, Menu bar
// and startup, Shortcuts and Date & time (R58); the rest is TBD with its milestone (R1, R3).
import { t } from '../i18n/catalog';
import type { ThemeChoice } from '../shell/commands';
import { Disabled } from '../shell/Disabled';
import { Placeholder } from '../shell/Placeholder';
import { ROUTES, routeDef } from '../shell/registry';
import type { DateTimeUiDto, TypeDefDto, VaultInfo } from '../ipc/types';
import { DateTimeSettings, MenuBarSettings, ShortcutsSettings, VaultSettings } from './settings5b';
import { BackupsSection } from './BackupsPage';

const SECTIONS: [string, string][] = [
  ['settings/appearance', 'settings.appearance'],
  ['settings/date-time', 'settings.dateTime'],
  ['settings/vault', 'settings.vault'],
  ['settings/shortcuts', 'settings.shortcuts'],
  ['settings/menu-bar', 'settings.menuBar'],
  ['settings/backups', 'backups.title'],
  ['settings/trash-history', 'settings.trashHistory'],
  ['settings/previews', 'settings.previews'],
];
const CHOICES: [ThemeChoice, string][] = [['system', 'settings.theme.system'], ['light', 'settings.theme.light'], ['dark', 'settings.theme.dark']];

export function SettingsPage({ id, theme, heading, onSection, onTheme, vault, types, refresh, dateTime, onDateTime, onStarter, onOpenFolder, commandTitle }: {
  id: string;
  theme: ThemeChoice;
  heading: React.RefObject<HTMLHeadingElement | null>;
  onSection: (id: string) => void;
  onTheme: (c: ThemeChoice) => void;
  // 5B (R58).
  vault: VaultInfo | null;
  types: TypeDefDto[];
  refresh: number;
  dateTime: DateTimeUiDto | undefined;
  onDateTime: (v: DateTimeUiDto) => void;
  onStarter: () => void;
  onOpenFolder: () => void;
  commandTitle: (id: string) => string | null;
}) {
  const def = routeDef(id) ?? ROUTES.find((r) => r.id === 'settings/appearance')!;
  return (
    <div className="page-column settings">
      <h1 ref={heading} tabIndex={-1}>{id === 'settings/backups' ? t('backups.title') : t(def.name)}</h1>
      <nav className="settings-sections" aria-label={t('frame.settingsSections')}>
        {SECTIONS.map(([sid, key]) => (
          <a
            key={sid}
            href="#"
            tabIndex={0}
            aria-current={sid === id ? 'page' : undefined}
            data-command={`goto.${sid}`}
            onClick={(e) => { e.preventDefault(); onSection(sid); }}
          >
            {t(key)}
          </a>
        ))}
      </nav>
      {id === 'settings/appearance' ? (
        <div className="settings-body">
          <div className="setting">
            <span className="setting-label" id="theme-label">{t('settings.theme')}</span>
            <div role="radiogroup" aria-labelledby="theme-label" aria-label={t('settings.theme')} className="segmented">
              {CHOICES.map(([c, key]) => (
                <button tabIndex={0}
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={theme === c}
                  aria-label={t(key)}
                  data-command={`theme.${c}`}
                  className={theme === c ? 'on' : ''}
                  onClick={(e) => { e.currentTarget.focus(); onTheme(c); }}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onTheme(c); }
                  }}
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <Disabled control="ctl.font" />
            <Disabled control="ctl.fontSize" />
            <Disabled control="ctl.accentColor" />
          </div>
        </div>
      ) : id === 'settings/vault' && vault ? (
        <VaultSettings vault={vault} types={types} refresh={refresh} onStarter={onStarter} onOpenFolder={onOpenFolder} />
      ) : id === 'settings/menu-bar' ? (
        <MenuBarSettings />
      ) : id === 'settings/shortcuts' ? (
        <ShortcutsSettings commandTitle={commandTitle} />
      ) : id === 'settings/backups' ? (
        <BackupsSection />
      ) : id === 'settings/date-time' ? (
        <DateTimeSettings value={dateTime} onChange={onDateTime} />
      ) : (
        <Placeholder def={def} />
      )}
    </div>
  );
}
