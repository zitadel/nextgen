---
"@zitadel/cli": patch
---

`zitadel setup` now scaffolds a new app into the directory `zitadel start` just
ran in. The local runtime and the `.gitignore` line that `start` writes no
longer make the directory count as non-empty, so `start` and then
`setup --server local` work in a new directory without `--force`.
