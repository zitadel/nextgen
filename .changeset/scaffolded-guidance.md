---
"@zitadel/cli": patch
"@zitadel/config": patch
"@zitadel/sdk-core": patch
"@zitadel/server": patch
"@zitadel/sdk-solid": patch
"@zitadel/sdk-qwik": patch
"@zitadel/sdk-svelte": patch
"@zitadel/sdk-vue": patch
"@zitadel/sdk-angular": patch
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

`zitadel eject` removes what setup wrote: the marker-fenced guidance section
is stripped from `README.md`/`AGENTS.md` (content outside the markers is
untouched), and a file is deleted only when nothing but the scaffold-created
header would remain — no stale golden path survives pointing at deleted
`.zitadel/` files.

Every SDK wrapper now forwards `locales`/`lang` to the widget (previously
only React did; Solid/Qwik/Svelte accepted and discarded them, Vue/Angular
did not expose them). The flow dialect meta-schema (`@zitadel/server`
embeds it; `@zitadel/config` ships the committed copy) marks a transition's
`action` as nullable, matching the OpenAPI contract — editors no longer
flag `"action": null`.
