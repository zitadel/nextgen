---
"@zitadel/cli": patch
---

Commands that `zitadel setup`, `start`, `doctor` and `env add` suggest after a `--cwd` run now work when pasted into the same shell: `--env-file` paths, the install and dev-server commands, `setup --server local` and `console` name the project directory. A relative `--env-file` is now read from the current directory, where Node itself reads it, instead of from `--cwd`.
