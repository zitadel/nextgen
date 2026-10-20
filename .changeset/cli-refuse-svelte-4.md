---
"@zitadel/cli": patch
---

`setup` and `doctor` refuse a Svelte 4 app up front, saying it needs Svelte 5 or newer, instead of failing later on a Svelte 5 component library that cannot be installed.
