# Session: MS2 switcher (FR-NAV-01 AC-11) and search/external-change charter
milestone: MS2
date: 2026-10-12
build: 0605943

## Manual ACs
- FR-NAV-01/AC-11: fail

## Setup

- Temp vault: copy of `tests/fixtures/vaults/search/` plus `tests/fixtures/vaults/new-empty/.tegg/`, in the session scratchpad. Temp `TEGG_APP_SUPPORT`. Launched `Tegg.app/Contents/MacOS/tegg` with `TEGG_TEST=1`.
- Driving: System Events keystrokes (AppleScript); state read from the macOS accessibility tree. `screencapture` was denied (no Screen Recording permission) and no computer-use tool was available, so there are no screenshots, and visual checks (highlight colours, dark mode) were not possible.
- Before/after listing with `shasum` of every vault file.

## Steps and observations

### FR-NAV-01 AC-11
- ⌘O from the main window: switcher opens, `Switcher query` field focused. Pass.
- `cteni` → "Čtení knih" (selected) + `Create "cteni"` (Quick Notes). `rozp` → Rozpočet 2026, Projekt a rozpočet, Create. `a` → 5 notes, alias "Reading list" shown for Čtení knih.
- ↓, ↓↓↑, ↓↓↓↑: selection stays on item 1 every time (`AXSelected`, DOM class `selected`); ⏎ then opens item 1 (Rozpočet 2026 instead of Projekt a rozpočet). Same with a CGEvent-posted key 125 and with the window moved away from the mouse pointer (ruled out `onMouseEnter` resetting the selection). ← in the same field moves the caret correctly. Fail.
- ⏎ opens the selected note; Esc closes. Pass (but see bug 2).
- Create: pasted `Žluťoučký nápad 🦊: a/b` → `Quick Notes/Žluťoučký nápad 🦊 a b.md`, NFC name, `:` and `/` replaced, title kept verbatim (quoted) in frontmatter, `type: quick-note`, id/created/modified set; note opens. Pass.
- An exact existing title (`Nápad na výlet`) still offers Create as the second item; could not test the ` (2)` suffix because Create is only reachable with ↓ (bug 1).

### Search charter
- `rozpočet` and `rozpocet`: same 5 results (diacritics-insensitive). Pass.
- Phrase `"rozpočet projektu"`: 2 results (Tomášovi, Rozpočet 2026). Pass.
- Exclusion `rozpočet -výlet`: 3 results, Nápad na výlet excluded. Pass.
- Typo `rozpocte`: 5 results marked "similar spelling". Pass.
- `meruňkách` (end of a long note): Čtení knih with the right snippet. `reading list` finds Čtení knih by alias (no snippet).
- `.trash/` (`Smazaný`) and `_templates/` (`Šablona`): no results. Pass.
- Syntax-only queries `"`, `-`, `*`, `OR`: "No results", no error, no crash.
- With exactly 1 result the count line ("N results") is missing, while 0 shows "No results" and 2+ shows "N results" (minor, maybe intended).
- Snippets: the accessible name runs the word before a highlight into the highlight in 2 of 5 results ("jinýrozpočet", "Zmiňujerozpočet"); the source has a space. Could be an accessibility-tree artefact of `<mark>`; not confirmed visually (bug 4, unconfirmed).

### External changes (app running)
- Created `Pages/Externí poznámka.md` and `Pages/Rychlá kontrola.md` and renamed `Obyčejná poznámka.md` → `Přejmenovaná.md` from the shell.
- A new file was in the switcher ~1 s later; the rename was reflected (old title gone, `prejm` → Přejmenovaná) within ~3 s. Pass.
- An already open switcher does not refresh its list when files change; it updates on the next keystroke. Acceptable.

### Light/dark
- Not checked: changing the system appearance is a system setting this agent does not modify, and no screenshots were possible. `ui/src/styles.css` has a `prefers-color-scheme: dark` block. Owner to check visually.

### Data safety
- Before/after hash comparison: the only differences are the three files changed from the shell and the two notes created via Create. No fixture file was rewritten, `.tegg/` untouched, no temp files left, nothing written into the vault after quitting (kill). Pass.

## Bugs (drafts)

1. **Switcher ↑/↓ don't move the selection** — FR-NAV-01 AC-11 / FR-UX-03, tier T3. Steps: open a vault, ⌘O, type `rozp`, press ↓, press ⏎. Expected: "Projekt a rozpočet" opens. Actual: "Rozpočet 2026" (first item) opens; selection never moves. ← works in the same field. Consequence: the Create item is not reachable from the keyboard whenever there is any match. Code looks right (`Switcher.tsx` onKeyDown); worth a WebKit Playwright test with real key events. Needs owner confirmation with a physical keyboard (synthetic System Events/CGEvent input here).
2. **macOS autocorrect/spelling bubble in the switcher field swallows the first Esc** — FR-NAV-01 / FR-UX-03, tier T4. Steps: ⌘O, type `prejm` (or `cteni`, `rychl`): a correction bubble ("Prejm", "Cteni") appears; Esc once. Expected: switcher closes. Actual: bubble closes, switcher stays; a later ⌘O + typing appends to the old query (`prejmexter`). Autocorrect could also rewrite a query on space. Fix: `autoCorrect="off" spellCheck={false} autoCapitalize="off"` on the switcher and search inputs.
3. **No count line for exactly one search result** — FR-SRC-03, tier T4. Search `meruňkách`: one result, no "1 result" line. Expected (by analogy) "1 result".
4. **(Unconfirmed) Space lost before a highlighted term in snippets** — FR-SRC-03, tier T4. Search `rozpočet`: accessibility names read "…týká jinýrozpočet." and "Zmiňujerozpočet jen jednou." (source has spaces; the second spans a line break). Check visually; if real, look at `Highlighted.tsx`/snippet whitespace at line joins.

## Risks noticed
- No data-loss risk found: creation is one atomic new file, nothing else written.
- Keyboard-only flow is blocked for anything beyond the first switcher item (bug 1); this also blocks the duplicate-name ` (2)` check, which should be re-run once fixed.
