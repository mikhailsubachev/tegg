# MS4 Daily Notes Interface Contract (slice 4B)

- **Status:** accepted, 2026-10-16 (AP-261…AP-264 → D-339…D-342, BRD v1.50). Written before the 4B red tests, as ms4-links.md was for 4A (D-295). Follows D-318…D-338 (BRD v1.49). Open points are in §11 (AP-261…AP-264).
- **ACs:** [docs/acceptance/daily-notes.md](../acceptance/daily-notes.md) (FR-DLY-01 AC-1…AC-11, FR-DLY-02 AC-1…AC-10, FR-DLY-03 AC-1…AC-6, FR-DLY-04 AC-1…AC-7, FR-DLY-05 AC-1…AC-4, FR-DLY-06 AC-1…AC-6, FR-DLY-08 AC-1…AC-8, FR-FMT-09 AC-3…AC-5) and its tables R17…R19. Where this contract and the ACs disagree, the ACs win, and this contract is corrected before the red tests.
- **Builds on** [ms4-links.md](ms4-links.md) (§1 resolution, §4 IPC, §6 fake core), [ms3-shell.md](ms3-shell.md) (§5 fake core, §11.1 resolution, §13 editor and autosave, §14.2.3 creation path, §15.5 `@` mentions), [ms2-core.md](ms2-core.md) and [ms1-core.md](ms1-core.md). Everything in those contracts stays valid unless this one changes it.

Until a part is implemented, it exists as a stub that compiles and returns a deliberately wrong result (an empty list, `None`, or an `Io` error). A test then fails on its assertion, never on a build or import error (TS-I1).

---

## 1. Dates, the clock and the zone

- **One date type.** A date is a `YYYY-MM-DD` string in DTOs and TypeScript, and a `chrono::NaiveDate` in Rust. Only valid calendar dates are dates (D-332). `tegg_format::date::parse_date(s) -> Option<NaiveDate>` and `@tegg/doc` `parseDate(s): string | null` accept exactly `^\d{4}-\d{2}-\d{2}$` with a valid day. Both are checked against the shared corpus `tests/fixtures/format/dates/cases.json`, which includes `2026-02-30`, `2026-13-01`, `2028-02-29`, and NFD/fullwidth digits (not dates).
- **The UI owns the clock and the zone.** "Now" comes only from `Date.now()`, and the zone only from `Intl` (ms3-shell §13.6), so Playwright `clock` and `timezoneId` control both. `@tegg/doc` `localDate(nowMs: number, timeZone?: string): string` gives today. Date arithmetic is `addDays(date, n): string`, on calendar days with no time involved, so DST changes nothing (FR-DLY-03 AC-1).
- **The core takes the day window from its caller.** Core calls that depend on "that day" receive a `DayWindow { date: NaiveDate, start: DateTime<FixedOffset>, end: DateTime<FixedOffset> }`. The UI builds it as local midnight to the next local midnight, each with its own offset, so a DST day is 23 or 25 h long. The core never reads the system zone. L4 tests build windows for both test zones with `tegg_core::daily::window(date, tz: &str)`, a test helper behind `cfg(any(test, feature = "test-hooks"))` that uses `chrono-tz`. The product code doesn't use it. An offset-less value is in the day when its local date text equals `date` (D-339).
- **Instants** in `created` / `modified` are compared as instants (FR-DLY-01 AC-6, FR-DLY-04 AC-3). The day an instant belongs to is decided by the window: `start ≤ t < end`.

## 2. Which note a date opens (D-318, D-319, D-335)

`tegg-index` keeps, for each date, every indexed object with `type: daily-note` and a valid `date` (first 10 characters of the value, trimmed, D-332). Objects in `_templates/` and `.trash/` are excluded (D-102, FR-TPL-07).

- **The winner.** For each date, the note it opens is chosen by these rules in order:
  1. the latest `created` instant; a missing or unreadable `created` counts as older than any note that has one;
  2. then the latest `modified`, treated the same way;
  3. then the byte order of the NFC vault path, ascending, first wins (D-335).
