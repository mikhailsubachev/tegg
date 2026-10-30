// Slices G1 and G2 (docs/contracts/v1-graph.md §5, §6, §15): what the full view (GraphPage) and the right panel
// (GraphPanel) share: request timing (§6), zoom limits (D-985), lenient reading of the stored view state (§5: missing or
// invalid values read as defaults), the preview target of a node and the relation names of a phrase (D-982).
import { region } from '../i18n/collate';
import type { PreviewTarget } from '../preview/types';
import type { RelationNames } from './graphModel';
import type { EdgeKindDto, GraphNodeDto } from './types';

/** D-912: Loading shows only when no answer came this long after the request. */
export const LOADING_AFTER = 300;
/** D-980: vault changes are re-asked after this quiet time. */
export const DEBOUNCE = 300;
/** D-985: ⌘-scroll / pinch zoom limits and step. */
export const ZOOM_MIN = 0.25, ZOOM_MAX = 4, ZOOM_STEP = 1.25;
export const KIND_KEYS: EdgeKindDto[] = ['link', 'relation', 'embed', 'tag'];

export const validDepth = (d: unknown): 1 | 2 | 3 => (d === 1 || d === 2 || d === 3 ? d : 1);
export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
export const kindsOf = (v: unknown): EdgeKindDto[] => strings(v).filter((k): k is EdgeKindDto => (KIND_KEYS as string[]).includes(k));
export const stemOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/, '');
export const fmt = (n: number) => new Intl.NumberFormat(region() ?? 'en-US').format(n);
export const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** `All` / `None` (FR-GRP-02 AC-3): every type of the walk shown or hidden; hidden keys the walk doesn't know are kept
 *  (§5: an unknown stored key is ignored and kept). */
export function typesAfterAll(hidden: string[], known: string[], visible: boolean): string[] {
  const unknown = hidden.filter((k) => !known.includes(k));
  return visible ? unknown : [...unknown, ...known];
}
/** `Show all types`: every known type shown, unknown keys kept. */
export const unknownHidden = (hidden: string[], known: string[]) => hidden.filter((k) => !known.includes(k));

/** The relation Names a phrase uses, from the type definitions (D-971, D-998). */
export function relationNames(types: { key: string }[]): RelationNames {
  return types.map((x) => ({ key: x.key, attributes: ((x as { attributes?: { key: string; name: string }[] }).attributes ?? []).map((a) => ({ key: a.key, name: a.name })) }));
}
/** The slice P preview target of a node (a tag node previews its tag, D-909). */
export const targetOf = (n: GraphNodeDto): PreviewTarget => (n.typeKey === 'tag'
  ? { kind: 'tag', key: n.tagKey ?? n.title, path: n.path ?? '', fragment: null }
  : { kind: 'note', path: n.path ?? '', fragment: null });
