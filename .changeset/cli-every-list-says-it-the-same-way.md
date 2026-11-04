---
"@zitadel/cli": patch
"@zitadel/config": patch
---

The last four lists that worded "found nothing" for themselves now say what every other list says. `zitadel variable list`, `zitadel origin list`, `zitadel env list` and `zitadel resources` answer an empty result with `No <things> found.`, derived from the resource as the count already was, instead of "No variables on the project.", "No origins on the project.", "No environments are bound here. Run `zitadel env add <name>` to bind one." and "No resources.". `zitadel variable list --preview` says it in the same words as `zitadel variable list`, which is what its count already did. An empty `zitadel env list` no longer spells a command out by hand, so the one spelling rule covers that file too.

The three refusals that ordered the reader about now state what is wrong, like every other message: a blank display name, client id or client secret is reported as empty rather than as an instruction to type one. They reach `--json` only as an error `message`, never as a `hint`, and `next_commands` is unchanged.
