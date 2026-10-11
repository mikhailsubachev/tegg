# Vault fixtures

Synthetic vaults for vault-level tests (D-50).

| Fixture | Used by | Status |
| --- | --- | --- |
| `new-empty/` | FR-VLT-02 AC-1, AC-3: the exact files a new empty vault gets (D-89, D-90, D-99) | **Draft, pending owner approval (D-99).** Derived from BRD §5.1, FR-TYP-01/-03/-08/-12, FR-TSK-01…03 (D-25, D-70), FR-TAG-01/-05, FR-ATT-07, FR-FMT-09, FR-VLT-05. Not from the BRD, proposed here: icons (names from a common icon set), colors, preview attributes, the `review: locked` value, attribute names, Image/PDF metadata keys (`media-type`, `size`, `width`, `height`, `pages`), and the YAML layout |

Byte-exact: LF, UTF-8 without BOM, NFC. Universal attributes (FR-TYP-08: description, aliases, tags, source, icon, cover, review) are built in and not listed per type.
