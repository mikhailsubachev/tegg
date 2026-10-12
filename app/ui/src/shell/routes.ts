// Route strings (docs/contracts/ms3-shell.md §4.1): the R1 ids with their parameter, NFC.
// `type/čajovna`, `note/Schůzky/2026-10-07 Porada.md`, `settings/appearance`, `home`.
import { ROUTES } from './registry';

export type Route = { id: string; param?: string };

const PARAM_ROUTES = ['type', 'type-settings', 'note'];

export function parseRoute(s: string): Route | null {
  const str = s.normalize('NFC');
  const slash = str.indexOf('/');
  if (slash > 0) {
    const head = str.slice(0, slash);
    const rest = str.slice(slash + 1);
    if (PARAM_ROUTES.includes(head)) return rest ? { id: `${head}/<${head === 'note' ? 'path' : 'type'}>`, param: rest } : null;
  }
  return ROUTES.some((r) => r.id === str) ? { id: str } : null;
}

export function routeString(r: Route): string {
  if (r.param === undefined) return r.id;
  return `${r.id.slice(0, r.id.indexOf('/'))}/${r.param.normalize('NFC')}`;
}

export function sameRoute(a: Route, b: Route): boolean {
  return routeString(a) === routeString(b);
}
