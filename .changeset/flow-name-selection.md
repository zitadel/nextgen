---
"@zitadel/components": patch
"@zitadel/sdk-core": patch
"@zitadel/sdk-vue": patch
"@zitadel/sdk-svelte": patch
"@zitadel/sdk-solid": patch
"@zitadel/sdk-qwik": patch
"@zitadel/sdk-angular": patch
"@zitadel/config": patch
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
