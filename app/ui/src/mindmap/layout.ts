// Slice MM (docs/contracts/mm-mindmap.md §2): the map's layout, pure and deterministic (D-683, D-777).
// Stub until the build: returns an empty layout (contract preamble).
import type { MindmapTree } from '@tegg/doc';

export type Measure = (text: string) => number;
export type Tone = 'root' | 'blue' | 'orange' | 'purple' | 'teal' | 'green' | 'yellow' | 'red' | 'plain';
export type MindLayoutNode = { id: string; depth: number; x: number; y: number; w: number; h: number; lines: string[]; tone: Tone };
export type MindConnector = { from: string; to: string; points: [number, number][] };
export type MindLayout = { width: number; height: number; nodes: MindLayoutNode[]; connectors: MindConnector[] };

export const PALETTE = ['blue', 'orange', 'purple', 'teal', 'green', 'yellow', 'red'] as const;

/** The test Measurer of R92: 7 px per Unicode scalar value of the NFC text. */
export const textMeasurer: Measure = (text) => [...text.normalize('NFC')].length * 7;

let count = 0;
export function layoutCount(): number {
  return count;
}

export function layoutMindmap(_tree: MindmapTree, _measure: Measure, _opts?: { chipExtra?: number }): MindLayout {
  count++;
  return { width: 0, height: 0, nodes: [], connectors: [] };
}
