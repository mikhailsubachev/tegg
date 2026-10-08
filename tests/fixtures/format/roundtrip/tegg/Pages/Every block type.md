---
id: 01J9ZK4M7Q2R8F3V6X1T0B5N9C
type: page
title: Every block type
tags:
  - demo
created: 2026-10-08T09:00:00+02:00
modified: 2026-10-08T09:30:00+02:00
---
# Heading 1

## Heading 2

### Heading 3

A paragraph with *emphasis*, **strong**, ~~strike~~, ==highlight==, `code` and a [[Trip to Lisbon|link]].

- bullet
  - nested bullet
- second bullet

1. first
2. second

- [ ] checklist item
- [x] done item

> A quote.

> [!note] Callout
> Body.

```ts
const x = 1;
```

---

| A | B |
| --- | --- |
| 1 | 2 |

![[photo.png|400]]

![[manual.pdf#page=3]]

![[Trip to Lisbon]]

```mermaid
mindmap
  root((Trip))
    Flights
    Hotel
      Booking
```

```query
types: [task]
filter:
  - attribute: source
    op: links-to
    value: this
sort: [due]
view: table
```
