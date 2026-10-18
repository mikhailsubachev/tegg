// `Type settings` in a page header (D-519): an icon button with the sliders icon, named and titled `Type settings`.
import { t } from '../i18n/catalog';
import { Icon } from './Icon';

export function TypeSettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button tabIndex={0} type="button" className="type-settings-button" data-command="type.openSettings"
      aria-label={t('cmd.typeSettings')} title={t('cmd.typeSettings')} onClick={onClick}>
      <Icon name="sliders" size={16} />
    </button>
  );
}
