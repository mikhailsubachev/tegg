// The Lucide 0.460.0 icon set (docs/contracts/v1-cards.md §5.1, §5.3, §5.5; FR-TYP-01 AC-20). The only module that
// imports the bundled data file; `icons/load.ts` imports this module dynamically, so Vite emits it as its own chunk
// (`assets/lucide-icons-<hash>.js`), requested on the first picker open of a window and never fetched from the network
// (NFR-SEC-01). Nothing imports it statically.
import data from '../../../../packages/schema/data/lucide-0.460.0.json';
import aliases from '../../../../packages/schema/data/icon-aliases.json';
import type { IconData, IconSet } from './resolve';

const d = data as unknown as IconData;

export const ICON_SET: IconSet = {
  version: d.lucide,
  icons: d.icons,
  names: Object.keys(d.icons).sort(),
  aliases: aliases as Record<string, string>,
};
