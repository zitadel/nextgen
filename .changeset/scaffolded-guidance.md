---
"@zitadel/cli": patch
"@zitadel/config": patch
"@zitadel/sdk-core": patch
---

Scaffolded projects now explain their own next step. `zitadel setup` writes
an `AGENTS.md` guidance section for AI agents and an "Authentication
(Zitadel)" section into the app README (marker-fenced — existing content is
never clobbered), copies the flow/schema dialect meta-schemas into
`.zitadel/meta/`, and scaffolds flow files with
`"$schema": "../meta/flow-definition.json"` so editors validate and
autocomplete flow edits offline. The `$schema` pointer is local-only: sync
ignores it and write-back preserves it. `ZitadelLogin` wrappers gain typed
`locales`/`lang` props for labelling custom flow steps (see the new
"Customize copy" docs page).
