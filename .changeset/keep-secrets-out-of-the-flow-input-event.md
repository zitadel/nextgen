---
"@zitadel/components": minor
"@zitadel/sdk-core": minor
"@zitadel/sdk-react": minor
"@zitadel/sdk-vue": minor
"@zitadel/sdk-angular": minor
"@zitadel/sdk-svelte": minor
"@zitadel/sdk-solid": minor
"@zitadel/sdk-qwik": minor
"@zitadel/sdk-next": minor
"@zitadel/sdk-nuxt": minor
---

Security-relevant change to a public event contract: the `zitadel-flow-input` event, which `<zitadel-login>` dispatches on every edit and which is composed so any script on the page can read it, no longer carries the value of a secret field. Its detail used to be `{ name, value }` for every field, so an analytics script listening on `document` could read a visitor's password or one-time code as it was typed. The detail is now a union you narrow on `secret`: `{ name, secret: false, value }` for an ordinary field and `{ name, secret: true }`, with no `value`, for a secret one. A field is secret when its step definition has the `password` type or an `autocomplete` of `current-password`, `new-password` or `one-time-code`, never judged from its name, and a field the step does not define is treated as secret. The atoms' own `zl-input` event no longer leaves the widget either. Code that reads `detail.value` from `onFlowInput` (or the Vue, Angular and Svelte equivalents) must check `detail.secret` first; the types in `@zitadel/sdk-core` and every SDK are updated and `ZitadelFlowInputEventDetail` is exported from `@zitadel/components`.
