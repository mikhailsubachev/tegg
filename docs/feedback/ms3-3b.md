# Feedback: MS3 slice 3B preview

Owner testing of `Tegg Preview.app` (docs/previews/ms3-3b.md), triaged by Claude (plan §5).

| # | Feedback | Triage | Status |
| --- | --- | --- | --- |
| F-1 | The logo in the app is not correct | Bug (FR-UX-01, design board Main): the sidebar shows the plain text "TEGG" in the UI font; the board has the SVG mark (rounded square, blue T and dot) and the "TEGG" wordmark in Space Grotesk 700, brand blue `#0B44F0` / dark `#8FAEFF`. The font can't be loaded from Google Fonts (NFR-SEC-01); it has to be bundled or the wordmark drawn as SVG paths | Open, see AP-108 |
| F-2 | The mouse back button doesn't go back to the previous page | Not a bug: Back/Forward (FR-NAV-03) is MS5; ⌘[ / ⌘] and the title-bar buttons are disabled (D-125, app-shell R3). Pulling it forward is an owner decision | Open, see AP-109 |

## Points for the owner

| # | Issue | Proposal | Affects |
| --- | --- | --- | --- |
| AP-108 | **Logo wordmark font.** The board uses Space Grotesk 700 from Google Fonts; the app makes no network calls (NFR-SEC-01). | Draw the whole logo (mark and "TEGG") as two SVG assets (light, dark), with the wordmark's letters converted to paths from Space Grotesk (SIL Open Font License), so no font ships with the app. Alternative: bundle the font file (OFL) and keep live text. | FR-UX-01, NFR-SEC-01, design Main |
| AP-109 | **Back/Forward earlier than MS5.** Following links in 3B makes going back the most common missing action. | Build FR-NAV-03 now as a small slice (3B.1): an in-memory history of routes (with note fragments and scroll position), Back/Forward from the title-bar buttons, ⌘[ / ⌘], the mouse back/forward buttons and the trackpad swipe, in the palette. Not persisted across launches. MS5 keeps the rest of FR-NAV (tabs v1.0). | FR-NAV-03, D-125, app-shell R3/R4 |
