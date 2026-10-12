// Applies a theme choice (FR-UX-05, FR-SET-02, D-128): token values as CSS custom properties on :root and the
// resolved name in `data-theme`. With `system` it follows prefers-color-scheme live.
import { themes, type ThemeName } from './tokens';

export type ThemeChoice = 'system' | 'light' | 'dark';

const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
let choice: ThemeChoice = 'system';

export function resolve(c: ThemeChoice): ThemeName {
  if (c === 'light' || c === 'dark') return c;
  return media?.matches ? 'dark' : 'light';
}

function paint(): void {
  const name = resolve(choice);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(themes[name])) root.style.setProperty(`--${k}`, v);
  root.style.colorScheme = name;
  root.className = `theme-choice-${choice}`;
  if (root.dataset.theme !== name) root.dataset.theme = name;
}

export function applyTheme(c: ThemeChoice): void {
  choice = c;
  paint();
}

media?.addEventListener('change', () => {
  if (choice === 'system') paint();
});
