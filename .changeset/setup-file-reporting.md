---
"@zitadel/cli": patch
---

`setup` no longer reorders your `package.json`: the dependency splice preserves the file's key order, indentation, line endings, and trailing newline (only the touched dependency map is name-sorted, as package managers write it); the Angular `dev`-script merge behaves the same. Setup's file reporting is also cleaned up — `files_written` now lists deduplicated file paths only (directories and double-counted env merges are gone), and a new `data.files` carries one typed row per artifact (`{path, kind, action}`) so scripts can tell what setup created versus merged into.
