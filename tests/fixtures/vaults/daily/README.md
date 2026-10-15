# Fixture `daily/` (MS4 slice 4B)

Synthetic vault for `docs/acceptance/daily-notes.md` (FR-DLY-01…06, -08, FR-FMT-09, D-318…D-320). Hand-written (D-50); no real content. **Status: description only, draft.** The files are written by the test author from this description, in their own commit, and reviewed against D-321…D-338 (AP-243…AP-260, accepted).

The test copies `tests/fixtures/vaults/new-empty/.tegg/` into it (default type Quick Note, `daily-format: YYYY-MM-DD`). No user type files.

Byte rules: LF line endings, UTF-8 without BOM, NFC everywhere. Write the files with a tool that keeps bytes (no editor re-save; `printf` or a small script). NFD variants are made at runtime by the tests. All ids are `01JB4B…` (26 characters, ULID alphabet), one per file. Time stamps carry the Europe/Prague offset as written below.

**Test clock** (injected, L5 and L6 `TEGG_TEST=1`): `2026-10-14T12:00:00+02:00` (= 03:00 in America/Los_Angeles, same local date in both zones) unless an AC sets another.

## Objects

`fm` = frontmatter keys in file order; every file starts with `id`. One paragraph per bullet in "Body".

| Path | fm (after `id`) | Body | Used by |
| --- | --- | --- | --- |
| `Daily/2026-10-01.md` | `type: daily-note`, `title: "2026-10-01"`, `date: 2026-10-01`, `review: reviewed`, `created: 2026-10-01T08:00:00+02:00`, `modified: 2026-10-01T08:05:00+02:00` | `Začátek měsíce.` | calendar marks, reviewed state |
| `Daily/2026-10-07.md` | `type: daily-note`, `title: "2026-10-07"`, `date: 2026-10-07`, `review: unreviewed`, `created: 2026-10-07T07:00:00+02:00`, `modified: 2026-10-07T07:10:00+02:00` | `Ráno porada, příliš žluťoučký kůň úpěl ďábelské ódy.` | existing note, Czech text, review toggle |
| `Daily/2026-10-09.md` | `type: daily-note`, `title: Pátek`, `date: 2026-10-09`, `review: unreviewed`, `created: 2026-10-09T08:00:00+02:00`, `modified: 2026-10-09T08:00:00+02:00` | `Název se liší od data.` | D-320 title mismatch |
| `Archiv/10.10.2026.md` | `type: daily-note`, `title: "2026-10-10"`, `date: 2026-10-10`, `review: reviewed`, `created: 2026-10-10T09:00:00+02:00` | `Starý formát názvu.` | FR-FMT-09 AC-2 (recognized by `date`, any folder and name) |
| `Daily/2026-10-12.md` | `type: daily-note`, `title: "2026-10-12"`, `date: 2026-10-12`, `review: unreviewed`, `created: 2026-10-12T08:00:00+02:00`, `modified: 2026-10-12T22:00:00+02:00` | `Starší zápis.` | D-319 (older) |
| `Daily/2026-10-12 (2).md` | `type: daily-note`, `title: "2026-10-12"`, `date: 2026-10-12`, `review: unreviewed`, `created: 2026-10-12T21:00:00+02:00`, `modified: 2026-10-12T21:05:00+02:00` | `Novější zápis z druhého zařízení.` | D-319 (newest by `created`) |
| `Daily/2026-10-16.md` | `type: page`, `title: "2026-10-16"` (no `date`) | `Stránka, ne denní poznámka.` | name collision at first write; date-first resolution (D-162) |
| `.trash/Daily/2026-10-05.md` | `type: daily-note`, `title: "2026-10-05"`, `date: 2026-10-05` | `Smazaný den.` | trashed: never marked or resolved (D-102) |
| `Quick Notes/Nápad z rána.md` | `type: quick-note`, `title: Nápad z rána`, `review: unreviewed`, `created: 2026-10-14T07:30:00+02:00`, `modified: 2026-10-14T07:30:00+02:00` | `Zavolat Šárce.` | context: Quick Notes of 14 Oct |
| `Quick Notes/Pozdní nápad.md` | `type: quick-note`, `title: Pozdní nápad`, `review: unreviewed`, `created: 2026-10-15T00:30:00+02:00`, `modified: 2026-10-15T00:30:00+02:00` | `Po půlnoci.` | time zone: 15 Oct in Prague, 14 Oct 15:30 in Los Angeles |
| `Quick Notes/Bez data.md` | `type: quick-note`, `title: Bez data` (no `created`, no `modified`) | `Žádné časy.` | never in context sections (D-271) |
| `Pages/Nová stránka dne.md` | `type: page`, `title: Nová stránka dne`, `created: 2026-10-14T09:00:00+02:00`, `modified: 2026-10-14T09:00:00+02:00` | `Vytvořeno dnes.` | context: created that day |
| `Pages/Upravená stránka.md` | `type: page`, `title: Upravená stránka`, `created: 2026-09-01T10:00:00+02:00`, `modified: 2026-10-14T10:00:00+02:00` | `Upraveno dnes.` | context: modified that day |
| `Pages/Zmínky.md` | `type: page`, `title: Zmínky`, `created: 2026-10-02T10:00:00+02:00`, `modified: 2026-10-02T10:00:00+02:00` | `Minulý týden [[2026-10-07]].`; `Dnes [[2026-10-14]].`; `Budoucnost [[2026-10-20]].`; `Konflikt [[2026-10-12]].`; `Neplatné [[2026-02-30]].`; `Pátek [[2026-10-09\|pátek]].`; `Kolize [[2026-10-16]].` | date links, backlinks, broken/not broken |
| `_templates/Daily Note/Daily Note.md` | `tags: [deník]` (no `id`) | `# Deník {{date:D. M. YYYY}}`; `Včera: [[{{yesterday}}]] · Zítra: [[{{tomorrow}}]] · Dnes: {{date}} · {{time}}`; `## Poznámky` | FR-DLY-06 (D-270); `{{time}}` is not a D-270 variable |

## Derived facts used by the criteria

- Calendar marks in October 2026: 1, 7, 9, 10, 12 (not 5: trashed; not 16: no `date`; not 14 until it is written).
- `[[2026-10-12]]` resolves to `Daily/2026-10-12 (2).md` (D-319: latest `created`).
- `[[2026-10-14]]`, `[[2026-10-20]]` and `[[2026-10-16]]` are `date-missing` before any write (D-162 checks the date first, so the page `Daily/2026-10-16.md` is not the target).
- Context of 14 Oct, Europe/Prague: Quick Notes = Nápad z rána; Created = Nová stránka dne; Modified = Upravená stránka. Pozdní nápad is on 15 Oct.
- Context of 14 Oct, America/Los_Angeles (UTC−7): Quick Notes = Pozdní nápad (15:30 on 14 Oct); Created = Nová stránka dne (exactly 00:00:00 on 14 Oct: the day's start is inclusive); Modified = Upravená stránka (01:00). Nápad z rána is on 13 Oct (22:30).
- Weekdays: 2026-10-14 is a Wednesday; Europe/Prague leaves summer time on 2026-10-25, America/Los_Angeles on 2026-11-01.
