// Theme tokens (FR-UX-05, docs/contracts/ms3-shell.md §3.5): the only module with colour literals (AC-2).
// Values follow the design boards (design/edit-note-page/), adjusted so every text token reaches 4.5:1 on every
// surface in both themes (D-129). `faint` is only for disabled controls and decorative icons.

export type Tokens = Record<string, string>;

const TYPE_LIGHT: Record<string, [string, string]> = {
  gray: ['#5E5E64', '#EFEFEC'],
  blue: ['#1D5CCB', '#EAF0FB'],
  green: ['#1F6F3A', '#E4F2E8'],
  orange: ['#9A4606', '#FCEBD9'],
  purple: ['#6B3FB8', '#EEE6FB'],
  red: ['#B3261E', '#FBE7E5'],
  teal: ['#0A6E5E', '#E3F3EF'],
  yellow: ['#7A5A00', '#FBF1D3'],
};
const TYPE_DARK: Record<string, [string, string]> = {
  gray: ['#B4B4BA', '#2C2C30'],
  blue: ['#86AEFF', '#1F2A3F'],
  green: ['#7FD39A', '#18301F'],
  orange: ['#F2A25C', '#3A2614'],
  purple: ['#BC9BF5', '#2D2240'],
  red: ['#FF8A85', '#3D1C1A'],
  teal: ['#4CC9B0', '#17332E'],
  yellow: ['#E8C45A', '#352B10'],
};

function typeTokens(t: Record<string, [string, string]>): Tokens {
  const out: Tokens = {};
  for (const [name, [fg, bg]] of Object.entries(t)) {
    out[`type-${name}`] = fg;
    out[`type-${name}-bg`] = bg;
  }
  return out;
}

export const light: Tokens = {
  bg: '#FFFFFF',
  side: '#F5F5F3',
  panel: '#FAFAF8',
  pop: '#FFFFFF',
  row: '#F7F7F5',
  hover: '#ECECE8',
  border: '#E4E4E0',
  text: '#1C1C1E',
  muted: '#5C5C62',
  faint: '#9A9AA0',
  link: '#1D5CCB',
  accent: '#0A6E5E',
  danger: '#B3261E',
  focus: '#737373', // D-594: neutral grey, ≥ 3:1 on bg/side/panel (WCAG 1.4.11)
  'accent-bg': '#E3F3EF',
  sel: '#D3E3FF',
  // 4F (FR-LNK-07, D-418): the embed frame; text tokens keep 4.5:1 on embed-bg.
  'embed-border': '#D2D2CC',
  'embed-bg': '#FAFAF7',
  // 5A-1 (FR-TSK-09 AC-2, AC-3): due chips on the Tasks boards; danger / link keep 4.5:1 on them.
  'danger-bg': '#FCEBEA',
  'link-bg': '#E8EFFC',
  // D-600 (LinkChips board): the hovered chip tint, the task suffix divider, the Unreviewed mark (text 4.5:1 on
  // unrev-bg and bg; the board's #B06F00 is 3.8:1).
  'link-bg-h': '#D6E3F8',
  'chip-div': '#C3D2EE',
  unrev: '#9A5F00',
  'unrev-ring': '#F2C46B',
  'unrev-bg': '#FFF6E5',
  // F9 (capture.md R55 look): the board's primary button.
  btn: '#1C1C1E',
  'btn-fg': '#FFFFFF',
  // The app mark on the capture's saved panel (D-164 colours, both themes).
  // G1 (graph.md R109, board Graph): the graph canvas, its dot grid, edges and the selection highlight.
  canvas: '#FBFBFA',
  dot: '#E2E2DE',
  edge: '#B9B9B3',
  hl: '#1D5CCB',
  ...typeTokens(TYPE_LIGHT),
};

export const dark: Tokens = {
  bg: '#1C1C1E',
  side: '#161618',
  panel: '#19191B',
  pop: '#262629',
  row: '#232326',
  hover: '#2A2A2D',
  border: '#313134',
  text: '#ECECEE',
  muted: '#A6A6AC',
  faint: '#6E6E74',
  link: '#86AEFF',
  accent: '#4CC9B0',
  danger: '#FF8A85',
  focus: '#8E8E93', // D-594
  'accent-bg': '#17332E',
  sel: '#2A4677',
  'embed-border': '#3C3C41',
  'embed-bg': '#212124',
  'danger-bg': '#3A2020',
  'link-bg': '#1E2A44',
  'link-bg-h': '#2A3A57',
  'chip-div': '#3A4C6E',
  unrev: '#F0B34A',
  'unrev-ring': '#7A5A1E',
  'unrev-bg': '#33270F',
  btn: '#ECECEE',
  'btn-fg': '#1C1C1E',
  // G1 (graph.md R109, board Graph): the graph canvas, its dot grid, edges and the selection highlight.
  canvas: '#18181A',
  dot: '#2A2A2D',
  edge: '#4A4A50',
  hl: '#86AEFF',
  ...typeTokens(TYPE_DARK),
};

export const themes = { light, dark } as const;
export type ThemeName = keyof typeof themes;
