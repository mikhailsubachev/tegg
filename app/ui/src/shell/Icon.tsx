// Line icons for the frame (stroke uses the current text colour, FR-UX-05 AC-2). Decorative: hidden from the
// accessibility tree; the control around an icon carries the label.
const PATHS: Record<string, string> = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5',
  calendar: 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4',
  task: 'M4 4h16v16H4zM8 12l3 3 5-6',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4',
  pdf: 'M6 3h8l4 4v14H6zM9 13h6M9 17h6',
  tag: 'M3 12V4h8l9 9-8 8zM7 8h.01',
  pin: 'M9 4h6l-1 6 3 3H7l3-3zM12 13v7',
  query: 'M4 6h16M7 12h10M10 18h4',
  sidebar: 'M4 5h16v14H4zM9 5v14',
  panel: 'M4 5h16v14H4zM15 5v14',
  focus: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  back: 'M15 5l-7 7 7 7',
  forward: 'M9 5l7 7-7 7',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6',
  gear: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  graph: 'M6 6a2 2 0 1 1 0 .1zM18 8a2 2 0 1 1 0 .1zM12 18a2 2 0 1 1 0 .1zM7.5 7l9 1M7 8l4 8M17 10l-4 7',
  type: 'M5 5h14v4M12 5v14M9 19h6',
  vault: 'M4 4h16v16H4zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  import: 'M12 3v12M7 10l5 5 5-5M4 19h16',
  conflict: 'M12 3l9 16H3zM12 10v4M12 17h.01',
  capture: 'M12 4v16M4 12h16',
  dot: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5H5V6h5',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-left': 'M15 6l-6 6 6 6',
  source: 'M9 7l-5 5 5 5M15 7l5 5-5 5',
  'more-horizontal': 'M6 12h.01M12 12h.01M18 12h.01',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  check: 'M5 12l5 5 9-10',
  'mark-bold': 'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z',
  'mark-italic': 'M14 5h-4M14 19h-4M13 5l-2 14',
  'mark-strike': 'M5 12h14M16 7a4 3 0 0 0-8 0c0 4 8 3 8 7a4 3 0 0 1-8 0',
  'mark-code': 'M9 8l-4 4 4 4M15 8l4 4-4 4',
  'mark-highlight': 'M5 19h14M8 15l7-9 3 3-9 7z',
  object: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z',
  // R14 type icons (D-236).
  'file-text': 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  'check-square': 'M4 4h16v16H4zM8 12l3 3 5-6',
  zap: 'M13 3L5 14h6l-1 7 8-11h-6z',
  hash: 'M5 9h14M5 15h14M10 4L8 20M16 4l-2 16',
  book: 'M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM5 18a2 2 0 0 1 2-2h11',
  'book-open': 'M3 5h6a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H3zM21 5h-6a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h7z',
  lightbulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 1 4 10.5c-.8.8-1 1.5-1 2.5H9c0-1-.2-1.7-1-2.5A6 6 0 0 1 12 3z',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 21v-1a7 7 0 0 1 14 0v1',
  folder: 'M3 6h6l2 2h10v11H3z',
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  flag: 'M5 21V4M5 4h12l-2 4 2 4H5',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  briefcase: 'M3 7h18v13H3zM8 7V4h8v3M3 12h18',
  coffee: 'M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 9h1a3 3 0 0 1 0 6h-1M7 2v3M11 2v3',
  globe: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  'graduation-cap': 'M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5M22 9v6',
  'pen-line': 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  utensils: 'M5 3v8a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3M7 13v8M17 3c-2 2-2 6 0 8v10',
  plane: 'M2 13l8-2 4-8 2 1-2 7 6 2 2-2 1 1-2 4-4 1-1 5-2 1-1-6-6 2z',
  warning: 'M12 3l9 16H3zM12 10v4M12 17h.01',
  x: 'M6 6l12 12M18 6L6 18',
};

/** R14 icon names a type file may use (D-236); others fall back to the generic type icon. */
export const TYPE_ICONS = new Set(['file-text', 'check-square', 'zap', 'calendar', 'hash', 'image', 'file', 'book', 'book-open', 'lightbulb', 'users', 'user',
  'folder', 'map', 'star', 'flag', 'bookmark', 'briefcase', 'coffee', 'globe', 'graduation-cap', 'pen-line', 'utensils', 'plane']);

/** `dataIcon`: the `data-icon` value when it differs from the glyph (link chips name the type's icon, FR-LNK-07). */
export function Icon({ name, size = 16, dataIcon }: { name: string; size?: number; dataIcon?: string }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-icon={dataIcon ?? name}>
      <path d={PATHS[name] ?? PATHS.dot} />
    </svg>
  );
}

/** The icon of a route id (R1). */
export function routeIcon(id: string): string {
  const head = id.split('/')[0];
  return ({ home: 'home', inbox: 'inbox', today: 'calendar', daily: 'calendar', tasks: 'task', search: 'search', type: 'type', 'type-settings': 'gear', tags: 'tag', pinned: 'pin', 'saved-queries': 'query', note: 'file', graph: 'graph', trash: 'trash', import: 'import', conflicts: 'conflict', capture: 'capture', settings: 'gear', chooser: 'vault' } as Record<string, string>)[head] ?? 'dot';
}

/** The icon of a type: the R14 `icon` of its definition when given and known (D-236), else by key (3A). */
/** The icon each system type's built-in definition names. */
export const SYSTEM_DEFAULT: Record<string, string> = { page: 'file-text', task: 'check-square', 'quick-note': 'zap', 'daily-note': 'calendar', tag: 'hash', image: 'image', pdf: 'file' };

export function typeIconName(key: string, icon?: string | null): string {
  const sys = ({ page: 'file', task: 'task', 'quick-note': 'bolt', 'daily-note': 'calendar', image: 'image', pdf: 'pdf', tag: 'tag' } as Record<string, string>)[key];
  // FR-TYP-06 (D-237): a system type's icon can be changed; its default icon keeps the system glyph.
  if (sys && (!icon || icon === SYSTEM_DEFAULT[key] || !TYPE_ICONS.has(icon))) return sys;
  return icon && TYPE_ICONS.has(icon) ? icon : 'type';
}

/** The same icon as a DOM element, for views that aren't React (the editor's link chips). */
export function iconElement(name: string, size = 13, dataIcon?: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ class: 'icon', width: String(size), height: String(size), viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', 'data-icon': dataIcon ?? name })) svg.setAttribute(k, v);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', PATHS[name] ?? PATHS.dot);
  svg.appendChild(path);
  return svg;
}