- **Callers.** `Index::daily_note(date)` (existing, FR-FMT-09 AC-2) returns the winner. The map behind date links (`Links.daily`, D-162) uses the same rule, replacing today's first-inserted entry. The calendar, Today, previous/next, date links and backlinks all go through this one rule.
- **Duplicates.** `Index::daily_duplicates(date) -> Vec<String>` lists the losers in winner order (FR-DLY-01 AC-7).
- **Duplicate titles.** `Core::duplicate_titles` (ms4-links §3) groups Daily Notes by `date`, never by `title`. The group key and label are `YYYY-MM-DD` (D-334, FR-DLY-01 AC-8).
- **Re-resolution.** A change to any Daily Note's `date`, `created`, `modified` or `type`, or its removal, re-runs the rule for the old and new dates, and re-resolves the date links to them before `VaultChanged` is sent (ms4-links §1).
- **Titles.** The displayed title of a Daily Note is its `date` (D-320). `ObjectInfo.title`, `SwitcherItem.title`, backlink entries, duplicate rows and context rows carry the date. The switcher still matches the stored `title:` text as an extra search key (D-334). The index stores both; `ObjectInfo` gains `stored_title: Option<String>`, which is `Some` only when it differs from the date.

## 3. Core API (`tegg-core`, new module `daily.rs`)

```rust
pub struct DailyView {
    pub date: NaiveDate,
    /// The winner's path, or None: the note is virtual.
    pub path: Option<String>,
    /// Losers, in winner order (D-319 notice).
    pub duplicates: Vec<String>,
    /// `review:` of the winner: "unreviewed" | "reviewed" | None (missing or unknown counts as unreviewed, D-330).
    pub review: Option<String>,
}

pub struct DailyDraft {
    /// The bytes a first write of this date would have with an empty edit: frontmatter (D-324) + expanded template
    /// body (D-322, D-325). The UI shows the body as the virtual content; `id`, `created`, `modified` are placeholders
    /// the UI fills at the write (§4.1).
    pub body: String,
    /// Template keys to write after `date`, in template order, reserved keys removed (D-325).
    pub template_keys: Vec<(String, String /* the key's source lines */)>,
    /// Some when the template's frontmatter didn't parse: the template's vault path (FR-DLY-06 AC-5 message).
    pub template_invalid: Option<String>,
    /// The file name the first write will use: daily-format applied (FR-FMT-09), fallback per D-336, then free_stem.
    pub path: String,
    /// True when daily-format was invalid and YYYY-MM-DD was used (D-336 message).
    pub format_fallback: bool,
}

pub struct ContextRow { pub path: String, pub title: String, pub r#type: String, pub at: String /* the instant as written */ }
pub struct DailyContext { pub quick_notes: Vec<ContextRow>, pub created: Vec<ContextRow>, pub modified: Vec<ContextRow> }

impl Core {
    pub fn daily_view(&self, date: NaiveDate) -> DailyView;
    /// Dates in `year-month` that have a winner (calendar marks, FR-DLY-03 AC-3); sorted ascending.
    pub fn daily_dates(&self, year: i32, month: u32) -> Vec<NaiveDate>;
    pub fn daily_draft(&self, date: NaiveDate) -> Result<DailyDraft, CoreError>;
    /// The first write (§4.1).
    pub fn daily_create(&self, date: NaiveDate, bytes: &[u8]) -> Result<DailyCreated, CoreError>;
    /// D-271, D-328: the three live sections for one day window, each newest first, each object only in its first
    /// matching section, the note itself excluded. `limit` per section; the totals say how many there are.
    pub fn daily_context(&self, w: &DayWindow, limit: usize) -> DailyContextPage;
}

pub struct DailyCreated { pub path: String, pub version: FileVersion, /* paths that now share the date */ pub duplicates: Vec<String> }
pub struct DailyContextPage { pub sections: DailyContext, pub totals: [usize; 3] }
```

- **`daily_create`:**
  - checks that `bytes` parse with `type: daily-note`, `date` equal to the argument, and `title` equal to the date; otherwise it returns `CoreError::DailyMismatch` and writes nothing;
  - computes the file name from `daily-format` (§5), then `free_stem` (ms4-links §3.1) in the Daily Note type's current folder, creating folders as needed;
  - writes the file create-exclusive (`RENAME_EXCL`, FR-SYN-02), never over an existing path;
  - indexes it and re-resolves before returning (FR-DLY-08 AC-7).
