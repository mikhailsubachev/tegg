// Route strings (docs/contracts/ms3-shell.md §4.1, §11.2): the R1 ids with their parameter, NFC.
// `type/čajovna`, `note/Schůzky/2026-10-07 Porada.md`, `note/Pages/Cíl.md#Druhá kapitola`, `search/tag:projekt`, `home`.
import { ROUTES } from './registry';

/** `fragment`: a note subpath `<heading>` or `^<block id>` (ms3-shell §11.2, D-140). */
export type Route = { id: string; param?: string; fragment?: string };

const PARAM_ROUTES = ['type', 'type-settings', 'note'];

export function parseRoute(s: string): Route | null {
  const str = s.normalize('NFC');
  const slash = str.indexOf('/');
  if (slash > 0) {
    const head = str.slice(0, slash);
    let rest = str.slice(slash + 1);
    if (head === 'search') return rest.startsWith('tag:') && rest.length > 4 ? { id: 'search', param: rest } : null;
    if (PARAM_ROUTES.includes(head)) {
      if (!rest) return null;
      let fragment: string | undefined;
      if (head === 'note' && rest.includes('#')) {
        fragment = rest.slice(rest.indexOf('#') + 1) || undefined;
        rest = rest.slice(0, rest.indexOf('#'));
      }
      return { id: `${head}/<${head === 'note' ? 'path' : 'type'}>`, param: rest, ...(fragment ? { fragment } : {}) };
    }
  }
  return ROUTES.some((r) => r.id === str) ? { id: str } : null;
}

export function routeString(r: Route): string {
  if (r.param === undefined) return r.id;
  const head = r.id.includes('/') ? r.id.slice(0, r.id.indexOf('/')) : r.id;
  return `${head}/${r.param.normalize('NFC')}${r.fragment ? `#${r.fragment.normalize('NFC')}` : ''}`;
}

export function sameRoute(a: Route, b: Route): boolean {
  return routeString(a) === routeString(b);
}
