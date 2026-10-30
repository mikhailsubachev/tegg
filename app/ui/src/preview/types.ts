// Slice P, object previews (docs/contracts/v1-previews.md §1, §3): the shapes every surface and the graph (D-917) use.
export type PreviewMode = 'click' | 'hover' | 'off';

export type PreviewUiDto = { mode?: PreviewMode; hoverDelay?: number; width?: number; height?: number };

export type PreviewTarget = {
  /** Vault path, NFC (for a tag, the Tag file's path or ''; for a day, ''). */
  path: string;
  /** '#Heading' text or '^id' (D-140 parsing, ms3-shell §11), without the '#'. */
  fragment: string | null;
  kind: 'note' | 'tag' | 'day';
  /** Tag key (kind 'tag'), date (kind 'day'). */
  key?: string;
  /** D-939: the task path whose first embed the source preview scrolls to. */
  scrollToEmbedOf?: string;
};
export type PreviewAnchor = { el: HTMLElement } | { rect: DOMRect };
/** §7: the graph's full view mounts the content in its right column. */
export type PreviewHost = { placement: 'popover' } | { placement: 'column'; container: HTMLElement };
/** 'key' = ⌥Space or ⏎ per D-929. */
export type PreviewOrigin = 'click' | 'hover' | 'key';
/** §7, D-982 (v1-graph §7): the graph's extra button before `Open` (`Center graph here`). */
export type PreviewExtraAction = { label: string; run: () => void; disabled?: boolean };
export type CloseReason = 'esc' | 'outside' | 'button' | 'tab' | 'open' | 'route';
