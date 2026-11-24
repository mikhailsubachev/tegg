// Slice AND-2 (docs/contracts/android-phone.md §4.2; FR-MMP-02 AC-33, D-2191): the scale rules of the phone's map.
export const MAP_MIN = 0.5, MAP_MAX = 2.5, MAP_STEP = 1.25, MAP_PAD = 24;

const clamp = (s: number) => Math.min(MAP_MAX, Math.max(MAP_MIN, s));

/** A layout that fits opens at 1; a wider one at area ÷ layout, at least MAP_MIN. */
export function openingScale(areaWidth: number, layoutWidth: number): number {
  return layoutWidth <= areaWidth ? 1 : Math.max(MAP_MIN, areaWidth / layoutWidth);
}
export const zoomIn = (s: number) => Math.min(MAP_MAX, s * MAP_STEP);
export const zoomOut = (s: number) => Math.max(MAP_MIN, s / MAP_STEP);
export const canZoomIn = (s: number) => s < MAP_MAX - 1e-9;
export const canZoomOut = (s: number) => s > MAP_MIN + 1e-9;
export const pinchScale = (s: number, fromDist: number, toDist: number) => (fromDist > 0 ? clamp((s * toDist) / fromDist) : s);
export const blockHeight = (layoutHeight: number, s: number) => layoutHeight * s + MAP_PAD;

/** The scroll that keeps the layout point under `centre` (area coordinates) in place from scale s0 to s1. */
export function scrollAfterZoom(scroll: { left: number; top: number }, centre: { x: number; y: number }, s0: number, s1: number): { left: number; top: number } {
  const k = s1 / s0;
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  return { left: r((scroll.left + centre.x) * k - centre.x), top: r((scroll.top + centre.y) * k - centre.y) };
}
