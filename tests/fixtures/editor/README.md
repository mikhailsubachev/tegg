# Editor fixtures

Synthetic clipboard and editor inputs for the MS3 slice 3C criteria in `docs/acceptance/editor.md` (D-50). Hand-written; nothing comes from a real export or vault.

| Fixture | Used by | What it reproduces |
| --- | --- | --- |
| `paste/web.html` | FR-EDT-14 AC-3 | A `text/html` clipboard as copied from a web page: headings (one with an inline `style`), a paragraph with `<b>`, `<i>`, `<s>`, `<code>` and a link carrying an `onclick`, a nested `<ul>`, an `<ol>`, a `<blockquote>`, a `<pre><code>`, a `<table>` with `<thead>`, a remote `<img>` with Czech `alt` text, a `<script>`, a `<style>`, an `<iframe>`, Google-Docs-style bold and italic as `<span style>` (AP-130), and a `javascript:` link. Every script-like part sets `window.__pasteRan`, which must stay unset |
| `paste/web.expected.md` | FR-EDT-14 AC-3 | The expected result of pasting `web.html` into an empty paragraph, **compared as structure, not bytes**: the mdast of the inserted blocks (parsed with `@tegg/doc` `markdownTree`, positions removed) must equal the mdast of this file. Bytes aren't compared because blank-line and escaping details belong to the engine's canonical writer. The image becomes its alt text and the `javascript:` link its text (AP-130) |

Other editor inputs (plain-text clipboards, typed text) are written inline in the criteria. Byte-tricky notes (CRLF, BOM, no final newline, invalid UTF-8, NFD file names) are copied or created by the tests at runtime from `tests/fixtures/format/roundtrip/edge/` or by code, because git and editors can change them.
