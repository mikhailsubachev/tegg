# Fixture `format/stem/` (slice REL, the Czech stemmer's golden list)

`cs.tsv` is the contract of the Czech stemmer `stem_cs` (D-1691; `docs/acceptance/related.md` FR-LNK-15 AC-2, R180). Hand-written and synthetic (D-50). Changing a row is an AC-test change (`AC-Test-Change` trailer, D-61).

**Status: draft.** The rows marked `AP-1467` or `AP-1468` follow those points' proposals. If the owner decides otherwise, the rows change in the same commit as the decision, to the values given below.

## Format

- UTF-8, LF, NFC, no BOM, one row per line.
- The first line is the header `word	stem	note`.
- Each row is `word<TAB>stem` or `word<TAB>stem<TAB>note`. A missing `note` means an ordinary row.
- `word` is written as a user would write it: with or without diacritics, any case. The NFD forms are made at runtime by the test (`nfd(word)`), never stored.
- `stem` is `stem_cs(fold(word))`, where `fold` is `text::fold` (NFC → lower case → combining marks removed).
- `note` values:
  - `AP-1467`: the value depends on a folded-text rule (AP-1467).
  - `AP-1468`: the value depends on the proposed extra normalization (AP-1468).
  - `limit`: a known limit accepted by D-1682. The row records what the rules give, which differs from the word's other forms, or merges two different words.

**How the test uses it** (FR-LNK-15 AC-2): for every row, `stem_cs(fold(word)) == stem` and `stem_cs(fold(nfd(word))) == stem`. Stems shorter than 3 characters (`dn`, `rk`) are what the stemmer returns. The R179 pipeline drops them afterwards, which AC-4 checks, not this file.

**How the rows were made.** Every row was computed **by hand** from the rule set below. It was not produced by running Lucene or any other implementation. Lucene's own test words (`hrad`, `muž`, `soudce`) were checked against Lucene's rules as recalled. Before the red tests, the contract author runs the port once over this file. Any disagreement is checked against the rules below and reported as a point for the owner. It is never fixed silently, in either the code or this file.

## The rule set (Dolamic and Savoy's light stemmer on folded text)

Input: a folded word (lower case, no diacritics). `len` is its length in characters. The three steps run in order, and within a step the first matching rule wins.

**1. Remove case endings.**

| Condition | Endings | Remove |
| --- | --- | --- |
| len > 7 | `atech` | 5 |
| len > 6 | `etem`, `atum` | 4 |
| len > 5 | `ech`, `ich`, `eho`, `emi`, `emu`, `ete`, `eti`, `iho`, `imi`, `imu`, `ach`, `ata`, `aty`, `ych`, `ama`, `ami`, `ove`, `ovi`, `ymi` | 3 |
| len > 4 | `em`, `es`, `im`, `um`, `at`, `am`, `os`, `us`, `ym`, `mi`, `ou` | 2 |
| len > 3 | a final `a`, `e`, `i`, `o`, `u` or `y` | 1 |

These are Lucene's `CzechStemmer` endings with their diacritics removed. For example, `-ých` is stored as `ych`, `-ého` as `eho`, `-ími` as `imi` and `-ům` as `um`.

**2. Remove possessive endings.** If len > 5 and the word ends in `ov`, `in` or `uv`, remove 2.

**3. Normalize** (only if len > 0):
1. ends in `ct` → `ck`;
2. ends in `st` → `sk`;
3. ends in `c` → `k`; ends in `z` → `h`;
4. if len > 1 and the second-to-last letter is `e`, remove that `e` (`domek` → `domk`);
5. **AP-1468 (proposed):** if rule 4 ran and the result ends in `ct` or `st`, apply rule 1 or 2 to it (`rozpocet` → `rozpoct` → `rozpock`).

Lucene's last rule, `ů → o` before the final letter, is not part of the port (AP-1467 point 3).

## Rows that depend on a point for the owner

**AP-1468** (the extra normalization). Values under the proposal, then under the alternative (the faithful port, without rule 3.5):

