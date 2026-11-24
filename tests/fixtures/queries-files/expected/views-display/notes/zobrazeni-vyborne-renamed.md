---
id: 01JB5V00000000000000000031
type: page
title: Zobrazení knih
created: 2026-11-18T09:00:00+01:00
modified: 2026-11-18T09:00:00+01:00
---
Tytéž dotazy, pokaždé zobrazené jinak.

```query
saved: Přečtené 2026
view: wall
group_by: none
```

Rozečtené jako tabulka, nejdřív to, co teprve čeká:

```query
saved: Rozečtené
view: table
lane_order: [To read]
widths: { title: 240 }
```

Knihy podle data dočtení:

```query
saved: Seskupeno podle data
view: list
group_by: { finished: period }
```

Celá zeď po stavech, řádky podle dotazu:

```query
saved: Celá zeď
group_by: status
```

Rozbité hodnoty:

```query
saved: Nejlepší knihy
# ruční pokus
view: kanban
group_by: finished
lanes: diagonal
widths: široké
```

> [!tip] Na zeď
> ```query
> saved: Nejlepší knihy
> ```
