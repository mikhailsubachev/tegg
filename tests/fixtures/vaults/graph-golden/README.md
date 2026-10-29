# Golden `graph-golden/` (v1.0 slice G1, the neighbourhood query)

`expected.json` holds the expected `graph_neighbourhood` results (docs/contracts/v1-graph.md §1, §2) on the
`graph/` fixture vault, typed by hand from `tests/fixtures/vaults/graph/README.md` (D-61: not produced by running the
query or the reference walk). It is not a vault. Two test files read it:

- `crates/tegg-index/tests/ac_graph.rs` (L4, the Rust query) and
- `app/test/graph_reference.ac.test.ts` (L1, the fake core's TypeScript reference walk, contract §8),

so the Rust query and the fake core give the same answer for every centre, depth and filter scenario of the README.

The vault for every scenario is `graph/` (without `README.md` and `make-hub.*`) plus `new-empty/.tegg/`, with
`_attachments/graf.png` and `_attachments/Smlouva.pdf` copied from `trash-media/_attachments/` (the README's runtime
files), and no hub.

How a scenario expands to a `GraphResultDto`:

- `nodes`: for each `[sortKey, depth]` in order, `nodes[sortKey]` with `depth` added;
- `edges`: for each id in order, `edges[id]` with `style` replaced by `styles[id]` when the scenario gives one
  (D-973: the strongest visible kind);
- `typeCounts`: `typeOrder` zipped with the scenario's `typeCounts` (D-977 order, the unfiltered walk, D-976);
- `total`, `unfiltered`, `hidden`, `truncated` as given.

`edgeOrder` is every edge of the vault in the §1.6 order (by the `(a, b)` sort keys); each scenario's `edges` follow it.
Chybná hlavička has no `objectId`: its frontmatter can't be read (D-103), so its `id` line isn't either.
