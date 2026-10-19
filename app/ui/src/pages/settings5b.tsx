// Slice 5B Settings sections (docs/acceptance/capture.md R58; docs/contracts/ms5-capture.md §5; FR-SET-01, -03, -05,
// D-71, D-547, D-548, D-551, D-566): Vault (portable, written to the vault one line at a time), Menu bar and startup
// and Date & time (per machine), Shortcuts (read-only until v1.0).
import { useCallback, useEffect, useId, useState } from 'react';
import { dailyFileStem, localDate } from '@tegg/doc';
import { collator, region as regionOf } from '../i18n/collate';
import { firstDay, formatDate, formatDateTime, REGION_SETTING } from '../i18n/dates';
import { t } from '../i18n/catalog';
import { events, ipc } from '../ipc/client';
import type { DateTimeUiDto, HotkeyStateDto, ShellSettingsDto, TypeDefDto, VaultInfo, VaultSettingsDto } from '../ipc/types';
import { CONTROL_COMMANDS } from '../shell/commands';
import { Disabled } from '../shell/Disabled';
import { SHORTCUTS } from '../shell/registry';
import { appZone } from '../zone';

const nfc = (s: string) => s.normalize('NFC');

/** A text field that commits on ⏎ or blur and restores on Esc (FR-SET-01 AC-10); `error` is shown under it. */
function Field({ label, value, note, example, error, onCommit, onDraft }: {
  label: string; value: string; note?: string; example?: string; error: string | null; onCommit: (v: string) => void; onDraft?: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  const id = useId();
  useEffect(() => setText(value), [value]);
  const commit = () => { if (nfc(text.trim()) !== nfc(value) || error) onCommit(nfc(text.trim())); };
  return (
    <div className="setting">
      <label className="setting-label" htmlFor={`${id}-in`}>{label}</label>
      <input id={`${id}-in`} type="text" aria-label={label} value={text} spellCheck={false} autoComplete="off"
        aria-invalid={error ? true : undefined} aria-describedby={[error ? `${id}-err` : '', note ? `${id}-note` : ''].filter(Boolean).join(' ') || undefined}
        onChange={(e) => { setText(e.target.value); onDraft?.(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setText(value); onDraft?.(value); }
        }}
        onBlur={commit} />
      {example && <span className="muted setting-example" data-user-content>{example}</span>}
      {error && <span id={`${id}-err`} className="setting-error">{error}</span>}
      {note && <span id={`${id}-note`} className="muted setting-note">{note}</span>}
    </div>
  );
}

/** R58 `settings/vault` (FR-SET-01, FR-VLT-05). */
export function VaultSettings({ vault, types, refresh, onStarter, onOpenFolder }: {
  vault: VaultInfo; types: TypeDefDto[]; refresh: number; onStarter: () => void; onOpenFolder: () => void;
}) {
  const [s, setS] = useState<VaultSettingsDto | null>(null);
  const [daily, setDaily] = useState<TypeDefDto | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [format, setFormat] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [v, d] = await Promise.all([ipc.vaultSettings().catch(() => null), ipc.typeGet('daily-note').catch(() => null)]);
    if (v) setS(v);
    setDaily(d);
  }, []);
  useEffect(() => { void load(); }, [refresh, load]);
  if (!s) return null;

  const first = ['page', 'task', 'quick-note'].map((k) => types.find((x) => x.key === k)).filter((x): x is TypeDefDto => !!x && !x.invalid);
  const user = types.filter((x) => !x.system && !x.invalid).sort((a, b) => collator().compare(a.name, b.name));
  const options = [...first, ...user];
  if (s.defaultType.valid && !options.some((x) => x.key === s.defaultType.key)) {
    const extra = types.find((x) => x.key === s.defaultType.key);
    if (extra) options.push(extra);
  }
  const label = (field: string) => ({ 'default-type': t('settings.vault.defaultType'), 'daily-format': t('settings.vault.dailyFormat'), attachments: t('settings.vault.attachments') } as Record<string, string>)[field] ?? field;

  const patch = async (key: 'default-type' | 'daily-format' | 'attachments', value: string) => {
    try {
      setS(await ipc.vaultSettingsPatch(s.version, key, value));
      setErrors((e) => ({ ...e, [key]: null }));
    } catch (e) {
      const kind = (e as { kind?: string })?.kind;
      if (kind === 'Conflict') {
        setAlert(t('settings.vault.changedOutside', { field: label(key) }));
        void load();
      } else setErrors((x) => ({ ...x, [key]: (e as { reason?: string; message?: string })?.reason ?? (e as { message?: string })?.message ?? t('typeRule.folderInvalid') }));
    }
  };
  const today = localDate(Date.now(), appZone());
  const folder = daily?.folder ?? 'Daily';
  const fmt = format ?? s.dailyFormat;
  const stem = dailyFileStem(fmt, today);
  const formatError = fmt.trim() === '' || stem === null ? t('settings.vault.badFormat') : null;
  const folderOf = (v: string) => /(^|\/)\.|^_templates(\/|$)|^\/|^\s*$/.test(v) ? t('typeRule.folderInvalid') : null;

  return (
    <div className="settings-body">
      {alert && (
        <div role="alert" className="task-alert">
          <span>{alert}</span>
          <button type="button" tabIndex={0} className="icon-button" aria-label={t('dialog.close')} onClick={() => setAlert(null)}>×</button>
        </div>
      )}
      <div className="setting">
        <span className="setting-label">{t('settings.vault.location')}</span>
        <span className="setting-value" data-user-content>{nfc(vault.path)}</span>
        <div className="setting-row">
          <button type="button" tabIndex={0} data-command="settings.revealVault" onClick={() => void ipc.vaultReveal()}>{t('settings.vault.reveal')}</button>
          <button type="button" tabIndex={0} data-command="vault.openFolder" onClick={onOpenFolder}>{t('settings.vault.openOther')}</button>
        </div>
      </div>
      <div className="setting">
        <label className="setting-label" aria-hidden="true" htmlFor="default-type">{t('settings.vault.defaultType')}</label>
        <select id="default-type" aria-label={t('settings.vault.defaultType')} value={s.defaultType.key}
          onChange={(e) => { if (e.target.value !== s.defaultType.key) void patch('default-type', e.target.value); }}>
          {options.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
        </select>
        {!s.defaultType.valid && s.defaultType.raw !== null && <span role="status" className="setting-error">{t('settings.vault.badDefault', { value: s.defaultType.raw })}</span>}
      </div>
      <Field label={t('settings.vault.dailyFolder')} value={folder} note={t('settings.vault.dailyFolderNote')} error={errors.folder ?? null}
        onCommit={(v) => {
          const bad = folderOf(v);
          if (bad) return setErrors((e) => ({ ...e, folder: bad }));
          void ipc.typePatch('daily-note', daily?.exists ? daily.version : null, [{ op: 'set', field: 'folder', value: v }])
            .then(() => { setErrors((e) => ({ ...e, folder: null })); void load(); },
              (e) => setErrors((x) => ({ ...x, folder: t(`typeRule.${(e as { reason?: string })?.reason ?? 'folderInvalid'}`) })));
        }} />
      <Field label={t('settings.vault.dailyFormat')} value={s.dailyFormat} example={stem ? `${folder}/${stem}.md` : undefined}
        error={format !== null && formatError ? formatError : errors['daily-format'] ?? null} onDraft={setFormat}
        onCommit={(v) => { if (v === '' || dailyFileStem(v, today) === null) { setErrors((e) => ({ ...e, 'daily-format': t('settings.vault.badFormat') })); return; } void patch('daily-format', v); }} />
      <Field label={t('settings.vault.attachments')} value={s.attachments} note={t('settings.vault.attachmentsNote')} error={errors.attachments ?? null}
        onCommit={(v) => { const bad = folderOf(v); if (bad) return setErrors((e) => ({ ...e, attachments: bad })); void patch('attachments', v); }} />
      <div className="setting">
        <button type="button" tabIndex={0} data-command="vault.addStarterTypes" onClick={onStarter}>{t('settings.vault.starter')}</button>
      </div>
    </div>
  );
}

