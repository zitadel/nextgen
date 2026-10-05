---
"@zitadel/cli": patch
---

Human output can now be turned colourless with `--no-color`, and the `NO_COLOR` and `FORCE_COLOR` environment variables are honoured. This covers both the step logging and the highlighted commands, paths and ids, so piped and CI runs read cleanly; `--color` forces colour on.
