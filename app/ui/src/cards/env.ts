// The card's clock, zone, region and Date & time setting (docs/contracts/v1-cards.md §7.1, §7.3; D-104, D-160, D-781).
import { dateTimeSetting } from '../i18n/dates';
import { region } from '../i18n/collate';
import type { DateTimeUiDto } from '../ipc/types';
import { appZone } from '../zone';

export type CardEnv = { now: number; zone: string; region: string; dateSetting: DateTimeUiDto | null };

export function cardEnv(): CardEnv {
  return {
    now: Date.now(),
    zone: appZone() ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    region: region() ?? (typeof navigator !== 'undefined' ? navigator.language : 'en'),
    dateSetting: dateTimeSetting() ?? null,
  };
}
