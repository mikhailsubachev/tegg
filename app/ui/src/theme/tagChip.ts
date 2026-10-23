// D-709: one style for every coloured tag surface (chips, inline `#tags`, the sidebar `#`, the tag page tile). In
// theme/ so the capture window may use it too (capture.md NFR-SEC-03 AC-4).
import type { CSSProperties } from 'react';

export const TAG_COLORS = ['gray', 'blue', 'green', 'orange', 'purple', 'red', 'teal', 'yellow'] as const;

/** A tint of the colour with text in the colour (`--type-<c>-bg` / `--type-<c>`); the neutral chip for none. */
export function tagChipStyle(color: string | null | undefined): CSSProperties {
  if (!color || !(TAG_COLORS as readonly string[]).includes(color)) return { background: 'var(--hover)', color: 'var(--muted)' };
  return { background: `var(--type-${color}-bg)`, color: `var(--type-${color})` };
}
