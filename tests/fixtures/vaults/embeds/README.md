# Fixture `embeds/` (MS4 slice 4F)

Synthetic vault for `docs/acceptance/embeds.md` (FR-EMB-01…04, FR-LNK-07 embed part, FR-FMT-07 AC-13…AC-15, FR-SYN-06 AC-10). Hand-written (D-50); no real content. **Status: exact contents, draft.** The files are written byte-exact by the test author from this README, in their own commit, after the owner has decided AP-318…AP-335: the `|full`, `|card`, `|link` lines (AP-319) and the `embed:` keys (AP-320) depend on those decisions.

The test copies `tests/fixtures/vaults/new-empty/.tegg/` into it (default type Quick Note; the seven system type files have no `embed` key; no file names clash) and adds the four type files below.

**Byte rules.** LF line endings, UTF-8 without BOM, every file ends with exactly one `\n`, NFC everywhere **except** the two places in `Pages/NFD vložení.md` marked NFD. Each block below is the whole file; the fence lines aren't part of it. Write the files with a tool that keeps bytes (`printf` or a small script, never an editor re-save). Git can't store NFD file names reliably, so NFD-named copies are made at runtime by the tests. Ids are `01JB4F0000000000000000E0nn` (26 characters, ULID alphabet), one per file; `E023` and `E026` are unused. Time stamps carry the Europe/Prague offset.

## Type files (`.tegg/types/`)

`.tegg/types/osoba.yml` (no `embed` key: the user-type default `card`, R31):

```yaml
# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.
version: 1
name: Osoba
plural: Osoby
system: false
folder: Osoby
icon: user
color: purple
review: false
preview: [firma, role]
attributes:
  - key: firma
    name: Firma
    type: text
  - key: role
    name: Role
    type: text
```

`.tegg/types/recept.yml`:

```yaml
# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.
version: 1
name: Recept
plural: Recepty
system: false
folder: Recepty
icon: utensils
color: orange
review: false
preview: [porce, čas]
embed: full
attributes:
  - key: porce
    name: Porce
    type: number
  - key: čas
    name: Čas
    type: text
```

`.tegg/types/kniha.yml`:

```yaml
# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.
version: 1
name: Kniha
plural: Knihy
system: false
folder: Knihy
icon: book
color: blue
review: false
preview: [autor]
embed: link
attributes:
  - key: autor
    name: Autor
    type: text
```

`.tegg/types/místo.yml` (an unknown `embed` value):

```yaml
# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.
version: 1
name: Místo
plural: Místa
system: false
folder: Místa
icon: map
color: teal
review: false
preview: []
embed: obrovský
attributes: []
```

## Targets

`Pages/Cíl.md` (E001):

```markdown
---
id: 01JB4F0000000000000000E001
type: page
title: Cíl
aliases: [Reading list]
created: 2026-10-01T08:00:00+02:00
modified: 2026-10-01T09:00:00+02:00
---
Úvodní odstavec cíle.

## Úvod

Text v úvodu s odkazem na [[Jana Nováková]].

### Podkapitola

Vnořený text podkapitoly.

## Druhá kapitola

Odstavec s identifikátorem. ^blok1

Poslední odstavec cíle.
```

`Osoby/Jana Nováková.md` (E027):

```markdown
---
id: 01JB4F0000000000000000E027
type: osoba
title: Jana Nováková
firma: Beta a.s.
role: Analytička
created: 2026-09-10T09:00:00+02:00
modified: 2026-09-10T09:00:00+02:00
---
Poznámky o Janě.
```

`Osoby/Šárka Malá.md` (E028, no preview values):

```markdown
---
id: 01JB4F0000000000000000E028
type: osoba
title: Šárka Malá
created: 2026-09-11T09:00:00+02:00
modified: 2026-09-11T09:00:00+02:00
---
Bez vlastností.
```

`Recepty/Svíčková.md` (E029):

```markdown
---
id: 01JB4F0000000000000000E029
type: recept
title: Svíčková
porce: 4
čas: 3 hodiny
created: 2026-09-12T09:00:00+02:00
modified: 2026-09-12T09:00:00+02:00
---
## Postup

Maso naložit přes noc.
```

`Knihy/Saturnin.md` (E030):

