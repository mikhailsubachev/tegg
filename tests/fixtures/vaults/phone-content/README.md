# Overlay `phone-content/` (slice AND-2, D-2474)

Synthetic overlay for FR-UX-03 AC-57 in `docs/acceptance/android-phone.md`: controls inside a note's content on the
phone. Hand-written (D-50); every name and text is invented (D-62). LF, UTF-8 without BOM, NFC, one final `\n`.

**How tests use it.** Copy `tests/fixtures/vaults/tasks/` (without its README), then `new-empty/.tegg/`, then
`views-tasks/` (without its README; it replaces `task.yml` and adds the Mac-made Schedule and Kanban views), then this
folder (without this README). No names clash.

| File | What it holds | What it tests |
| --- | --- | --- |
| `Pages/Vložené.md` | id `…N501`; a paragraph; a folded `> [!tip]- Složený tip` with `Skrytý text tipu.`; a folded `> [!mindmap]- Složená mapa` with three nodes; the note embed `![[Vložená stránka]]`; the task embed `![[Opravit kolo]]` (base `tasks/`, `status: In progress`) | the fold buttons `read.fold:1`, `read.fold:2`; `read.openEmbed:1`, `read.openEmbed:2`; no `Display as`, no task status, priority or due button |
| `Pages/Vložená stránka.md` | id `…N502`, `Text vložené stránky.` | the note embed's target |
