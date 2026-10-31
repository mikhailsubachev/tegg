// The Object preview setting and the popover size, machine-local in `ui-state.json` (v1-previews §1; D-922, D-923;
// FR-SET-07 AC-3): stored values are read leniently and never rewritten until the user changes them. D-1164: hover with
// 1,000 ms is the default; a value already stored stays (no migration), and a bad stored mode reads as hover (D-1172).
import type { PreviewMode, PreviewUiDto } from './types';

export const DEFAULT_DELAY = 1000;
export const DEFAULT_MODE: PreviewMode = 'hover';
export const DELAY_MIN = 200;
export const DELAY_MAX = 1500;
export const DELAY_STEP = 100;
export const DEFAULT_WIDTH = 380;
export const MAX_AUTO_HEIGHT = 480;
export const SIZE = { minW: 300, maxW: 720, minH: 200, maxH: 800 } as const;
/** D-917: leaving both the reference and a hover preview hides it after this grace. */
export const HOVER_GRACE = 300;

export type PreviewUi = { mode: PreviewMode; hoverDelay: number; width: number | null; height: number | null };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The delay clamped to 200…1500 and rounded to the nearest 100 ms step. */
export function normalDelay(v: unknown): number {
  const n = num(v);
  if (n === null) return DEFAULT_DELAY;
  return clamp(Math.round(n / DELAY_STEP) * DELAY_STEP, DELAY_MIN, DELAY_MAX);
}

export function readPreviewUi(dto: PreviewUiDto | null | undefined): PreviewUi {
  const d = (dto && typeof dto === 'object' ? dto : {}) as PreviewUiDto;
  const mode: PreviewMode = d.mode === 'hover' || d.mode === 'off' || d.mode === 'click' ? d.mode : DEFAULT_MODE;
  const w = num(d.width);
  const h = num(d.height);
  return {
    mode,
    hoverDelay: normalDelay(d.hoverDelay),
    width: w === null ? null : clamp(Math.round(w), SIZE.minW, SIZE.maxW),
    height: h === null ? null : clamp(Math.round(h), SIZE.minH, SIZE.maxH),
  };
}
