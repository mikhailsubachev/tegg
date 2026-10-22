// @tegg/editor: the block editor on source blocks (ADR 0002), ported from spike S2 (D-83).
// Public interface: docs/contracts/ms3-shell.md §13.3.
export { createEditor, blockSelKey, type ConversionRecord, type EditorOptions, type Now, type TeggEditor } from './editor'
export { embedTarget, linkText, type LinkChoice } from './links'
export { slashItems, SLASH_BLOCK, type Due, type SlashItem } from './slash'
export { VerifyError } from './sourceDoc'
export { OPERATIONS, applyOperation } from './ops'
export { wikiLabel } from './schema'
export { createLatencyProbe } from './probe'
export { linkTarget, type ChipExtra, type EditorUi, type EmbedHandle, type LinkInfo } from './present'
export { insertEmbeds } from './media'
