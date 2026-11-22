// Applies a theme choice (FR-UX-05, FR-SET-02, D-128): token values as CSS custom properties on :root and the
// resolved name in `data-theme`. With `system` it follows prefers-color-scheme live.
import { themes, type ThemeName } from './tokens';

export type ThemeChoice = 'system' | 'light' | 'dark';

const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
let choice: ThemeChoice = 'system';
/** Slice AND-2 (android-phone §8.7, FR-SET-02 AC-11): Android's night mode from the plugin; null: the media query. */
let systemDark: boolean | null = null;
const resolvedListeners = new Set<(name: ThemeName) => void>();

export function resolve(c: ThemeChoice): ThemeName {
  if (c === 'light' || c === 'dark') return c;
  if (systemDark !== null) return systemDark ? 'dark' : 'light';
  return media?.matches ? 'dark' : 'light';
}

/** On Android the phone frame feeds the system's night mode here (never the WebView's media query). */
export function setSystemDark(dark: boolean | null): void {
  if (systemDark === dark) return;
  systemDark = dark;
  paint();
}

/** Called with the resolved theme after every paint (the phone syncs the bar icons). */
export function onResolved(f: (name: ThemeName) => void): () => void {
  resolvedListeners.add(f);
  return () => { resolvedListeners.delete(f); };
}

function paint(): void {
  const name = resolve(choice);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(themes[name])) root.style.setProperty(`--${k}`, v);
  root.style.colorScheme = name;
  root.className = `theme-choice-${choice}`;
  if (root.dataset.theme !== name) root.dataset.theme = name;
  for (const f of resolvedListeners) f(name);
}

export function applyTheme(c: ThemeChoice): void {
  choice = c;
  paint();
}

media?.addEventListener('change', () => {
  if (choice === 'system' && systemDark === null) paint();
});