```markdown
---
id: 01JB4F0000000000000000E030
type: kniha
title: Saturnin
autor: Zdeněk Jirotka
created: 2026-09-13T09:00:00+02:00
modified: 2026-09-13T09:00:00+02:00
---
Kniha o sluhovi.
```

`Tasks/Zavolat Janě.md` (E031):

```markdown
---
id: 01JB4F0000000000000000E031
type: task
title: Zavolat Janě
status: To do
priority: High
due: 2026-10-09
created: 2026-10-05T09:00:00+02:00
modified: 2026-10-05T09:00:00+02:00
---
Domluvit schůzku.
```

`Místa/Praha.md` (E032):

```markdown
---
id: 01JB4F0000000000000000E032
type: místo
title: Praha
created: 2026-09-14T09:00:00+02:00
modified: 2026-09-14T09:00:00+02:00
---
Hlavní město.
```

`Daily/2026-10-07.md` (E033):

```markdown
---
id: 01JB4F0000000000000000E033
type: daily-note
title: "2026-10-07"
date: 2026-10-07
review: unreviewed
created: 2026-10-07T07:00:00+02:00
modified: 2026-10-07T07:10:00+02:00
---
Zápis dne.
```

`Pages/Dvojník.md` (E034):

```markdown
---
id: 01JB4F0000000000000000E034
type: page
title: Dvojník
---
Stránkový dvojník.
```

