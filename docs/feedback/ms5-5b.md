# Feedback: MS5 slice 5B preview (owner, 2026-10-19)

Preview `preview-2026-10-19` (ecc2070). Triage: **bug** = contradicts an existing AC/decision, fixed with a `bug_*` test
first; **change** = new behaviour, needs an AP point and a D-xx before work.

| # | Finding | Triage |
|---|---|---|
| F1 | The mouse's Back button (Logi Options+) doesn't go back; it should behave like the touchpad's back swipe | bug: FR-NAV-03, D-165 |
| F2 | No calendar icon when setting a task's due date | change: D-587 (AP-515) |
| F3 | Back (`<`) must return to the Tasks view the user left | bug: tasks.md AC-9, AC-15 |
| F4 | The sidebar's `Tasks` entry shows a number of tasks | change: D-588 (AP-516) |
| F5 | A Kanban card can't be dropped below the last card of a short column: only the cards' height is a drop zone | bug: tasks.md R42 |
| F6 | The Kanban doesn't need the status chip on cards | change: D-589 (AP-517) |
| F7 | An object card (Inbox) shows its text as one run without line breaks; it should show simplified formatting | change: D-590 (AP-518) |
| F8 | A `Review` button at the top of every reviewable object, as on its Inbox card | change: D-591 (AP-519) |

## Bugs

- **F1.** Tegg handles mouse buttons 4/5 (page `mouseup` and a native `OtherMouseUp` monitor) and a two-finger
  horizontal scroll. Logi Options+ maps the Back button to the system's navigation **swipe** (`NSEventTypeSwipe`),
  which neither path sees. Fix: the native monitor also turns a horizontal swipe event into `nav:mouse`
  (`back` for a swipe to the right, as Safari does). A Logi mouse can't be simulated in L6, so the regression test drives a
  synthetic swipe event; the owner checks the real mouse in the next preview.
- **F3.** To be reproduced from AC-9/AC-15 (Kanban → open a card → Back); the `bug_*` test comes first.
- **F5.** `.task-board` aligns columns to the top (`align-items: flex-start`), so a column is as tall as its cards.
  Fix: columns stretch to the board's height, which fills the page below the toolbar.

## Points for the owner (AP-515…AP-519, decided as D-587…D-591)

Decided by the owner on 2026-10-19: AP-516, AP-517 and AP-518 as recommended; AP-515 as (b), the card menu only; AP-519 as (b), also on review-on types.

| AP | Point | Recommendation | Alternatives | Affects |
|---|---|---|---|---|
| AP-515 | **Picking a due date.** The card menu's `Due date…` is a text field only; the quick-add `Due` chip can only be set by typing a token. Elsewhere a date property has the `Choose date` month grid. | `Due date…` shows a calendar button `Choose date` next to its field, opening the same month grid (keyboard as in R10); the quick-add `Due` chip becomes a button that opens it too. Typing keeps working. | (b) Only the card menu. **Chosen: D-587.** (c) Open the month grid directly instead of the text field. | tasks.md R43, R44, FR-TSK-09, FR-TSK-10 |
| AP-516 | **The `Tasks` count in the sidebar.** R1 shows overdue + due-today open tasks and nothing at 0, so on a day without due tasks the entry has no number. | Show the **open** tasks count (open + in progress, as the header's `open`); none at 0. Overdue tasks are already red on the page. **Accepted: D-588.** | (b) Keep overdue + due today, but show `0`. (c) Both: `open`, with the overdue part red (`12 · 2`). | tasks.md R1, AC-1; app-shell FR-NAV-04 |
| AP-517 | **Status on Kanban cards.** The card shows its status unless it's the first status; on the board by status the column already says it. | Hide the status chip on the Kanban **by status**, except a non-status value in `No status` (`Rozpracováno` · `Not a status`, AC-9). Keep it on the board by tag, the Schedule and the Daily Note. **Accepted: D-589.** | (b) Hide it on both Kanban groupings. | tasks.md R44, AC-9 |
| AP-518 | **Card text.** The Inbox card's excerpt is plain text with whitespace collapsed (≤ 300 chars). | The card shows the body's first blocks as **simplified Markdown**: paragraphs and line breaks kept, list items with bullets / numbers / checkboxes (read-only), headings as bold lines, bold/italic/strike/code inline, links and wikilinks as their text, embeds and images as `[image]`/the embed's title, tables and code blocks as their first line; clamped at the card's fixed height (D-586) with `…`. Rendered from the same `@tegg/doc` parse (D-82), never HTML from the file. **Accepted: D-590.** | (b) Only keep line breaks and list bullets, no inline styling. (c) Render the full read view inside the card. | inbox.md R60, FR-INB-01; the Backlinks excerpts stay as they are |
| AP-519 | **A review button on every reviewable object.** Only the Daily Note header has the `Mark reviewed` / `Reviewed` toggle (D-330); other objects are reviewed from the Inbox or the properties. | The same toggle (`aria-pressed`, palette `Mark reviewed` / `Mark unreviewed`, D-330) at the top of the note page, right of the title row, on every object that is an Inbox member or was reviewed: `review` is `unreviewed` or `reviewed`, or the type is Quick Note or Daily Note (R61, D-554). It writes only `review` and `modified` (D-562), and nothing until clicked. Not shown on other objects or in templates. | (b) Also on every object of a type with the review workflow on, even without a value. **Chosen: D-591.** (c) Only on Inbox members (hidden once reviewed). | inbox.md R61, FR-INB-02; daily-notes.md D-330 |
