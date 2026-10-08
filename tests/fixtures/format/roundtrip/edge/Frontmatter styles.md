---
# a comment in frontmatter
title: 'Single quoted'
plain: unquoted value
number: 42
flag: true
empty:
nothing: ~
flow: [a, "b c", d]
block:
  - x
  - y
folded: >-
  a folded
  string
literal: |
  line one
  line two
relation: "[[Some note]]"
unknown_key: kept as is
---
Body.