`Quick Notes/Dvojník.md` (E035; title differs, so the two aren't duplicate titles, D-296):

```markdown
---
id: 01JB4F0000000000000000E035
type: quick-note
title: Rychlý dvojník
---
Rychlý dvojník.
```

`Pages/Senior Product Manager.md` (E037):

```markdown
---
id: 01JB4F0000000000000000E037
type: page
title: Senior Product Manager
created: 2026-09-01T10:00:00+02:00
---
První.
```

`Pages/Senior Product Manager (2).md` (E038):

```markdown
---
id: 01JB4F0000000000000000E038
type: page
title: Senior Product Manager
created: 2026-10-02T10:00:00+02:00
---
Druhá.
```

`Pages/C tips.md` (E039):

```markdown
---
id: 01JB4F0000000000000000E039
type: page
title: "C# tips"
---
Tipy.
```

`_templates/Page/Šablona.md` (no `id`; never a target, FR-TPL-07):

```markdown
---
title: Šablona
---
Šablonový text.
```

`.trash/Pages/Smazaná.md` (E040; never a target, D-102):

```markdown
---
id: 01JB4F0000000000000000E040
type: page
title: Smazaná
---
Smazaný text.
```

## Hosts: modes, sections, broken, inline, NFD

`Pages/Režimy.md` (E002; FR-EMB-02 AC-1; the last four embeds depend on AP-319):

```markdown
---
id: 01JB4F0000000000000000E002
type: page
title: Režimy
created: 2026-10-02T08:00:00+02:00
modified: 2026-10-02T08:00:00+02:00
---
Před vloženími.

![[Cíl]]

![[Jana Nováková]]

![[Šárka Malá]]

![[Svíčková]]

![[Saturnin]]

![[Zavolat Janě]]

![[Praha]]

![[2026-10-07]]

![[Cíl|card]]

![[Jana Nováková|full]]

![[Svíčková|link]]

![[Cíl|jiný text]]

Po vloženích.
```

`Pages/Sekce.md` (E003; FR-EMB-02 AC-3, FR-LNK-07 AC-7):

```markdown
---
id: 01JB4F0000000000000000E003
type: page
title: Sekce
created: 2026-10-02T08:10:00+02:00
modified: 2026-10-02T08:10:00+02:00
---
![[Cíl#Úvod]]

![[Cíl#úvod]]

![[Cíl#Podkapitola]]

![[Cíl#Druhá kapitola]]

![[Cíl#^blok1]]

![[Cíl#Neexistující nadpis]]

![[Cíl#^chybí]]
```

`Pages/Rozbitá vložení.md` (E004; FR-LNK-07 AC-6, AC-7, FR-EMB-01 AC-2, AC-4):

```markdown
---
id: 01JB4F0000000000000000E004
type: page
title: Rozbitá vložení
created: 2026-10-02T08:20:00+02:00
modified: 2026-10-02T08:20:00+02:00
---
![[Chybí]]

![[Šablona]]

![[Smazaná]]

![[Reading list]]

![[2026-10-20]]

![[obrázek.png]]

![[Chyba hlavičky]]

`![[Cíl]]` v kódu.
```

`Pages/Uvnitř textu.md` (E005; FR-EMB-01 AC-3; the table cell's embed has no `|`):

```markdown
---
id: 01JB4F0000000000000000E005
type: page
title: Uvnitř textu
created: 2026-10-02T08:30:00+02:00
modified: 2026-10-02T08:30:00+02:00
---
Text s vloženým ![[Cíl]] uvnitř odstavce.

- Položka ![[Jana Nováková]]
- ![[Cíl]]

> ![[Cíl]]

| Sloupec | Vložení |
| --- | --- |
| řádek | ![[Cíl]] |
```

`Pages/NFD vložení.md` (E006; FR-EMB-01 AC-2, FR-EMB-02 AC-3, FR-FMT-07 AC-14). Shown here in NFC; in the file, `Cíl` on both body lines is **NFD** (`C`, `i`, U+0301, `l` = bytes `43 69 CC 81 6C`) and `Úvod` is **NFD** (`U`, U+0301, `vod` = bytes `55 CC 81 76 6F 64`). The frontmatter is NFC.

```markdown
---
id: 01JB4F0000000000000000E006
type: page
title: NFD vložení
created: 2026-10-02T08:40:00+02:00
modified: 2026-10-02T08:40:00+02:00
---
![[Cíl]]

![[Cíl#Úvod]]
```

## Hosts: circular embeds and depth

Each file below has this frontmatter, with its own id, title and the time stamps `created: 2026-10-03T08:00:00+02:00` / `modified: 2026-10-03T08:00:00+02:00`:

```markdown
---
id: 01JB4F0000000000000000E0nn
type: page
title: <title>
created: 2026-10-03T08:00:00+02:00
modified: 2026-10-03T08:00:00+02:00
---
```

followed by the body:

| Path | id | Body (one paragraph per item, separated by one blank line) | Used by |
| --- | --- | --- | --- |
| `Pages/Kruh A.md` | E007 | `Začátek A.` · `![[Kruh B]]` | FR-EMB-04 AC-2 |
| `Pages/Kruh B.md` | E008 | `Začátek B.` · `![[Kruh A]]` | FR-EMB-04 AC-2 |
| `Pages/Sama sebe.md` | E009 | `Před vložením sebe.` · `![[Sama sebe]]` · `Po vložení sebe.` | FR-EMB-04 AC-1 |
| `Pages/Obsah.md` | E010 | `## Kapitola jedna` · `Text první kapitoly.` · `## Přehled` · `![[Obsah#Kapitola jedna]]` | FR-EMB-04 AC-3 (AP-323) |
| `Pages/Karta sebe.md` | E011 | `Karta sama sebe:` · `![[Karta sebe\|card]]` (a plain `\|`: not in a table) | FR-EMB-04 AC-4 (AP-319) |
| `Pages/Řetěz 1.md` | E012 | `Úroveň 1.` · `![[Řetěz 2]]` | FR-EMB-04 AC-5, FR-EMB-03 AC-11, AC-12 |
| `Pages/Řetěz 2.md` | E013 | `Úroveň 2.` · `![[Řetěz 3]]` | |
| `Pages/Řetěz 3.md` | E014 | `Úroveň 3.` · `![[Řetěz 4]]` | FR-EMB-04 AC-9 (appended at runtime) |
| `Pages/Řetěz 4.md` | E015 | `Úroveň 4.` · `![[Řetěz 5]]` | |
| `Pages/Řetěz 5.md` | E016 | `Úroveň 5.` | |
| `Pages/Kosočtverec.md` | E017 | `![[Větev 1]]` · `![[Větev 2]]` | FR-EMB-04 AC-6, FR-EMB-02 AC-12 |
| `Pages/Větev 1.md` | E018 | `Větev jedna.` · `![[List]]` | |
| `Pages/Větev 2.md` | E019 | `Větev dvě.` · `![[List]]` | |
| `Pages/List.md` | E020 | `Společný list.` | |

Example, `Pages/Kruh A.md` in full:

```markdown
---
id: 01JB4F0000000000000000E007
type: page
title: Kruh A
created: 2026-10-03T08:00:00+02:00
modified: 2026-10-03T08:00:00+02:00
---
Začátek A.

![[Kruh B]]
```

## Hosts and targets for editing and insertion

`Pages/Úpravy.md` (E021; FR-EMB-03, FR-EMB-01 AC-13):

```markdown
---
id: 01JB4F0000000000000000E021
type: page
title: Úpravy
created: 2026-10-03T09:00:00+02:00
modified: 2026-10-03T09:00:00+02:00
---
Hostitel před.

![[Upravitelná]]

Hostitel mezi.

![[Upravitelná]]

![[Bez hlavičky]]

![[Upravitelná#Druhá část]]

Hostitel po.
```

`Pages/Upravitelná.md` (E022; non-canonical `_`, `__` and `*` must survive an edit of another block):

```markdown
---
id: 01JB4F0000000000000000E022
type: page
title: Upravitelná
created: 2026-10-03T09:00:00+02:00
modified: 2026-10-03T09:00:00+02:00
---
První odstavec k úpravě.

Druhý odstavec s _kurzívou_ a __tučně__.

* hvězdička jedna
* hvězdička dvě

## Druhá část

Text druhé části.

## Třetí část

Text třetí části.
```

`Pages/Bez hlavičky.md` (no frontmatter, no id, D-103; FR-EMB-03 AC-5). The whole file is the one line:

```markdown
Text bez hlavičky.
```

`Pages/Chyba hlavičky.md` (E024; invalid YAML: line 3 opens a quote that never closes; FR-EMB-03 AC-11):

```markdown
---
id: 01JB4F0000000000000000E024
title: "Chyba hlavičky
type: page
---
Tělo s chybnou hlavičkou.
```

`Pages/Vkládání.md` (E025; FR-EMB-01 AC-5…AC-12):

```markdown
---
id: 01JB4F0000000000000000E025
type: page
title: Vkládání
created: 2026-10-04T08:00:00+02:00
modified: 2026-10-04T08:00:00+02:00
---
Odstavec před.

Odstavec po.
```

`Quick Notes/Vložení dvojníka.md` (E036; same-folder resolution, FR-EMB-01 AC-2; Quick Note default `full`):

```markdown
---
id: 01JB4F0000000000000000E036
type: quick-note
title: Vložení dvojníka
created: 2026-10-04T09:00:00+02:00
modified: 2026-10-04T09:00:00+02:00
---
![[Dvojník]]
```

## Not in the fixture (on purpose)

No `Chybí.md`, `Reading list.md`, `Nic.md`, `Nová kapitola.md`, `C nápad.md`, `obrázek.png`, `Daily/2026-10-20.md`, no `_attachments/` folder. `Pages/Dvojník host.md`, the NFD-named copies, the invalid-UTF-8 copy of Upravitelná and the vault copy without `task.yml` are made at runtime.

## Derived facts used by the criteria

- Režimy: 12 embeds; modes in order `full, card, card, full, link, card, card, full, card, full, link, full` (AP-319, AP-320, AP-328).
- Sekce: `Cíl › Úvod` body = `Text v úvodu s odkazem na Jana Nováková.`, `Podkapitola`, `Vnořený text podkapitoly.`; `#Podkapitola` body = `Vnořený text podkapitoly.`; `#Druhá kapitola` body = `Odstavec s identifikátorem.`, `Poslední odstavec cíle.`; `#^blok1` body = `Odstavec s identifikátorem.`; the last two are `missing-section`.
- Rozbitá vložení: broken = `Chybí`, `Šablona`, `Smazaná`, `Reading list`; `2026-10-20` is `date-missing`; `obrázek.png` stays the R5 `embed-image` placeholder; `Chyba hlavičky` is a full, read-only embed.
- Řetěz 1: depths Řetěz 2 = 1, Řetěz 3 = 2, Řetěz 4 = 3, Řetěz 5 = `too-deep`. Řetěz 2: Řetěz 5 at depth 3.
- Kruh A: Kruh B at depth 1, a circular Kruh A at depth 2. Sama sebe and Obsah: circular at depth 1.
- Kosočtverec: `Společný list.` twice, no circular frame.
- Card strips: Jana `Firma Beta a.s.`, `Role Analytička`; Zavolat Janě `Status To do`, `Priority High`, `Due date Oct 9, 2026` (en-US); Šárka, Praha and `Cíl|card` header only.