- **A note for the date arrives first (D-326):** if a Daily Note for the date was indexed after the UI's view, or appears while the call runs, `daily_create` still writes the user's note as its own file, and `duplicates` names the other files. It never returns an error for this, so the typed text is never lost (FR-DLY-02 AC-7).
- **Fault injection.** The create's three kill points (before rename, between rename and index, after) are exposed to L4 through the existing test-hooks `VaultFs` wrapper (FR-DLY-02 AC-5).
- **`note_create` refusal (D-318):** `Core::create_object("daily-note", …)` returns `CoreError::UseDailyNote`. The only way to create a Daily Note is `daily_create` (FR-DLY-01 AC-5).
- **Title on edit (D-334):** `note_write` (ms3-shell §13.2) is unchanged in the core. The UI's save path adds the `title: "<date>"` line (§6.3), so the rule stays one text engine (D-82).
- **The review control** writes through `note_write` with a `@tegg/doc` patch of the `review` line and `modified` (FR-FMT-07 AC-5). No new core call.
- **New `CoreError` kinds:** `UseDailyNote` and `DailyMismatch`, each with a catalog message.

## 4. IPC added or changed in 4B

| Command | Arguments | Returns | Notes |
| --- | --- | --- | --- |
| `daily_view` | `date` | `DailyViewDto` | Read-only. Re-queried on `vault:changed` while a daily route is shown. |
| `daily_dates` | `year`, `month` | `string[]` | Read-only (calendar). |
| `daily_draft` | `date` | `DailyDraftDto` | Read-only. Called when a virtual note opens and on `vault:changed` while it is still untouched (FR-DLY-06 AC-4). |
| `daily_create` | `date`, `text` | `{ path, version, duplicates: string[] }` | The one write of a first keystroke. Errors `DailyMismatch`, `Io`. Counts in `writes()`. |
| `daily_context` | `date`, `start`, `end`, `limit` | `DailyContextDto` | Read-only. `start`/`end` as RFC 3339 with offset (§1). |
| `note_create` | unchanged | | Error `UseDailyNote` when `type` is `daily-note`. |
| `index_duplicate_titles`, `index_switcher`, `resolve_links`, `index_backlinks` | unchanged | | Follow §2: date grouping, the date as title, and the winner rule. |

```ts
type DailyViewDto = { date: string; path: string | null; duplicates: string[]; review: 'unreviewed' | 'reviewed' | null };
type DailyDraftDto = { text: string; body: string; templateInvalid: string | null; path: string; formatFallback: boolean };
type ContextRowDto = { path: string; title: string; type: string; at: string };
type DailyContextDto = { quickNotes: ContextRowDto[]; created: ContextRowDto[]; modified: ContextRowDto[]; totals: [number, number, number] };
```

- `DailyDraftDto.text` holds the complete bytes of the first write for an empty edit. They are made with the placeholders `id: {{id}}`, `created: {{now}}` and `modified: {{now}}`, which the UI replaces at the write.
- `body` is the part after the frontmatter: the editor's virtual content.
- DTOs are generated by `ts-rs` (ms2-shell §2).

### 4.1 The virtual note in the UI

- **Opening.** `daily/<date>` calls `daily_view`.
  - If the result has a `path`, the route shows that file as any note page does (ms3-shell §13), plus the daily header (R17) and the context sections (R19). `note/<path>` of a winner redirects to `daily/<date>` (D-321).
  - If `path` is `null`, the route calls `daily_draft` and opens the editor on `body` with the caret at its end (D-322). The editor's "original" is set to `body`, so `isDirty()` is false, and the virtual marker is shown.
- **The first save.** Autosave (ms3-shell §13) runs as usual, with one difference: while the note is virtual, a save calls `daily_create` instead of `note_write`. It sends the draft's `text` with the placeholders filled in and the body replaced by the editor's current body (`@tegg/doc` `withBody`, D-82).
  - If, when the save fires, the editor's body equals `body`, nothing is sent (D-323).
  - The flush before navigation and before quitting is the existing editor rule (FR-EDT-09, FR-DLY-02 AC-4).
- **After the first write**, the route keeps `daily/<date>`. The editor marks the returned bytes as saved (`markSaved`), and later saves go through `note_write`.
  - A non-empty `duplicates` shows the D-319 notice.
  - An `Io` error leaves the note virtual with the typed text in the editor, and the next change retries (FR-DLY-02 AC-8).
- **A file arrives first (D-326).** On `vault:changed`, `daily_view` is asked again.
  - If the note is still untouched (nothing changed since the draft), a `path` shows that file and no write is sent.
  - If it has been touched, the route stays virtual and the next save's `daily_create` writes a file of its own.

## 5. File names from `daily-format` (FR-FMT-09, D-336)

