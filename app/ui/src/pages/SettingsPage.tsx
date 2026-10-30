// Settings (FR-SET-02 theme part, D-128): a section list; Appearance has the Theme control; 5B builds Vault, Menu bar
// and startup, Shortcuts and Date & time (R58); slice P builds Previews (FR-SET-07); the rest is TBD (R1, R3).
import { useId, useSyncExternalStore } from 'react';
import { t } from '../i18n/catalog';
import { DELAY_MAX, DELAY_MIN, DELAY_STEP } from '../preview/state';
import { getPrefs, subscribe, updatePrefs } from '../preview/store';
import type { PreviewMode } from '../preview/types';
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
      <h1 ref={heading} tabIndex={-1}>{id === 'settings/backups' ? t('backups.title') : id === 'settings/previews' ? t('settings.previews') : t(def.name)}</h1>
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
      ) : id === 'settings/previews' ? (
        <PreviewSettings />
      ) : id === 'settings/date-time' ? (
        <DateTimeSettings value={dateTime} onChange={onDateTime} />
      ) : (
        <Placeholder def={def} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Previews (FR-SET-07, D-923; v1-previews §4)
// The Object preview mode and the hover delay, machine-local.
const MODES: [PreviewMode, string][] = [['click', 'settings.preview.click'], ['hover', 'settings.preview.hover'], ['off', 'settings.preview.off']];

export function setPreviewMode(mode: PreviewMode): void {
  if (getPrefs().mode === mode) return;
  updatePrefs((d) => ({ ...d, mode }));
}

function PreviewSettings() {
  const prefs = useSyncExternalStore(subscribe, getPrefs);
  const id = useId();
  const hover = prefs.mode === 'hover';
  const setDelay = (v: number) => {
    const next = Math.max(DELAY_MIN, Math.min(DELAY_MAX, v));
    if (!hover || next === prefs.hoverDelay) return;
    updatePrefs((d) => ({ ...d, hoverDelay: next }));
  };
  const onRadioKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (d) {
      e.preventDefault();
      const [m] = MODES[(i + d + MODES.length) % MODES.length];
      setPreviewMode(m);
      const group = (e.currentTarget as HTMLElement).parentElement;
      requestAnimationFrame(() => (group?.querySelector(`[data-mode="${m}"]`) as HTMLElement | null)?.focus());
    } else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setPreviewMode(MODES[i][0]); }
  };
  const onSliderKey = (e: React.KeyboardEvent) => {
    const v = prefs.hoverDelay;
    const next = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? v + DELAY_STEP : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? v - DELAY_STEP
      : e.key === 'Home' ? DELAY_MIN : e.key === 'End' ? DELAY_MAX : null;
    if (next === null) return;
    e.preventDefault();
    setDelay(next);
  };
  const pct = ((prefs.hoverDelay - DELAY_MIN) / (DELAY_MAX - DELAY_MIN)) * 100;
  return (
    <div className="settings-body">
      <div className="setting">
        <span className="setting-label" id={`${id}-mode`}>{t('settings.preview.mode')}</span>
        <div role="radiogroup" aria-labelledby={`${id}-mode`} className="radio-list">
          {MODES.map(([m, key], i) => (
            <button key={m} type="button" role="radio" data-mode={m} aria-checked={prefs.mode === m} aria-label={t(key)} data-command={`preview.mode.${m}`}
              tabIndex={prefs.mode === m ? 0 : -1} className={`radio-row${prefs.mode === m ? ' on' : ''}`}
              onClick={(e) => { e.currentTarget.focus(); setPreviewMode(m); }} onKeyDown={(e) => onRadioKey(e, i)}>
              <span className="radio-dot" aria-hidden="true" />
              {t(key)}
            </button>
          ))}
        </div>
      </div>
      <div className="setting">
        <span className="setting-label" id={`${id}-delay`}>{t('settings.preview.delay')}</span>
        <div className="slider-row">
          <div role="slider" tabIndex={0} aria-labelledby={`${id}-delay`} aria-valuemin={DELAY_MIN} aria-valuemax={DELAY_MAX} aria-valuenow={prefs.hoverDelay}
            aria-valuetext={t('settings.preview.delayValue', { ms: prefs.hoverDelay })} aria-disabled={hover ? undefined : 'true'} aria-describedby={`${id}-note`}
            data-command="settings.previewDelay" className={`slider${hover ? '' : ' disabled'}`} onKeyDown={onSliderKey}
            onPointerDown={(e) => {
              if (!hover) return;
              const r = e.currentTarget.getBoundingClientRect();
              const at = (x: number) => Math.round((DELAY_MIN + ((x - r.left) / r.width) * (DELAY_MAX - DELAY_MIN)) / DELAY_STEP) * DELAY_STEP;
              setDelay(at(e.clientX));
            }}>
            <span className="slider-track"><span className="slider-fill" style={{ width: `${pct}%` }} /></span>
            <span className="slider-thumb" style={{ left: `${pct}%` }} />
          </div>
          <span className="slider-value">{t('settings.preview.delayValue', { ms: prefs.hoverDelay })}</span>
        </div>
        <p className="setting-note" id={`${id}-note`}>{t('settings.preview.delayNote')}</p>
      </div>
    </div>
  );
}