| Rows | Proposal | Alternative |
| --- | --- | --- |
| `rozpočet`, `rozpocet`, `Rozpočet` | `rozpock` | `rozpoct` |
| `účet`, `ucet` | `uck` | `uct` |
| `deset` | `desk` | `dest` |

The other forms of these words (`rozpočtu`, `účtem` …) are `rozpock` and `uck` under both. Under the alternative, a nominative and its other forms get different stems. That is what the board's caption "`rozpočet`, `rozpocet` and `rozpočtu` are one word" disagrees with.

**AP-1467** (rules where folding loses information). Values under the proposal, then under the alternative:

| Rows | Rule | Proposal | Alternative |
| --- | --- | --- | --- |
| `město` family (10 rows) | `st → sk` also on a plain `st` | `mesk` | `mest` |
| `cesta` family (6 rows) | same | `cesk` | `cest` |
| `čeští`, `cesti` | same | `cesk` | `cest` (then `český` `cesk` and `čeští` `cest` differ) |
| `letiště` family (6 rows) | same | `letisk` | `letist` |
| `kompost` family (3 rows) | same | `komposk` | `kompost` |
| `termín` family (10 rows) | possessive `-in` also strips `-ín` | `term` | `termin` (if the `-in` rule is dropped) |

Under the proposal, `cesta` and `český` share the stem `cesk`. In Lucene they don't (`cest` / `česk`), because `st` and `št` differ there.

## Families and what each checks

| Family | Rows | Checks |
| --- | --- | --- |
| `důležitý` (adjective, all cases) | 28 | DIA-2, DIA-4; upper case and partly accented forms (`dulezité`, `důlezite`, DIA-3) |
| `zelený` | 16 | adjective endings `-ých`, `-ými`, `-ého`, `-ou`; fleeting `e` after the ending is removed; a partly accented `zelenymí` |
| `kniha`, `Praha`, `noha`, `obloha` | 12, 6, 5, 4 | `z` → `h` (`knize`, `Praze`, `noze`, `obloze`) |
| `ruka`, `matka` | 9, 6 | `c` → `k` (`ruce`, `matce`) |
| `domek` | 7 | the fleeting `e` (`domek` / `domku`) and `c` → `k` (`domcích`) |
| `rozpočet`, `účet` | 14, 8 | the fleeting `e` before `čt` (AP-1468) |
| `město`, `cesta`, `český`, `letiště`, `kompost` | 10, 6, 8, 6, 3 | `st` / `št` → `sk` on folded text (AP-1467) |
| `školení`, `termín`, `schůzka`, `přihláška`, `dodavatel` | 10, 10, 8, 8, 8 | the words of the fixture vault's twins (DIA-6); `termín` the possessive `-ín` (AP-1467) |
| `včelstvo`, `dělnice`, `rámek` | 8, 8, 8 | the fixture vault's exclusion cluster |
| `hrad`, `muž`, `soudce` | 9, 14, 7 | Lucene's hard and soft masculine examples on folded text |
| `Novák` | 14 | the possessive `-ov`, `-uv` (`Novákova`, `Novákův`) |
| `ubytování`, `letenka`, `náklad`, `finance`, `Lisabon` | 6, 5, 8, 6, 3 | the fixture vault's offsite cluster (board A) |
| `zahrada`, `záhon`, `rajče`, `paprika` | 7, 8, 10, 4 | the fixture vault's linked cluster; `-atům` (`rajčatům`) |
| `hvězda`, `souhvězdí`, `kometa`, `měsíc`, `paprsek` | 8, 4, 4, 6, 4 | the fixture vault's cap cluster |
| limits | 19 | D-1682's accepted limits: vowel change inside the stem (`dům` / `domu`, `stůl` / `stolu`); one normalization only (`řeka` / `řece`, `trubec` / `trubci`); `-us` taken as an ending (`autobus` / `autobusu`); 3-letter words (`den` / `dne`); folding merges (`řada` = `rada`, `být` = `byt`); the AP-1468 merge `deset` = `deska` |

362 rows.
