# Overlay `phone/` (slice AND-2, the phone layout and reading)

Synthetic overlay for `docs/acceptance/android-phone.md` ("Fixtures"; FR-UX-04, FR-NAV-04, FR-NAV-03, FR-EDT-10, FR-EDT-02, FR-EDT-07, FR-MMP-02, FR-HOM-02, FR-HOM-04, FR-SYN-06, FR-SYN-03, NFR-SEC-01). Hand-written by `make-phone.mjs` (D-50); every name, title and text is invented (D-62).

**How tests use it.** Copy `tests/fixtures/vaults/views/` (without its README), then `tests/fixtures/vaults/new-empty/.tegg/`, then this folder (without this README and `make-phone.mjs`). No names clash. `_attachments/široký.png` is binary.

**Byte rules.** LF, UTF-8 without BOM, NFC (names and content), one final newline. Ids `01JBAN2000000000000000N0nn`. Regenerate with `node tests/fixtures/vaults/phone/make-phone.mjs`; don't re-save the files in an editor.

**Test clock.** The views fixture's: `2026-11-19T10:00:00+01:00` (a Thursday), Europe/Prague, region `cs`.

| Path | id | What it holds | Used by |
| --- | --- | --- | --- |
| `Pages/Mapa výletu.md` | N001 | paragraph; `> [!mindmap] Výlet` with Výjezd's 7-node list (mindmap R90) whose `Místo` child is `Lisabon [[Mapa bez severu]]`; the checklist item `- [x] Pasy` after the map (outside the callout, so the map keeps 7 nodes); `> [!mindmap\|spider] Pavouk` with Pavouk's 8 nodes (R96) | FR-MMP-02 AC-32…AC-36, FR-SYN-06 AC-51 |
| `Pages/Široký obsah.md` | N002 | a 6-column table (`Místo`, `Cena`, `Kapacita`, `Vzdálenost`, `Poznámka`, `Kontakt`, 4 rows); a fenced code line of 240 characters; the word `nejneobhospodařovávatelnějšímu` three times without spaces; a 160-character URL `https://example.org/…`; `![[široký.png]]`; a `[!tip]` callout with a 300-character line | FR-EDT-02 AC-26, FR-UX-04 AC-6 |
| `Pages/Odkazy ven.md` | N003 | `[web](https://example.org/čeština)`, `<mailto:eva@example.org>`, `[skript](javascript:alert(1))`, `[soubor](file:///etc/hosts)`, `[[Neexistuje]]`, `[[Později]]` (pushed by a test), `[[2026-10-20]]` (no daily note), `#cestování` | NFR-SEC-01 AC-4, FR-SYN-03 AC-36, FR-EDT-10 AC-11 |
| `Pages/Dlouhá poznámka.md` | N004 | `## Úvod`, 40 paragraphs `Odstavec <n>: …`, `## Druhá kapitola`, then 30 paragraphs (so the heading can be scrolled to the top) | FR-UX-04 AC-7, FR-NAV-03 AC-19, FR-SYN-03 AC-35 |
| `Quick Notes/Nápad z vlaku.md` | N005 | `review: unreviewed`, `captured: 2026-11-19T07:40:00+01:00` | the Inbox on the overlay |
| `Quick Notes/Koupit čaj.md` | N006 | `review: unreviewed`, `captured: 2026-11-18T18:05:00+01:00` | the Inbox on the overlay |
| `Daily/2026-10-21.md` | N007 | `review: reviewed`, body `Prohlédnout [[Mapa výletu]].` | daily routes; not an Inbox item |
| `Tags/čtení.md` | N008 | `color: blue` | `tag/čtení` |
| `Images/Široký.md` | N009 | Image object of `široký.png` (`width: 2000`, `height: 400`) | FR-EDT-02 AC-26 |
| `_attachments/široký.png` | — | PNG 2,000 × 400, two flat halves (the routine of `trash-media/make-media.mjs`) | FR-EDT-02 AC-26 (5 : 1) |
| `.tegg/pinned.yml` | — | `Mapa výletu` (by `id` and path), then the query `Rozečtené` | FR-HOM-02 AC-32, FR-NAV-04 AC-13 |

Made at runtime by the tests (never committed): `Pages/Později.md`, a swapped `pinned.yml`, an empty pins file, a pin of a missing object, a `views:` entry `Chybí` in `book.yml`, `Quick Notes/Třetí nápad.md`, appended paragraphs.
