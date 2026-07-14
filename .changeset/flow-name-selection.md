---
"@zitadel/components": patch
"@zitadel/sdk-core": patch
"@zitadel/sdk-vue": patch
"@zitadel/sdk-svelte": patch
"@zitadel/sdk-solid": patch
"@zitadel/sdk-qwik": patch
"@zitadel/sdk-angular": patch
"@zitadel/config": patch
"@zitadel/cli": patch
"@zitadel/server": patch
---

Select a flow definition by name. `<zitadel-login>` gains a `flow-name`
attribute (`flowName` prop on every framework wrapper) that sends
`flow_definition_name` on flow start, so a project with several synced
flows can run a specific one instead of the audience-resolved default.
An unknown name or a purpose mismatch surfaces as a clear startup error
naming the attribute. Audience selection itself is now honored and
deterministic: hinted app beats hinted team beats the newest unscoped
flow, and a flow scoped to an app/team no longer captures the project
default. The flows README and plan/apply docs explain how to add and
select a second flow.

Because newest-unscoped-wins means a new flow can silently take over the
default login, `plan` warns on any create of an active, unscoped flow in
a project that already has flows (`warn/default-flow-swap`, a
non-blocking `# warning:` line and a `--json` warnings entry) — scope
the flow via `audience` or pin `flow-name` in the widget to opt out.
The offline dialect gains the committed `auth-methods`/`auth-method`
meta-schema copies that `user-schema.json` references, so editors
resolve the full dialect without network access.
