# Overlay `phone-edit/` (slice AND-3)

Synthetic overlay for `docs/acceptance/android-edit.md` and `docs/contracts/android-edit.md` §18: editing on the
phone. Hand-written (D-50); every name and text is invented (D-62). LF, UTF-8 without BOM, NFC, one final `\n`;
frontmatter `id`, `type`, `title`, `created`, `modified` in that order, as in the editor fixture.

**How tests use it.** Copy `tests/fixtures/vaults/editor/`, then `new-empty/.tegg/`, then this folder (without this
README). No names clash.

| File | What it holds | What it tests |
| --- | --- | --- |
| `Pages/Psaní.md` | id `…E001`; `# Nákup`; `- mléko` / `- chléb`; `- [ ] Zavolat` / `- [x] Hotovo`; `1. první` / `2. druhý`; `Text s [[Cíl]] a #projekt.`; `Konec.` | the phone editor and keyboard input (FR-EDT-01 AC-15…AC-20), saving (FR-EDT-08 AC-15…AC-18), external changes (FR-SYN-03 AC-40…AC-44), the trash (FR-HIS-01 AC-16), the editing tour (FR-SYN-06 AC-56) |
| `Pages/Mapa v textu.md` | id `…E002`; `Před mapou.`; `> [!mindmap] Plán` with `Cesta`, `Vlak`, `[ ] Jízdenky`; `Po mapě.` | the protected mindmap (FR-MMP-02 AC-37, FR-TSK-11 AC-5) |
| `Pages/Tabulka.md` | id `…E003`; a 2 × 2 table | editable table cells without row or column actions (RA14) |
