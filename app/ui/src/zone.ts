// The app's time zone: the test build's `TZ` (set by the core before first paint, since WebKit's content process
// doesn't inherit it), else undefined, which is the Mac's zone. Dates and stamps go through it (FR-FMT-11).
import { localDate as docLocalDate, localIso as docLocalIso, localMidnight as docLocalMidnight } from '@tegg/doc';

export const appZone = (): string | undefined => (globalThis as { __TEGG_TZ__?: string | null }).__TEGG_TZ__ ?? undefined;

export const localDate = (nowMs: number): string => docLocalDate(nowMs, appZone());
export const localIso = (nowMs: number): string => docLocalIso(nowMs, appZone());
export const localMidnight = (date: string): string => docLocalMidnight(date, appZone());
