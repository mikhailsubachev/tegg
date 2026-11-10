// Route strings (docs/contracts/ms3-shell.md §4.1, §11.2): the R1 ids with their parameter, NFC.
// `type/čajovna`, `note/Schůzky/2026-10-07 Porada.md`, `note/Pages/Cíl.md#Druhá kapitola`, `search/tag:projekt`, `home`.
import { parseDate } from '@tegg/doc';
import { ROUTES } from './registry';

/** `fragment`: a note subpath `<heading>` or `^<block id>` (ms3-shell §11.2, D-140). */
export type Route = {
  id: string; param?: string; fragment?: string;
  /** ms4-links §5.4: open a note with the caret at a link (`?at=<line>:<byte>`, ms3-shell §15.2) or with the focus on a
   *  property's value control (`?attr=<key>`); not part of the route string, so Back/Forward compare notes only. */
  at?: { line: number; byte: number }; attr?: string;
  /** 5A-1 (D-486): the note opens with the first block embed of this path selected at the top. */
  selectEmbedOf?: string;
  /** Slice Q (v1-queries §4.4, D-1490): a draft `new/<type>` from a query block's footer starts with these values
   *  (`[key, value]`), written with its first write; not part of the route string. */
  prefill?: [string, unknown][];
};

const PARAM_ROUTES = ['type', 'type-settings', 'note', 'new', 'graph'];

export function parseRoute(s: string): Route | null {
  const str = s.normalize('NFC');
  const slash = str.indexOf('/');
  if (slash > 0) {
    const head = str.slice(0, slash);
    let rest = str.slice(slash + 1);
    if (head === 'search') return rest.startsWith('tag:') && rest.length > 4 ? { id: 'search', param: rest } : null;
    // 4D-lite (D-736): `tag/` + the encoded key, so `a/b` is one parameter.
    if (head === 'tag') {
      let key = rest;
      try { key = decodeURIComponent(rest); } catch { /* a literal % */ }
      return key ? { id: 'tag/<key>', param: key.normalize('NFC').toLowerCase() } : null;
    }
    // Slice Q (v1-queries §4.1, D-1480): the NFC name, unencoded (names never hold `/` or `#`).
    if (head === 'query') return rest ? { id: 'query/<name>', param: rest } : null;
    // 4B (D-321): a valid date only.
    if (head === 'daily') return parseDate(rest) ? { id: 'daily/YYYY-MM-DD', param: rest } : null;
    if (PARAM_ROUTES.includes(head)) {
      if (!rest) return null;
      let fragment: string | undefined;
      if (head === 'note' && rest.includes('#')) {
        fragment = rest.slice(rest.indexOf('#') + 1) || undefined;
        rest = rest.slice(0, rest.indexOf('#'));
      }
      return { id: `${head}/<${head === 'note' || head === 'graph' ? 'path' : 'type'}>`, param: rest, ...(fragment ? { fragment } : {}) };
    }
  }
  return ROUTES.some((r) => r.id === str) ? { id: str } : null;
}

export function routeString(r: Route): string {
  if (r.param === undefined) return r.id;
  if (r.id === 'tag/<key>') return `tag/${encodeURIComponent(r.param.normalize('NFC'))}`;
  const head = r.id.includes('/') ? r.id.slice(0, r.id.indexOf('/')) : r.id;
  return `${head}/${r.param.normalize('NFC')}${r.fragment ? `#${r.fragment.normalize('NFC')}` : ''}`;
}

export function sameRoute(a: Route, b: Route): boolean {
  return routeString(a) === routeString(b);
}
