---
"@zitadel/cli": minor
---

An update that sets a field to `null` removes it, so it now asks first on a terminal and needs `--force` when nothing can be asked, as a deletion does, and a refused one sends nothing. Every list also reports `truncated` beside `next_page_token`, `true` exactly when more remain.

**Breaking:** a script that updated with `:=null` must now pass `--force`.
