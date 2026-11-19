// Data for the slice Q2 L1 tests (docs/acceptance/views.md; docs/contracts/v1-views.md §2, §4.2): the fixture's Book and
// Autor types as `TypeDto`s, the queries as `QuerySummaryDto`s (with Q2's `view` and `types`), and the `Rozečtené` board
// as a `GroupingDto` (R193). Built from tests/fixtures/vaults/views (its README) by hand. No assertions here.
const V = { mtimeNs: '1', size: 1, hash: 'h' };
const opt = (label: string, color: string) => ({ label, color, state: null });
const attr = (key: string, name: string, type: string, o: { options?: { label: string; color: string | null; state: null }[]; to?: string[]; multiple?: boolean; default?: unknown } = {}) => ({
  key, name, type, supported: true, readOnlyReason: null, default: o.default ?? null, required: false, options: o.options ?? [], to: o.to ?? null,
  multiple: o.multiple ?? false, description: null, builtIn: false,
});
const base = (o: Record<string, unknown>) => ({
  system: false, invalid: false, exists: true, version: V, state: 'ok', error: null, declaredVersion: 1n, description: null, review: 'off', previewIgnored: [],
  hidden: [], columns: null, columnsIgnored: [], columnsUnreadable: false, embed: 'full', embedRaw: null, template: null, views: null, viewsUnreadable: false, ...o,
});
export const BOOK: any = base({
  key: 'book', name: 'Book', plural: 'Books', folder: 'Books', icon: 'book', color: 'purple', description: 'Knihy, které jsem četl, čtu nebo chci číst.',
  preview: ['author', 'status'], columns: ['author', 'rating', 'status', 'modified'], views: ['Rozečtené', 'Přečtené 2026', 'Výborné knihy'],
  attributes: [
    attr('author', 'Author', 'relation', { to: ['autor'] }),
    attr('status', 'Status', 'select', { default: 'To read', options: [opt('To read', 'gray'), opt('Reading', 'blue'), opt('Read', 'green')] }),
    attr('rating', 'Rating', 'select', { options: [opt('Excellent', 'green'), opt('Good', 'blue'), opt('Bad', 'red')] }),
    attr('genres', 'Genres', 'multi-select', { options: [opt('Román', 'purple'), opt('Detektivka', 'orange'), opt('Poezie', 'teal'), opt('Eseje', 'yellow'), opt('Cestopis', 'blue')] }),
    attr('finished', 'Finished', 'date'),
  ],
});
export const AUTOR: any = base({
  key: 'autor', name: 'Autor', plural: 'Autoři', folder: 'Autoři', icon: 'user', color: 'blue', preview: ['poznámka'],
  attributes: [attr('poznámka', 'Poznámka', 'text')],
});
export const PAGE: any = base({ key: 'page', name: 'Page', plural: 'Pages', folder: 'Pages', icon: 'file', color: 'gray', system: true, preview: [], attributes: [] });
export const TASK: any = base({ key: 'task', name: 'Task', plural: 'Tasks', folder: 'Tasks', icon: 'check-square', color: 'gray', system: true, preview: [], attributes: [] });
export const TAG: any = base({ key: 'tag', name: 'Tag', plural: 'Tags', folder: 'Tags', icon: 'hash', color: 'gray', system: true, preview: [], attributes: [] });
export const TYPES: any[] = [BOOK, AUTOR, PAGE, TASK, TAG];

/** QuerySummaryDto (v1-queries §2 plus v1-views §2 `view`, `types`). */
export const summary = (name: string, view: 'list' | 'table' | 'board' | null, types: string[] | null, o: { state?: 'ok' | 'newer' | 'unreadable'; usesThis?: boolean; created?: string } = {}) => ({
  name, title: name, path: `.tegg/queries/${name}.yml`, state: o.state ?? 'ok', line: o.state === 'unreadable' ? 3 : null, created: o.created ?? '2026-10-01T20:00:00+02:00',
  modified: o.created ?? '2026-10-01T20:00:00+02:00', usesThis: o.usesThis ?? false, version: V, view, types,
});
export const SUMMARIES: any[] = [
  summary('Rozečtené', 'board', ['book'], { created: '2026-11-02T20:00:00+01:00' }),
  summary('Přečtené 2026', 'table', ['book'], { created: '2026-10-20T20:00:00+02:00' }),
  summary('Seskupeno podle data', 'board', ['book'], { created: '2026-10-14T20:00:00+02:00' }),
  summary('Podle autora', 'board', ['book'], { created: '2026-10-12T20:00:00+02:00' }),
  summary('Podle žánru', 'board', ['book'], { created: '2026-10-10T20:00:00+02:00' }),
  summary('Výborné knihy', 'table', ['book'], { created: '2026-10-05T20:00:00+02:00' }),
  summary('Knihy odkazované odsud', 'list', ['book'], { usesThis: true, created: '2026-09-25T20:00:00+02:00' }),
  summary('Knihy a autoři', 'list', ['book', 'autor'], { created: '2026-09-20T20:00:00+02:00' }),
  summary('Autoři', 'list', ['autor'], { created: '2026-09-15T20:00:00+02:00' }),
];

