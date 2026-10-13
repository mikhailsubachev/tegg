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
  source: 'M9 7l-5 5 5 5M15 7l5 5-5 5',
};

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-icon={name}>
      <path d={PATHS[name] ?? PATHS.dot} />
    </svg>
  );
}

/** The icon of a route id (R1). */
export function routeIcon(id: string): string {
  const head = id.split('/')[0];
  return ({ home: 'home', inbox: 'inbox', today: 'calendar', tasks: 'task', search: 'search', type: 'type', 'type-settings': 'gear', tags: 'tag', pinned: 'pin', 'saved-queries': 'query', note: 'file', graph: 'graph', trash: 'trash', import: 'import', conflicts: 'conflict', capture: 'capture', settings: 'gear', chooser: 'vault' } as Record<string, string>)[head] ?? 'dot';
}

/** The icon of a type key (until `icon:` is mapped in 3D). */
export function typeIconName(key: string): string {
  return ({ page: 'file', task: 'task', 'quick-note': 'bolt', 'daily-note': 'calendar', image: 'image', pdf: 'pdf', tag: 'tag' } as Record<string, string>)[key] ?? 'type';
}
