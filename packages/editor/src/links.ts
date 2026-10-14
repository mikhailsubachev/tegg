// D-184: the wikilink text written for an object chosen in `[[` autocomplete or the link field (FR-EDT-06 AC-3,
// FR-LNK-14, FR-FMT-12 AC-2). The target is the file name when it resolves to that file from the current note, else
// the vault path without `.md`; `|title` is added when the title differs from the written target, `|alias` when the
// object was matched through an alias.

export type LinkChoice = { path: string; title: string; viaAlias?: string; fromPath: string; stemResolves: boolean }

export function linkText(c: LinkChoice): string {
  const path = c.path.normalize('NFC').replace(/\.md$/i, '')
  const stem = path.slice(path.lastIndexOf('/') + 1)
  const target = c.stemResolves ? stem : path
  const shown = (c.viaAlias ?? c.title).normalize('NFC')
  return shown && shown !== target ? `${target}|${shown}` : target
}
