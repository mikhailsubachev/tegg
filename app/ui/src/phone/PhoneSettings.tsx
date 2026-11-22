// Slice AND-2 (docs/contracts/android-phone.md §9.10; FR-SET-01 AC-14, D-2065): Settings on the phone. `settings` is a
// list of four sections and the version; `settings/vault` shows the vault read-only; `settings/storage` shows whether
// "All files access" is on, with a way to the system setting. Nothing here writes the vault.
import { useEffect, useState } from 'react';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { TypeDefDto, VaultInfo, VaultSettingsDto } from '../ipc/types';
import { Icon } from '../shell/Icon';
import { PageHeading } from './PageHeading';

type Go = (id: string) => void;

const SECTIONS: [string, string][] = [
  ['settings/appearance', 'settings.appearance'],
  ['settings/date-time', 'settings.dateTime'],
  ['settings/vault', 'settings.vault'],
  ['settings/storage', 'phone.settings.storage'],
];

export function PhoneSettingsList({ heading, onGo }: { heading: React.RefObject<HTMLHeadingElement | null>; onGo: Go }) {
  return (
    <div className="page-column phone-settings">
      <PageHeading ref={heading} tabIndex={-1}>{t('phone.settings')}</PageHeading>
      <ul className="phone-list">
        {SECTIONS.map(([id, key]) => (
          <li key={id}>
            <a href="#" className="phone-row" data-command={`goto.${id}`} onClick={(e) => { e.preventDefault(); onGo(id); }}>
              <span>{t(key)}</span>
              <Icon name="chevron-right" />
            </a>
          </li>
        ))}
      </ul>
      <p className="muted phone-settings-version">{t('phone.settings.version', { version: __TEGG_VERSION__ })}</p>
    </div>
  );
}

export function PhoneVaultSettings({ heading, vault, types, onSwitch }: {
  heading: React.RefObject<HTMLHeadingElement | null>; vault: VaultInfo; types: TypeDefDto[]; onSwitch: (anchor: HTMLElement) => void;
}) {
  const [s, setS] = useState<VaultSettingsDto | null>(null);
  useEffect(() => { ipc.vaultSettings().then(setS, () => setS(null)); }, [vault.path]);
  const def = s ? types.find((x) => x.key.normalize('NFC') === s.defaultType.key.normalize('NFC')) : undefined;
  return (
    <div className="page-column phone-settings">
      <PageHeading ref={heading} tabIndex={-1}>{t('route.settings.vault')}</PageHeading>
      <dl className="phone-facts">
        <dt>{t('settings.vault')}</dt>
        <dd data-user-content>{vault.name}</dd>
        <dt>{t('settings.vault.location')}</dt>
        <dd data-user-content>{vault.path}</dd>
        <dt>{t('settings.vault.defaultType')}</dt>
        <dd data-user-content>{def ? def.name : s?.defaultType.key ?? ''}</dd>
      </dl>
      <button type="button" className="phone-button" data-command="vault.switch" onClick={(e) => onSwitch(e.currentTarget)}>
        {t('phone.settings.switchVault')}
      </button>
    </div>
  );
}

export function PhoneStorageSettings({ heading }: { heading: React.RefObject<HTMLHeadingElement | null> }) {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    const read = () => { ipc.storageAccess().then((a) => setOn(a.granted), () => setOn(null)); };
    read();
    const f = () => { if (document.visibilityState === 'visible') read(); };
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);
  return (
    <div className="page-column phone-settings">
      <PageHeading ref={heading} tabIndex={-1}>{t('phone.settings.storage')}</PageHeading>
      <div className="phone-facts">
        <span>{t('phone.settings.storage')}</span>
        <strong>{on === null ? '' : t(on ? 'phone.settings.storageOn' : 'phone.settings.storageOff')}</strong>
      </div>
      <button type="button" className="phone-button" data-command="android.openSettings" onClick={() => { void ipc.storageAccessSettings().catch(() => {}); }}>
        {t('android.access.openSettings')}
      </button>
    </div>
  );
}
