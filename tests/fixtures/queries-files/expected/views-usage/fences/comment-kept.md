---
id: 01JB5V00000000000000000030
type: page
title: Knihy na cesty
created: 2026-11-05T09:00:00+01:00
modified: 2026-11-05T09:00:00+01:00
---
Co si vzít do vlaku. Úzký sloupec, tak jen to nejnutnější.

```query
saved: Přečtené 2026
sort: { by: title, order: asc }
columns: [author]
```

Stejný dotaz podruhé, jak ho nastavil dotaz sám:

```query
saved: Přečtené 2026
```

Rozečtené jen s hodnocením na kartách:

```query
saved: Rozečtené
sort: { by: title, order: asc }
# jen hodnocení
columns: [rating, author]
x-poznámka: úzký sloupec
```

Rozbité řazení:

```query
saved: Výborné knihy
sort:
  - { by: finished, order: desc }
  - { by: neznámý, order: asc }
```

> [!note] Na cestu
> ```query
> saved: Výborné knihy
> ```
