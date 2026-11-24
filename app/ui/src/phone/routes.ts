// Slice AND-2 (docs/contracts/android-phone.md §7; RA9, D-2181…D-2183, D-2209): the phone's own routes and the
// desktop routes it doesn't offer.
import type { RouteDef } from '../shell/registry';

export const PHONE_ROUTES: RouteDef[] = [
  { id: 'settings', name: 'phone.settings', purpose: 'purpose.phone.settings', status: { built: true }, reqs: ['FR-SET-01'], design: 'Mobile2 N20' },
  { id: 'settings/storage', name: 'phone.settings.storage', purpose: 'purpose.phone.settingsStorage', status: { built: true }, reqs: ['FR-SET-01', 'FR-VLT-01'], design: 'Mobile2 N20' },
];

export const PHONE_NOT_OFFERED: readonly string[] = [
  'new/<type>', 'home', 'graph/<path>', 'trash', 'type-settings/<type>', 'help/shortcuts', 'settings/shortcuts',
  'settings/menu-bar', 'settings/trash-history', 'settings/previews', 'settings/backups', 'broken-links', 'duplicate-titles',
];

export const phoneRouteOffered = (id: string) => !PHONE_NOT_OFFERED.includes(id);
