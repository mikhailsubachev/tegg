// All UI text in one place, for localization later (NFR-OTH-02).
export const t = {
  openVault: 'Open vault folder',
  openVaultHint: 'Choose the folder of a Tegg vault.',
  openVaultFailed: 'This folder could not be opened as a Tegg vault.',
  searchPlaceholder: 'Search notes',
  searchLabel: 'Search query',
  searchResults: 'Search results',
  noResults: 'No results',
  resultCount: (n: number) => (n === 1 ? '1 result' : `${n} results`),
  typoHint: 'similar spelling',
  switcherLabel: 'Quick switcher',
  switcherQuery: 'Switcher query',
  switcherPlaceholder: 'Go to or create an object…',
  create: (title: string) => `Create “${title}”`,
  alias: (a: string) => `alias: ${a}`,
  indexing: (done: number, total: number) => `Indexing ${done} of ${total}`,
  indexingLabel: 'Indexing progress',
  indexCancelled: 'Indexing paused',
  placeholders: (n: number) =>
    `${n} file${n === 1 ? ' is' : 's are'} online-only and not indexed. Make the folder available offline in your sync app.`,
  emptyNote: 'Open a note with ⌘O or search.',
  conflict: (p: string) => `${p} changed on disk.`,
} as const;
