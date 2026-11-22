// Slice AND-2 (docs/contracts/android-phone.md §8.5; RA12, FR-NAV-03 AC-17, CP-3 → D-2085): what system Back does.
// First match wins: close the topmost layer, else go back, else let the app go to the background.

type Layer = { close(): void };

const layers: Layer[] = [];

/** A menu, the drawer, a sheet, the calendar or a full-screen map registers while open; the last one is on top. */
export function pushLayer(close: () => void): () => void {
  const l: Layer = { close };
  layers.push(l);
  return () => {
    const i = layers.indexOf(l);
    if (i >= 0) layers.splice(i, 1);
  };
}

export const layerOpen = () => layers.length > 0;

let backFn: (() => boolean) | null = null;

/** The frame's history Back: true when it went back. */
export function setHistoryBack(f: () => boolean): void {
  backFn = f;
}

export function systemBack(): boolean {
  const top = layers[layers.length - 1];
  if (top) {
    top.close();
    return true;
  }
  return backFn ? backFn() : false;
}
