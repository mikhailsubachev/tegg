# Fixture `queries-files/` (v1.0 slice Q, query-file writes)

Expected bytes of query-file writes for `docs/acceptance/queries.md` (R138 write rules, D-1436) and
`docs/contracts/v1-queries.md` §1.4, §1.5. Synthetic (D-50). The inputs are the query files of
`tests/fixtures/vaults/queries/.tegg/queries/` (and their CRLF / no-final-newline copies, made at runtime); the clock of
every write is the test clock `2026-11-10T10:00:00+01:00`.

**Byte rules.** UTF-8 without BOM, NFC. LF and one final `\n`, except the `-crlf` files (CRLF on every line, final CRLF)
and the `-no-newline` files (LF, no final newline). Don't open and re-save these files in an editor.

| File | Input → action | Criteria |
| --- | --- | --- |
| `expected/created.yml` | `New query` `Úkoly na víkend` (no types, no filters: every key at its default, R138 create order) | FR-QRY-06 AC-3 |
| `expected/created-a-b-plan.yml` | `New query` `A/B: plán?` → file `A B plán.yml`, `title` double-quoted (D-52, D-230) | FR-QRY-06 AC-3 |
| `expected/komentare-after-view.yml` | `Komentáře a neznámé klíče.yml`, commit `view: table` only: the `view:` line (its trailing comment kept byte for byte) and `modified:` change | FR-FMT-07 AC-29 |
| `expected/komentare-after-view-crlf.yml` | the CRLF copy of the input, same commit | FR-FMT-07 AC-29 |
| `expected/komentare-after-view-no-newline.yml` | the no-final-newline copy of the input, same commit | FR-FMT-07 AC-29 |
| `expected/komentare-after-filter.yml` | `Komentáře a neznámé klíče.yml`, commit adding the filter `rozpočet` `>` `5000` (`- rozpočet: { gt: 5000 }`, appended): only the `filters:` block (its inner comment is lost; the unchanged item keeps its lines, `x-poznámka` included) and `modified:` change | FR-FMT-07 AC-29 |
| `expected/komentare-after-filter-crlf.yml` | the CRLF copy, same commit | FR-FMT-07 AC-29 |
| `expected/komentare-after-filter-no-newline.yml` | the no-final-newline copy, same commit | FR-FMT-07 AC-29 |
| `expected/saved-rucni-dotaz.yml` | `Save as query…` on Přehled's inline fence `Ruční dotaz`: R138 create order with the fence's values, defaults for the missing keys (`columns` = Kniha's effective columns `[autor, modified]`), then the fence's comment line `# napsáno ručně` (unknown keys and comments after the known ones) | FR-QRY-06 AC-14 |
| `expected/duplicate-projekty-v-behu-2.yml` | `Duplicate` on `Projekty v běhu` → `Projekty v běhu (2).yml`: same bytes except `title:`, `created:`, `modified:` (the header comment is unchanged) | FR-QRY-06 AC-8 |
| `expected/renamed-otevrene-ukoly-porady.yml` | rename job `Otevřené úkoly z této schůzky` → `Otevřené úkoly porady`: same bytes except the `title:` line (no `modified` change, the header comment is unchanged) | FR-QRY-06 AC-6 |

`expected.json` (L3 conformance, shape in the contract §6.2) is written by the test author with the red tests.
