// Type icons for lists (FR-SRC-03, FR-NAV-01 AC-5): the type's own icon and colour, as the sidebar and chips draw it
// (D-236, D-519; v0.52 H13 replaced the 3B emoji map).
import { chipIcon, chipTypes } from './links/icons';
import { Icon } from './shell/Icon';

export function TypeIcon({ type, size = 14 }: { type: string | null | undefined; size?: number }) {
  const key = (type ?? 'page').normalize('NFC');
  const icon = chipIcon(key);
  const color = chipTypes().find((x) => x.key.normalize('NFC') === key)?.color;
  return <span className="type-glyph" style={color ? { color: `var(--type-${color})` } : undefined}><Icon name={icon.glyph} dataIcon={icon.def} size={size} /></span>;
}