/** R58 `settings/menu-bar` (FR-SET-05, D-547). */
export function MenuBarSettings() {
  const [s, setS] = useState<ShellSettingsDto | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  useEffect(() => { void ipc.shellSettings().then(setS, () => setS({ showStatusItem: true, openAtLogin: false })); }, []);
  if (!s) return null;
  const set = async (next: ShellSettingsDto) => {
    setS(next);
    try {
      await ipc.shellSettingsSet(next);
    } catch {
      setS(s);
      setAlert(t('settings.menubar.loginFailed'));
    }
  };
  const sw = (label: string, on: boolean, flip: () => void, cmd: string, desc?: string) => (
    <div className="setting">
      <button type="button" tabIndex={0} role="switch" aria-checked={on} aria-label={label} aria-description={desc} className={`switch${on ? ' on' : ''}`} data-command={cmd} onClick={flip}>
        <span className="switch-knob" aria-hidden="true" />
        <span>{label}</span>
      </button>
      {desc && <span className="muted setting-note">{desc}</span>}
    </div>
  );
  return (
    <div className="settings-body">
      {alert && <div role="alert" className="task-alert"><span>{alert}</span></div>}
      {sw(t('settings.menubar.show'), s.showStatusItem, () => void set({ ...s, showStatusItem: !s.showStatusItem }), 'settings.toggleStatusItem')}
      {sw(t('settings.menubar.login'), s.openAtLogin, () => void set({ ...s, openAtLogin: !s.openAtLogin }), 'settings.toggleLogin', t('settings.menubar.loginNote'))}
    </div>
  );
}

