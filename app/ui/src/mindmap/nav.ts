// Slice MM3 (docs/contracts/mm-mindmap.md §7.2, docs/acceptance/mindmap.md R229; D-2600, D-2604, D-2605, D-2612…D-2615):
// the map's keys as a pure function of the laid-out (visible) nodes. ↑ / ↓ go to the previous / next sibling, then to
// the nearest visible node of the same depth in outline order (D-2612); nothing on a root (D-2613). Home / End: the
// root and the last visible node. ← / → as R95 (D-790 in `spider`); on a folded node the key towards its children
// unfolds it (D-2605, D-2614), on a folded spider root either key does (D-2615).
import type { MindLayout } from './layout';

export type MindNavKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

export function navigateMindmap(layout: MindLayout, from: string, key: MindNavKey): { focus: string } | { unfold: string } | null {
  const nodes = layout.nodes; // outline order (a pre-order walk, R92 / R96)
  const i = nodes.findIndex((n) => n.id === from);
  if (i < 0 || nodes.length === 0) return null;
  const n = nodes[i];
  const parent = new Map<string, string>();
  for (const c of layout.connectors) parent.set(c.to, c.from);
  const up = parent.get(n.id);
  const children = nodes.filter((x) => parent.get(x.id) === n.id);
  const focus = (id: string | undefined) => (id === undefined ? null : { focus: id });
  switch (key) {
    case 'Home': return focus(nodes[0].id);
    case 'End': return focus(nodes[nodes.length - 1].id);
    case 'ArrowDown':
    case 'ArrowUp': {
      if (up === undefined) return null;
      const down = key === 'ArrowDown';
      const sibs = nodes.filter((x) => parent.get(x.id) === up);
      const k = sibs.indexOf(n);
      const sib = sibs[k + (down ? 1 : -1)];
      if (sib) return focus(sib.id);
      const same = (x: (typeof nodes)[number]) => x.depth === n.depth;
      return focus(down ? nodes.slice(i + 1).find(same)?.id : nodes.slice(0, i).reverse().find(same)?.id);
    }
    case 'ArrowLeft':
    case 'ArrowRight': {
      const dir = key === 'ArrowRight' ? 'right' : 'left';
      const folded = !!n.fold?.folded;
      if (layout.layout === 'spider' && up === undefined) {
        if (folded) return { unfold: n.id };
        return focus(children.find((c) => c.side === dir)?.id);
      }
      // Towards the children: → in `right`, the node's own side in `spider`.
      const toward = layout.layout === 'spider' ? n.side ?? 'right' : 'right';
      if (dir !== toward) return focus(up);
      if (folded) return { unfold: n.id };
      return focus(children[0]?.id);
    }
  }
  return null;
}
