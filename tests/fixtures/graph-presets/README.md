# Fixture `graph-presets/` (v1.0 slice G3, graph filter presets)

Synthetic sample files of `.tegg/graph.yml` for `docs/acceptance/graph.md` part two (FR-GRP-02 AC-11…AC-24, FR-SYN-02 AC-8, FR-SYN-03 AC-22…AC-24, FR-SYN-06 AC-40, FR-FMT-07 AC-27, FR-FMT-12 AC-7, NFR-POR-01 AC-3, FR-STO-06 AC-1). Hand-written (D-50); no real content. **Status: draft**, with the criteria; the format and the write rules are proposals (AP-920, AP-921) until the owner decides.

These files are **not** a vault and never sit in `tests/fixtures/vaults/graph/`: G1's criteria (FR-SYN-06 AC-38) check that the graph creates no `.tegg/graph.yml`, so each test copies one of these files to `.tegg/graph.yml` of its temporary copy of `tests/fixtures/vaults/graph/` (or leaves it absent). The graph vault's type keys are used: `page`, `task`, `quick-note`, `daily-note`, `cesta`, `osoba`, `projekt`, `schůzka`, `image`, `pdf`, `tag`, and the undefined `recept`. `kniha` is a type key that doesn't exist in that vault.

**Byte rules.** LF line endings, UTF-8 without BOM, every file ends with exactly one `\n`, NFC everywhere. Don't open and re-save these files in an editor; the `expected/` files are compared byte for byte. NFD and CRLF variants are made at runtime (below), because an editor or Git can normalize them.

## Input files

| File | What it holds | Used by |
| --- | --- | --- |
| `valid.yml` | the canonical format (R118): header comment, `version: 1`, three presets in flow style. `Bez štítků` hides `tag` and the unknown key `kniha`; `Jen vztahy` hides the kinds `link`, `embed`, `tag`; `Lidé a schůzky` hides every type except `osoba` and `schůzka` | FR-GRP-02 AC-11…AC-16, AC-18, AC-22, AC-23; FR-SYN-06 AC-40 |
| `unknown-keys.yml` | two header comments, an unknown top-level key `výchozí-pohled`, a comment inside `presets`, a quoted name `"Lidé: schůzky"`, an unknown preset key `poznámka` and `barva`, a block-style list, a trailing comment on a value line, a column-0 comment after the list | FR-FMT-07 AC-27, FR-SYN-06 AC-40 |
| `invalid-yaml.yml` | an unclosed flow list on **line 5** | FR-GRP-02 AC-19 |
| `entries.yml` | entries that are skipped and kept (R118 read rules): a case duplicate `lidé` of `Lidé`, the reserved `Default`, a blank name `"   "`, an entry without `name`, `hidden-types: tag` (not a list), `name: 42` (not a string); and entries that are listed: `Lidé`, `Bez druhů` (no `hidden-kinds` key = none hidden), `Neznámé spoje` (the unknown kind `backlink` is ignored and kept) | FR-GRP-02 AC-20 |
| `newer-version.yml` | `version: 2` with an unknown key `views` | FR-GRP-02 AC-21 |

Expected menus (Default first, then the listed presets in file order, AP-945): `valid.yml` → Default, Bez štítků, Jen vztahy, Lidé a schůzky; `unknown-keys.yml` → Default, Lidé: schůzky, Bez štítků; `entries.yml` → Default, Lidé, Bez druhů, Neznámé spoje; `newer-version.yml` → Default, Bez štítků (read-only); `invalid-yaml.yml` → Default only.

Expected graphs of Plán (`Pages/Plán čtvrtletí.md`) with each preset of `valid.yml` (from the graph vault README's walk rules):

| Preset | Depth | Drawn | Edges | Hidden |
| --- | --- | --- | --- | --- |
| Bez štítků | 1 | 8 (filter scenario a) | 8 | 2 |
| Bez štítků | 2 | 14 (scenario b) | 15 | 5 |
| Jen vztahy | 1 | 3: Plán, Rozpočet, Úkol (E1, E5 as `relation`) | 2 | 7 |
| Lidé a schůzky | 1 | 2: Plán, Zápis (E2) | 1 | 8 |
| Lidé a schůzky | 2 | 4: Plán, Zápis, Jana, Petr (E2, E14, E15) | 3 | 15 |

## Expected outputs (`expected/`)

Each is the exact file after one operation through `graph_presets_apply` (contract §16.2), by the R118 write rules:

| File | Start | Operation |
| --- | --- | --- |
| `created.yml` | no `.tegg/graph.yml` | `save` `Bez štítků`, hidden types `[tag]`, hidden kinds `[]` |
| `valid-after-update.yml` | `valid.yml` | `update` `Bez štítků` to hidden types `[kniha]` (Tags ticked again; the unknown key stays, D-907), kinds `[]`: only line 5 changes |
| `valid-after-deleting-all.yml` | `valid.yml` | `delete` of the three presets in turn; the file stays with `presets: []` (AP-926) |
| `unknown-keys-after-rename.yml` | `unknown-keys.yml` | `rename` `Bez štítků` → `Bez tagů`: only line 14 changes |
| `unknown-keys-after-update.yml` | `unknown-keys.yml` | `update` `Lidé: schůzky` to types `[page, task, quick-note, tag]`, kinds `[embed, tag]`: lines 9–12 become one flow line, line 13 keeps its trailing comment |
| `unknown-keys-after-delete.yml` | `unknown-keys.yml` | `delete` `Lidé: schůzky`: lines 7–13 removed; the comment on line 6 stays |
| `unknown-keys-after-save.yml` | `unknown-keys.yml` | `save` `Jen vztahy`, types `[]`, kinds `[link, embed, tag]`: three lines inserted after line 17, before `# konec` |

## Made at runtime by the tests (never committed)

- **NFD names**: `valid.yml` with every `name:` value converted to NFD (`String.prototype.normalize('NFD')`), written as `.tegg/graph.yml` (FR-FMT-12 AC-7).
- **CRLF**: `valid.yml` and `unknown-keys.yml` with every `\n` replaced by `\r\n`; and `valid.yml` without its final newline (FR-FMT-07 AC-27).
- **Missing version**: `valid.yml` without line 2 (FR-GRP-02 AC-21).
- **Invalid versions**: `valid.yml` with `version: 0`, `version: "1"`, `version: 1.5` (unreadable, as types.md AR-07 AC-4).
- **Not UTF-8**: `valid.yml` with the byte `0xFF` inserted in line 4's name (unreadable).
- **Not a mapping / wrong shape**: `- a` (a list at the top), `presets: Bez štítků` (not a list) (unreadable).
- **Sync conflict copies**: `.tegg/graph (conflicted copy 2026-10-28).yml` and `.tegg/graph 2.yml`, each a copy of `valid.yml` with a fourth preset `Z jiného Macu` (FR-SYN-03 AC-23).
- The external writes and deletes of `.tegg/graph.yml` named in the criteria: by the helper process of ms3-shell §13.6 in L6, by the fake core in L5, by plain file writes in L4.
