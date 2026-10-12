// Type icons for lists (FR-SRC-03, FR-NAV-01 AC-5). MS3 reads `icon:` from `.tegg/types/`; until then, by type key.
const ICONS: Record<string, string> = {
  page: '📄',
  task: '☑︎',
  'quick-note': '⚡︎',
  'daily-note': '📅',
  tag: '#',
  image: '🖼',
  pdf: '📕',
};

export const typeIcon = (type: string) => ICONS[type] ?? '◆';
