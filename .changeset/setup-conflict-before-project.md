---
"@zitadel/cli": patch
---

`zitadel setup` now checks whether patching your app would overwrite one of your files, such as an existing app's `src/App.tsx`, before it creates a project. It stops with `E_CONFLICT` without creating a project or writing `zitadel.json`, so you can move the file aside and rerun, or rerun with `--force` to let setup replace it. Before, setup created the project and wrote `zitadel.json` first, and every rerun then reported the directory as already set up.
