# Fixture `pinned-files/` (v1.0 slice PIN, sample `.tegg/pinned.yml` files)

Synthetic sample files of `.tegg/pinned.yml` (R131) for `docs/acceptance/pinned.md` and `docs/contracts/v1-pinned.md`, and the exact bytes expected after each write. Hand-written (D-50). They are **not** a vault: a test copies one of them to `.tegg/pinned.yml` of its temporary copy of `tests/fixtures/vaults/pinned/` (whose README lists the objects and ids). The L4 core tests, the fake core's TypeScript twin (`app/ui/test/fake-pins.ts`) and the L1 tests read the same files.

**Byte rules.** UTF-8 without BOM, NFC except `nfd.yml`; LF except the `-crlf` files (CRLF on every line); every file ends with one newline except the `-no-newline` files. Don't open and re-save them in an editor; `.gitattributes` keeps `tests/fixtures/**` binary-exact.

Positions: "position k" is 1-based (R131); the IPC's `at` / `to` is k − 1 (contract §2).

## Input files

| File | Lines | What it holds | Used by |
| --- | --- | --- | --- |
| `valid.yml` | 12 | R131's example. 1 header comment, 2 `version: 1`, 3 `pins:`, 4–5 Rozpočet (`id` + `path`), 6–7 Lisabon, 8–9 Porada, 10 `- tag: offsite`, 11 `- type: projekt`, 12 `- query: Otevřené úkoly tento týden` | most criteria |
| `unknown-keys.yml` | 16 | 1 header, 2 a second comment, 3 `version: 1`, 4 the unknown top-level key `x-sidebar: wide`, 5 `pins:`, 6 a comment above the first item, 7–9 Rozpočet with its path in **single** quotes and the unknown item key `x-note: z Macu`, 10 the flow item `- {tag: účty}`, 11 a comment between items, 12–14 Porada with a comment **inside** the item (13) and its path in **double** quotes, 15 `- type: projekt`, 16 the column-0 comment `# konec` after the list | FR-FMT-07 AC-28 |
| `unknown-keys-crlf.yml` | 16 | `unknown-keys.yml` with CRLF | FR-FMT-07 AC-28 |
| `unknown-keys-no-newline.yml` | 16 | `unknown-keys.yml` without the final newline | FR-FMT-07 AC-28 |
| `entries.yml` | 19 | R131's skipped items, kept byte for byte: 4–5 Rozpočet (listed), 6 a second pin of Rozpočet by `path` (duplicate, skipped), 7 `- tag: Offsite` (listed as `offsite`), 8 `- tag: "#offsite"` (duplicate key, skipped), 9–10 an item with both `tag` and `type` (skipped), 11 `- type: ""` (blank), 12 `- path: /etc/hosts` (absolute), 13 `- path: ../mimo.md` (`..`), 14 `- path: .tegg/vault.yml` (in `.tegg/`, not `.md`), 15 `- id: 42` (not a string), 16 `- x-route: inbox` (no kind), 17 `- jen text` (not a mapping), 18 `- type: schůzka` (listed), 19 `- query: …` (kept, not listed). Listed: Rozpočet, `#offsite`, `Schůzky` | FR-HOM-02 AC-24 |
| `stale.yml` | 14 | 4–5 Rozpočet's `id` with the stale path `Projekty/Starý název.md`; 6 `- path: Pages/Bez hlavičky.md`; 7–8 Koš's `id` with its old path `Pages/Starý plán.md`; 9–10 the unknown id `01JB5P000000000000000000ZZ` with `Pages/Smazaný.md`; 11–12 the unknown id `01JB5P000000000000000000ZY` with `Pages/Plán.md` (a path now held by Plán, id 10); 13 `- tag: zrušený`; 14 `- type: kniha` | FR-HOM-02 AC-16, FR-LNK-03 AC-22 |
| `nfd.yml` | 12 | `valid.yml` with the five `path:` / `tag:` lines in NFD (the header and the `query:` line stay NFC) | FR-FMT-12 AC-8 |
| `invalid-yaml.yml` | 7 | an unclosed flow sequence opened on **line 5** (`path: [Projekty/…`) | FR-HOM-02 AC-22 |
| `newer-version.yml` | 12 | `valid.yml` with `version: 2` | FR-HOM-02 AC-23 |

## Expected outputs (`expected/`)

Each is the exact file after one operation from its start, by R131's write rules (contract §1.2). New object items are `  - id: <id>` / `    path: <path>` (the items' indentation, dash 2, keys 4).

| File | Start | Operation | Bytes |
| --- | --- | --- | --- |
| `created.yml` | no file | pin Rozpočet | header, `version: 1`, `pins:`, valid lines 4–5 |
| `created-idless.yml` | `created.yml` | pin Bez hlavičky (no `id`) at the end | + `  - path: Pages/Bez hlavičky.md` |
| `valid-after-unpin-porada.yml` | `valid.yml` | unpin Porada (index 2) | lines 8–9 removed |
| `valid-after-move.yml` | `valid.yml` | move Lisabon to position 4 (`from: 1, to: 3`) | lines 1–5, 8–10, 6–7, 11–12 |
| `valid-after-pin-at-2.yml` | `valid.yml` | pin Čajovna at position 2 (`at: 1`) | Čajovna's two lines before line 6 |
| `valid-after-unpin-all.yml` | `valid.yml` | unpin the five listed items in turn | header, `version: 1`, `pins:`, `  - query: Otevřené úkoly tento týden` (the list isn't empty while the `query:` item stays, so no `pins: []`; see the red-test point in the slice's report) |
| `valid-after-rename.yml` | `valid.yml` | the rename job's patch for Rozpočet → `Projekty/Rozpočet 2028.md` | line 5 only |
| `valid-after-tag-rename.yml` | `valid.yml` + `  - tag: účty` as line 13 | the tag-rename job `účty` → `finance` | line 13 is `  - tag: finance` |
| `stale-after-rename-bez-hlavicky.yml` | `stale.yml` | the rename job's patch for Bez hlavičky → `Pages/Bez hlavičky 2.md`, which wrote an `id` into the note | line 6 becomes `  - id: <ID>` / `    path: Pages/Bez hlavičky 2.md`; tests replace the placeholder `<ID>` with the id the note got before comparing |
| `unknown-keys-after-pin.yml` | `unknown-keys.yml` | pin Čajovna at position 2 (`at: 1`) | Čajovna's two lines inserted before line 10 |
| `unknown-keys-after-unpin.yml` | `unknown-keys.yml` | unpin the flow item `{tag: účty}` (index 1) | line 10 removed (the comment on line 11 stays) |
| `unknown-keys-after-move.yml` | `unknown-keys.yml` | move the commented item Porada to position 1 (`from: 2, to: 0`) | lines 12–14 moved before line 7 (after the comment on line 6, which stays) |
| `unknown-keys-crlf-after-{pin,unpin,move}.yml` | `unknown-keys-crlf.yml` | as above | the same lines, CRLF on every line (new lines included) |
| `unknown-keys-no-newline-after-{pin,unpin,move}.yml` | `unknown-keys-no-newline.yml` | as above | the same lines, still without the final newline |
| `entries-after-pin.yml` | `entries.yml` | pin Čajovna at position 2 (`at: 1`) | Čajovna's two lines before line 7 (after the skipped duplicate on line 6) |
| `entries-after-unpin.yml` | `entries.yml` | unpin `#offsite` (index 1) | line 7 removed; line 8's skipped `"#offsite"` stays |
| `entries-after-move.yml` | `entries.yml` | move `Schůzky` to position 1 (`from: 2, to: 0`) | line 18 moved before line 4 |