/** The `Rozečtené` board's rows (QueryRowDto paths, rows order) and its GroupingDto (R193). */
export const ROZ_ROWS = ['Books/Noční vlak.md', 'Books/Účetní ze Žižkova.md', 'Books/Světla přístavu.md', 'Books/Dům u řeky.md', 'Books/Kniha o horách.md'];
const lane = (id: string, kind: string, value: string | null, label: string, color: string | null, cards: [number, string[]][], o: { excluded?: boolean; drop?: boolean; target?: string } = {}) => ({
  id, kind, value, label, color, target: o.target ?? null, excluded: o.excluded ?? false, dropTarget: o.drop ?? (kind === 'option' || kind === 'tag' || kind === 'relation'),
  cards: cards.map(([row, raw]) => ({ row, raw })),
});
export const ROZ_GROUP: any = {
  key: 'status', kind: 'select', multiple: false, name: 'Status',
  lanes: [
    lane('option:Reading', 'option', 'Reading', 'Reading', 'blue', [[0, ['Reading']], [1, ['Reading']], [2, ['Reading']]]),
    lane('option:To read', 'option', 'To read', 'To read', 'gray', [[3, ['To read']], [4, ['To read']]]),
    lane('option:Read', 'option', 'Read', 'Read', 'green', [], { excluded: true }),
  ],
};
/** Runtime `Podle stavu` (FR-QRY-05 AC-15): every book by status, no filters, with the unknown and `none` lanes. */
export const STAV_GROUP: any = {
  key: 'status', kind: 'select', multiple: false, name: 'Status',
  lanes: [
    lane('option:To read', 'option', 'To read', 'To read', 'gray', [[0, ['To read']], [1, ['To read']], [2, ['To read']]]),
    lane('option:Reading', 'option', 'Reading', 'Reading', 'blue', [[3, ['Reading']], [4, ['Reading']], [5, ['Reading']]]),
    lane('option:Read', 'option', 'Read', 'Read', 'green', [[6, ['Read']]]),
    lane('unknown:Rozečteno', 'unknown', 'Rozečteno', 'Rozečteno', null, [[7, ['Rozečteno']]], { drop: false }),
    lane('none', 'none', null, '', null, [[8, []]], { drop: false }),
  ],
};
/** `Podle žánru` (multi-select) with the rows that the AC-14 drags use: 0 Sto zimních dní, 1 Čarovná mapa, 2 Mapa bez severu, 3 Ostrov bez jména. */
export const GENRE_GROUP: any = {
  key: 'genres', kind: 'multiSelect', multiple: true, name: 'Genres',
  lanes: [
    lane('option:Román', 'option', 'Román', 'Román', 'purple', [[1, ['Román']], [2, ['Román']], [0, ['Román']]]),
    lane('option:Detektivka', 'option', 'Detektivka', 'Detektivka', 'orange', []),
    lane('option:Poezie', 'option', 'Poezie', 'Poezie', 'teal', []),
    lane('option:Eseje', 'option', 'Eseje', 'Eseje', 'yellow', [[0, ['Eseje']]]),
    lane('option:Cestopis', 'option', 'Cestopis', 'Cestopis', 'blue', [[1, ['Cestopis']]]),
    lane('none', 'none', null, '', null, [[3, []]], { drop: false }),
  ],
};
/** `Podle autora` (single relation): 0 Dům u řeky (Lucie), 1 Kniha o horách (Marek), 2 Ostrov bez jména (none). */
export const AUTHOR_GROUP: any = {
  key: 'author', kind: 'relation', multiple: false, name: 'Author',
  lanes: [
    lane('relation:Autoři/Eva Lindová.md', 'relation', '[[Eva Lindová]]', 'Eva Lindová', null, [], { target: 'Autoři/Eva Lindová.md' }),
    lane('relation:Autoři/Lucie Horká.md', 'relation', '[[Lucie Horká]]', 'Lucie Horká', null, [[0, ['[[Lucie Horká]]']]], { target: 'Autoři/Lucie Horká.md' }),
    lane('relation:Autoři/Marek Sova.md', 'relation', '[[Marek Sova]]', 'Marek Sova', null, [[1, ['[[Marek Sova]]']]], { target: 'Autoři/Marek Sova.md' }),
    lane('unresolved:[[Nikdo]]', 'unresolved', '[[Nikdo]]', '[[Nikdo]]', null, [], { drop: false }),
    lane('none', 'none', null, '', null, [[2, []]], { drop: false }),
  ],
};
/** Runtime `Podle štítku` (tags): 0 Dům u řeky, 1 Mapa bez severu, 2 Ostrov bez jména, 3 Světla přístavu (inline only). */
export const TAG_GROUP: any = {
  key: 'tags', kind: 'tags', multiple: true, name: 'Tags',
  lanes: [
    lane('tag:doporučené', 'tag', 'doporučené', 'doporučené', null, [[0, ['doporučené']], [1, ['doporučené']]]),
    lane('tag:odloženo', 'tag', 'odloženo', 'odloženo', null, [[2, ['odloženo']]]),
    lane('tag:večerní', 'tag', 'večerní', 'večerní', null, [[3, []]]),
  ],
};
export const def = (o: Record<string, unknown> = {}) => ({
  title: 'Dotaz', types: ['book'], match: 'all', filters: [], sort: [{ by: 'modified', order: 'desc' }], limit: 50, view: 'board', groupBy: 'status',
  lanes: 'vertical', laneOrder: null, columns: ['author', 'rating'], ...o,
});
