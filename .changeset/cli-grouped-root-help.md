---
"@zitadel/cli": minor
---

Group the root help by purpose. `zitadel`, `zitadel --help`, and `zitadel help` now list commands under "Project commands", "Local server commands", and "Configuration commands" in journey order, with oclif's own utilities under "Additional commands", followed by flags, examples, and where to learn more, in the layout of `gh --help`. Nested commands such as `schemas list` and `branding eject` are listed inline; the `uninstall` alias and `help` are not. Per-command help and `--json` output are unchanged.