`tegg_format::daily::file_stem(format: &str, date: NaiveDate) -> Result<String, BadFormat>`, with its TypeScript twin `dailyFileStem` (shared corpus `tests/fixtures/format/dates/daily-format.json`):

- Tokens are `YYYY`, `MM`, `M`, `DD` and `D`, matched longest first. Any other character is copied as written.
- The result is `BadFormat` when the format has no `DD` or `D` token, when the stem would contain a D-52 forbidden character (`/ \ : * ? " < > |`, or a control character), or when it would be empty after `sanitize_file_stem`.
- The core reads `daily-format` from `vault.yml` at each `daily_draft` / `daily_create` call. A missing key means `YYYY-MM-DD`.
- When the format is bad, the core uses `YYYY-MM-DD` and sets `format_fallback`. The UI shows the message once per session (FR-FMT-09 AC-5).
- The format never creates subfolders and never renames existing files (FR-FMT-09 AC-4).

## 6. `@tegg/doc` and `@tegg/editor` additions

### 6.1 Template expansion (D-270, D-325)

```ts
export function expandDailyTemplate(templateText: string, date: string): { keys: [string, string][]; body: string; invalid: boolean };
export function formatDate(date: string, format: string): string;   // tokens of §5; same engine as file_stem
```

- Variables `{{date}}`, `{{yesterday}}`, `{{tomorrow}}` and `{{date:FORMAT}}` are relative to `date`. Any other `{{…}}` stays as written.
- Reserved keys (FR-TYP-15) are removed from `keys`.
- Invalid frontmatter gives `invalid: true`, no keys, and the whole text after the frontmatter fence as `body`. If there is no closing fence, the body is the whole text.
- The Rust core has the twin `tegg_format::daily::expand_template`, kept equal to the TypeScript one by `tests/fixtures/format/dates/template-cases.json`. `daily_draft` uses the Rust one; the fake core and L1 use the TypeScript one.

### 6.2 First-write bytes (D-324)

`@tegg/doc` `newDailyNote({ date, keys, body, id, now }): string` gives:
- the frontmatter, in this order: `id`, `type: daily-note`, `title: "<date>"`, `date: <date>`, then the template keys as their source lines, then `review: unreviewed`, `created` and `modified`;
- one blank-line rule as `newObject` (ms3-shell §14.5);
- then the body.

The core builds the same bytes in `daily_draft` through the Rust twin, checked by one shared corpus case.

### 6.3 Saving a Daily Note with a mismatched title (D-334)

`@tegg/doc` `fixDailyTitle(text: string): string` sets `title: "<date>"` when the note's `title` differs from its `date`, changing only that line, or inserting it after `type` when it's missing. The editor's save path calls it for notes of type `daily-note` before `note_write`. Opening and reading a note never call it.

### 6.4 `@` date rows (D-331)

`@tegg/doc` `dateRows(query: string, today: string, locale: string): { date: string; label: string; keyword: string | null }[]` returns zero or one row:
- **Keywords:** prefixes of `today`, `tomorrow` and `yesterday`, plus, for `cs`, `dnes`, `zítra` and `včera`. Matching folds diacritics and case, with the query NFC-normalized first.
- **Dates:** ISO `YYYY-MM-DD`, and the region's numeric short date: `D.M.YYYY` for `cs` (zero-padding optional), `M/D/YYYY` for `en-US`. Each must be a valid date (§1).
- **Labels:** `Today, 2026-10-14` for a keyword row, and the bare date for a typed date. The labels come from the catalog.

`@tegg/editor`'s `@` suggestion (ms3-shell §15.5) puts the rows in this order: date rows, note rows, `Pick a date…`, then `Create`. Choosing a date row inserts `[[<date>]]`, the same bytes as `[[`. The `[[` trigger doesn't show date rows.

## 7. UI

### 7.1 Routes, commands, registry

- **Routes:**
  - `daily/YYYY-MM-DD`, built;
  - `today`, which redirects to `daily/<localDate(Date.now())>`;
  - `note/<path>` redirects as in §4.1 (D-321).
  - An invalid date in `daily/…` is a not-found page (ms3-shell §4.1 rule).
