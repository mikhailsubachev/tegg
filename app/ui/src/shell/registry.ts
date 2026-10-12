// STUB (MS3 slice 3A red tests, D-61 / TS-I1): docs/contracts/ms3-shell.md §3.2. Empty registries; the real
// content must equal tables R1–R4 of docs/acceptance/app-shell.md.
export type Milestone = 'MS3' | 'MS4' | 'MS5' | 'MS6' | 'MS7' | 'MS8' | 'v1.0' | 'v1.x';
export type Slice = '3A' | '3B' | '3C' | '3D' | '3E';
export type Due = { milestone: Milestone; slice?: Slice };

export type RouteDef = {
  id: string;
  name: string;
  purpose: string;
  status: { built: true; due?: Due } | { built: false; due: Due };
  reqs: string[];
  design: string | null;
};
export type TabDef = { id: 'backlinks' | 'outline' | 'graph'; name: string; status: RouteDef['status']; reqs: string[] };
export type DisabledControl = { label: string; where: string; due: Due; req: string };
export type ShortcutDef = { keys: string; command: string };

export const ROUTES: RouteDef[] = [];
export const PANEL_TABS: TabDef[] = [];
export const DISABLED_CONTROLS: DisabledControl[] = [];
export const SHORTCUTS: ShortcutDef[] = [];

export function overdue(_milestone: Milestone): string[] {
  return [];
}
