# QA review: slice AND-2 (phone layout and reading)

- Branch: `claude/and-2-phone-layout`, head `dd0a5b42` (tree `19e882df4d`), `./verify push` pass on that tree.
- Reviewer: `qa-reviewer` agent, 2026-11-23. Emulator (LA) suite: 47/47 on `7a1490b7`'s code.
- Verdict: **NOT READY** (4 major findings, none data loss).

## Findings

1. **[major] `mindmap.showMap` / `mindmap.showList` do nothing when run by id on the phone** (FR-UX-03 AC-54, contract §10,
   D-2101). `phoneCommands` (`app/ui/src/phone/commands.ts`) keeps the desktop command when the phone's own command has
   the same id; the desktop one calls the editor (`noteApi.edit`), which the phone's read view doesn't have. The AC-54
   test compares only route, dialogs and IPC, so it misses it.
2. **[major] The start screens never get the insets** (D-2122, contract §8.2, §8.6, FR-UX-04 AC-3). `useNative()` runs
   only in `PhoneFrame`; the access, opening and chooser screens render before it, so `--inset-*` stay 0 px on a cold
   start and the §8.6 resize handler isn't installed there.
3. **[major] Controls inside a note's content carry no command or a phone-hidden one** (FR-UX-03 AC-54, AR-03 AC-13):
   the callout and mindmap fold buttons (no `data-command`), note embeds (`edit.openEmbed`, `edit.displayEmbedAs`), task
   embeds (`task.setStatus`, `task.setPriority`, `task.setDue`), board task cards (`task.open`). The tests' notes and
   vaults don't contain them.
4. **[major] D-2118, D-2121, D-2122 change the contract without the owner's approval** (§5.1 insets rounding and the
   insets animation callback, §8.2 start screens, §8.3 scrim and drawer width `min(320, 100vw − 56) + --inset-left`).
5. [minor] The review diff used a stale local `main` (merge-base before PRs #145–#154); update `main` and run
   `./verify merge` before merging.
6. [minor] The rotation anchor walks the blocks on every scroll event, unthrottled (`PhoneFrame.tsx`, D-2121).
7. [minor] D-2123 is missing from the decision table.
8. [minor] `qa/manual/and-2.md` (FR-UX-01 AC-9 manual design review) doesn't exist yet; CLAUDE.md's Status doesn't name
   D-2099…D-2126.

## Checks that passed

- Zero writes while reading (FR-SYN-06): the phone note is always the read view; task embeds, query blocks and broken
  links offer no write; the task-views migration is off on Android through the core's `OpenExtras` (AR-03).
- No network (NFR-SEC-01): one URL rule (http, https, mailto, tel) in `phone/links.ts`, `src-tauri/src/phone.rs` and
  the Kotlin plugin; the release manifest drops `INTERNET`; read-view images are placeholders.
- Desktop unchanged: every phone rule is under `html[data-layout="phone"]`, phone branches behind `isPhone()`.
- D-2125, D-2126: rules and tests match the decisions.
- Test integrity: `ac-test-protection` passed for the range; the AC-test changes read match their owner-approved
  decisions (D-2104, D-2111, D-2116, D-2117, D-2119, D-2120, D-2124).
- Coverage: every automated AC in `docs/acceptance/android-phone.md` has a test named after it; FR-UX-01 AC-9 is manual
  and not yet recorded.

## Resolution (2026-11-23)

1. Fixed: the phone registers `mindmap.showMap` / `mindmap.showList` itself (D-2127, `b7a74c13`); FR-UX-03 AC-55 also
   checks the Map/List switch's in-page effect.
2. Fixed: `PhoneStartInsets` gives the start screens the insets and the §8.6 keyboard rule (D-2127, `b7a74c13`).
3. Decided and built: owner's "Hide edit, add commands" (D-2128) and the card and checkbox rules (D-2129); new
   criterion FR-UX-03 AC-55 with overlay `phone-content/`, red test `214a4d2c` (`check-red` pass), build `e3c23559`.
4. Approved by the owner: D-2118, D-2121, D-2122 ("Approve all three"); RA10 names the left inset.
5. Open: update `main` and run `./verify merge` before merging (needs the owner's word to merge).
6. Fixed: the rotation anchor's walk runs at most once per frame (D-2127).
7. Fixed: D-2123 recorded as not used.
8. CLAUDE.md names D-2099…D-2130 (`be84a943`); `qa/manual/and-2.md` (FR-UX-01 AC-9) is the owner's manual review, open.

Open after the fixes: two L5p load races flagged by the push gate's flaky reporter, both seen before the review:
FR-NAV-04 AC-14 ("Menu again" taps where Menu is, which the open drawer covers, so it closes only while the drawer is
still sliding in) and FR-INB-01 AC-14 (Back restores the Inbox scroll 200 → 0 in about 1 of 12 runs at 6 workers; the
arrival routine finds no pending scroll; the cause isn't found yet).
