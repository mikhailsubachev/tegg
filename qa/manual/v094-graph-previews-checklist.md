# v0.94 graph and previews: manual checks (checklist, no results yet)

The `[manual]` criteria of the v0.94 slice (D-1164…D-1190; docs/acceptance/app-shell.md FR-NAV-03 AC-3 as changed by
D-1168, docs/acceptance/graph.md FR-GRP-01 AC-50). They need a real trackpad and mouse, so they are not automated
(D-170). A session record with one line `- <AC-ID>: pass` or `fail` each goes into `qa/manual/<date>-v094.md` or
`qa/sessions/` when they are run (tools/qa CONTRACT §9.3). This file holds no results on purpose.

Setup: the built app with `TEGG_TEST=1`, a temporary `TEGG_APP_SUPPORT`, and a temporary copy of a synthetic vault
(`tests/fixtures/vaults/graph/` + `new-empty/.tegg/`, and for the Kanban `tests/fixtures/vaults/tasks/`). Never the
owner's real vault (D-62). Before each check, make a few navigations so Back and Forward both have an entry.

| AC | Where defined | Check |
| --- | --- | --- |
| FR-NAV-03/AC-3 | app-shell.md `[manual]` (D-1168) | The mouse's back and forward buttons go back and forward, also when a mouse utility (Logi Options+) sends them as navigation swipes; a three-finger swipe that macOS sends as a navigation swipe goes back and forward. A two-finger horizontal scroll on the trackpad and a horizontal mouse scroll never go back or forward: over a wide Kanban board they scroll it, over the graph they pan it, elsewhere they do nothing. |
| FR-GRP-01/AC-50 | graph.md `[manual]` (D-1169) | On Plán čtvrtletí's full view and in its panel: a two-finger scroll pans in every direction; a pinch zooms around the fingers; ⌘ with a mouse wheel zooms around the pointer; a horizontal two-finger scroll never goes Back; the note behind the panel doesn't scroll. |
