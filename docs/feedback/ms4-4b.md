# Feedback: MS4 slice 4B preview (owner, 2026-10-16)

Triage: **bug** = contradicts an existing AC/decision, fixed with a `bug_*` test first; **change** = new behaviour, needs an AP point and a D-xx before work.

| # | Finding | Triage |
|---|---|---|
| F1 | Adding a new object of any type must open its edit page with the caret in the title (if editable); for a Daily Note, in the content | D-367 (AP-285); bug where a create path that D-247 covers doesn't do it |
| F2 | Backlinks: just show chips of the objects that link to the displayed one | D-368 (AP-286) |
| F3 | Clicking the object's type must not change the type but open the page of all objects of that type | D-369 (AP-287) |

AP-285…AP-287 were accepted as recommended (owner, 2026-10-16).