- **Commands, all `needsVault: true`:**
  - `daily.today` (`Go to Today`, ⌘D);
  - `daily.previous` (`Previous day`, ⌥⌘←) and `daily.next` (`Next day`, ⌥⌘→);
  - `daily.pickDate` (`Go to date…`);
  - `daily.markReviewed` and `daily.markUnreviewed`.
  - `previous`, `next` and the review commands are enabled only on `daily/…` routes; elsewhere they are absent from the palette and their shortcuts aren't bound (FR-DLY-03 AC-2, D-127).
- **`registry.ts`:** the 4B rows of R17 become `built`.
- **Sidebar:** the `Today` description is refreshed every 30 s from `Date.now()` (D-327: within 60 s).
- **i18n keys** (exact English texts are the ACs'):
  - the `daily.*` group: `daily.notSaved`, `daily.titleReadonly`, `daily.otherNotes` (plural), `daily.duplicateTitles`, `daily.reviewed`, `daily.markReviewed`, `daily.markUnreviewed`, `daily.previous`, `daily.next`, `daily.today`, `daily.pickDate`, `daily.calendar`, `daily.hasNote`, `daily.previousMonth`, `daily.nextMonth`, `daily.formatInvalid`, `daily.templateInvalid`, `daily.typeLocked`, `daily.section.quickNotes`, `daily.section.tasks`, `daily.section.created`, `daily.section.modified`, `daily.section.empty`, `daily.section.more` (plural);
  - the `mention.*` group: `mention.today`, `mention.tomorrow`, `mention.yesterday`, `mention.pickDate`;
  - the error messages `errors.useDailyNote` and `errors.dailyMismatch`.
  - Long dates and month names come from `Intl.DateTimeFormat` with the region (D-133), never from the catalog.
- **Marks:** `daily-ready:<date>` once per open, after the body and the sections have painted (the FR-DLY-04 AC-6 benchmark, report only).

### 7.2 Components (`app/ui/src/daily/`)

- **`DailyPage`:** the route. It holds the virtual and written states and the header, and reuses `NotePage`'s editor pane.
- **`DailyHeader`:** the buttons, the read-only title, the subtitle and the review toggle (R17, R19).
- **`Calendar`:** the R18 popover, built on the WAI-ARIA date-picker grid pattern. It calls `daily_dates` per shown month and on `vault:changed`.
- **`ContextSections`:** `daily_context`, re-queried on `vault:changed`, with `Show <n> more` showing all rows in place by calling again with `limit = total`.
- **`DuplicateNotice`.**

The date-link activation of read-view and editor chips (`data-link-kind` `daily` / `date-missing`) navigates to `daily/<date>`. That replaces the D-142 disabled control everywhere, including property rows.

## 8. Fake core additions (ms3-shell §5, ms4-links §6)

- `installFakeCore` implements `daily_view`, `daily_dates`, `daily_draft`, `daily_create`, `daily_context` and the `note_create` refusal over its in-memory files. It uses the §2 winner rule, the TypeScript twins of §5 and §6, and types from `@tegg/schema`.
- `daily_create` counts in `writes()`, and `writeControl({ fail: 'Io' })` applies to it.
- `daily_context` uses the `start`/`end` it is given, so the test's `timezoneId` drives the window.
- No new `FakeCoreHandle` method. `setFile` with a Daily Note re-runs §2 and emits `vault:changed`.

## 9. Test layout

- **L4** `crates/tegg-core/tests/ac_daily.rs`:
  - FR-DLY-01 AC-4, AC-5 (refusal), AC-6, AC-8 (grouping), AC-11 (bytes);
  - FR-DLY-02 AC-2, AC-5 (fault injection), AC-6, AC-7, AC-8;
  - FR-DLY-03 AC-3, AC-4;
  - FR-DLY-04 AC-2, AC-3, AC-4;
  - FR-DLY-05 AC-1, AC-2 (bytes);
  - FR-DLY-06 AC-1, AC-3…AC-6;
  - FR-DLY-08 AC-5, AC-7;
  - FR-FMT-09 AC-3…AC-5.
- **L2** `crates/tegg-core/tests/ac_property_daily.rs`: FR-DLY-02 AC-10.
- **L1:**
  - `crates/tegg-format/tests/ac_dates.rs` + `packages/doc/test/dates.ac.test.ts` (shared corpora §1, §5, §6.1);
  - `app/test/daily_dates.ac.test.ts` (FR-DLY-01 AC-2 `localDate`, FR-DLY-03 AC-1 arithmetic, AC-6 locale);
  - `app/test/mention_dates.ac.test.ts` (FR-DLY-08 AC-1, AC-2 parsing);
  - `app/test/daily_registry.ac.test.ts` (R17).
  - New tests go in new files (TS-I3, D-304).
- **L5:**
  - `app/webkit/daily.ac.test.ts`: FR-DLY-01 AC-1…AC-3, AC-5…AC-7, AC-9, AC-10; FR-DLY-02 AC-1, AC-3, AC-4, AC-8, AC-9; FR-DLY-05 AC-2…AC-4.
  - `app/webkit/daily_calendar.ac.test.ts`: FR-DLY-03 AC-1…AC-6.
  - `app/webkit/daily_context.ac.test.ts`: FR-DLY-04 AC-1…AC-7.
  - `app/webkit/date_mentions.ac.test.ts`: FR-DLY-08 AC-1…AC-8.
  - (TZ) tests run as two `describe` blocks with `test.use({ timezoneId })`, as 4A did.
- **L6** `app/e2e/ms4_daily.ac.test.ts`: FR-DLY-01 AC-1 (⌘D), AC-7 (bytes); FR-DLY-02 AC-1 (vault), AC-4 (⌘Q); FR-DLY-04 AC-4 (file bytes). Benchmark: `app/e2e/perf_daily.ts` (FR-DLY-04 AC-6).
- **Fixture:** `tests/fixtures/vaults/daily/`, as described in its README, written byte-exact in its own commit before the tests.
- **AC-Test-Change** in the 4B red-test commit: read-view FR-EDT-02 AC-8 (date part), editor FR-EDT-02 AC-16 (date part) and links FR-DLY-08 AC-1, with the trailer `AC-Test-Change: 4B replaces D-142's date-link placeholder; approved-by: owner`.

## 10. Contract choices (no owner decision needed)

1. The clock and the zone live in the UI. The core gets day windows (§1), so it stays platform-neutral (AR-03) and needs no zone database in product code.
2. A first write is a separate command (`daily_create`), not `note_create`, so the refusal in D-318 can be absolute and the D-326 race is handled in one place.
3. `daily_draft` returns the exact first-write bytes, so the virtual content and the written file can't drift apart. The UI only fills in `id` and the instants.
4. The winner rule lives only in `tegg-index` (and its fake twin), and every caller uses it.
5. Date rows are produced by `@tegg/doc` and not by the editor, so property fields (ms3-shell §15.4) get them through `useLinkSuggest` unchanged.

## 11. Points for the owner (accepted 2026-10-16: AP-261…AP-264 → D-339…D-342)

| ID | Issue | Recommendation | Affects |
| --- | --- | --- | --- |
| AP-261 | **Offset-less instants on DST days.** D-328 says a `created` without an offset is local time. With a window passed as two offsets (§1), a value like `2026-10-25T02:30:00` on the Prague DST day is ambiguous, and the core has no zone to resolve it. | Compare offset-less values by their local wall-clock text against the window's local `date` (same calendar date means in that day), so no zone database is needed. The ambiguous hour on a DST day counts for that day either way. | FR-DLY-04 AC-3 |
| AP-262 | **FR-DLY-01 AC-2 tags "L4 for `today()`".** With §1, today is computed in the UI (`localDate`), not in the core. | Change the tag to "L1 for `localDate`" (AC text only, before the red tests). | FR-DLY-01 AC-2 |
| AP-263 | **The template's `{{time}}` stays literal (FR-DLY-06 AC-1).** In daily use, the fixture's own template shows a literal `{{time}}`. | Keep it: it's correct per D-270, and FR-TPL (v1.0) adds it. The starter template (D-92) gets no `{{time}}`. | FR-DLY-06 AC-1, starter vault |
| AP-264 | **The `ObjectInfo.stored_title` field (§2)** is added only so the switcher can still match `Pátek` (D-334). | Accept it as an index-only field. Nothing is written, and it is rebuilt from the files (AR-01). | FR-DLY-01 AC-11 |

## 12. Clarifications from the red tests (accepted 2026-10-16: AP-265…AP-284 → D-344…D-363)

These override the sections above where they differ.

| ID | Decision | Topic | Rule |
| --- | --- | --- | --- |
| AP-265 | D-344 | Fault injection and temp files (FR-DLY-02 AC-5) | The kill-point wrapper lives in the test file over `LocalFs`; the temp name is part of the contract: `.<name>.tegg-tmp` in the target folder (FR-SYN-02 AC-2), so orphan cleanup is tested by planting one |
| AP-266 | D-345 | `DailyDraft` fields (ms4-daily §3) | Rust `DailyDraft` has `text` (full first-write bytes for an empty edit) and `body` (after the frontmatter), matching `DailyDraftDto` |
| AP-267 | D-346 | Template keys ignored (FR-DLY-06 AC-3, D-325) | Ignored keys are exactly `id, type, title, date, review, created, modified`; every other key, `tags` included, is written |
| AP-268 | D-347 | First-write bytes (D-324) | Template key source lines end with LF; the body follows the closing `---\n` with no blank line added, as `newObject` |
| AP-269 | D-348 | Backlinks of a date (FR-DLY-08 AC-7) | New core call and IPC `daily_backlinks(date) -> BacklinksPanelDto`: the panel of the date's winner, or of the date links to it when virtual; `index_backlinks(path)` unchanged |
| AP-270 | D-349 | Recency of daily routes (FR-DLY-01 AC-1, D-105) | `nav_opened` gains an optional `route`: daily routes call it with `route: 'daily/<date>'` and `path` = the winner or null; the launch landing can reopen `daily/<date>`, virtual or not |
| AP-271 | D-350 | Zone change while running (FR-DLY-01 AC-2) | That sentence is tested at L1 (`localDate` with an explicit zone) |
| AP-272 | D-351 | L6 clock | L6 uses the system clock and `TZ`; tests compute today from `Date.now()` in that zone; no `TEGG_NOW` hook |
| AP-273 | D-352 | Command context on daily routes (D-127) | `ctx.route = { id: 'daily/YYYY-MM-DD', date: string, path: string \| null }` |
| AP-274 | D-353 | Creating a Daily Note from New object (D-318) | Entry points are `New Daily Note` on the Daily Notes type page and every create path whose type is Daily Note (New object with `default-type: Daily Note`, the switcher create): each opens today's Daily Note instead of a dialog |
| AP-275 | D-354 | Calendar locale tag (FR-DLY-03 AC-6) | Tested at L5 only; the AC tag changes to L5 |
| AP-276 | D-355 | `dailyFileStem` signature (ms4-daily §5) | `dailyFileStem(format: string, date: string): string \| null` (null = bad format) |
| AP-277 | D-356 | Error catalog keys | `error.useDailyNote`, `error.dailyMismatch` (the ms3-shell §10 `error.<kind>` scheme) |
| AP-278 | D-357 | `dateRows` locales and labels (D-331) | Locale tags as BCP 47 language or language-region (`cs`, `cs-CZ`, `en-US`), matched by language; labels `Today, <date>`, `Tomorrow, <date>`, `Yesterday, <date>`; in `cs` `Dnes, <date>`, `Zítra, <date>`, `Včera, <date>` |
| AP-279 | D-358 | `stored_title` (D-342) | A field of `ObjectInfo` only, not an index method |
| AP-280 | D-359 | Shared FR-DLY-08 IDs | `fr_dly_08_ac1…ac3_*` tests cover both links.md and daily-notes.md criteria of that ID; coverage counts them once |
| AP-281 | D-360 | Daily benchmark (FR-DLY-04 AC-6) | `app/e2e/perf_daily.ts` is written with the build (report only, D-152) |
| AP-282 | D-361 | Literal letters in date formats (FR-FMT-09, D-325) | Tokens match anywhere; a backslash makes the next character literal (`\Deník YYYY-MM-DD` → `Deník 2026-10-14`); the corpus gets this case |
| AP-283 | D-362 | Template without a closing fence (D-325) | Frontmatter that opens but never closes is invalid: no keys, the whole text is the body, and the message names the template |
| AP-284 | D-363 | Fake `writeControl` for the first write | The fake applies `delay`, `hold` and `fail` to `daily_create` as to `note_write` |

## 13. After the PR #38 review (D-365, D-366)

- The winner rule reads instants with `tegg_format::daily::instant` / `@tegg/doc` `instantOf` (corpus `tests/fixtures/format/dates/winner-instants.json`); offset-less date-times are local (D-365). The fake core's one copy of the rule is `@tegg/doc` `dailyOrder` (fake-links.ts); `link_resolve` asks it through `daily_winners`.
- `daily_create` treats the exact bytes already at the planned path as its own landed write (an error reported after the rename), so a retry never writes a second file (FR-SYN-06).
- A review-only save skips the title fix (D-366); the title fix leaves non-plain titles alone and keeps CRLF.

