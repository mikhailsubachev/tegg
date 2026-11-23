// Slice AND-2 (contract §9.4, FR-MMP-02 AC-34): whether a map is open in full screen. The frame then drops the bottom
// bar and makes the app bar and the page inert under the full-screen dialog.
let on = false;
const subs = new Set<() => void>();

export function setMapFullScreen(v: boolean): void {
  if (on === v) return;
  on = v;
  for (const f of subs) f();
}
export const mapFullScreen = (): boolean => on;
export function subscribeMapFullScreen(f: () => void): () => void {
  subs.add(f);
  return () => { subs.delete(f); };
}