/** The global hotkeys' state (§5.2): read once and kept current by `hotkeys:state`. */
export function useHotkeys(): HotkeyStateDto[] {
  const [h, setH] = useState<HotkeyStateDto[]>([]);
  useEffect(() => {
    void ipc.hotkeys().then(setH, () => {});
    const off = events.hotkeysState(setH);
    return () => { void off.then((f) => f()); };
  }, []);
  return h;
}

/** R58 `settings/shortcuts` (D-71, D-548): read-only until FR-SET-04 (v1.0). */
export function ShortcutsSettings({ commandTitle }: { commandTitle: (id: string) => string | null }) {
  const hotkeys = useHotkeys();
  const rows: [string, string, string][] = [['quick-capture', t('settings.shortcuts.quickCapture'), '⌃⌥Space'], ['new-task', t('settings.shortcuts.newTask'), '⌃⌥T']];
  return (
    <div className="settings-body">
      <table aria-label={t('settings.shortcuts.global')} className="settings-table">
        <caption>{t('settings.shortcuts.global')}</caption>
        <thead><tr><th>{t('settings.shortcuts.action')}</th><th>{t('settings.shortcuts.shortcut')}</th><th>{t('settings.shortcuts.status')}</th><th /></tr></thead>
        <tbody>
          {rows.map(([id, name, keys]) => {
            const st = hotkeys.find((x) => x.id === id)?.state ?? 'active';
            return (
              <tr key={id}>
                <td>{name}</td>
                <td><kbd>{t('shortcut.keys', { keys })}</kbd></td>
                <td>
                  {st === 'active' ? t('settings.shortcuts.active') : (
                    <>
                      <span>{t('settings.shortcuts.taken')}</span>{' '}
                      <button type="button" tabIndex={0} data-command="settings.retryHotkey" onClick={() => void ipc.hotkeysRetry(id)}>{t('settings.shortcuts.retry')}</button>
                    </>
                  )}
                </td>
                <td><Disabled control="settings.shortcuts.change" /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <table aria-label={t('settings.shortcuts.app')} className="settings-table">
        <caption>{t('settings.shortcuts.app')}</caption>
        <thead><tr><th>{t('settings.shortcuts.action')}</th><th>{t('settings.shortcuts.shortcut')}</th></tr></thead>
        <tbody>
          {SHORTCUTS.filter((s) => !Object.values(CONTROL_COMMANDS).includes(s.command) && commandTitle(s.command) !== null).map((s) => (
            <tr key={`${s.keys}-${s.command}`}><td>{commandTitle(s.command)}</td><td><kbd>{t('shortcut.keys', { keys: s.keys })}</kbd></td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** R58 `settings/date-time` (FR-SET-03, D-566): per machine, display only. */
export function DateTimeSettings({ value, onChange }: { value: DateTimeUiDto | undefined; onChange: (v: DateTimeUiDto) => void }) {
  const v = value ?? REGION_SETTING;
  const now = Date.now();
  const today = localDate(now, appZone());
  const sample = new Date(now).toISOString();
  const region = regionOf() ?? navigator.language;
  const sel = (label: string, key: keyof DateTimeUiDto, opts: [string, string][], example: string) => (
    <div className="setting">
      {/* The select carries the name; the visible label stays out of the accessibility tree (one element per name). */}
      <label className="setting-label" aria-hidden="true" htmlFor={`dt-${key}`}>{label}</label>
      <select id={`dt-${key}`} aria-label={label} value={v[key]} onChange={(e) => onChange({ ...v, [key]: e.target.value })}
        onKeyDown={(e) => {
          // FR-SET-03 AC-5: ↑/↓ change the choice (WebKit opens the menu on a closed select instead).
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          const i = opts.findIndex(([k]) => k === v[key]);
          const next = opts[Math.min(opts.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))][0];
          if (next !== v[key]) onChange({ ...v, [key]: next });
        }}>
        {opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <span className="muted setting-example"><span>{t('settings.dt.exampleLabel')}</span> <span data-user-content>{example}</span></span>
    </div>
  );
  const firstIso = v.week === 'monday' ? 1 : v.week === 'sunday' ? 7 : undefined;
  return (
    <div className="settings-body">
      {sel(t('settings.dt.date'), 'date', [['region', t('settings.dt.region')], ['iso', t('settings.dt.iso')], ['long', t('settings.dt.long')]], formatDate(today, v))}
      {sel(t('settings.dt.time'), 'time', [['region', t('settings.dt.region')], ['24', t('settings.dt.h24')], ['12', t('settings.dt.h12')]], formatDateTime(sample, v, appZone()))}
      {sel(t('settings.dt.week'), 'week', [['region', t('settings.dt.region')], ['monday', t('settings.dt.monday')], ['sunday', t('settings.dt.sunday')]], t((firstIso ?? firstDay(undefined, region)) === 7 ? 'settings.dt.sunday' : 'settings.dt.monday'))}
    </div>
  );
}
